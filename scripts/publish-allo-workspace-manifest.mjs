#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

import {
  hasVerifiedCleanScan,
  manifestBytes,
  publishScannedManifestConfirmation,
  sha256,
  validateCloudManifest,
} from "./allo-workspace-import-common.mjs";

process.on("uncaughtException", () => fail("The scanned manifest was not published."));
process.on("unhandledRejection", () => fail("The scanned manifest was not published."));

const args = argumentMap();
const manifestPath = absoluteArgument("--manifest");
const privateReceipt = absoluteArgument("--private-receipt");
if (args.get("--confirm") !== publishScannedManifestConfirmation) {
  fail(`Refusing to publish without --confirm=${publishScannedManifestConfirmation}.`);
}
const account = process.env.AZURE_STORAGE_ACCOUNT?.trim();
const containerName = process.env.AZURE_STORAGE_CONTAINER_RAW?.trim() || "raw";
if (!account) fail("AZURE_STORAGE_ACCOUNT is required.");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateCloudManifest(manifest);
if (!hasVerifiedCleanScan(manifest)) fail("A verified clean-scan attestation is required.");
for (const workspace of manifest.workspaces) {
  for (const file of workspace.files) {
    if (file.blob_container !== containerName) fail("The manifest targets a different private container.");
  }
}

const bytes = manifestBytes(manifest);
const manifestSha256 = sha256(bytes);
const manifestBlobKey = `allo-import/v1/manifests/${manifestSha256}.json`;
const container = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential({
  managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined,
})).getContainerClient(containerName);
const blob = container.getBlockBlobClient(manifestBlobKey);
await blob.uploadData(bytes, {
  conditions: { ifNoneMatch: "*" },
  blobHTTPHeaders: { blobContentType: "application/json" },
  metadata: { sourceSystem: "allo", manifestSha256, malwareScan: "clean" },
}).catch(async (error) => {
  if (![409, 412].includes(storageStatus(error))) throw error;
  const properties = await blob.getProperties();
  if (Number(properties.contentLength) !== bytes.length) throw new Error("existing_manifest_mismatch");
});
const receipt = Buffer.from(`${JSON.stringify({
  version: 1,
  manifest_sha256: manifestSha256,
  manifest_blob_key: manifestBlobKey,
  file_count: manifest.available_file_count,
  total_bytes: manifest.malware_scan.total_bytes,
  malware_scan_status: "clean",
  published_at: new Date().toISOString(),
})}\n`, "utf8");
await writeFile(privateReceipt, receipt, { mode: 0o600 });
await chmod(privateReceipt, 0o600);
console.log(JSON.stringify({
  ok: true,
  manifest_sha256: manifestSha256,
  manifest_blob_key: manifestBlobKey,
  file_count: manifest.available_file_count,
}));

function argumentMap() {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.split("=");
    return [key, rest.join("=")];
  }));
}

function absoluteArgument(name) {
  const value = args.get(name);
  if (!value || !path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  return value;
}

function storageStatus(error) {
  if (!error || typeof error !== "object") return 0;
  const value = "statusCode" in error ? Number(error.statusCode) : "status" in error ? Number(error.status) : 0;
  return Number.isFinite(value) ? value : 0;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

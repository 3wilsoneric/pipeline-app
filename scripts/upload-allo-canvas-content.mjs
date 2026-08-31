#!/usr/bin/env node

import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

import {
  buildManifest,
  contentBlobKey,
  loadManifest,
  manifestBytes,
  sha256,
  uploadConfirmation,
  validateManifest,
} from "./allo-canvas-content-common.mjs";

const args = argumentMap();
const manifestPath = absoluteArgument("--manifest");
const privateOutput = absoluteArgument("--private-output");
const dryRun = args.has("--dry-run");
const concurrency = integerArgument("--concurrency", 8, 1, 16);
const apply = !dryRun && args.get("--confirm") === uploadConfirmation;
if (!dryRun && !apply) fail(`Refusing to upload without --confirm=${uploadConfirmation}.`);
const account = process.env.AZURE_STORAGE_ACCOUNT?.trim();
const containerName = process.env.AZURE_STORAGE_CONTAINER_RAW?.trim() || "raw";
if (apply && !account) fail("AZURE_STORAGE_ACCOUNT is required.");

const localManifest = await loadManifest(manifestPath);
const plannedBytes = localManifest.snapshots.reduce((sum, snapshot) => sum + rawSnapshotBytes(snapshot).length, 0);
if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    mode: "plan",
    canvas_count: localManifest.canvas_count,
    block_count: localManifest.block_count,
    total_bytes: plannedBytes,
    concurrency,
    changes_made: false,
  }));
  process.exit(0);
}

const container = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential({
  managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined,
})).getContainerClient(containerName);
const cloudSnapshots = structuredClone(localManifest.snapshots);
let uploaded = 0;
let existing = 0;
let verifiedBytes = 0;

try {
  await runBounded(cloudSnapshots, concurrency, async (snapshot) => {
    const bytes = rawSnapshotBytes(snapshot);
    const payloadSha256 = sha256(bytes);
    const blobKey = contentBlobKey(snapshot);
    const blob = container.getBlockBlobClient(blobKey);
    if (await blob.exists()) {
      const properties = await blob.getProperties();
      const storedSourceDigest = metadataValue(properties.metadata, "sourceSha256");
      const storedPayloadDigest = metadataValue(properties.metadata, "payloadSha256");
      if (Number(properties.contentLength) !== bytes.length
          || storedSourceDigest !== snapshot.source_sha256
          || storedPayloadDigest !== payloadSha256) throw new Error("existing_snapshot_mismatch");
      existing += 1;
    } else {
      await blob.uploadData(bytes, {
        conditions: { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: "application/json" },
        metadata: {
          sourceSystem: "allo",
          sourceSha256: snapshot.source_sha256,
          payloadSha256,
          dataClass: "user_supplied_real",
        },
      });
      uploaded += 1;
    }
    snapshot.raw_blob_container = containerName;
    snapshot.raw_blob_key = blobKey;
    verifiedBytes += bytes.length;
  });

  const cloudManifest = buildManifest(cloudSnapshots, {
    created_at: localManifest.created_at,
    capture_scope: localManifest.capture_scope,
  });
  validateManifest(cloudManifest, { requireBlob: true });
  const cloudBytes = manifestBytes(cloudManifest);
  const manifestSha256 = sha256(cloudBytes);
  const manifestBlobKey = `allo-content/v1/manifests/${manifestSha256}.json`;
  const manifestBlob = container.getBlockBlobClient(manifestBlobKey);
  await manifestBlob.uploadData(cloudBytes, {
    conditions: { ifNoneMatch: "*" },
    blobHTTPHeaders: { blobContentType: "application/json" },
    metadata: { sourceSystem: "allo", manifestSha256, dataClass: "user_supplied_real" },
  }).catch(async (error) => {
    if (![409, 412].includes(storageStatus(error))) throw error;
    const properties = await manifestBlob.getProperties();
    if (Number(properties.contentLength) !== cloudBytes.length) throw new Error("existing_manifest_mismatch");
  });
  await writeFile(privateOutput, cloudBytes, { mode: 0o600 });
  await chmod(privateOutput, 0o600);
  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    uploaded,
    existing,
    verified_bytes: verifiedBytes,
    manifest_sha256: manifestSha256,
    manifest_blob_key: manifestBlobKey,
    private_output_written: true,
  }));
} catch (error) {
  fail(`The ALLO canvas-content upload stopped safely (${safeFailureCode(error)}). It is restartable and no canvas text was logged.`);
}

function rawSnapshotBytes(snapshot) {
  return manifestBytes({
    version: 1,
    data_class: "user_supplied_real",
    source_system: "allo",
    source_canvas_id: snapshot.source_canvas_id,
    source_canvas_name: snapshot.source_canvas_name,
    source_project_id: snapshot.source_project_id,
    source_project_name: snapshot.source_project_name,
    source_locator: snapshot.source_locator,
    capture_method: snapshot.capture_method,
    captured_at: snapshot.captured_at,
    source_sha256: snapshot.source_sha256,
    block_count: snapshot.block_count,
    blocks: snapshot.blocks,
  });
}

async function runBounded(items, concurrencyLimit, worker) {
  let index = 0;
  await Promise.all(Array.from({ length: concurrencyLimit }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }));
}

function metadataValue(metadata, key) {
  if (!metadata) return null;
  const target = key.toLocaleLowerCase("en-US");
  const entry = Object.entries(metadata).find(([name]) => name.toLocaleLowerCase("en-US") === target);
  return entry?.[1] ?? null;
}

function storageStatus(error) {
  if (!error || typeof error !== "object") return 0;
  const value = "statusCode" in error ? Number(error.statusCode) : "status" in error ? Number(error.status) : 0;
  return Number.isFinite(value) ? value : 0;
}

function safeFailureCode(error) {
  const value = error instanceof Error ? error.message : "upload_failed";
  return new Set(["existing_snapshot_mismatch", "existing_manifest_mismatch"]).has(value) ? value : "upload_failed";
}

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

function integerArgument(name, fallback, minimum, maximum) {
  const raw = args.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`${name} must be between ${minimum} and ${maximum}.`);
  return value;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

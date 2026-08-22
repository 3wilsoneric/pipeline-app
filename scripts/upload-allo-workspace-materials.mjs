#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

import {
  cloudManifest,
  manifestBytes,
  sha256,
  uploadConfirmation,
} from "./allo-workspace-import-common.mjs";

const args = argumentMap();
const manifestPath = absoluteArgument("--manifest");
const privateOutput = optionalAbsoluteArgument("--private-output");
const dryRun = args.has("--dry-run");
const prepareOnly = args.has("--prepare-only");
const workerConcurrency = boundedIntegerArgument("--concurrency", 16, 1, 32);
const apply = !dryRun && !prepareOnly && args.get("--confirm") === uploadConfirmation;
if (!dryRun && !prepareOnly && !apply) fail(`Refusing to upload without --confirm=${uploadConfirmation}.`);
const account = process.env.AZURE_STORAGE_ACCOUNT?.trim();
if (!account && apply) fail("AZURE_STORAGE_ACCOUNT is required.");
const containerName = process.env.AZURE_STORAGE_CONTAINER_RAW?.trim() || "raw";

const localManifest = JSON.parse(await readFile(manifestPath, "utf8"));
const cloud = cloudManifest(localManifest, containerName);
const totalBytes = cloud.workspaces.reduce(
  (sum, workspace) => sum + workspace.files.reduce((fileSum, file) => fileSum + file.source_byte_size, 0),
  0,
);
if (dryRun) {
  print({
    ok: true,
    mode: "plan",
    workspace_count: cloud.workspace_count,
    material_count: cloud.available_file_count,
    total_bytes: totalBytes,
    concurrency: workerConcurrency,
    digest_calculation_required: true,
    changes_made: false,
  });
  process.exit(0);
}

const container = apply
  ? new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential({
      managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined,
    })).getContainerClient(containerName)
  : null;

let uploaded = 0;
let existing = 0;
let verifiedBytes = 0;
try {
  const localFiles = new Map();
  for (const workspace of localManifest.workspaces) {
    for (const file of workspace.files) {
      if (file.source_available) localFiles.set(`${workspace.source_workspace_id}\u0000${file.source_item_id}`, file);
    }
  }
  const tasks = [];
  for (const workspace of cloud.workspaces) {
    for (const file of workspace.files) {
      const local = localFiles.get(`${workspace.source_workspace_id}\u0000${file.source_item_id}`);
      if (!local) throw new Error("local_source_missing");
      tasks.push({ file, sourcePath: local.source_path });
    }
  }

  await runBounded(tasks, workerConcurrency, async ({ file, sourcePath }) => {
    const metadata = await stat(sourcePath);
    if (!metadata.isFile() || metadata.size !== file.source_byte_size) throw new Error("source_file_changed");
    const digest = await fileSha256(sourcePath);
    if (file.source_sha256 && digest !== file.source_sha256) throw new Error("source_file_changed");
    file.source_sha256 = digest;
    if (prepareOnly) {
      existing += 1;
      verifiedBytes += file.source_byte_size;
      return;
    }
    const blob = container.getBlockBlobClient(file.blob_key);
    const exists = await blob.exists();
    if (exists) {
      const properties = await blob.getProperties();
      const storedDigest = properties.metadata?.sourceSha256 ?? properties.metadata?.sourcesha256;
      if (Number(properties.contentLength) !== file.source_byte_size || storedDigest !== digest) {
        throw new Error("existing_blob_mismatch");
      }
      existing += 1;
    } else {
      await blob.uploadFile(sourcePath, {
        concurrency: 4,
        blockSize: 8 * 1024 * 1024,
        conditions: { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: file.source_content_type },
        metadata: { sourceSystem: "allo", sourceSha256: digest },
      });
      uploaded += 1;
    }
    verifiedBytes += file.source_byte_size;
    const completed = uploaded + existing;
    if (completed % 500 === 0) print({ progress: true, completed, total: tasks.length });
  });

  const bytes = manifestBytes(cloud);
  const manifestSha256 = sha256(bytes);
  const manifestBlobKey = `allo-import/v1/manifests/${manifestSha256}.json`;
  if (privateOutput) {
    await writeFile(privateOutput, bytes, { mode: 0o600 });
    await chmod(privateOutput, 0o600);
  }
  if (prepareOnly) {
    print({
      ok: true,
      mode: "prepare_only",
      verified_files: existing,
      verified_bytes: verifiedBytes,
      manifest_sha256: manifestSha256,
      manifest_blob_key: manifestBlobKey,
      changes_made: false,
    });
    process.exit(0);
  }
  const manifestBlob = container.getBlockBlobClient(manifestBlobKey);
  await manifestBlob.uploadData(bytes, {
    conditions: { ifNoneMatch: "*" },
    blobHTTPHeaders: { blobContentType: "application/json" },
    metadata: { sourceSystem: "allo", manifestSha256 },
  }).catch(async (error) => {
    if (![409, 412].includes(storageStatus(error))) throw error;
    const properties = await manifestBlob.getProperties();
    if (Number(properties.contentLength) !== bytes.length) throw new Error("existing_manifest_mismatch");
  });
} catch (error) {
  const code = safeFailureCode(error);
  const diagnostic = safeStorageDiagnostic(error);
  fail(`The Allo material upload stopped safely (${code}${diagnostic}). It is restartable; no client names or file names were logged.`);
}

print({
  ok: true,
  mode: "apply",
  uploaded,
  existing,
  verified_bytes: verifiedBytes,
  manifest_sha256: sha256(manifestBytes(cloud)),
  manifest_blob_key: `allo-import/v1/manifests/${sha256(manifestBytes(cloud))}.json`,
});

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function runBounded(items, concurrency, worker) {
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }));
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

function optionalAbsoluteArgument(name) {
  const value = args.get(name);
  if (!value) return null;
  if (!path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  return value;
}

function boundedIntegerArgument(name, fallback, minimum, maximum) {
  const raw = args.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function storageStatus(error) {
  if (!error || typeof error !== "object") return 0;
  const value = "statusCode" in error ? Number(error.statusCode) : "status" in error ? Number(error.status) : 0;
  return Number.isFinite(value) ? value : 0;
}

function safeFailureCode(error) {
  const value = error instanceof Error ? error.message : "upload_failed";
  return new Set([
    "local_source_missing",
    "source_file_changed",
    "existing_blob_mismatch",
    "existing_manifest_mismatch",
    "manifest_invalid",
    "workspace_count_invalid",
    "workspace_count_mismatch",
    "workspace_invalid",
    "workspace_material_count_invalid",
    "workspace_stage_invalid",
    "material_invalid",
    "material_digest_invalid",
    "blob_locator_invalid",
  ]).has(value) ? value : "upload_failed";
}

function safeStorageDiagnostic(error) {
  if (!error || typeof error !== "object") return "";
  const status = storageStatus(error);
  const rawCode = "code" in error ? String(error.code ?? "") : "";
  const code = /^[A-Za-z0-9_.-]{1,80}$/.test(rawCode) ? rawCode : "";
  return [status ? `status_${status}` : "", code].filter(Boolean).map((value) => `:${value}`).join("");
}

function print(value) {
  console.log(JSON.stringify(value));
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

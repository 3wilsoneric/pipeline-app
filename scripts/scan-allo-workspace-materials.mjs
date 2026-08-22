#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  hasVerifiedCleanScan,
  manifestBytes,
  scanConfirmation,
  sha256,
  validateCloudManifest,
  validateLocalManifest,
} from "./allo-workspace-import-common.mjs";

process.on("uncaughtException", () => fail("The protected safety scan stopped safely without logging source paths."));
process.on("unhandledRejection", () => fail("The protected safety scan stopped safely without logging source paths."));

const args = argumentMap();
const localManifestPath = absoluteArgument("--local-manifest");
const cloudManifestPath = absoluteArgument("--cloud-manifest");
const databasePath = absoluteArgument("--database");
const privateOutput = absoluteArgument("--private-output");
const privateLog = absoluteArgument("--private-log");
const privateFileList = absoluteArgument("--private-file-list");
const dryRun = args.has("--dry-run");
if (!dryRun && args.get("--confirm") !== scanConfirmation) {
  fail(`Refusing to scan without --confirm=${scanConfirmation}.`);
}

const localBytes = await readFile(localManifestPath);
const localManifest = JSON.parse(localBytes.toString("utf8"));
const cloudManifest = JSON.parse(await readFile(cloudManifestPath, "utf8"));
validateLocalManifest(localManifest);
validateCloudManifest(cloudManifest);
if (cloudManifest.malware_scan !== undefined) fail("The cloud manifest already has a safety attestation.");

const localFiles = new Map();
for (const workspace of localManifest.workspaces) {
  for (const file of workspace.files) {
    if (file.source_available) localFiles.set(fileKey(workspace.source_workspace_id, file.source_item_id), file);
  }
}
const files = [];
for (const workspace of cloudManifest.workspaces) {
  for (const file of workspace.files) {
    const local = localFiles.get(fileKey(workspace.source_workspace_id, file.source_item_id));
    if (!local) fail("A cloud material does not have an available local source.");
    if (!path.isAbsolute(local.source_path) || /[\r\n\0]/.test(local.source_path)) {
      fail("A protected source path cannot be represented safely in the scanner file list.");
    }
    files.push({
      path: local.source_path,
      byteSize: file.source_byte_size,
      sha256: file.source_sha256,
    });
  }
}
const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
if (files.length !== cloudManifest.available_file_count) fail("The cloud material count does not match the protected sources.");

if (dryRun) {
  print({ ok: true, mode: "plan", file_count: files.length, total_bytes: totalBytes, changes_made: false });
  process.exit(0);
}

await ensureScannerDatabase(databasePath);
const sourceStates = new Map();
let verified = 0;
await runBounded(files, 3, async (file) => {
  const before = await stat(file.path);
  if (!before.isFile() || before.size !== file.byteSize) throw new Error("source_file_changed");
  const digest = await fileSha256(file.path);
  const after = await stat(file.path);
  if (digest !== file.sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("source_file_changed");
  }
  sourceStates.set(file.path, { size: after.size, mtimeMs: after.mtimeMs });
  verified += 1;
  if (verified % 500 === 0) print({ progress: true, phase: "verify", completed: verified, total: files.length });
});

await writeProtected(privateFileList, `${files.map((file) => file.path).join("\n")}\n`);
await writeProtected(privateLog, "");
const scannerVersion = await readScannerVersion(databasePath);
const scanCode = await runScanner(databasePath, privateFileList, privateLog);
if (scanCode !== 0) {
  fail(scanCode === 1
    ? "The safety scan blocked one or more materials. Details remain only in the protected scan log."
    : "The safety scan failed closed. Details remain only in the protected scan log.");
}

await runBounded(files, 12, async (file) => {
  const current = await stat(file.path);
  const expected = sourceStates.get(file.path);
  if (!current.isFile() || !expected || current.size !== expected.size || current.mtimeMs !== expected.mtimeMs) {
    throw new Error("source_file_changed_during_scan");
  }
});

const sealed = {
  ...cloudManifest,
  malware_scan: {
    status: "clean",
    scanner: "ClamAV",
    scanner_version: scannerVersion,
    scanned_at: new Date().toISOString(),
    base_manifest_sha256: sha256(manifestBytes(cloudManifest)),
    local_manifest_sha256: sha256(localBytes),
    file_count: files.length,
    total_bytes: totalBytes,
  },
};
validateCloudManifest(sealed);
if (!hasVerifiedCleanScan(sealed)) fail("The generated safety attestation did not validate.");
await writeProtected(privateOutput, manifestBytes(sealed));
print({
  ok: true,
  mode: "apply",
  file_count: files.length,
  total_bytes: totalBytes,
  sealed_manifest_sha256: sha256(manifestBytes(sealed)),
});

async function ensureScannerDatabase(database) {
  const metadata = await stat(database).catch(() => null);
  if (!metadata?.isDirectory()) fail("The ClamAV database directory is unavailable.");
  const version = await readScannerVersion(database).catch(() => "");
  if (!version || /\/0\//.test(version)) fail("Current ClamAV signature definitions are required.");
}

async function readScannerVersion(database) {
  const result = await runProcess("clamscan", ["--database", database, "--version"], { capture: true });
  if (result.code !== 0) throw new Error("scanner_version_unavailable");
  const version = result.output.trim().replace(/\s+/g, " ");
  if (!version || version.length > 200) throw new Error("scanner_version_invalid");
  return version;
}

async function runScanner(database, fileList, logPath) {
  const log = await open(logPath, "a", 0o600);
  try {
    const result = await runProcess("clamscan", [
      "--database", database,
      "--file-list", fileList,
      "--infected",
      "--no-summary",
      "--alert-exceeds-max=yes",
      "--fail-if-cvd-older-than=7",
      "--max-filesize=500M",
      "--max-scansize=2G",
      "--max-files=100000",
      "--max-recursion=32",
    ], { stdout: log.fd, stderr: log.fd });
    return result.code;
  } finally {
    await log.close();
  }
}

function runProcess(command, processArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const output = [];
    const child = spawn(command, processArgs, {
      stdio: ["ignore", options.capture ? "pipe" : options.stdout ?? "ignore", options.capture ? "pipe" : options.stderr ?? "ignore"],
    });
    if (options.capture) {
      child.stdout.on("data", (chunk) => output.push(chunk));
      child.stderr.on("data", (chunk) => output.push(chunk));
    }
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 2, output: Buffer.concat(output).toString("utf8") }));
  });
}

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

async function writeProtected(filePath, value) {
  await writeFile(filePath, value, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function fileKey(workspaceId, itemId) {
  return `${workspaceId}\u0000${itemId}`;
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

function print(value) {
  console.log(JSON.stringify(value));
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

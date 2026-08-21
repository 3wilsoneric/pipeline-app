#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.split("=");
  return [key, rest.join("=")];
}));
const manifestPath = requiredAbsolutePath("--manifest");
const privateOutputPath = requiredAbsolutePath("--private-output");
const summaryOutputPath = optionalAbsolutePath("--summary-output");
const compareDatabase = args.has("--database");
const verifyBlobs = args.has("--verify-blobs");

if (verifyBlobs && !compareDatabase) fail("--verify-blobs also requires --database.");
if (compareDatabase && !process.env.PIPELINE_DATABASE_URL?.trim()) {
  fail("PIPELINE_DATABASE_URL is required with --database.");
}
if (verifyBlobs && !process.env.AZURE_STORAGE_ACCOUNT?.trim()) {
  fail("AZURE_STORAGE_ACCOUNT is required with --verify-blobs.");
}

const rawManifest = await readFile(manifestPath);
const manifest = JSON.parse(rawManifest.toString("utf8"));
validateManifest(manifest);
const manifestSha256 = createHash("sha256").update(rawManifest).digest("hex");
const databaseRows = compareDatabase
  ? await loadDatabaseRows(manifestSha256)
  : new Map();
const blobReader = verifyBlobs ? await createBlobReader() : null;
const details = [];

for (const item of manifest.items) {
  const local = await inspectLocalSource(item);
  const database = databaseRows.get(item.source_item_id) ?? null;
  const blob = database?.blob_key && blobReader
    ? await blobReader(database.blob_container, database.blob_key)
    : null;
  const classification = classify({ item, local, database, blob, compareDatabase, verifyBlobs });
  details.push({
    source_item_id: item.source_item_id,
    source_client_name: item.source_client_name,
    source_file_name: item.source_file_name,
    source_path: item.source_path,
    source_content_type: item.source_content_type,
    source_byte_size: item.source_byte_size,
    source_sha256: item.source_sha256,
    classification,
    local,
    database: database
      ? {
          match_status: database.match_status,
          document_present: Boolean(database.document_id),
          document_metadata_matches: documentMetadataMatches(item, database),
          preview_status: database.preview_status,
          processing_status: database.processing_status,
        }
      : null,
    blob,
  });
}

const counts = Object.fromEntries(
  ["present", "metadata-only", "file-only", "unmatched", "structured-not-imported", "intentionally-excluded", "source-changed"]
    .map((classification) => [classification, details.filter((item) => item.classification === classification).length]),
);
const totalBytes = details.reduce((sum, item) => sum + Number(item.source_byte_size || 0), 0);
const locallyVerified = details.filter((item) => item.local.status === "verified").length;
const blobVerified = details.filter((item) => item.blob?.status === "verified").length;
const generatedAt = new Date().toISOString();
const summary = {
  version: 1,
  generated_at: generatedAt,
  source_system: manifest.source_system,
  comparison_mode: verifyBlobs ? "database_and_blob" : compareDatabase ? "database_metadata" : "local_sources_only",
  item_count: details.length,
  total_bytes: totalBytes,
  local_sources_verified: locallyVerified,
  blob_objects_verified: blobVerified,
  counts,
  complete: counts.present === details.length,
};
const privateReport = {
  ...summary,
  data_class: "protected_reconciliation_detail",
  warning: "Contains PHI, absolute paths, hashes, and import state. Store only in an approved protected location.",
  manifest_id: manifest.manifest_id,
  manifest_sha256: manifestSha256,
  items: details,
};

await writeProtectedJson(privateOutputPath, privateReport);
if (summaryOutputPath) await writeProtectedJson(summaryOutputPath, summary);
console.log(JSON.stringify({ ok: true, ...summary }));

async function inspectLocalSource(item) {
  const metadata = await stat(item.source_path).catch(() => null);
  if (!metadata?.isFile()) return { status: "missing" };
  if (metadata.size !== item.source_byte_size) {
    return { status: "changed", byte_size_matches: false, sha256_matches: false };
  }
  const bytes = await readFile(item.source_path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    status: sha256 === item.source_sha256 ? "verified" : "changed",
    byte_size_matches: true,
    sha256_matches: sha256 === item.source_sha256,
  };
}

async function loadDatabaseRows(manifestHash) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.PIPELINE_DATABASE_URL.trim(), {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
    max: 1,
    prepare: false,
    connection: { application_name: "pipeline-client-file-reconciliation" },
  });
  try {
    const rows = await sql`
      select
        i.source_item_id,
        i.match_status,
        i.source_file_name,
        i.source_content_type,
        i.source_byte_size,
        i.source_sha256,
        i.imported_document_id::text as document_id,
        d.file_name as document_file_name,
        d.content_type as document_content_type,
        d.byte_size as document_byte_size,
        d.sha256 as document_sha256,
        d.blob_container,
        d.blob_key,
        d.preview_status,
        d.processing_status
      from pipeline.client_file_import_items i
      join pipeline.client_file_import_batches b on b.import_batch_id = i.import_batch_id
      left join pipeline.documents d
        on d.document_id = i.imported_document_id
       and d.deleted_at is null
      where b.manifest_sha256 = ${manifestHash}
    `;
    return new Map(rows.map((row) => [row.source_item_id, row]));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function createBlobReader() {
  const [{ DefaultAzureCredential }, { BlobServiceClient }] = await Promise.all([
    import("@azure/identity"),
    import("@azure/storage-blob"),
  ]);
  const account = process.env.AZURE_STORAGE_ACCOUNT.trim();
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined,
  });
  const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
  return async (containerName, blobKey) => {
    try {
      const properties = await service.getContainerClient(containerName).getBlobClient(blobKey).getProperties();
      return {
        status: "verified",
        byte_size: Number(properties.contentLength ?? 0),
      };
    } catch (error) {
      return {
        status: error?.statusCode === 404 ? "missing" : "unavailable",
        http_status: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
      };
    }
  };
}

function classify({ item, local, database, blob, compareDatabase: compare, verifyBlobs: verify }) {
  if (local.status !== "verified") return "source-changed";
  if (!compare) return isStructured(item.source_file_name) ? "structured-not-imported" : "file-only";
  if (!database) return isStructured(item.source_file_name) ? "structured-not-imported" : "file-only";
  if (database.match_status === "rejected") return "intentionally-excluded";
  if (["unmatched", "candidate"].includes(database.match_status)) return "unmatched";
  if (!database.document_id || !documentMetadataMatches(item, database)) return "metadata-only";
  if (verify && blob?.status !== "verified") return "metadata-only";
  if (verify && Number(blob.byte_size) !== Number(item.source_byte_size)) return "metadata-only";
  return "present";
}

function documentMetadataMatches(item, database) {
  return database.document_file_name === item.source_file_name
    && database.document_content_type === item.source_content_type
    && Number(database.document_byte_size) === Number(item.source_byte_size)
    && database.document_sha256 === item.source_sha256;
}

function isStructured(filename) {
  return new Set([".csv", ".tsv", ".xls", ".xlsx", ".json", ".parquet"]).has(path.extname(filename).toLowerCase());
}

async function writeProtectedJson(outputPath, value) {
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(outputPath, 0o600);
}

function requiredAbsolutePath(key) {
  const value = args.get(key);
  if (!value || !path.isAbsolute(value)) fail(`${key} must be an absolute path.`);
  return value;
}

function optionalAbsolutePath(key) {
  const value = args.get(key);
  if (!value) return null;
  if (!path.isAbsolute(value)) fail(`${key} must be an absolute path.`);
  return value;
}

function validateManifest(value) {
  if (value?.version !== 1 || value?.data_class !== "user_supplied_real") fail("The private manifest is invalid.");
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100_000) fail("The manifest item count is invalid.");
  for (const item of value.items) {
    if (!item || typeof item !== "object") fail("A manifest item is invalid.");
    if (!path.isAbsolute(item.source_path || "")) fail("Every manifest source_path must be absolute.");
    if (!/^[a-f0-9]{64}$/.test(item.source_sha256 || "")) fail("A manifest source hash is invalid.");
    if (!Number.isSafeInteger(item.source_byte_size) || item.source_byte_size < 1) fail("A manifest source size is invalid.");
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

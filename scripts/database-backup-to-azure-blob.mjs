#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import postgres from "postgres";

const run = promisify(execFile);
const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
const storageAccount = process.env.PIPELINE_BACKUP_STORAGE_ACCOUNT?.trim();
const containerName = process.env.PIPELINE_BACKUP_CONTAINER?.trim() || "artifacts";
const reason = process.env.PIPELINE_BACKUP_REASON?.trim() || "manual";
const pgDump = process.env.PG_DUMP_PATH?.trim() || "pg_dump";

if (!databaseUrl) fail("Configure PIPELINE_DATABASE_URL before creating an Azure backup.");
if (!storageAccount || !/^[a-z0-9]{3,24}$/.test(storageAccount)) fail("Configure a valid PIPELINE_BACKUP_STORAGE_ACCOUNT.");
if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(containerName)) fail("Configure a valid PIPELINE_BACKUP_CONTAINER.");
if (!/^[a-z0-9-]{1,48}$/.test(reason)) fail("Configure a safe PIPELINE_BACKUP_REASON.");

const connection = parseDatabaseUrl(databaseUrl);
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").toLowerCase();
const backupPath = path.join(tmpdir(), `pipeline-${randomUUID()}.dump`);
const blobPrefix = `database-recovery/${reason}/${timestamp}`;
const backupBlobName = `${blobPrefix}/pipeline.dump`;
const manifestBlobName = `${blobPrefix}/pipeline.dump.manifest.json`;
const sql = postgres(databaseUrl, databaseOptions());
let reserved;
let migrationLockHeld = false;

try {
  reserved = await sql.reserve();
  await reserved`select pg_advisory_lock(hashtextextended('pipeline_schema_migrations', 0))`;
  migrationLockHeld = true;
  const migrations = await reserved`
    select migration_id from pipeline.schema_migrations order by migration_id
  `;
  await run(pgDump, [
    `--dbname=${connection.database}`,
    "--schema=pipeline",
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-acl",
    `--file=${backupPath}`,
  ], {
    env: databaseEnvironment(connection),
    maxBuffer: 1024 * 1024,
  });

  const backupBytes = await readFile(backupPath);
  const checksum = createHash("sha256").update(backupBytes).digest("hex");
  const backupStat = await stat(backupPath);
  const manifest = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    reason,
    format: "postgres_custom",
    database_scope: "pipeline_schema_only",
    sha256: checksum,
    byte_size: backupStat.size,
    migrations: migrations.map((row) => row.migration_id),
  };

  const token = await getStorageToken();
  await uploadBlockBlob({
    token,
    blobName: backupBlobName,
    bytes: backupBytes,
    contentType: "application/octet-stream",
    metadata: { sha256: checksum, migration_count: String(manifest.migrations.length) },
  });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await uploadBlockBlob({
    token,
    blobName: manifestBlobName,
    bytes: manifestBytes,
    contentType: "application/json",
  });

  const [backupProperties, manifestProperties] = await Promise.all([
    getBlobProperties(token, backupBlobName),
    getBlobProperties(token, manifestBlobName),
  ]);
  const verified = backupProperties.contentLength === backupStat.size
    && manifestProperties.contentLength === manifestBytes.byteLength
    && backupProperties.sha256 === checksum;
  if (!verified) throw new Error("backup_verification_failed");

  console.log(JSON.stringify({
    ok: true,
    operation: "pipeline_schema_backup",
    backup_reference: `${containerName}/${backupBlobName}`,
    manifest_reference: `${containerName}/${manifestBlobName}`,
    byte_size: backupStat.size,
    migration_count: manifest.migrations.length,
    sha256: checksum,
    encrypted_at_rest: true,
    configuration_present: {
      PIPELINE_DATABASE_URL: true,
      PIPELINE_BACKUP_STORAGE_ACCOUNT: true,
      PIPELINE_BACKUP_CONTAINER: true,
    },
    note: "Backup bytes remained inside Azure and no database values were logged.",
  }, null, 2));
} catch {
  console.error(JSON.stringify({
    ok: false,
    error: "Azure pipeline-schema backup failed. No connection details or database values were logged.",
    configuration_present: {
      PIPELINE_DATABASE_URL: true,
      PIPELINE_BACKUP_STORAGE_ACCOUNT: true,
      PIPELINE_BACKUP_CONTAINER: true,
    },
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (migrationLockHeld && reserved) {
    await reserved`select pg_advisory_unlock(hashtextextended('pipeline_schema_migrations', 0))`.catch(() => undefined);
  }
  reserved?.release();
  await sql.end({ timeout: 5 });
  await unlink(backupPath).catch(() => undefined);
}

function parseDatabaseUrl(value) {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || !url.hostname || !url.username) fail("PIPELINE_DATABASE_URL is invalid.");
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslmode: url.searchParams.get("sslmode") || process.env.PIPELINE_DATABASE_SSL_MODE || "require",
  };
}

function databaseEnvironment(value) {
  return {
    ...process.env,
    PGHOST: value.host,
    PGPORT: value.port,
    PGUSER: value.user,
    PGPASSWORD: value.password,
    PGDATABASE: value.database,
    PGSSLMODE: value.sslmode,
  };
}

function databaseOptions() {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable"
      ? false
      : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full"
        ? "verify-full"
        : "require",
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  };
}

async function getStorageToken() {
  const endpoint = process.env.IDENTITY_ENDPOINT?.trim();
  const identityHeader = process.env.IDENTITY_HEADER?.trim();
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  if (!endpoint || !identityHeader || !clientId) throw new Error("managed_identity_not_configured");
  const url = new URL(endpoint);
  url.searchParams.set("api-version", "2019-08-01");
  url.searchParams.set("resource", "https://storage.azure.com/");
  url.searchParams.set("client_id", clientId);
  const response = await fetch(url, {
    headers: { "X-IDENTITY-HEADER": identityHeader },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("managed_identity_token_failed");
  const body = await response.json();
  if (!body || typeof body !== "object" || typeof body.access_token !== "string") {
    throw new Error("managed_identity_token_invalid");
  }
  return body.access_token;
}

async function uploadBlockBlob({ token, blobName, bytes, contentType, metadata = {} }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Length": String(bytes.byteLength),
    "Content-Type": contentType,
    "If-None-Match": "*",
    "x-ms-blob-type": "BlockBlob",
    "x-ms-date": new Date().toUTCString(),
    "x-ms-version": "2023-11-03",
  };
  for (const [key, value] of Object.entries(metadata)) headers[`x-ms-meta-${key}`] = value;
  const response = await fetch(blobUrl(blobName), {
    method: "PUT",
    headers,
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status !== 201) throw new Error("blob_upload_failed");
}

async function getBlobProperties(token, blobName) {
  const response = await fetch(blobUrl(blobName), {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": "2023-11-03",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("blob_verification_failed");
  return {
    contentLength: Number(response.headers.get("content-length")),
    sha256: response.headers.get("x-ms-meta-sha256"),
  };
}

function blobUrl(blobName) {
  const encodedBlobName = blobName.split("/").map(encodeURIComponent).join("/");
  return `https://${storageAccount}.blob.core.windows.net/${containerName}/${encodedBlobName}`;
}

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    error: message,
    configuration_present: {
      PIPELINE_DATABASE_URL: Boolean(databaseUrl),
      PIPELINE_BACKUP_STORAGE_ACCOUNT: Boolean(storageAccount),
      PIPELINE_BACKUP_CONTAINER: Boolean(containerName),
    },
  }, null, 2));
  process.exit(1);
}

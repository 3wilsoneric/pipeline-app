#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";

const run = promisify(execFile);
const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
const options = parseArgs(process.argv.slice(2));
if (!databaseUrl) fail("Configure PIPELINE_DATABASE_URL before creating a backup.");
if (!options.out.endsWith(".dump")) fail("Backup output must use a .dump extension.");
const connection = parseDatabaseUrl(databaseUrl);
const sql = postgres(databaseUrl, databaseOptions(1));

try {
  const migrations = await sql`
    select migration_id from pipeline.schema_migrations order by migration_id
  `;
  await run(options.pgDump, [
    `--dbname=${connection.database}`,
    "--schema=pipeline",
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-acl",
    `--file=${options.out}`,
  ], {
    env: databaseEnvironment(connection),
    maxBuffer: 1024 * 1024,
  });
  await chmod(options.out, 0o600);
  const bytes = await readFile(options.out);
  const manifest = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    format: "postgres_custom",
    database_scope: "pipeline_schema_only",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byte_size: bytes.byteLength,
    migrations: migrations.map((row) => row.migration_id),
  };
  const manifestPath = `${options.out}.manifest.json`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    backup_file: options.out,
    manifest_file: manifestPath,
    byte_size: manifest.byte_size,
    migration_count: manifest.migrations.length,
    note: "The backup contains production data. Store it only in an encrypted, access-controlled recovery location.",
  }, null, 2));
} catch {
  fail("Pipeline database backup failed. No connection details were logged.");
} finally {
  await sql.end({ timeout: 5 });
}

function parseArgs(args) {
  const result = { out: "", pgDump: process.env.PG_DUMP_PATH?.trim() || "pg_dump" };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--out") result.out = args[++index] ?? "";
    else if (value === "--pg-dump") result.pgDump = args[++index] ?? "";
    else throw new Error(`Unknown option: ${value}`);
  }
  if (!result.out) fail("Pass --out /secure/path/pipeline-YYYYMMDD.dump.");
  return result;
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

function databaseEnvironment(connection) {
  return {
    ...process.env,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
    PGSSLMODE: connection.sslmode,
  };
}

function databaseOptions(max) {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
    max,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  };
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}

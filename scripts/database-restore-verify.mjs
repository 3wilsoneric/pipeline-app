#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";

const run = promisify(execFile);
const databaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim();
const options = parseArgs(process.argv.slice(2));
if (!databaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL before running a restore drill.");
if (process.env.PIPELINE_ALLOW_RESTORE_DRILL !== "true") fail("Set PIPELINE_ALLOW_RESTORE_DRILL=true to enable a destructive disposable-database drill.");
if (!options.confirmDisposable) fail("Pass --confirm-disposable to acknowledge that the Pipeline schema in the test database will be replaced.");
if (databaseUrl === process.env.PIPELINE_DATABASE_URL?.trim() && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
  fail("The restore drill cannot target PIPELINE_DATABASE_URL.");
}
const connection = parseDatabaseUrl(databaseUrl);
if (!/(test|drill|disposable|ci)/i.test(connection.database) && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
  fail("The restore target database name must contain test, drill, disposable, or ci.");
}

const backupBytes = await readFile(options.backup);
const manifest = JSON.parse(await readFile(`${options.backup}.manifest.json`, "utf8"));
const checksum = createHash("sha256").update(backupBytes).digest("hex");
if (manifest.schema_version !== 1 || manifest.sha256 !== checksum || manifest.database_scope !== "pipeline_schema_only") {
  fail("Backup manifest verification failed.");
}

try {
  await run(options.pgRestore, [
    `--dbname=${connection.database}`,
    "--schema=pipeline",
    "--clean",
    "--if-exists",
    "--exit-on-error",
    "--no-owner",
    "--no-acl",
    options.backup,
  ], {
    env: databaseEnvironment(connection),
    maxBuffer: 2 * 1024 * 1024,
  });
} catch {
  fail("Pipeline restore command failed. No connection details or row data were logged.");
}

const sql = postgres(databaseUrl, databaseOptions(1));
try {
  const rows = await sql`
    select
      (select count(*) from pipeline.schema_migrations) as migrations,
      (select count(*) from pipeline.referrals) as referrals,
      (select count(*) from pipeline.assessments) as assessments,
      (select count(*) from pipeline.documents) as documents,
      (select count(*) from pipeline.audit_events) as audit_events,
      (select count(*) from pipeline.user_workspace_state) as user_workspace_state
  `;
  const counts = Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
  const migrationRows = await sql`select migration_id from pipeline.schema_migrations order by migration_id`;
  const expectedMigrations = Array.isArray(manifest.migrations) ? manifest.migrations : [];
  const migrationsMatch = JSON.stringify(migrationRows.map((row) => row.migration_id)) === JSON.stringify(expectedMigrations);
  console.log(JSON.stringify({
    ok: migrationsMatch,
    checksum_verified: true,
    migration_history_verified: migrationsMatch,
    aggregate_counts: counts,
    note: "Only aggregate restored row counts are emitted. The disposable target must be destroyed after operator review.",
  }, null, 2));
  if (!migrationsMatch) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

function parseArgs(args) {
  const result = { backup: "", confirmDisposable: false, pgRestore: process.env.PG_RESTORE_PATH?.trim() || "pg_restore" };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--backup") result.backup = args[++index] ?? "";
    else if (value === "--pg-restore") result.pgRestore = args[++index] ?? "";
    else if (value === "--confirm-disposable") result.confirmDisposable = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (!result.backup.endsWith(".dump")) fail("Pass --backup /secure/path/pipeline.dump.");
  return result;
}

function parseDatabaseUrl(value) {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || !url.hostname || !url.username) fail("PIPELINE_TEST_DATABASE_URL is invalid.");
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
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_TEST_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}

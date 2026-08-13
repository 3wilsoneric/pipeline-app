#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

const root = process.cwd();
const migrationDirectory = path.join(root, "database/migrations");
const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
const planOnly = process.argv.includes("--plan");

const files = (await readdir(migrationDirectory))
  .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
  .sort();

class MigrationGuardError extends Error {
  constructor(code) {
    super(code);
    this.name = "MigrationGuardError";
    this.code = code;
  }
}

if (files.length === 0) fatal("No database migrations were found.");

if (planOnly && !databaseUrl) {
  printResult({ ok: true, mode: "plan", migrations: files.map(migrationId), configuration_present: { PIPELINE_DATABASE_URL: false } });
  process.exit(0);
}

if (!databaseUrl) fatal("Configure PIPELINE_DATABASE_URL before applying migrations.");

const sql = postgres(databaseUrl, {
  ssl: databaseSslMode(),
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});

const connection = await sql.reserve();
const applied = [];
const skipped = [];
const checksums = new Map();
let currentMigration = null;

try {
  await connection`select pg_advisory_lock(hashtextextended('pipeline_schema_migrations', 0))`;

  for (const file of files) {
    currentMigration = migrationId(file);
    const source = await readFile(path.join(migrationDirectory, file), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    checksums.set(currentMigration, checksum);
    const tableRows = await connection`
      select to_regclass('pipeline.schema_migrations') is not null as exists
    `;
    const migrationTableExists = Boolean(tableRows[0]?.exists);
    let existingChecksum = null;

    if (migrationTableExists) {
      const checksumColumnRows = await connection`
        select exists(
          select 1 from information_schema.columns
          where table_schema = 'pipeline'
            and table_name = 'schema_migrations'
            and column_name = 'checksum_sha256'
        ) as exists
      `;
      const checksumColumnExists = Boolean(checksumColumnRows[0]?.exists);
      const rows = checksumColumnExists
        ? await connection`
            select checksum_sha256 from pipeline.schema_migrations where migration_id = ${currentMigration}
          `
        : await connection`
            select null::text as checksum_sha256 from pipeline.schema_migrations where migration_id = ${currentMigration}
          `;

      if (rows[0]) {
        existingChecksum = rows[0].checksum_sha256;
        if (existingChecksum && existingChecksum !== checksum) {
          throw new MigrationGuardError("migration_checksum_mismatch");
        }
        if (planOnly) {
          skipped.push(currentMigration);
          continue;
        }
        if (checksumColumnExists && !existingChecksum) {
          await connection`
            update pipeline.schema_migrations set checksum_sha256 = ${checksum}
            where migration_id = ${currentMigration} and checksum_sha256 is null
          `;
        }
        skipped.push(currentMigration);
        continue;
      }
    }

    if (planOnly) {
      applied.push(currentMigration);
      continue;
    }

    await connection.unsafe(source);
    const checksumColumnRows = await connection`
      select exists(
        select 1 from information_schema.columns
        where table_schema = 'pipeline'
          and table_name = 'schema_migrations'
          and column_name = 'checksum_sha256'
      ) as exists
    `;
    if (checksumColumnRows[0]?.exists) {
      await connection`
        update pipeline.schema_migrations set checksum_sha256 = ${checksum}
        where migration_id = ${currentMigration}
      `;
    }
    applied.push(currentMigration);
  }

  if (!planOnly) {
    for (const [migration, checksum] of checksums) {
      await connection`
        update pipeline.schema_migrations
        set checksum_sha256 = ${checksum}
        where migration_id = ${migration} and checksum_sha256 is null
      `;
    }
  }

  printResult({
    ok: true,
    mode: planOnly ? "plan" : "apply",
    applied,
    already_applied: skipped,
    configuration_present: { PIPELINE_DATABASE_URL: true },
  });
} catch (error) {
  printResult({
    ok: false,
    migration: currentMigration,
    failure_code: safeDatabaseCode(error),
    configuration_present: { PIPELINE_DATABASE_URL: true },
  }, true);
  process.exitCode = 1;
} finally {
  await connection`select pg_advisory_unlock(hashtextextended('pipeline_schema_migrations', 0))`.catch(() => undefined);
  connection.release();
  await sql.end({ timeout: 5 });
}

function migrationId(file) {
  return file.replace(/\.sql$/, "");
}

function databaseSslMode() {
  if (process.env.PIPELINE_DATABASE_SSL_MODE === "disable") return false;
  if (process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full") return "verify-full";
  return "require";
}

function safeDatabaseCode(error) {
  if (error instanceof MigrationGuardError) return error.code;
  if (!error || typeof error !== "object" || !("code" in error)) return "migration_failed";
  const code = String(error.code);
  return /^[A-Z0-9_]{1,20}$/.test(code) ? code : "migration_failed";
}

function printResult(value, toError = false) {
  const output = JSON.stringify(value, null, 2);
  if (toError) console.error(output);
  else console.log(output);
}

function fatal(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}

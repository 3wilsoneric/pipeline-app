#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import postgres from "postgres";

const adminUrl = requiredUrl("PIPELINE_DATABASE_ADMIN_URL");
const migrationUrl = requiredUrl("PIPELINE_DATABASE_MIGRATION_URL");
const runtimeUrl = requiredUrl("PIPELINE_DATABASE_URL");

assertDatabaseIdentity(migrationUrl, "pipeline_migrator");
assertDatabaseIdentity(runtimeUrl, "pipeline_runtime");
assertSameDatabase(adminUrl, migrationUrl);
assertSameDatabase(adminUrl, runtimeUrl);

const admin = postgres(adminUrl.toString(), {
  ssl: databaseSslMode(),
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});

try {
  await admin.begin(async (sql) => {
    if (!(await roleExists(sql, "pipeline_migrator"))) {
      await sql.unsafe("create role pipeline_migrator login");
    }
    if (!(await roleExists(sql, "pipeline_runtime"))) {
      await sql.unsafe("create role pipeline_runtime login");
    }
    await setRolePassword(sql, "pipeline_migrator", migrationUrl.password);
    await setRolePassword(sql, "pipeline_runtime", runtimeUrl.password);
    await sql.unsafe("grant connect on database pipeline to pipeline_migrator, pipeline_runtime");
    await sql.unsafe("create extension if not exists pgcrypto");
    await sql.unsafe("create extension if not exists pg_trgm");
    await sql.unsafe("create schema if not exists pipeline authorization pipeline_migrator");
    await sql.unsafe("alter schema pipeline owner to pipeline_migrator");
    await sql.unsafe("grant usage on schema pipeline to pipeline_runtime");
    await sql.unsafe("alter default privileges for role pipeline_migrator in schema pipeline grant select, insert, update, delete on tables to pipeline_runtime");
    await sql.unsafe("alter default privileges for role pipeline_migrator in schema pipeline grant usage, select, update on sequences to pipeline_runtime");
    await sql.unsafe("alter default privileges for role pipeline_migrator in schema pipeline grant execute on functions to pipeline_runtime");
  });

  await runMigrations(migrationUrl.toString());

  await admin.begin(async (sql) => {
    await sql.unsafe("grant usage on schema pipeline to pipeline_runtime");
    await sql.unsafe("grant select, insert, update, delete on all tables in schema pipeline to pipeline_runtime");
    await sql.unsafe("grant usage, select, update on all sequences in schema pipeline to pipeline_runtime");
    await sql.unsafe("grant execute on all functions in schema pipeline to pipeline_runtime");
    const administratorRole = decodeURIComponent(adminUrl.username);
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(administratorRole)) {
      throw new Error("database_administrator_role_invalid");
    }
    const revokedPassword = randomBytes(48).toString("base64url");
    await setRolePassword(sql, administratorRole, revokedPassword);
  });

  console.log(JSON.stringify({
    ok: true,
    operation: "production_database_bootstrap",
    roles: ["pipeline_migrator", "pipeline_runtime"],
    administrator_credential_revoked: true,
    configuration_present: {
      PIPELINE_DATABASE_ADMIN_URL: true,
      PIPELINE_DATABASE_MIGRATION_URL: true,
      PIPELINE_DATABASE_URL: true,
    },
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    operation: "production_database_bootstrap",
    failure_code: safeCode(error),
    configuration_present: {
      PIPELINE_DATABASE_ADMIN_URL: true,
      PIPELINE_DATABASE_MIGRATION_URL: true,
      PIPELINE_DATABASE_URL: true,
    },
  }, null, 2));
  process.exitCode = 1;
} finally {
  await admin.end({ timeout: 5 });
}

async function roleExists(sql, role) {
  const rows = await sql`select exists(select 1 from pg_roles where rolname = ${role}) as exists`;
  return Boolean(rows[0]?.exists);
}

async function setRolePassword(sql, role, password) {
  const rows = await sql`
    select format(
      'alter role %I password %L',
      ${role}::text,
      ${password}::text
    ) as statement
  `;
  const statement = rows[0]?.statement;
  if (typeof statement !== "string" || !statement.startsWith("alter role ")) {
    throw new Error("database_password_statement_invalid");
  }
  await sql.unsafe(statement);
}

function runMigrations(databaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/apply-database-migrations.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PIPELINE_DATABASE_URL: databaseUrl,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("migration_child_failed")));
  });
}

function requiredUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_missing`);
  try {
    const url = new URL(value);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("invalid_protocol");
    if (!url.hostname || !url.username || !url.password || url.pathname !== "/pipeline") throw new Error("invalid_shape");
    return url;
  } catch {
    throw new Error(`${name}_invalid`);
  }
}

function assertDatabaseIdentity(url, expected) {
  if (decodeURIComponent(url.username) !== expected) throw new Error("database_role_mismatch");
}

function assertSameDatabase(reference, candidate) {
  if (reference.hostname !== candidate.hostname || reference.pathname !== candidate.pathname) {
    throw new Error("database_target_mismatch");
  }
}

function databaseSslMode() {
  if (process.env.PIPELINE_DATABASE_SSL_MODE === "disable") return false;
  if (process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full") return "verify-full";
  return "require";
}

function safeCode(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (/^[A-Z0-9_]{1,20}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9_]{1,64}$/.test(message) ? message : "database_bootstrap_failed";
}

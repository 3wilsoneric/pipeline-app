#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
const apply = process.argv.includes("--apply");
const inputPath = path.resolve(readArgument("--input") ?? "config/provisional-workspace-members.json");

if (!databaseUrl && apply) fail("Configure PIPELINE_DATABASE_URL before importing workspace members.");

const manifest = validateManifest(JSON.parse(await readFile(inputPath, "utf8")));
if (!apply) {
  print({
    ok: true,
    mode: "plan",
    member_count: manifest.members.length,
    source_system: manifest.source_system,
    configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) },
    note: "No database changes were made. Use --apply after reviewing the plan.",
  });
  process.exit(0);
}

const sql = postgres(databaseUrl, databaseOptions());
try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('pipeline_workspace_member_import', 0))`;
    const migration = await tx`
      select 1 from pipeline.schema_migrations
      where migration_id = '0010_provisional_workspace_members'
    `;
    if (migration.length !== 1) throw new Error("missing_migration");

    let upserted = 0;
    for (const member of manifest.members) {
      const rows = await tx`
        insert into pipeline.workspace_members (
          principal_id, display_name, email, roles, active, last_seen_at,
          identity_status, source_system, source_identity, merged_into_principal_id,
          created_at, updated_at
        ) values (
          ${member.principal_id}, ${member.display_name}, null, ${member.roles}, true, null,
          'provisional', ${manifest.source_system}, ${member.source_identity}, null,
          now(), now()
        )
        on conflict (principal_id) do update set
          display_name = excluded.display_name,
          roles = excluded.roles,
          active = true,
          source_system = excluded.source_system,
          source_identity = excluded.source_identity,
          updated_at = now()
        where pipeline.workspace_members.identity_status = 'provisional'
        returning principal_id
      `;
      upserted += rows.length;
    }

    const active = await tx`
      select count(*)::integer as count
      from pipeline.workspace_members
      where active and identity_status = 'provisional' and source_system = ${manifest.source_system}
    `;
    return { upserted, active: Number(active[0]?.count ?? 0) };
  });

  print({
    ok: result.active === manifest.members.length,
    mode: "apply",
    requested: manifest.members.length,
    upserted: result.upserted,
    active_provisional_members: result.active,
    configuration_present: { PIPELINE_DATABASE_URL: true },
    note: "No credentials were created and no Entra access was granted.",
  });
  if (result.active !== manifest.members.length) process.exitCode = 1;
} catch (error) {
  fail(error instanceof Error && error.message === "missing_migration"
    ? "Apply migration 0010 before importing workspace members."
    : "Workspace member import failed. No member names or database details were logged.");
} finally {
  await sql.end({ timeout: 5 });
}

function validateManifest(value) {
  if (!value || value.schema_version !== 1 || !safeToken(value.source_system, 100) || !Array.isArray(value.members)) {
    fail("The workspace member manifest is invalid.");
  }
  if (value.members.length < 1 || value.members.length > 500) fail("The workspace member manifest must contain 1 to 500 members.");
  const principalIds = new Set();
  const sourceIdentities = new Set();
  const allowedRoles = new Set(["admin", "assessment_coordinator", "reviewer", "viewer"]);
  const members = value.members.map((member) => {
    if (!member || !safePrincipal(member.principal_id) || !boundedText(member.display_name, 200)
      || !safeToken(member.source_identity, 200) || !Array.isArray(member.roles)
      || member.roles.length < 1 || member.roles.some((role) => !allowedRoles.has(role))) {
      fail("The workspace member manifest contains an invalid member.");
    }
    if (!member.principal_id.startsWith("provisional:")) fail("Provisional member IDs must use the provisional: namespace.");
    if (principalIds.has(member.principal_id) || sourceIdentities.has(member.source_identity)) fail("The workspace member manifest contains duplicate identities.");
    principalIds.add(member.principal_id);
    sourceIdentities.add(member.source_identity);
    return {
      principal_id: member.principal_id,
      display_name: member.display_name.trim(),
      source_identity: member.source_identity,
      roles: [...new Set(member.roles)],
    };
  });
  return { source_system: value.source_system, members };
}

function readArgument(name) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function safePrincipal(value) {
  return typeof value === "string" && value.length <= 256 && /^[a-zA-Z0-9_.:@-]+$/.test(value);
}

function safeToken(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && /^[a-zA-Z0-9_.:-]+$/.test(value);
}

function boundedText(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function databaseOptions() {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  };
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}

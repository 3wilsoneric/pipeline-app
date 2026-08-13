#!/usr/bin/env node

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
const principalId = process.env.PIPELINE_WORKSPACE_PURGE_PRINCIPAL_ID?.trim();
const execute = process.argv.includes("--execute");
const confirmed = process.argv.includes("--confirm=PURGE_USER_WORKSPACE_STATE");

if (!databaseUrl) fail("Configure PIPELINE_DATABASE_URL before planning a workspace-state purge.");
if (!principalId || principalId.length > 256) fail("Configure a valid PIPELINE_WORKSPACE_PURGE_PRINCIPAL_ID.");
if (execute && (process.env.PIPELINE_ALLOW_USER_STATE_PURGE !== "true" || !confirmed)) {
  fail("Execution requires PIPELINE_ALLOW_USER_STATE_PURGE=true and --confirm=PURGE_USER_WORKSPACE_STATE.");
}

const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});

try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`workspace-purge\u0000${principalId}`}, 0))`;
    const rows = execute
      ? await tx`
          delete from pipeline.user_workspace_state
          where principal_id = ${principalId}
          returning state_kind
        `
      : await tx`
          select state_kind
          from pipeline.user_workspace_state
          where principal_id = ${principalId}
        `;
    return countByKind(rows);
  });
  console.log(JSON.stringify({
    ok: true,
    mode: execute ? "execute" : "dry_run",
    records: result,
    principal_configured: true,
    note: "The principal identifier and workspace payloads are never printed.",
  }, null, 2));
} catch {
  fail("Workspace-state purge failed without logging an identity or payload.");
} finally {
  await sql.end({ timeout: 5 });
}

function countByKind(rows) {
  return {
    total: rows.length,
    recent_destinations: rows.filter((row) => row.state_kind === "recent_destination").length,
    referral_drafts: rows.filter((row) => row.state_kind === "referral_draft").length,
  };
}

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    error: message,
    configuration_present: {
      PIPELINE_DATABASE_URL: Boolean(databaseUrl),
      PIPELINE_WORKSPACE_PURGE_PRINCIPAL_ID: Boolean(principalId),
    },
  }, null, 2));
  process.exit(1);
}

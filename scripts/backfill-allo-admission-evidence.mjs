#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import postgres from "postgres";

import { validateCloudManifest } from "./allo-workspace-import-common.mjs";

const confirmation = "BACKFILL-ALLO-ADMISSION-EVIDENCE";
const args = argumentMap();
const apply = args.get("--confirm") === confirmation;
const dryRun = args.has("--dry-run");
if (!dryRun && !apply) fail(`Refusing to apply without --dry-run or --confirm=${confirmation}.`);

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) fail("PIPELINE_DATABASE_URL is required.");
const manifest = await loadManifest();
validateCloudManifest(manifest);

const evidence = manifest.workspaces.flatMap((workspace) => {
  if (!Array.isArray(workspace.profile_candidates) || workspace.profile_candidates.length !== 1) return [];
  const admissionDate = isoDate(workspace.profile_candidates[0]?.admit_date);
  if (!admissionDate) return [];
  return [{ source_workspace_id: workspace.source_workspace_id, admission_date: admissionDate }];
});
const evidenceIds = new Set(evidence.map((item) => item.source_workspace_id));
if (evidenceIds.size !== evidence.length) fail("The manifest contains duplicate workspace admission evidence.");

const sql = postgres(databaseUrl, databaseOptions());
try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('pipeline_allo_admission_evidence_backfill', 0))`;
    const migration = await tx`
      select 1 from pipeline.schema_migrations
      where migration_id = '0011_historical_material_workspaces'
    `;
    if (migration.length !== 1) throw new Error("missing_migration");

    const plan = await tx`
      with evidence as (
        select * from jsonb_to_recordset(${tx.json(evidence)}::jsonb)
          as item(source_workspace_id text, admission_date text)
      )
      select
        count(*)::integer as matched_workspaces,
        count(*) filter (
          where coalesce(r.data->>'admissionDate', '') is distinct from evidence.admission_date
        )::integer as workspaces_to_update
      from evidence
      join pipeline.referrals r
        on r.workspace_origin = 'allo'
       and r.source_workspace_id = evidence.source_workspace_id
    `;
    const counts = {
      matched_workspaces: Number(plan[0]?.matched_workspaces ?? 0),
      workspaces_to_update: Number(plan[0]?.workspaces_to_update ?? 0),
    };
    if (!apply) return { ...counts, updated_workspaces: 0 };

    const updated = await tx`
      with evidence as (
        select * from jsonb_to_recordset(${tx.json(evidence)}::jsonb)
          as item(source_workspace_id text, admission_date text)
      )
      update pipeline.referrals r
      set data = jsonb_set(r.data, '{admissionDate}', to_jsonb(evidence.admission_date), true),
          version = r.version + 1,
          updated_by = 'system:allo-admission-evidence',
          updated_by_name = 'Client history reconciliation'
      from evidence
      where r.workspace_origin = 'allo'
        and r.source_workspace_id = evidence.source_workspace_id
        and coalesce(r.data->>'admissionDate', '') is distinct from evidence.admission_date
      returning r.referral_id::text, r.version - 1 as before_version, r.version as after_version
    `;

    if (updated.length > 0) {
      const referralIds = updated.map((row) => row.referral_id);
      const beforeVersions = updated.map((row) => Number(row.before_version));
      const afterVersions = updated.map((row) => Number(row.after_version));
      await tx`
        insert into pipeline.audit_events (
          entity_type, entity_id, action, actor_id, actor_name,
          from_version, to_version, changed_fields, metadata
        )
        select
          'referral', item.referral_id, 'client_admission_history_linked',
          'system:allo-admission-evidence', 'Client history reconciliation',
          item.before_version, item.after_version, array['admissionDate'],
          jsonb_build_object('source_system', 'master_client_datasheet', 'match_method', 'unique_profile_match')
        from unnest(
          ${referralIds}::text[], ${beforeVersions}::integer[], ${afterVersions}::integer[]
        ) as item(referral_id, before_version, after_version)
      `;
      await tx`
        update pipeline.store_revisions
        set revision = revision + 1, updated_at = now()
        where store_name in ('referrals', 'client_workspaces')
      `;
    }
    return { ...counts, updated_workspaces: updated.length };
  });

  print({
    ok: result.matched_workspaces === evidence.length,
    mode: apply ? "apply" : "plan",
    manifest_workspaces: manifest.workspace_count,
    unique_admission_evidence: evidence.length,
    ambiguous_or_unmatched: manifest.workspace_count - evidence.length,
    ...result,
    changes_made: apply && result.updated_workspaces > 0,
  });
  if (result.matched_workspaces !== evidence.length) process.exitCode = 1;
} catch (error) {
  fail(error instanceof Error && error.message === "missing_migration"
    ? "Apply migration 0011 before reconciling admission evidence."
    : "Admission-evidence reconciliation failed. No client names, resident identifiers, or database values were logged.");
} finally {
  await sql.end({ timeout: 5 });
}

function argumentMap() {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.split("=");
    return [key, rest.join("=")];
  }));
}

async function loadManifest() {
  const localPath = args.get("--manifest");
  const blobKey = args.get("--manifest-blob");
  if (localPath) {
    if (!path.isAbsolute(localPath)) fail("--manifest must be an absolute path.");
    return JSON.parse(await readFile(localPath, "utf8"));
  }
  if (!blobKey) fail("Use --manifest=/absolute/path/cloud-manifest.json or --manifest-blob=<private-blob-key>.");
  const account = process.env.AZURE_STORAGE_ACCOUNT?.trim();
  if (!account) fail("AZURE_STORAGE_ACCOUNT is required with --manifest-blob.");
  const containerName = process.env.AZURE_STORAGE_CONTAINER_RAW?.trim() || "raw";
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined,
  });
  const blob = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential)
    .getContainerClient(containerName)
    .getBlobClient(blobKey);
  return JSON.parse((await blob.downloadToBuffer(0, undefined, { maxRetryRequests: 5 })).toString("utf8"));
}

function isoDate(value) {
  const normalized = String(value ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : null;
}

function databaseOptions() {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
    max: 1,
    connect_timeout: 15,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: "pipeline-allo-admission-evidence" },
  };
}

function print(value) {
  console.log(JSON.stringify(value));
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

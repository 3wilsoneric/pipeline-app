#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import postgres from "postgres";

import { resolveWorkspaceMonth } from "../lib/pipeline/workspace-month.mjs";
import { resolveImportedWorkspaceCommunity } from "./allo-admission-evidence.mjs";

import {
  hasVerifiedCleanScan,
  importConfirmation,
  manifestBytes,
  sha256,
  validateCloudManifest,
} from "./allo-workspace-import-common.mjs";

const requirements = [
  ["medication_list", "Signed medication list", "admission_decision", true],
  ["conservatorship_document", "Letters of conservatorship", "move_in", false],
  ["signed_admission_agreement", "Signed admission agreement + LIC forms", "move_in", true],
  ["lic_602", "LIC 602", "move_in", true],
  ["tb_test", "TB test result", "move_in", true],
  ["lic_601_603", "LIC 601 & LIC 603", "move_in", true],
  ["provider_form", "Provider form", "pre_assessment", false],
  ["face_sheet", "Face sheet", "pre_assessment", true],
];
const importedInProgressStage = "Packet Review";

const args = argumentMap();
const dryRun = args.has("--dry-run");
const apply = !dryRun && args.get("--confirm") === importConfirmation;
if (!dryRun && !apply) fail(`Refusing to import without --confirm=${importConfirmation}.`);
const queuePreviews = args.get("--queue-previews") === "true";
const requireCleanScan = args.get("--require-clean-scan") === "true";
const manifest = await loadManifest();
validateCloudManifest(manifest);
const cleanScan = hasVerifiedCleanScan(manifest);
if (requireCleanScan && !cleanScan) fail("A verified clean-scan attestation is required for this import.");
const bytes = manifestBytes(manifest);
const manifestSha256 = sha256(bytes);

if (dryRun) {
  print({
    ok: true,
    mode: "plan",
    workspace_count: manifest.workspace_count,
    material_count: manifest.available_file_count,
    owner_assigned_workspace_count: manifest.workspaces.filter((workspace) => workspace.primary_owner).length,
    unique_profile_workspace_count: manifest.workspaces.filter((workspace) => workspace.profile_candidates?.length === 1).length,
    queue_previews: queuePreviews,
    clean_scan_verified: cleanScan,
    manifest_sha256: manifestSha256,
    changes_made: false,
  });
  process.exit(0);
}

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) fail("PIPELINE_DATABASE_URL is required.");
const sql = postgres(databaseUrl, databaseOptions("pipeline-allo-workspace-import"));
const connection = await sql.reserve();
let batchId = null;
let failure = false;
let failureDiagnostic = null;
let processingWorkspaceOrdinal = 0;
try {
  await connection`select pg_advisory_lock(hashtextextended('pipeline_allo_workspace_import', 0))`;
  const migrations = await connection`
    select 1 from pipeline.schema_migrations
    where migration_id in (
      '0011_historical_material_workspaces',
      '0015_assessor_workflow',
      '0024_workspace_month_provenance',
      '0026_imported_workspace_lifecycle'
    )
  `;
  if (migrations.length !== 4) throw new Error("missing_migration");

  const memberRows = await connection`
    select principal_id, display_name
    from pipeline.workspace_members
    where active and identity_status <> 'merged'
  `;
  const members = new Map(memberRows.map((row) => [normalizeName(row.display_name), row]));
  const batchRows = await connection`
    insert into pipeline.workspace_import_batches (
      source_system, manifest_sha256, status, workspace_count, material_count, created_by
    ) values (
      'allo', ${manifestSha256}, 'importing', ${manifest.workspace_count},
      ${manifest.available_file_count}, 'allo_workspace_import'
    )
    on conflict (source_system, manifest_sha256) do update set
      status = 'importing', workspace_count = excluded.workspace_count,
      material_count = excluded.material_count, updated_at = now()
    returning workspace_import_batch_id::text
  `;
  batchId = batchRows[0].workspace_import_batch_id;

  let processed = 0;
  for (const workspace of manifest.workspaces) {
    processingWorkspaceOrdinal = processed + 1;
    await runTransaction(
      connection,
      (tx) => processWorkspace(tx, workspace, batchId, members, queuePreviews, cleanScan),
    );
    processed += 1;
    if (processed % 100 === 0) print({ progress: true, completed_workspaces: processed, total_workspaces: manifest.workspace_count });
  }

  const counts = await connection`
    select
      count(distinct r.referral_id)::integer as workspace_count,
      count(distinct d.document_id)::integer as document_count
    from pipeline.referrals r
    left join pipeline.documents d on d.referral_id = r.referral_id and d.deleted_at is null
    where r.workspace_import_batch_id = ${batchId}::uuid
  `;
  await connection`
    update pipeline.workspace_import_batches
    set status = 'complete', imported_workspace_count = ${Number(counts[0].workspace_count)},
      imported_document_count = ${Number(counts[0].document_count)}, updated_at = now()
    where workspace_import_batch_id = ${batchId}::uuid
  `;
  await connection`
    update pipeline.store_revisions set revision = revision + 1, updated_at = now()
    where store_name in ('referrals', 'client_workspaces')
  `;
  print({
    ok: Number(counts[0].workspace_count) === manifest.workspace_count,
    mode: "apply",
    imported_workspaces: Number(counts[0].workspace_count),
    imported_documents: Number(counts[0].document_count),
    source_materials: manifest.available_file_count,
    queue_previews: queuePreviews,
    clean_scan_verified: cleanScan,
    manifest_sha256: manifestSha256,
  });
} catch (error) {
  failure = true;
  failureDiagnostic = safeImportDiagnostic(error, processingWorkspaceOrdinal);
  if (batchId) {
    await connection`
      update pipeline.workspace_import_batches set status = 'failed', updated_at = now()
      where workspace_import_batch_id = ${batchId}::uuid
    `.catch(() => undefined);
  }
} finally {
  await connection`select pg_advisory_unlock(hashtextextended('pipeline_allo_workspace_import', 0))`.catch(() => undefined);
  connection.release();
  await sql.end({ timeout: 5 });
}
if (failure) {
  fail(
    "The workspace import stopped safely and can be retried. No client or document values were logged.",
    failureDiagnostic,
  );
}

async function processWorkspace(tx, workspace, workspaceImportBatchId, members, shouldQueuePreviews, isCleanScanVerified) {
  const profile = workspace.profile_candidates?.length === 1 ? workspace.profile_candidates[0] : null;
  const community = resolveImportedWorkspaceCommunity(workspace);
  const externalClientId = profileExternalId(profile, workspace.source_workspace_id);
  const dateOfBirth = sqlDate(profile?.date_of_birth);
  const admissionDate = sqlDate(profile?.admit_date);
  const stage = admissionDate ? "Accepted / Admitted" : importedInProgressStage;
  const closedAt = admissionDate ? `${admissionDate}T12:00:00.000Z` : null;
  const receivedDate = sqlDate(workspace.first_material_at);
  const workspaceMonth = resolveWorkspaceMonth({
    workspaceMonth: workspace.workspace_month,
    workspaceMonthBasis: workspace.workspace_month_basis,
    workspaceOrigin: "allo",
    sourceProjectName: workspace.project_name,
  });
  const owner = workspace.primary_owner ? members.get(normalizeName(workspace.primary_owner)) : null;
  const ownerName = owner?.display_name ?? "Unassigned";
  const ownerId = owner?.principal_id ?? null;
  const workflowStatus = admissionDate ? "accepted" : ownerId ? "profile_incomplete" : "intake_unassigned";
  const tags = ["allo-import", ...(owner ? [] : ["owner-review"])];
  const firstFile = workspace.files[0] ?? null;
  const data = {
    clientId: externalClientId,
    workspaceOrigin: "allo",
    workspaceStatus: "active",
    sourceWorkspaceId: workspace.source_workspace_id,
    sourceWorkspaceName: workspace.source_workspace_name,
    sourceProjectId: workspace.project_id ?? undefined,
    sourceProjectName: workspace.project_name ?? undefined,
    sourceMaterialCount: workspace.material_count,
    stage,
    workflowStatus,
    name: workspace.display_name,
    date: receivedDate ?? "",
    community,
    source: "Allo workspace import",
    priority: "standard",
    tags,
    documentName: firstFile?.source_file_name ?? "",
    documentSizeBytes: firstFile?.source_byte_size,
    documentStatus: firstFile ? "Uploaded" : "Missing",
    ownerId: ownerId ?? undefined,
    owner: ownerName,
    note: `Imported workspace with ${workspace.material_count} material${workspace.material_count === 1 ? "" : "s"}.`,
    createdAt: workspace.first_material_at ?? new Date().toISOString(),
    dob: dateOfBirth ?? "",
    admissionDate: admissionDate ?? "",
    phone: "",
    email: "",
    payer: "",
  };

  const people = await tx`
    insert into pipeline.people (external_client_id, display_name, date_of_birth)
    values (${externalClientId}, ${workspace.display_name}, ${dateOfBirth}::date)
    on conflict (external_client_id) do update set
      display_name = excluded.display_name,
      date_of_birth = coalesce(pipeline.people.date_of_birth, excluded.date_of_birth),
      updated_at = now()
    returning person_id::text
  `;
  const personId = people[0].person_id;
  const searchText = [workspace.display_name, community, ownerName, workspace.source_workspace_name,
    workspace.project_name, "allo import", ...workspace.files.map((file) => file.source_file_name)].filter(Boolean).join(" ").toLowerCase();
  const referrals = await tx`
    insert into pipeline.referrals (
      person_id, stage, workflow_status, community, owner_id, owner_name, priority, source, received_date,
      workspace_month, workspace_month_basis,
      tags, summary, search_text, data, closed_at,
      workspace_origin, workspace_status, source_workspace_id, source_workspace_name,
      source_project_id, source_project_name, source_material_count, workspace_import_batch_id,
      created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at
    ) values (
      ${personId}::uuid, ${stage}, ${workflowStatus}, ${community}, ${ownerId}, ${ownerName},
      'standard', 'Allo workspace import', ${receivedDate}::date,
      ${workspaceMonth.month ? `${workspaceMonth.month}-01` : null}::date, ${workspaceMonth.basis},
      ${tags}, ${data.note}, ${searchText},
      ${tx.json(data)}, ${closedAt}::timestamptz,
      'allo', 'active', ${workspace.source_workspace_id}, ${workspace.source_workspace_name},
      ${workspace.project_id}, ${workspace.project_name}, ${workspace.material_count}, ${workspaceImportBatchId}::uuid,
      'allo_workspace_import', 'Allo workspace import', 'allo_workspace_import', 'Allo workspace import',
      coalesce(${workspace.first_material_at}::timestamptz, now()), coalesce(${workspace.first_material_at}::timestamptz, now())
    )
    on conflict (workspace_origin, source_workspace_id) where source_workspace_id is not null
    do update set
      person_id = excluded.person_id,
      stage = case
        when pipeline.referrals.workspace_status = 'archived'
          or pipeline.referrals.workflow_status not in ('intake_unassigned', 'profile_incomplete')
          then pipeline.referrals.stage
        else excluded.stage
      end,
      workflow_status = case
        when pipeline.referrals.workspace_status = 'archived'
          or pipeline.referrals.workflow_status not in ('intake_unassigned', 'profile_incomplete')
          then pipeline.referrals.workflow_status
        else excluded.workflow_status
      end,
      owner_id = excluded.owner_id,
      owner_name = excluded.owner_name,
      community = excluded.community,
      source_workspace_name = excluded.source_workspace_name,
      source_project_id = excluded.source_project_id,
      source_project_name = excluded.source_project_name,
      workspace_month = excluded.workspace_month,
      workspace_month_basis = excluded.workspace_month_basis,
      source_material_count = excluded.source_material_count,
      workspace_status = case
        when pipeline.referrals.workspace_status = 'archived' then pipeline.referrals.workspace_status
        else excluded.workspace_status
      end,
      workspace_import_batch_id = excluded.workspace_import_batch_id,
      search_text = excluded.search_text,
      data = jsonb_set(
        jsonb_set(
          (excluded.data || pipeline.referrals.data) - 'stage',
          '{workspaceStatus}',
          to_jsonb(case
            when pipeline.referrals.workspace_status = 'archived' then pipeline.referrals.workspace_status
            else excluded.workspace_status
          end),
          true
        ),
        '{workflowStatus}',
        to_jsonb(case
          when pipeline.referrals.workspace_status = 'archived'
            or pipeline.referrals.workflow_status not in ('intake_unassigned', 'profile_incomplete')
            then pipeline.referrals.workflow_status
          else excluded.workflow_status
        end),
        true
      ),
      tags = (select array_agg(distinct tag) from unnest(pipeline.referrals.tags || excluded.tags) tag),
      closed_at = case
        when pipeline.referrals.workspace_status = 'archived'
          or pipeline.referrals.workflow_status not in ('intake_unassigned', 'profile_incomplete')
          then pipeline.referrals.closed_at
        else excluded.closed_at
      end,
      updated_at = greatest(pipeline.referrals.updated_at, excluded.updated_at)
    returning referral_id, (xmax = 0) as inserted
  `;
  const referralId = Number(referrals[0].referral_id);
  const evidence = new Map();

  for (const file of workspace.files) {
    const sourceExternalId = `${workspace.source_workspace_id}:${file.source_item_id}`;
    const inserted = await tx`
      insert into pipeline.documents (
        referral_id, person_id, category, file_name, content_type, byte_size, sha256,
        blob_container, blob_key, processing_status, uploaded_by, uploaded_at, updated_at,
        preview_status, malware_scan_status, retention_until,
        source_system, source_external_id, source_canvas_id, document_date,
        client_display_name, client_community, identity_status
      ) values (
        ${referralId}, ${personId}::uuid, ${file.document_category}, ${file.source_file_name},
        ${file.source_content_type}, ${file.source_byte_size}, ${file.source_sha256},
        ${file.blob_container}, ${file.blob_key}, ${isCleanScanVerified ? "uploaded" : "quarantined"}, 'allo_workspace_import',
        coalesce(${file.source_created_at}::timestamptz, now()), coalesce(${file.source_created_at}::timestamptz, now()),
        'pending', ${isCleanScanVerified ? "clean" : "pending"}, now() + interval '7 years',
        'allo', ${sourceExternalId}, ${workspace.source_workspace_id}, ${sqlDate(file.source_created_at)}::date,
        ${workspace.display_name}, ${community}, 'linked'
      )
      on conflict do nothing
      returning document_id::text, category
    `;
    const document = inserted[0] ?? (await tx`
      select document_id::text, category from pipeline.documents
      where deleted_at is null and (
        (source_system = 'allo' and source_external_id = ${sourceExternalId})
        or (referral_id = ${referralId} and sha256 = ${file.source_sha256})
      )
      order by source_external_id = ${sourceExternalId} desc
      limit 1
    `)[0];
    if (!document) throw new Error("document_import_conflict");
    if (isCleanScanVerified) {
      await tx`
        update pipeline.documents
        set malware_scan_status = 'clean',
          processing_status = case
            when processing_status in ('reserved', 'quarantined', 'uploaded') then 'uploaded'
            else processing_status
          end,
          failure_code = case when failure_code = 'malware_scan_failed' then null else failure_code end,
          updated_at = greatest(updated_at, now())
        where document_id = ${document.document_id}::uuid
          and malware_scan_status <> 'infected'
      `;
    }
    if (!evidence.has(file.document_category)) evidence.set(file.document_category, document.document_id);
    if (shouldQueuePreviews) {
      await tx`
        insert into pipeline.extraction_jobs (document_id, job_type, status)
        values (${document.document_id}::uuid, 'document_preview', 'queued')
        on conflict (document_id, job_type) where status in ('queued', 'running') do nothing
      `;
    }
  }

  for (const [type, label, gate, blocker] of requirements) {
    const documentId = evidence.get(type) ?? null;
    const workItemId = stableUuid(`${workspace.source_workspace_id}:${type}`);
    await tx`
      insert into pipeline.work_items (
        work_item_id, referral_id, person_id, type, label, gate, status,
        owner_id, owner_name, next_action, blocker, evidence_document_id, evidence_document_name
      ) values (
        ${workItemId}::uuid, ${referralId}, ${personId}::uuid, ${type}, ${label}, ${gate},
        ${documentId ? "received" : "needed"}, ${ownerId}, ${ownerName},
        ${documentId ? "Review the attached source document." : `No ${label.toLowerCase()} was found in the imported materials.`},
        ${blocker}, ${documentId}::uuid,
        ${documentId ? workspace.files.find((file) => file.document_category === type)?.source_file_name ?? null : null}
      )
      on conflict (work_item_id) do update set
        referral_id = excluded.referral_id,
        person_id = excluded.person_id,
        owner_id = excluded.owner_id,
        owner_name = excluded.owner_name,
        status = case
          when excluded.evidence_document_id is not null and pipeline.work_items.status = 'needed' then 'received'
          else pipeline.work_items.status
        end,
        evidence_document_id = coalesce(pipeline.work_items.evidence_document_id, excluded.evidence_document_id),
        evidence_document_name = coalesce(pipeline.work_items.evidence_document_name, excluded.evidence_document_name),
        updated_at = now()
    `;
  }

  if (referrals[0].inserted) {
    await tx`
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name, to_version, changed_fields, metadata
      ) values (
        'referral', ${String(referralId)}, 'workspace_imported',
        'allo_workspace_import', 'Allo workspace import', 1,
        array['workspace_origin','workspace_status','owner','documents'],
        ${tx.json({ source_system: "allo", material_count: workspace.material_count })}
      )
    `;
  }
}

async function runTransaction(connection, operation) {
  await connection`begin`;
  try {
    const result = await operation(connection);
    await connection`commit`;
    return result;
  } catch (error) {
    await connection`rollback`.catch(() => undefined);
    throw error;
  }
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
  const credential = new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined });
  const blob = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential)
    .getContainerClient(containerName)
    .getBlobClient(blobKey);
  return JSON.parse((await blob.downloadToBuffer(0, undefined, { maxRetryRequests: 5 })).toString("utf8"));
}

function profileExternalId(profile, workspaceId) {
  const residentNumber = String(profile?.resident_number ?? "").trim();
  if (residentNumber && /^[a-zA-Z0-9._:-]{1,80}$/.test(residentNumber)) return `allo-resident-${residentNumber}`;
  const nameAndDob = `${normalizeName(profile?.resident_name)}|${sqlDate(profile?.date_of_birth) ?? ""}`;
  if (profile && nameAndDob !== "|") return `allo-profile-${createHash("sha256").update(nameAndDob).digest("hex").slice(0, 32)}`;
  return `allo-workspace-${createHash("sha256").update(String(workspaceId)).digest("hex").slice(0, 32)}`;
}

function stableUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function sqlDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(raw);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const iso = `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) ? iso : null;
}

function normalizeName(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function safeImportDiagnostic(error, workspaceOrdinal) {
  const result = {
    category: "unclassified",
    ...(Number.isSafeInteger(workspaceOrdinal) && workspaceOrdinal > 0 ? { workspace_ordinal: workspaceOrdinal } : {}),
  };
  if (!error || typeof error !== "object") return result;
  const allowedTypes = new Set(["Error", "TypeError", "RangeError", "SyntaxError"]);
  if (error instanceof Error && allowedTypes.has(error.name)) result.error_type = error.name;
  if (error instanceof Error) {
    const sourceFrames = [...(error.stack ?? "").matchAll(/import-allo-material-workspaces\.mjs:(\d+):(\d+)/g)]
      .slice(0, 6)
      .map((match) => ({ line: Number(match[1]), column: Number(match[2]) }));
    if (sourceFrames.length > 0) {
      result.source_line = sourceFrames[0].line;
      result.source_column = sourceFrames[0].column;
      result.source_frames = sourceFrames;
    }
  }
  const code = "code" in error ? String(error.code ?? "") : "";
  if (/^[0-9A-Z]{5}$/.test(code)) {
    result.category = "database";
    result.sqlstate = code;
  }
  const knownReasons = new Set(["missing_migration"]);
  if (error instanceof Error && knownReasons.has(error.message)) {
    result.category = "precondition";
    result.reason = error.message;
  }
  for (const [source, target] of [
    ["schema_name", "schema"],
    ["table_name", "table"],
    ["column_name", "column"],
    ["constraint_name", "constraint"],
    ["routine", "routine"],
  ]) {
    const value = source in error ? String(error[source] ?? "") : "";
    if (/^[a-zA-Z0-9_.-]{1,128}$/.test(value)) result[target] = value;
  }
  return result;
}

function argumentMap() {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.split("=");
    return [key, rest.join("=")];
  }));
}

function databaseOptions(applicationName) {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
    max: 1,
    connect_timeout: 15,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: applicationName },
  };
}

function print(value) {
  console.log(JSON.stringify(value));
}

function fail(message, diagnostic) {
  console.error(JSON.stringify({ ok: false, error: message, ...(diagnostic ? { diagnostic } : {}) }));
  process.exit(1);
}

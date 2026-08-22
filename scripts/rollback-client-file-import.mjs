#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import postgres from "postgres";

const confirmation = "ROLLBACK-CONFIRMED-CLIENT-FILE-BATCH";
const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.split("=");
  return [key, rest.join("=")];
}));
const manifestPath = args.get("--manifest");
const execute = args.has("--execute");
if (!manifestPath || !path.isAbsolute(manifestPath)) fail("Use --manifest=/absolute/path/private-manifest.json.");
if (!process.env.PIPELINE_DATABASE_URL?.trim()) fail("PIPELINE_DATABASE_URL is required.");
if (execute && process.env.PIPELINE_CLIENT_FILE_ROLLBACK_ENABLED !== "true") {
  fail("Execution requires PIPELINE_CLIENT_FILE_ROLLBACK_ENABLED=true.");
}
if (execute && args.get("--confirm") !== confirmation) {
  fail(`Refusing to roll back without --confirm=${confirmation}.`);
}
if (execute && !process.env.AZURE_STORAGE_ACCOUNT?.trim()) fail("AZURE_STORAGE_ACCOUNT is required.");

const raw = await readFile(manifestPath);
const manifest = JSON.parse(raw.toString("utf8"));
if (manifest?.version !== 1 || !Array.isArray(manifest.items)) fail("The private manifest is invalid.");
const manifestSha256 = createHash("sha256").update(raw).digest("hex");
const sql = postgres(process.env.PIPELINE_DATABASE_URL.trim(), {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
  max: 1,
  prepare: false,
  connection: { application_name: "pipeline-client-file-rollback" },
});

let result;
let failure = null;
try {
  const batch = await findBatch(sql, manifestSha256);
  if (!batch) throw new Error("batch_not_found");
  const plan = await loadPlan(sql, manifestSha256);
  if (plan.downstream_references > 0) throw new Error("downstream_references_present");
  const targets = await loadBlobTargets(sql, manifestSha256, batch);
  const publicPlan = { ...plan, blob_targets: targets.length };
  if (!execute) {
    result = { ok: true, mode: "dry_run", plan: publicPlan, writes_performed: false };
  } else {
    await prepareRollback(sql, manifestSha256, batch.import_batch_id, plan);
    const deletion = await deleteBlobTargets(targets);
    const finalized = await finalizeRollback(sql, manifestSha256, batch.import_batch_id, plan, deletion);
    result = { ok: true, mode: "execute", ...finalized, ...deletion };
  }
} catch (error) {
  failure = error instanceof Error ? error.message : "rollback_failed";
} finally {
  await sql.end({ timeout: 5 });
}

if (failure) {
  const recovery = failure === "downstream_references_present"
    ? "Remove or replace reviewed evidence links before retrying the rollback dry-run."
    : "No client or file details were reported. Re-run the dry-run and review database and Blob permissions.";
  fail(`Client-file batch rollback stopped: ${failure}. ${recovery}`);
}
console.log(JSON.stringify(result, null, 2));

async function findBatch(client, manifestHash) {
  return (await client`
    select import_batch_id::text, source_system
    from pipeline.client_file_import_batches
    where manifest_sha256 = ${manifestHash}
    limit 1
  `)[0] ?? null;
}

async function loadPlan(client, manifestHash) {
  const rows = await client`
    with batch_items as (
      select i.import_item_id, i.imported_document_id, i.match_status
      from pipeline.client_file_import_items i
      join pipeline.client_file_import_batches b on b.import_batch_id = i.import_batch_id
      where b.manifest_sha256 = ${manifestHash}
    ), batch_documents as (
      select distinct d.document_id
      from pipeline.documents d
      join batch_items i on i.imported_document_id = d.document_id
    )
    select
      (select count(*) from batch_items)::integer as items,
      (select count(*) from batch_items where match_status = 'imported')::integer as imported_items,
      (select count(*) from batch_documents)::integer as documents,
      ((select count(*) from pipeline.referral_fields rf join batch_documents d on d.document_id = rf.source_document_id)
        + (select count(*) from pipeline.work_items wi join batch_documents d on d.document_id = wi.evidence_document_id))::integer
        as downstream_references
  `;
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

async function loadBlobTargets(client, manifestHash, batch) {
  const rawContainer = process.env.AZURE_STORAGE_CONTAINER_RAW?.trim() || "raw";
  const artifactsContainer = process.env.AZURE_STORAGE_CONTAINER_ARTIFACTS?.trim() || "artifacts";
  const evidenceContainer = process.env.AZURE_STORAGE_CONTAINER_EVIDENCE?.trim() || "evidence";
  const allowedContainers = new Set([rawContainer, artifactsContainer, evidenceContainer]);
  const rows = await client`
    with batch_items as (
      select i.import_item_id, i.imported_document_id, i.source_file_name, b.source_system
      from pipeline.client_file_import_items i
      join pipeline.client_file_import_batches b on b.import_batch_id = i.import_batch_id
      where b.manifest_sha256 = ${manifestHash} and i.match_status in ('confirmed', 'imported')
    ), batch_documents as (
      select distinct d.document_id, d.blob_container, d.blob_key, d.preview_blob_key
      from pipeline.documents d
      join batch_items i on i.imported_document_id = d.document_id
    )
    select 'document' as kind, d.blob_container, d.blob_key from batch_documents d
    union all
    select 'page', p.blob_container, p.blob_key
      from pipeline.document_preview_pages p join batch_documents d on d.document_id = p.document_id
    union all
    select 'artifact', a.blob_container, a.blob_key
      from pipeline.document_artifacts a join batch_documents d on d.document_id = a.document_id
    union all
    select 'preview', ${artifactsContainer}, d.preview_blob_key
      from batch_documents d where d.preview_blob_key is not null
  `;
  const importItems = await client`
    select i.import_item_id::text, i.source_file_name, b.source_system
    from pipeline.client_file_import_items i
    join pipeline.client_file_import_batches b on b.import_batch_id = i.import_batch_id
    where b.manifest_sha256 = ${manifestHash} and i.match_status in ('confirmed', 'imported')
    order by i.import_item_id
  `;
  const targets = rows.map((row) => ({ container: row.blob_container, key: row.blob_key }));
  for (const item of importItems) {
    targets.push({
      container: rawContainer,
      key: `client-import/${item.source_system}/${batch.import_batch_id}/${item.import_item_id}/original${safeExtension(item.source_file_name)}`,
    });
  }
  const unique = new Map();
  for (const target of targets) {
    if (!allowedContainers.has(target.container) || !safeBlobKey(target.key)) throw new Error("unsafe_blob_target");
    unique.set(`${target.container}\0${target.key}`, target);
  }
  return [...unique.values()];
}

async function prepareRollback(client, manifestHash, batchId, plan) {
  await client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`client_file_import:${manifestHash}`}, 0))`;
    const current = await loadPlan(tx, manifestHash);
    if (current.downstream_references > 0) throw new Error("downstream_references_present");
    await tx`
      update pipeline.extraction_jobs j
      set status = 'cancelled', completed_at = now(), updated_at = now(),
          lease_owner = null, lease_expires_at = null
      from pipeline.client_file_import_items i
      where i.import_batch_id = ${batchId}::uuid and i.imported_document_id = j.document_id
        and j.status in ('queued', 'running')
    `;
    await tx`
      insert into pipeline.retention_events (document_id, event_type, actor_id, reason_code)
      select distinct i.imported_document_id, 'soft_delete', 'client-file-rollback', 'pilot_batch_rollback'
      from pipeline.client_file_import_items i
      join pipeline.documents d on d.document_id = i.imported_document_id
      where i.import_batch_id = ${batchId}::uuid and d.deleted_at is null
    `;
    await tx`
      update pipeline.documents d
      set deleted_at = coalesce(d.deleted_at, now()), processing_status = 'failed',
          failure_code = 'pilot_batch_rollback', version = d.version + 1, updated_at = now()
      from pipeline.client_file_import_items i
      where i.import_batch_id = ${batchId}::uuid and i.imported_document_id = d.document_id
        and d.deleted_at is null
    `;
    await tx`
      update pipeline.client_file_import_batches
      set status = 'failed', updated_at = now()
      where import_batch_id = ${batchId}::uuid
    `;
    await tx`
      insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, metadata)
      values ('client_file_import_batch', ${batchId}, 'client_file_import_rollback_started',
        'client-file-rollback', 'Client file rollback', ${tx.json({ item_count: plan.items, document_count: plan.documents })})
    `;
  });
}

async function deleteBlobTargets(targets) {
  const account = process.env.AZURE_STORAGE_ACCOUNT.trim();
  const credential = new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined });
  const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
  let blobs_deleted = 0;
  let blobs_already_absent = 0;
  for (const target of targets) {
    const deleted = await service.getContainerClient(target.container).getBlobClient(target.key)
      .deleteIfExists({ deleteSnapshots: "include" });
    if (deleted.succeeded) blobs_deleted += 1;
    else blobs_already_absent += 1;
  }
  return { blobs_deleted, blobs_already_absent };
}

async function finalizeRollback(client, manifestHash, batchId, plan, deletion) {
  return client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`client_file_import:${manifestHash}`}, 0))`;
    await tx`
      insert into pipeline.retention_events (document_id, event_type, actor_id, reason_code)
      select distinct i.imported_document_id, 'blob_delete', 'client-file-rollback', 'pilot_batch_rollback'
      from pipeline.client_file_import_items i
      where i.import_batch_id = ${batchId}::uuid and i.imported_document_id is not null
    `;
    const restored = await tx`
      update pipeline.client_file_import_items
      set match_status = 'confirmed', imported_document_id = null,
          version = version + 1, updated_at = now()
      where import_batch_id = ${batchId}::uuid and match_status = 'imported'
      returning import_item_id
    `;
    await tx`
      update pipeline.client_file_import_batches b
      set status = 'ready', imported_count = 0,
          matched_count = (select count(*)::integer from pipeline.client_file_import_items i
            where i.import_batch_id = b.import_batch_id and i.match_status = 'confirmed'),
          updated_at = now()
      where import_batch_id = ${batchId}::uuid
    `;
    await tx`
      insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, metadata)
      values ('client_file_import_batch', ${batchId}, 'client_file_import_rollback_completed',
        'client-file-rollback', 'Client file rollback', ${tx.json({
          item_count: plan.items,
          document_count: plan.documents,
          blob_delete_count: deletion.blobs_deleted,
          blob_absent_count: deletion.blobs_already_absent,
        })})
    `;
    await tx`update pipeline.store_revisions set revision = revision + 1, updated_at = now() where store_name in ('documents', 'client_workspaces', 'client_file_imports')`;
    return { restored_items: restored.length, documents_soft_deleted: plan.documents };
  });
}

function safeExtension(filename) {
  const extension = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".bin";
}

function safeBlobKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 900 && !value.includes("..") && !/[?#\\]/.test(value);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: {
    PIPELINE_DATABASE_URL: Boolean(process.env.PIPELINE_DATABASE_URL?.trim()),
    AZURE_STORAGE_ACCOUNT: Boolean(process.env.AZURE_STORAGE_ACCOUNT?.trim()),
  } }, null, 2));
  process.exit(1);
}

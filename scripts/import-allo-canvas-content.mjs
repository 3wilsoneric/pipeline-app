#!/usr/bin/env node

import path from "node:path";
import postgres from "postgres";

import {
  importConfirmation,
  loadManifest,
  manifestBytes,
  sha256,
} from "./allo-canvas-content-common.mjs";

const args = argumentMap();
const manifestPath = absoluteArgument("--manifest");
const dryRun = args.has("--dry-run");
const requireBlob = args.get("--require-blob") !== "false";
const apply = !dryRun && args.get("--confirm") === importConfirmation;
if (!dryRun && !apply) fail(`Refusing to import without --confirm=${importConfirmation}.`);
const manifest = await loadManifest(manifestPath, { requireBlob });
const manifestSha256 = sha256(manifestBytes(manifest));

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    mode: "plan",
    canvas_count: manifest.canvas_count,
    block_count: manifest.block_count,
    candidate_count: manifest.candidate_count,
    record_link_count: manifest.record_link_count,
    canonical_client_count: manifest.canonical_client_count,
    cloud_snapshots_required: requireBlob,
    manifest_sha256: manifestSha256,
    changes_made: false,
  }));
  process.exit(0);
}

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) fail("PIPELINE_DATABASE_URL is required.");
const sql = postgres(databaseUrl, databaseOptions("pipeline-allo-canvas-content-import"));
const connection = await sql.reserve();
let batchId = null;
let linked = 0;
let unmatched = 0;
let importedBlocks = 0;
let importedCandidates = 0;

try {
  await connection`select pg_advisory_lock(hashtextextended('pipeline_allo_canvas_content_import', 0))`;
  const migrations = await connection`
    select 1 from pipeline.schema_migrations where migration_id = '0020_allo_canvas_content'
  `;
  if (migrations.length !== 1) throw new Error("missing_migration");
  const batchRows = await connection`
    insert into pipeline.canvas_content_import_batches (
      source_system, manifest_sha256, status, canvas_count, block_count, candidate_count, created_by
    ) values (
      'allo', ${manifestSha256}, 'importing', ${manifest.canvas_count}, ${manifest.block_count},
      ${manifest.candidate_count}, 'allo_canvas_content_import'
    )
    on conflict (source_system, manifest_sha256) do update set
      status = 'importing', canvas_count = excluded.canvas_count,
      block_count = excluded.block_count, candidate_count = excluded.candidate_count,
      updated_at = now()
    returning canvas_content_import_batch_id::text
  `;
  batchId = batchRows[0].canvas_content_import_batch_id;

  for (let index = 0; index < manifest.snapshots.length; index += 1) {
    const result = await connection.begin((tx) => importSnapshot(tx, manifest.snapshots[index], batchId, index + 1));
    if (result.linkStatus === "linked") linked += 1;
    else unmatched += 1;
    importedBlocks += result.blocks;
    importedCandidates += result.candidates;
  }

  await connection`
    update pipeline.canvas_content_import_batches
    set status = 'complete', linked_canvas_count = ${linked}, updated_at = now()
    where canvas_content_import_batch_id = ${batchId}::uuid
  `;
  await connection`
    update pipeline.store_revisions set revision = revision + 1, updated_at = now()
    where store_name = 'allo_canvas_content'
  `;
  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    batch_id: batchId,
    canvas_count: manifest.canvas_count,
    linked_canvas_count: linked,
    unmatched_canvas_count: unmatched,
    inserted_blocks: importedBlocks,
    inserted_candidates: importedCandidates,
    manifest_sha256: manifestSha256,
  }));
} catch (error) {
  if (batchId) {
    await connection`
      update pipeline.canvas_content_import_batches set status = 'failed', updated_at = now()
      where canvas_content_import_batch_id = ${batchId}::uuid
    `.catch(() => undefined);
  }
  fail(`The ALLO canvas-content import stopped safely (${safeFailureCode(error)}). It is restartable and no canvas text was logged.`);
} finally {
  await connection`select pg_advisory_unlock(hashtextextended('pipeline_allo_canvas_content_import', 0))`.catch(() => undefined);
  connection.release();
  await sql.end({ timeout: 5 });
}

async function importSnapshot(tx, snapshot, importBatchId, snapshotOrdinal) {
  const referralRows = await tx`
    select referral_id::text
    from pipeline.referrals
    where workspace_origin = 'allo' and source_workspace_id = ${snapshot.source_canvas_id}
    limit 2
  `;
  const linkStatus = referralRows.length === 1 ? "linked" : referralRows.length > 1 ? "ambiguous" : "unmatched";
  const referralId = linkStatus === "linked" ? referralRows[0].referral_id : null;
  const snapshotRows = await tx`
    insert into pipeline.canvas_content_snapshots (
      source_system, source_canvas_id, source_canvas_name,
      source_project_id, source_project_name, source_locator, capture_method, captured_at,
      source_sha256, raw_blob_container, raw_blob_key, block_count,
      record_link_status, canonical_client_id, canonical_link_status, canonical_match_method,
      link_status, referral_id
    ) values (
      'allo', ${snapshot.source_canvas_id}, ${snapshot.source_canvas_name},
      ${snapshot.source_project_id}, ${snapshot.source_project_name}, ${snapshot.source_locator},
      ${snapshot.capture_method}, ${snapshot.captured_at}::timestamptz, ${snapshot.source_sha256},
      ${snapshot.raw_blob_container}, ${snapshot.raw_blob_key}, ${snapshot.block_count},
      ${snapshot.record_link_status ?? "not_evaluated"}, ${snapshot.canonical_client_id},
      ${snapshot.canonical_link_status ?? "not_evaluated"}, ${snapshot.canonical_match_method},
      ${linkStatus}, ${referralId}::bigint
    )
    on conflict (source_system, source_canvas_id, source_sha256) do update set
      raw_blob_container = coalesce(pipeline.canvas_content_snapshots.raw_blob_container, excluded.raw_blob_container),
      raw_blob_key = coalesce(pipeline.canvas_content_snapshots.raw_blob_key, excluded.raw_blob_key),
      record_link_status = case
        when excluded.record_link_status = 'exact' then 'exact'
        else pipeline.canvas_content_snapshots.record_link_status
      end,
      canonical_client_id = coalesce(pipeline.canvas_content_snapshots.canonical_client_id, excluded.canonical_client_id),
      canonical_link_status = case
        when excluded.canonical_link_status = 'confirmed' then 'confirmed'
        else pipeline.canvas_content_snapshots.canonical_link_status
      end,
      canonical_match_method = coalesce(
        pipeline.canvas_content_snapshots.canonical_match_method,
        excluded.canonical_match_method
      ),
      link_status = case
        when excluded.link_status = 'linked' then 'linked'
        else pipeline.canvas_content_snapshots.link_status
      end,
      referral_id = coalesce(pipeline.canvas_content_snapshots.referral_id, excluded.referral_id)
    where pipeline.canvas_content_snapshots.canonical_client_id is null
      or excluded.canonical_client_id is null
      or pipeline.canvas_content_snapshots.canonical_client_id = excluded.canonical_client_id
    returning canvas_content_snapshot_id::text
  `;
  if (snapshotRows.length !== 1) throw new Error("canonical_identity_conflict");
  const snapshotId = snapshotRows[0].canvas_content_snapshot_id;
  await tx`
    insert into pipeline.canvas_content_import_batch_snapshots (
      canvas_content_import_batch_id, canvas_content_snapshot_id, snapshot_ordinal
    ) values (${importBatchId}::uuid, ${snapshotId}::uuid, ${snapshotOrdinal})
    on conflict (canvas_content_import_batch_id, canvas_content_snapshot_id) do nothing
  `;
  let blocks = 0;
  for (const chunk of chunks(snapshot.blocks, 500)) {
    const blockRows = chunk.map((block) => ({
      source_block_id: block.source_block_id,
      page_number: block.page_number,
      page_title: block.page_title,
      ordinal: block.ordinal,
      block_type: block.block_type,
      semantic_role: block.semantic_role,
      heading_path: block.heading_path,
      text_content: block.text,
      structured_value: block.structured_value,
      source_locator: block.locator,
      bounding_box: block.bounding_box,
    }));
    const rows = await tx`
      insert into pipeline.canvas_content_blocks (
        canvas_content_snapshot_id, source_block_id, page_number, page_title, ordinal,
        block_type, semantic_role, heading_path, text_content, structured_value,
        source_locator, bounding_box
      )
      select ${snapshotId}::uuid, source_block_id, page_number, page_title, ordinal,
             block_type, semantic_role, heading_path, text_content, structured_value,
             source_locator, bounding_box
      from jsonb_to_recordset(${tx.json(blockRows)}::jsonb) as block_rows(
        source_block_id text, page_number integer, page_title text, ordinal integer,
        block_type text, semantic_role text, heading_path text[], text_content text,
        structured_value jsonb, source_locator text, bounding_box jsonb
      )
      on conflict (canvas_content_snapshot_id, source_block_id) do nothing
      returning canvas_content_block_id
    `;
    blocks += rows.length;
  }

  let candidates = 0;
  for (const candidate of snapshot.candidates) {
    const rows = await tx`
      insert into pipeline.canvas_content_field_candidates (
        canvas_content_snapshot_id, referral_id, canonical_client_id, target_field_key, proposed_value,
        mapping_confidence, source_block_ids, review_status
      ) values (
        ${snapshotId}::uuid, ${referralId}::bigint, ${snapshot.canonical_client_id}, ${candidate.target_field_key},
        ${tx.json(candidate.proposed_value)}, ${candidate.mapping_confidence},
        ${tx.array(candidate.source_block_ids)}, 'pending'
      )
      on conflict (canvas_content_snapshot_id, target_field_key) do update set
        referral_id = coalesce(pipeline.canvas_content_field_candidates.referral_id, excluded.referral_id),
        canonical_client_id = coalesce(
          pipeline.canvas_content_field_candidates.canonical_client_id,
          excluded.canonical_client_id
        )
      returning canvas_content_candidate_id
    `;
    candidates += rows.length;
  }
  return { linkStatus, blocks, candidates };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function databaseOptions(applicationName) {
  return {
    connection: { application_name: applicationName },
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable"
      ? false
      : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
    max: 1,
    connect_timeout: 10,
    idle_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
  };
}

function safeFailureCode(error) {
  const value = error instanceof Error ? error.message : "import_failed";
  return new Set(["canonical_identity_conflict", "missing_migration", "manifest_invalid", "snapshot_blob_missing"]).has(value)
    ? value
    : "import_failed";
}

function argumentMap() {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.split("=");
    return [key, rest.join("=")];
  }));
}

function absoluteArgument(name) {
  const value = args.get(name);
  if (!value || !path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  return value;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

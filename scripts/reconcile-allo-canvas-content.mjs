#!/usr/bin/env node

import path from "node:path";
import postgres from "postgres";

import { loadManifest, manifestBytes, sha256 } from "./allo-canvas-content-common.mjs";

const args = argumentMap();
const manifestPath = absoluteArgument("--manifest");
const includeDatabase = args.has("--database");
const manifest = await loadManifest(manifestPath);
const manifestSha256 = sha256(manifestBytes(manifest));
const result = {
  ok: true,
  manifest_sha256: manifestSha256,
  expected: {
    canvases: manifest.canvas_count,
    blocks: manifest.block_count,
    candidates: manifest.candidate_count,
  },
  database: null,
};

if (includeDatabase) {
  const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
  if (!databaseUrl) fail("PIPELINE_DATABASE_URL is required for --database.");
  const sql = postgres(databaseUrl, databaseOptions("pipeline-allo-canvas-content-reconcile"));
  try {
    const rows = await sql`
      select
        b.status,
        count(distinct s.canvas_content_snapshot_id)::int as snapshots,
        count(distinct case when s.link_status = 'linked' then s.canvas_content_snapshot_id end)::int as linked_snapshots,
        count(distinct case when s.link_status <> 'linked' then s.canvas_content_snapshot_id end)::int as unlinked_snapshots,
        count(distinct cb.canvas_content_block_id)::int as blocks,
        count(distinct c.canvas_content_candidate_id)::int as candidates,
        count(distinct case when c.review_status = 'pending' then c.canvas_content_candidate_id end)::int as pending_candidates
      from pipeline.canvas_content_import_batches b
      left join pipeline.canvas_content_import_batch_snapshots bs
        on bs.canvas_content_import_batch_id = b.canvas_content_import_batch_id
      left join pipeline.canvas_content_snapshots s
        on s.canvas_content_snapshot_id = bs.canvas_content_snapshot_id
      left join pipeline.canvas_content_blocks cb
        on cb.canvas_content_snapshot_id = s.canvas_content_snapshot_id
      left join pipeline.canvas_content_field_candidates c
        on c.canvas_content_snapshot_id = s.canvas_content_snapshot_id
      where b.source_system = 'allo' and b.manifest_sha256 = ${manifestSha256}
      group by b.canvas_content_import_batch_id, b.status
    `;
    result.database = rows[0] ?? { status: "not_imported", snapshots: 0, linked_snapshots: 0, unlinked_snapshots: 0, blocks: 0, candidates: 0, pending_candidates: 0 };
    result.ok = result.database.status === "complete"
      && result.database.snapshots === manifest.canvas_count
      && result.database.blocks === manifest.block_count
      && result.database.candidates === manifest.candidate_count;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

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

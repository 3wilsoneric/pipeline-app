#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const confirmation = "STAGE-CLIENT-FILE-METADATA";
const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.split("=");
  return [key, rest.join("=")];
}));
const manifestPath = args.get("--manifest");
const dryRun = args.has("--dry-run");
if (!manifestPath || !path.isAbsolute(manifestPath)) fail("Use --manifest=/absolute/path/private-manifest.json.");
if (!dryRun && args.get("--confirm") !== confirmation) fail(`Refusing to stage without --confirm=${confirmation}.`);
if (!dryRun && !process.env.PIPELINE_DATABASE_URL?.trim()) fail("PIPELINE_DATABASE_URL is required.");

const raw = await readFile(manifestPath);
const manifest = JSON.parse(raw.toString("utf8"));
validateManifest(manifest);
const manifestSha256 = createHash("sha256").update(raw).digest("hex");
if (dryRun) {
  console.log(JSON.stringify({ ok: true, dry_run: true, item_count: manifest.items.length, source_system: manifest.source_system }));
  process.exit(0);
}

const sql = postgres(process.env.PIPELINE_DATABASE_URL.trim(), {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
  max: 1,
  prepare: false,
  connection: { application_name: "pipeline-client-file-stage" },
});
try {
  const result = await sql.begin(async (tx) => {
    const batch = (await tx`
      insert into pipeline.client_file_import_batches (
        source_system, manifest_sha256, item_count, created_by
      ) values (
        ${manifest.source_system}, ${manifestSha256}, ${manifest.items.length}, 'offline_import_tool'
      )
      on conflict (source_system, manifest_sha256) do update
      set item_count = excluded.item_count, updated_at = now()
      returning import_batch_id
    `)[0];
    let staged = 0;
    for (const item of manifest.items) {
      const rows = await tx`
        insert into pipeline.client_file_import_items (
          import_batch_id, source_item_id, source_canvas_id, source_client_name,
          source_resident_number, source_date_of_birth, source_community,
          source_file_name, source_content_type, source_byte_size, source_sha256,
          source_locator
        ) values (
          ${batch.import_batch_id}::uuid, ${item.source_item_id}, ${item.source_canvas_id},
          ${item.source_client_name}, ${item.source_resident_number}, ${item.source_date_of_birth}::date,
          ${item.source_community}, ${item.source_file_name}, ${item.source_content_type},
          ${item.source_byte_size}, ${item.source_sha256}, ${item.source_locator}
        )
        on conflict (import_batch_id, source_item_id) do nothing
        returning import_item_id
      `;
      staged += rows.length;
    }
    return { staged, existing: manifest.items.length - staged };
  });
  console.log(JSON.stringify({ ok: true, item_count: manifest.items.length, ...result }));
} finally {
  await sql.end({ timeout: 5 });
}

function validateManifest(manifest) {
  if (manifest?.version !== 1 || manifest?.data_class !== "user_supplied_real") fail("Manifest version or data class is invalid.");
  if (!new Set(["allo", "import"]).has(manifest.source_system)) fail("Manifest source_system is invalid.");
  if (!Array.isArray(manifest.items) || manifest.items.length < 1 || manifest.items.length > 100_000) fail("Manifest item count is invalid.");
  for (const [index, item] of manifest.items.entries()) {
    if (!item || typeof item !== "object") fail(`Manifest item ${index + 1} is invalid.`);
    for (const field of ["source_item_id", "source_client_name", "source_file_name", "source_sha256"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) fail(`Manifest item ${index + 1} is missing ${field}.`);
    }
    if (!/^[a-f0-9]{64}$/.test(item.source_sha256)) fail(`Manifest item ${index + 1} SHA-256 is invalid.`);
    if (!Number.isSafeInteger(item.source_byte_size) || item.source_byte_size < 1 || item.source_byte_size > 100 * 1024 * 1024) fail(`Manifest item ${index + 1} size is invalid.`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

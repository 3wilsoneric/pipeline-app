#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import postgres from "postgres";

const confirmation = "UPLOAD-CONFIRMED-CLIENT-FILES";
const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.split("=");
  return [key, rest.join("=")];
}));
const manifestPath = args.get("--manifest");
const dryRun = args.has("--dry-run");
if (!manifestPath || !path.isAbsolute(manifestPath)) fail("Use --manifest=/absolute/path/private-manifest.json.");
if (!process.env.PIPELINE_DATABASE_URL?.trim()) fail("PIPELINE_DATABASE_URL is required.");
if (!dryRun && args.get("--confirm") !== confirmation) fail(`Refusing to upload without --confirm=${confirmation}.`);
if (!dryRun && !process.env.AZURE_STORAGE_ACCOUNT?.trim()) fail("AZURE_STORAGE_ACCOUNT is required.");

const raw = await readFile(manifestPath);
const manifest = JSON.parse(raw.toString("utf8"));
if (manifest?.version !== 1 || !Array.isArray(manifest.items)) fail("The private manifest is invalid.");
const manifestSha256 = createHash("sha256").update(raw).digest("hex");
const manifestItems = new Map(manifest.items.map((item) => [item.source_item_id, item]));
const sql = postgres(process.env.PIPELINE_DATABASE_URL.trim(), {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
  max: 1,
  prepare: false,
  connection: { application_name: "pipeline-client-file-import" },
});

try {
  const rows = await sql`
    select
      i.import_item_id::text,
      i.source_item_id,
      i.source_client_name,
      i.source_file_name,
      i.source_content_type,
      i.source_byte_size,
      i.source_sha256,
      i.matched_person_id::text,
      i.matched_canonical_client_id,
      i.matched_referral_id,
      i.version,
      b.import_batch_id::text,
      b.source_system
    from pipeline.client_file_import_items i
    join pipeline.client_file_import_batches b on b.import_batch_id = i.import_batch_id
    where b.manifest_sha256 = ${manifestSha256}
      and i.match_status = 'confirmed'
      and i.imported_document_id is null
    order by i.created_at, i.import_item_id
  `;
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, confirmed_ready: rows.length, manifest_items: manifest.items.length }));
    process.exit(0);
  }

  const account = process.env.AZURE_STORAGE_ACCOUNT.trim();
  const containerName = process.env.AZURE_STORAGE_CONTAINER_RAW?.trim() || "raw";
  const credential = new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined });
  const container = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential).getContainerClient(containerName);
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const item = manifestItems.get(row.source_item_id);
    if (!item) fail("The staged batch and private manifest do not contain the same source items.");
    const bytes = await readFile(item.source_path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== row.source_sha256 || sha256 !== item.source_sha256 || bytes.length !== Number(row.source_byte_size)) {
      fail("A source file changed after metadata staging. Recreate and review a new manifest.");
    }
    const extension = safeExtension(row.source_file_name);
    const blobKey = `client-import/${row.source_system}/${row.import_batch_id}/${row.import_item_id}/original${extension}`;
    await container.getBlockBlobClient(blobKey).uploadData(bytes, {
      blobHTTPHeaders: { blobContentType: row.source_content_type || "application/octet-stream" },
      metadata: { sourceSystem: row.source_system, sourceSha256: sha256 },
    });

    const result = await sql.begin(async (tx) => {
      const existing = await tx`
        select document_id from pipeline.documents
        where source_system = ${row.source_system}
          and source_external_id = ${`${row.import_batch_id}:${row.source_item_id}`}
          and deleted_at is null
        limit 1
      `;
      const documentId = existing[0]?.document_id ?? (await tx`
        insert into pipeline.documents (
          referral_id, person_id, canonical_client_id, client_display_name, client_community,
          category, file_name, content_type, byte_size, sha256,
          blob_container, blob_key, processing_status, uploaded_by,
          preview_status, malware_scan_status, retention_until,
          source_system, source_external_id, identity_status
        ) values (
          ${row.matched_referral_id}, ${row.matched_person_id}::uuid,
          ${row.matched_canonical_client_id}, ${row.source_client_name}, ${item.source_community},
          ${categoryFor(row.source_file_name)}, ${row.source_file_name},
          ${row.source_content_type || "application/octet-stream"}, ${bytes.length}, ${sha256},
          ${containerName}, ${blobKey}, 'quarantined', 'offline_import_tool',
          'pending', 'pending', now() + interval '7 years',
          ${row.source_system}, ${`${row.import_batch_id}:${row.source_item_id}`}, 'linked'
        ) returning document_id
      `)[0].document_id;
      await tx`
        insert into pipeline.extraction_jobs (document_id, job_type, status)
        values (${documentId}::uuid, 'document_preview', 'queued')
        on conflict (document_id, job_type) where status in ('queued', 'running')
        do update set next_attempt_at = least(pipeline.extraction_jobs.next_attempt_at, now()), updated_at = now()
      `;
      const updated = await tx`
        update pipeline.client_file_import_items
        set match_status = 'imported', imported_document_id = ${documentId}::uuid,
            version = version + 1, updated_at = now()
        where import_item_id = ${row.import_item_id}::uuid
          and version = ${row.version}
          and match_status = 'confirmed'
        returning import_item_id
      `;
      return updated.length > 0;
    });
    if (result) imported += 1;
    else skipped += 1;
  }
  await sql`
    update pipeline.client_file_import_batches b
    set imported_count = counts.imported_count,
        matched_count = counts.matched_count,
        status = case when counts.imported_count = b.item_count then 'complete' else 'ready' end,
        updated_at = now()
    from (
      select import_batch_id,
        count(*) filter (where match_status in ('confirmed', 'imported'))::integer as matched_count,
        count(*) filter (where match_status = 'imported')::integer as imported_count
      from pipeline.client_file_import_items
      group by import_batch_id
    ) counts
    where counts.import_batch_id = b.import_batch_id and b.manifest_sha256 = ${manifestSha256}
  `;
  console.log(JSON.stringify({ ok: true, imported, skipped, attempted: rows.length }));
} finally {
  await sql.end({ timeout: 5 });
}

function safeExtension(filename) {
  const extension = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".bin";
}

function categoryFor(filename) {
  const value = filename.toLowerCase();
  if (value.includes("face sheet")) return "face_sheet";
  if (value.includes("assessment")) return "assessment";
  if (value.includes("med") && value.includes("list")) return "medication_list";
  if (value.includes("tb")) return "tb_test";
  if (value.includes("602")) return "lic_602";
  if (value.includes("601") || value.includes("603")) return "lic_601_603";
  if (value.includes("provider")) return "provider_form";
  return "other";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

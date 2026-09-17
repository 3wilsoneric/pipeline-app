import "server-only";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";

// Expired undo never reactivates. Failed blob removal stays eligible for the next run.
export async function purgeExpiredDocumentUndo(limit = 100, dryRun = true) {
  const sql = getPipelineSql();
  const candidates = await sql<{ document_id: string; blob_container: string; blob_key: string; preview_blob_key: string | null }[]>`
    select document_id, blob_container, blob_key, preview_blob_key from pipeline.documents
    where deleted_at is not null and undo_until <= now() and purged_at is null
      and not exists (select 1 from pipeline.extraction_jobs j where j.document_id = documents.document_id and j.status in ('queued', 'running'))
    order by undo_until, document_id limit ${Math.min(500, Math.max(1, Math.trunc(limit)))}
  `;
  if (dryRun) return { dry_run: true, eligible: candidates.length, deleted: 0, failed: 0 };
  const signer = getAzureBlobUploadSigner();
  let deleted = 0;
  let failed = 0;
  for (const document of candidates) {
    try {
      const artifacts = await sql<{ blob_container: string; blob_key: string }[]>`
        select blob_container, blob_key from pipeline.document_artifacts where document_id = ${document.document_id}::uuid
        union select blob_container, blob_key from pipeline.document_preview_pages where document_id = ${document.document_id}::uuid
      `;
      await signer.deleteBlob(document.blob_container, document.blob_key);
      if (document.preview_blob_key) await signer.deleteBlob(process.env.AZURE_STORAGE_CONTAINER_ARTIFACTS?.trim() || "artifacts", document.preview_blob_key);
      for (const artifact of artifacts) await signer.deleteBlob(artifact.blob_container, artifact.blob_key);
      await sql.begin(async (tx) => {
        await tx`update pipeline.documents set purged_at = now(), deletion_recovery = null, updated_at = now() where document_id = ${document.document_id}::uuid`;
        await tx`insert into pipeline.retention_events(document_id, event_type, actor_id, reason_code)
          values (${document.document_id}::uuid, 'blob_delete', 'pipeline-retention', 'document_undo_expired')`;
      });
      deleted += 1;
    } catch { failed += 1; }
  }
  return { dry_run: false, eligible: candidates.length, deleted, failed };
}

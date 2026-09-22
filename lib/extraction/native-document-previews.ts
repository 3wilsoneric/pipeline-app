import "server-only";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { browserPreviewContentTypes } from "@/lib/extraction/document-access-policy";

// Native previews already use the authorized original-file route. Retire only
// redundant, unleased jobs; never run extraction or change a scanning verdict.
export async function reconcileNativeDocumentPreviews(limit = 50) {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    const jobs = await tx<{ extraction_job_id: string; document_id: string; status: string; preview_status: string; deleted_at: Date | null }[]>`
      select j.extraction_job_id, j.document_id, j.status, d.preview_status, d.deleted_at
      from pipeline.extraction_jobs j join pipeline.documents d using (document_id)
      where j.job_type = 'document_preview' and j.status in ('queued', 'dead_letter')
        and (d.deleted_at is not null or (
          d.content_type = any(${browserPreviewContentTypes})
          and d.malware_scan_status in ('clean', 'not_scanned')
          and d.processing_status in ('uploaded', 'ready_for_review', 'reviewed', 'failed')
          and d.preview_status in ('pending', 'ready', 'failed')
          and d.preview_blob_key is null
        ))
      order by j.queued_at, j.extraction_job_id
      for update of d, j skip locked
      limit ${Math.min(100, Math.max(1, Math.trunc(limit)))}
    `;
    for (const job of jobs) {
      const reason = job.deleted_at ? "document_deleted" : "native_preview_available";
      await tx`update pipeline.extraction_jobs set status = 'cancelled', completed_at = now(),
        lease_owner = null, lease_expires_at = null, last_error_code = ${reason}, updated_at = now()
        where extraction_job_id = ${job.extraction_job_id}::uuid`;
      if (!job.deleted_at) await tx`update pipeline.documents set preview_status = 'ready',
        version = version + 1, updated_at = now() where document_id = ${job.document_id}::uuid`;
      await tx`insert into pipeline.audit_events(entity_type, entity_id, action, actor_id, actor_name, changed_fields, before_values, after_values, metadata)
        values ('document', ${job.document_id}, 'document_preview_reconciled', 'system:document-preview', 'Pipeline',
          array['preview_status'], ${tx.json({ preview_status: job.preview_status })},
          ${tx.json({ preview_status: job.deleted_at ? job.preview_status : "ready" })},
          ${tx.json({ extraction_job_id: job.extraction_job_id, previous_job_status: job.status, job_status: "cancelled", reason })})`;
    }
    return { native_ready: jobs.filter((job) => !job.deleted_at).length, deleted_cancelled: jobs.filter((job) => job.deleted_at).length };
  });
}

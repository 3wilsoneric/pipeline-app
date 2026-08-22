import "server-only";

import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";

type RetentionCandidate = { referral_id: number | string };
type RetentionDocument = {
  document_id: string;
  blob_container: string;
  blob_key: string;
  preview_blob_key: string | null;
};

export async function purgeExpiredReferrals(limit = 100, dryRun = true) {
  if (!getPipelineDatabaseReadiness().ready) {
    return { dry_run: dryRun, eligible: 0, deleted: 0, failed: 0, skipped: "database_unavailable" };
  }
  const sql = getPipelineSql();
  const candidates = await sql<RetentionCandidate[]>`
    select referral_id
    from pipeline.referrals
    where deleted_at is not null and delete_after <= now()
    order by delete_after, referral_id
    limit ${Math.min(500, Math.max(1, Math.trunc(limit)))}
  `;
  if (dryRun) return { dry_run: true, eligible: candidates.length, deleted: 0, failed: 0 };

  const signer = getAzureBlobUploadSigner();
  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const documents = await sql<RetentionDocument[]>`
        select document_id, blob_container, blob_key, preview_blob_key
        from pipeline.documents
        where referral_id = ${candidate.referral_id}
      `;
      for (const document of documents) {
        const artifacts = await sql<{ blob_container: string; blob_key: string }[]>`
          select blob_container, blob_key from pipeline.document_artifacts
          where document_id = ${document.document_id}::uuid
        `;
        await signer.deleteBlob(document.blob_container, document.blob_key);
        if (document.preview_blob_key) {
          await signer.deleteBlob(process.env.AZURE_STORAGE_CONTAINER_ARTIFACTS?.trim() || "artifacts", document.preview_blob_key);
        }
        for (const artifact of artifacts) await signer.deleteBlob(artifact.blob_container, artifact.blob_key);
      }

      const removed = await sql.begin(async (tx) => {
        await tx`
          update pipeline.client_file_import_items
          set matched_referral_id = null,
              imported_document_id = case
                when imported_document_id in (
                  select document_id from pipeline.documents where referral_id = ${candidate.referral_id}
                ) then null else imported_document_id end,
              updated_at = now()
          where matched_referral_id = ${candidate.referral_id}
             or imported_document_id in (
               select document_id from pipeline.documents where referral_id = ${candidate.referral_id}
             )
        `;
        const rows = await tx<{ referral_id: number | string }[]>`
          delete from pipeline.referrals
          where referral_id = ${candidate.referral_id}
            and deleted_at is not null
            and delete_after <= now()
          returning referral_id
        `;
        if (!rows[0]) return false;
        await tx`
          update pipeline.store_revisions
          set revision = revision + 1, updated_at = now()
          where store_name = 'referrals'
        `;
        return true;
      });
      if (removed) deleted += 1;
    } catch {
      failed += 1;
    }
  }
  recordPipelineMetric("pipeline.retention.referrals", deleted, "count", { operation: "retention", result: "deleted" });
  recordPipelineMetric("pipeline.retention.referrals", failed, "count", { operation: "retention", result: "failed" });
  return { dry_run: false, eligible: candidates.length, deleted, failed };
}

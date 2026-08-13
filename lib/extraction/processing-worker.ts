import "server-only";

import type { TransactionSql } from "postgres";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import { DatabricksAdapterError, getDatabricksJobAdapter } from "@/lib/extraction/databricks";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { getExtractionFailureDisposition } from "@/lib/extraction/extraction-state";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";

type JobType = "referral_packet" | "assessment_workbook" | "document_preview";
type JobRow = {
  extraction_job_id: string;
  document_id: string;
  packet_id: string | null;
  job_type: JobType;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "dead_letter";
  attempt_count: number;
  attempt_token: string | null;
  max_attempts: number;
  provider_job_id: string | null;
  blob_container: string;
  blob_key: string;
  sha256: string;
};

export type ExtractionCandidateInput = {
  source: "document_intelligence" | "claude" | "human";
  value: unknown;
  confidence: number;
  source_page?: number;
  evidence_blob_key?: string;
};

export type ExtractionFieldInput = {
  field_key: string;
  proposed_value: unknown;
  confidence: number;
  source_page?: number;
  evidence_blob_key?: string;
  candidates?: ExtractionCandidateInput[];
};

export type WorkerReport = {
  extraction_job_id: string;
  attempt_count: number;
  attempt_token: string;
  status: "heartbeat" | "succeeded" | "failed";
  provider_job_id?: string;
  error_code?: string;
  retryable?: boolean;
  malware_scan_status?: "clean" | "infected" | "failed";
  verified_sha256?: string;
  page_count?: number;
  preview?: {
    blob_container: string;
    blob_key: string;
    content_type: string;
    pages?: Array<{
      page_number: number;
      blob_container: string;
      blob_key: string;
      content_type: string;
      byte_size?: number;
      width?: number;
      height?: number;
    }>;
  };
  artifacts?: Array<{
    kind: "normalized_page" | "ocr_json" | "preview" | "evidence" | "extraction_output" | "other";
    blob_container: string;
    blob_key: string;
    content_type?: string;
    byte_size?: number;
  }>;
  fields?: ExtractionFieldInput[];
};

export async function dispatchExtractionJobs(limit = 10, workerId = "pipeline-dispatch") {
  const sql = getPipelineSql();
  const boundedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const jobs = await sql.begin(async (tx) => tx<JobRow[]>`
    with candidates as (
      select j.extraction_job_id
      from pipeline.extraction_jobs j
      where j.status = 'queued' and j.next_attempt_at <= now()
      order by j.next_attempt_at, j.queued_at, j.extraction_job_id
      for update skip locked
      limit ${boundedLimit}
    )
    update pipeline.extraction_jobs j
    set status = 'running', attempt_count = j.attempt_count + 1, started_at = coalesce(j.started_at, now()),
      attempt_token = gen_random_uuid(),
      heartbeat_at = now(), lease_owner = ${safeWorkerId(workerId)}, lease_expires_at = now() + interval '5 minutes',
      updated_at = now(), error_code = null, last_error_code = null
    from candidates c, pipeline.documents d
    where j.extraction_job_id = c.extraction_job_id and d.document_id = j.document_id
    returning j.extraction_job_id, j.document_id, j.packet_id, j.job_type, j.status,
      j.attempt_count, j.max_attempts, j.attempt_token, j.provider_job_id, d.blob_container, d.blob_key, d.sha256
  `);

  const adapter = getDatabricksJobAdapter();
  let dispatched = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const job of jobs) {
    try {
      const run = await adapter.triggerExtractionJob({
        packet_id: job.packet_id ?? "document-only",
        raw_blob_prefix: `${job.blob_container}/${job.blob_key}`,
        extraction_job_id: job.extraction_job_id,
        attempt_count: job.attempt_count,
        attempt_token: job.attempt_token!,
        job_type: job.job_type,
      });
      await sql`
        update pipeline.extraction_jobs set provider_job_id = ${run.job_run_id}, provider_state = 'queued',
          heartbeat_at = now(), lease_expires_at = now() + interval '30 minutes', updated_at = now()
        where extraction_job_id = ${job.extraction_job_id}::uuid and status = 'running'
      `;
      if (job.packet_id) {
        await sql`update pipeline.packet_uploads set status = 'extracting', updated_at = now() where packet_id = ${job.packet_id}::uuid`;
      }
      dispatched += 1;
      metric("dispatch", "success", job.job_type);
    } catch (error) {
      const retryable = error instanceof DatabricksAdapterError ? error.retryable : true;
      const outcome = await failOrRetry(job, safeErrorCode(error), retryable);
      if (outcome === "dead_letter") deadLettered += 1;
      else if (outcome === "queued") retried += 1;
      metric("dispatch", outcome, job.job_type);
    }
  }
  return { claimed: jobs.length, dispatched, retried, dead_lettered: deadLettered };
}

export async function reconcileExtractionJobs(limit = 25) {
  const sql = getPipelineSql();
  const jobs = await sql<JobRow[]>`
    select j.extraction_job_id, j.document_id, j.packet_id, j.job_type, j.status,
      j.attempt_count, j.max_attempts, j.attempt_token, j.provider_job_id, d.blob_container, d.blob_key, d.sha256
    from pipeline.extraction_jobs j
    join pipeline.documents d on d.document_id = j.document_id
    where j.status = 'running' and j.provider_job_id is not null
      and (j.heartbeat_at < now() - interval '30 seconds' or j.heartbeat_at is null)
    order by j.heartbeat_at nulls first, j.updated_at, j.extraction_job_id
    limit ${Math.min(100, Math.max(1, Math.trunc(limit)))}
  `;
  const adapter = getDatabricksJobAdapter();
  let running = 0;
  const succeeded = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const job of jobs) {
    try {
      const state = await adapter.getRunState(job.provider_job_id!);
      if (state === "queued" || state === "running") {
        await sql`
          update pipeline.extraction_jobs set provider_state = ${state}, heartbeat_at = now(),
            lease_expires_at = now() + interval '30 minutes', updated_at = now()
          where extraction_job_id = ${job.extraction_job_id}::uuid and status = 'running'
        `;
        running += 1;
      } else if (state === "succeeded") {
        const outcome = await failOrRetry(job, "worker_callback_missing", true);
        if (outcome === "dead_letter") deadLettered += 1;
        else if (outcome === "queued") retried += 1;
      } else {
        const outcome = await failOrRetry(job, "databricks_run_failed", true);
        if (outcome === "dead_letter") deadLettered += 1;
        else if (outcome === "queued") retried += 1;
      }
      metric("reconcile", state, job.job_type);
    } catch (error) {
      const retryable = error instanceof DatabricksAdapterError ? error.retryable : true;
      if (!retryable) {
        const outcome = await failOrRetry(job, safeErrorCode(error), false);
        if (outcome === "dead_letter") deadLettered += 1;
        else if (outcome === "queued") retried += 1;
      }
      metric("reconcile", retryable ? "upstream_unavailable" : "failed", job.job_type);
    }
  }
  return { inspected: jobs.length, running, succeeded, retried, dead_lettered: deadLettered };
}

export async function reportExtractionJob(input: WorkerReport) {
  validateWorkerReport(input);
  const sql = getPipelineSql();
  const rows = await sql<JobRow[]>`
    select j.extraction_job_id, j.document_id, j.packet_id, j.job_type, j.status,
      j.attempt_count, j.max_attempts, j.attempt_token, j.provider_job_id, d.blob_container, d.blob_key, d.sha256
    from pipeline.extraction_jobs j join pipeline.documents d on d.document_id = j.document_id
    where j.extraction_job_id = ${input.extraction_job_id}::uuid limit 1
  `;
  const job = rows[0];
  if (!job) throw new DocumentProcessingError("extraction_job_not_found", 404, "Extraction job not found.");
  if (job.attempt_count !== input.attempt_count || job.attempt_token !== input.attempt_token) {
    throw new DocumentProcessingError("stale_job_attempt", 409, "This worker callback belongs to an expired attempt.");
  }
  if (job.status === "succeeded" && input.status === "succeeded") {
    return { status: "succeeded" as const };
  }
  if (job.status !== "running") {
    throw new DocumentProcessingError("job_not_running", 409, "This extraction job is no longer running.");
  }
  if (input.status === "heartbeat") {
    await sql`
      update pipeline.extraction_jobs set heartbeat_at = now(), lease_expires_at = now() + interval '30 minutes',
        provider_job_id = coalesce(${input.provider_job_id ?? null}, provider_job_id), updated_at = now()
      where extraction_job_id = ${job.extraction_job_id}::uuid and status = 'running'
        and attempt_count = ${input.attempt_count} and attempt_token = ${input.attempt_token}::uuid
    `;
    return { status: "running" as const };
  }
  if (input.status === "failed") {
    const outcome = await failOrRetry(job, input.error_code ?? "worker_reported_failure", input.retryable !== false);
    if (outcome === "stale") throw new DocumentProcessingError("stale_job_attempt", 409);
    return { status: outcome };
  }
  if (job.job_type !== "document_preview") {
    if (!input.verified_sha256) throw new DocumentProcessingError("verified_sha256_required", 400, "The worker must report the verified file digest.");
    if (input.verified_sha256 !== job.sha256) {
      await failOrRetry(job, "uploaded_blob_digest_mismatch", false);
      throw new DocumentProcessingError("uploaded_blob_digest_mismatch", 409, "The uploaded file digest does not match its reservation.");
    }
    if (!input.malware_scan_status) throw new DocumentProcessingError("malware_scan_status_required", 400, "The worker must report the file safety scan.");
  }

  await sql.begin(async (tx) => {
    const completed = await tx<{ extraction_job_id: string }[]>`
      update pipeline.extraction_jobs set status = 'succeeded', provider_state = 'succeeded',
        provider_job_id = coalesce(${input.provider_job_id ?? null}, provider_job_id), completed_at = now(),
        heartbeat_at = now(), lease_owner = null, lease_expires_at = null, updated_at = now()
      where extraction_job_id = ${job.extraction_job_id}::uuid and status = 'running'
        and attempt_count = ${input.attempt_count} and attempt_token = ${input.attempt_token}::uuid
      returning extraction_job_id
    `;
    if (!completed[0]) throw new DocumentProcessingError("stale_job_attempt", 409);
    const infected = input.malware_scan_status === "infected";
    const scanFailed = input.malware_scan_status === "failed";
    const unsafe = infected || scanFailed;
    const scan = input.malware_scan_status;
    const previewStatus = input.preview ? "ready" : job.job_type === "document_preview" ? "failed" : undefined;
    await tx`
      update pipeline.documents set
        malware_scan_status = coalesce(${scan ?? null}, malware_scan_status),
        processing_status = ${unsafe ? "failed" : "ready_for_review"},
        preview_status = coalesce(${previewStatus ?? null}, preview_status),
        preview_blob_key = coalesce(${input.preview?.blob_key ?? null}, preview_blob_key),
        preview_content_type = coalesce(${input.preview?.content_type ?? null}, preview_content_type),
        page_count = coalesce(${input.page_count ?? null}, page_count),
        failure_code = ${infected ? "malware_detected" : scanFailed ? "malware_scan_failed" : null}, version = version + 1, updated_at = now()
      where document_id = ${job.document_id}::uuid
    `;
    if (input.preview?.pages) {
      for (const page of input.preview.pages) {
        await tx`
          insert into pipeline.document_preview_pages (
            document_id, page_number, blob_container, blob_key, content_type, byte_size, width, height
          ) values (
            ${job.document_id}::uuid, ${page.page_number}, ${page.blob_container}, ${page.blob_key},
            ${page.content_type}, ${page.byte_size ?? null}, ${page.width ?? null}, ${page.height ?? null}
          ) on conflict (document_id, page_number) do update set
            blob_container = excluded.blob_container, blob_key = excluded.blob_key,
            content_type = excluded.content_type, byte_size = excluded.byte_size,
            width = excluded.width, height = excluded.height
        `;
      }
    }
    const artifacts = collectReportedArtifacts(input);
    for (const artifact of artifacts) {
      await tx`
        insert into pipeline.document_artifacts (
          document_id, artifact_kind, blob_container, blob_key, content_type, byte_size
        ) values (
          ${job.document_id}::uuid, ${artifact.kind}, ${artifact.blob_container}, ${artifact.blob_key},
          ${artifact.content_type ?? null}, ${artifact.byte_size ?? null}
        ) on conflict (blob_container, blob_key) do update set
          document_id = excluded.document_id, artifact_kind = excluded.artifact_kind,
          content_type = excluded.content_type, byte_size = excluded.byte_size
      `;
    }
    if (job.packet_id && !unsafe && input.fields?.length) {
      const packet = await tx<{ referral_id: number | string }[]>`
        select referral_id from pipeline.packet_uploads where packet_id = ${job.packet_id}::uuid limit 1
      `;
      if (!packet[0]) throw new DocumentProcessingError("packet_not_found", 404);
      for (const field of input.fields) {
        const fieldRows = await tx<{ referral_field_id: string }[]>`
          insert into pipeline.referral_fields (
            referral_id, field_key, proposed_value, confidence, review_status,
            source_document_id, source_page, evidence_blob_key
          ) values (
            ${Number(packet[0].referral_id)}, ${field.field_key}, ${tx.json(field.proposed_value as never)},
            ${field.confidence}, 'pending', ${job.document_id}::uuid, ${field.source_page ?? null},
            ${field.evidence_blob_key ?? null}
          ) on conflict (referral_id, field_key) do update set
            proposed_value = excluded.proposed_value, confidence = excluded.confidence,
            source_document_id = excluded.source_document_id, source_page = excluded.source_page,
            evidence_blob_key = excluded.evidence_blob_key, updated_at = now(),
            version = pipeline.referral_fields.version + 1
          returning referral_field_id
        `;
        await tx`delete from pipeline.extraction_candidates where referral_field_id = ${fieldRows[0].referral_field_id}::uuid`;
        for (const candidate of field.candidates ?? []) {
          await tx`
            insert into pipeline.extraction_candidates (
              referral_field_id, source, candidate_value, confidence, source_page, evidence_blob_key
            ) values (
              ${fieldRows[0].referral_field_id}::uuid, ${candidate.source}, ${tx.json(candidate.value as never)},
              ${candidate.confidence}, ${candidate.source_page ?? null}, ${candidate.evidence_blob_key ?? null}
            )
          `;
        }
      }
    }
    if (job.packet_id) await refreshPacketState(tx, job.packet_id);
  });
  metric("report", "succeeded", job.job_type);
  return { status: "succeeded" as const };
}

export async function replayDeadLetterJob(extractionJobId: string) {
  if (!uuid(extractionJobId)) throw new DocumentProcessingError("extraction_job_id_invalid", 400);
  const sql = getPipelineSql();
  const rows = await sql<{ extraction_job_id: string }[]>`
    update pipeline.extraction_jobs set status = 'queued', attempt_count = 0, next_attempt_at = now(),
      provider_job_id = null, provider_state = null, error_code = null, last_error_code = null,
      attempt_token = null, dead_lettered_at = null, completed_at = null,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where extraction_job_id = ${extractionJobId}::uuid and status = 'dead_letter'
    returning extraction_job_id
  `;
  if (!rows[0]) throw new DocumentProcessingError("dead_letter_not_found", 404, "Dead-letter job not found.");
  return { status: "queued" as const };
}

export async function getExtractionQueueHealth() {
  const sql = getPipelineSql();
  const rows = await sql<{ status: string; count: number | string; oldest_seconds: number | string | null }[]>`
    select status, count(*) as count,
      extract(epoch from (now() - min(coalesce(next_attempt_at, queued_at)))) as oldest_seconds
    from pipeline.extraction_jobs group by status order by status
  `;
  return {
    generated_at: new Date().toISOString(),
    queues: rows.map((row) => ({ status: row.status, count: Number(row.count), oldest_seconds: Math.max(0, Math.round(Number(row.oldest_seconds ?? 0))) })),
  };
}

export async function runDocumentRetention(limit = 100, dryRun = true) {
  const sql = getPipelineSql();
  const candidates = await sql<{
    document_id: string; blob_container: string; blob_key: string; preview_blob_key: string | null;
  }[]>`
    select document_id, blob_container, blob_key, preview_blob_key
    from pipeline.documents
    where deleted_at is null and (
      retention_until < now() or
      (processing_status = 'reserved' and uploaded_at < now() - interval '24 hours')
    )
    order by coalesce(retention_until, uploaded_at), document_id
    limit ${Math.min(500, Math.max(1, Math.trunc(limit)))}
  `;
  if (dryRun) return { dry_run: true, eligible: candidates.length, deleted: 0, failed: 0 };
  const signer = getAzureBlobUploadSigner();
  let deleted = 0;
  let failed = 0;
  for (const document of candidates) {
    try {
      const artifacts = await sql<{ blob_container: string; blob_key: string }[]>`
        select blob_container, blob_key from pipeline.document_artifacts
        where document_id = ${document.document_id}::uuid
      `;
      await signer.deleteBlob(document.blob_container, document.blob_key);
      if (document.preview_blob_key) {
        await signer.deleteBlob(process.env.AZURE_STORAGE_CONTAINER_ARTIFACTS?.trim() || "artifacts", document.preview_blob_key);
      }
      for (const artifact of artifacts) {
        await signer.deleteBlob(artifact.blob_container, artifact.blob_key);
      }
      await sql.begin(async (tx) => {
        await tx`
          update pipeline.documents set deleted_at = now(), processing_status = 'failed',
            failure_code = 'retention_deleted', version = version + 1, updated_at = now()
          where document_id = ${document.document_id}::uuid and deleted_at is null
        `;
        await tx`
          insert into pipeline.retention_events (document_id, event_type, actor_id, reason_code)
          values (${document.document_id}::uuid, 'blob_delete', 'pipeline-retention', 'retention_period_elapsed')
        `;
      });
      deleted += 1;
    } catch {
      await sql`
        insert into pipeline.retention_events (document_id, event_type, actor_id, reason_code)
        values (${document.document_id}::uuid, 'blob_delete_failed', 'pipeline-retention', 'storage_delete_failed')
      `;
      failed += 1;
    }
  }
  recordPipelineMetric("pipeline.retention.documents", deleted, "count", { operation: "retention", result: "deleted" });
  return { dry_run: false, eligible: candidates.length, deleted, failed };
}

async function failOrRetry(job: JobRow, code: string, retryable: boolean): Promise<"queued" | "dead_letter" | "stale"> {
  const sql = getPipelineSql();
  const disposition = getExtractionFailureDisposition(job.attempt_count, job.max_attempts, retryable);
  const deadLetter = disposition.status === "dead_letter";
  const nextStatus = disposition.status;
  const backoffSeconds = disposition.backoffSeconds;
  const updated = await sql<{ extraction_job_id: string }[]>`
    update pipeline.extraction_jobs set status = ${nextStatus}, last_error_code = ${code}, error_code = ${code},
      next_attempt_at = now() + (${backoffSeconds} * interval '1 second'),
      dead_lettered_at = ${deadLetter ? new Date() : null}, completed_at = ${deadLetter ? new Date() : null},
      provider_job_id = null, provider_state = null, attempt_token = null,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where extraction_job_id = ${job.extraction_job_id}::uuid and status = 'running'
      and attempt_count = ${job.attempt_count} and attempt_token = ${job.attempt_token}::uuid
    returning extraction_job_id
  `;
  if (!updated[0]) return "stale";
  recordPipelineMetric("pipeline.extraction.failures", 1, "count", {
    operation: "failure_disposition",
    result: nextStatus,
    job_type: job.job_type,
  });
  if (deadLetter) {
    await sql`update pipeline.documents set processing_status = 'failed', failure_code = ${code}, updated_at = now() where document_id = ${job.document_id}::uuid`;
    if (job.packet_id) {
      await sql`update pipeline.packet_uploads set status = 'failed', failure_code = ${code}, updated_at = now() where packet_id = ${job.packet_id}::uuid`;
    }
  }
  return nextStatus;
}

async function refreshPacketState(tx: TransactionSql, packetId: string) {
  const states = await tx<{ active_count: number | string; failed_count: number | string; field_count: number | string; page_count: number | string }[]>`
    select
      coalesce((select count(*) from pipeline.extraction_jobs j
        where j.packet_id = ${packetId}::uuid and j.job_type = 'referral_packet'
          and j.status in ('queued', 'running')), 0) as active_count,
      coalesce((select count(*) from pipeline.extraction_jobs j
        where j.packet_id = ${packetId}::uuid and j.job_type = 'referral_packet'
          and j.status in ('failed', 'dead_letter')), 0) as failed_count,
      coalesce((select count(*)
        from pipeline.referral_fields rf
        join pipeline.packet_upload_files pf on pf.document_id = rf.source_document_id
        where pf.packet_id = ${packetId}::uuid), 0) as field_count,
      coalesce((select sum(d.page_count)
        from pipeline.packet_upload_files pf
        join pipeline.documents d on d.document_id = pf.document_id
        where pf.packet_id = ${packetId}::uuid), 0) as page_count
  `;
  const state = states[0];
  const status = Number(state.failed_count) > 0
    ? "failed"
    : Number(state.active_count) > 0
      ? "extracting"
      : Number(state.field_count) > 0
        ? "ready_for_review"
        : "failed";
  await tx`
    update pipeline.packet_uploads set status = ${status}, page_count = ${Number(state.page_count)},
      failure_code = case when ${status} = 'failed' then coalesce(failure_code, 'worker_output_missing') else null end,
      updated_at = now() where packet_id = ${packetId}::uuid
  `;
}

function validateWorkerReport(input: WorkerReport) {
  if (!input || !uuid(input.extraction_job_id)) throw new DocumentProcessingError("extraction_job_id_invalid", 400);
  if (!Number.isInteger(input.attempt_count) || input.attempt_count < 1 || input.attempt_count > 1_000_000) {
    throw new DocumentProcessingError("attempt_count_invalid", 400);
  }
  if (!uuid(input.attempt_token)) throw new DocumentProcessingError("attempt_token_invalid", 400);
  if (!["heartbeat", "succeeded", "failed"].includes(input.status)) throw new DocumentProcessingError("worker_status_invalid", 400);
  if (input.page_count !== undefined && (!Number.isInteger(input.page_count) || input.page_count < 0 || input.page_count > 50_000)) {
    throw new DocumentProcessingError("page_count_invalid", 400);
  }
  if (input.verified_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.verified_sha256)) {
    throw new DocumentProcessingError("verified_sha256_invalid", 400);
  }
  if ((input.fields?.length ?? 0) > 1_000) throw new DocumentProcessingError("too_many_fields", 413);
  if ((input.artifacts?.length ?? 0) > 10_000) throw new DocumentProcessingError("too_many_artifacts", 413);
  for (const artifact of input.artifacts ?? []) {
    if (!["normalized_page", "ocr_json", "preview", "evidence", "extraction_output", "other"].includes(artifact.kind)) {
      throw new DocumentProcessingError("artifact_kind_invalid", 400);
    }
    safeBlobContainer(artifact.blob_container);
    safeBlobKey(artifact.blob_key);
    if (artifact.byte_size !== undefined && (!Number.isSafeInteger(artifact.byte_size) || artifact.byte_size < 0)) {
      throw new DocumentProcessingError("artifact_size_invalid", 400);
    }
    if (artifact.content_type !== undefined && (!artifact.content_type || artifact.content_type.length > 128)) {
      throw new DocumentProcessingError("artifact_content_type_invalid", 400);
    }
  }
  for (const field of input.fields ?? []) {
    if (!/^[a-z][a-z0-9_.-]{1,127}$/i.test(field.field_key)) throw new DocumentProcessingError("field_key_invalid", 400);
    validateConfidence(field.confidence);
    if ((field.candidates?.length ?? 0) > 20) throw new DocumentProcessingError("too_many_candidates", 413);
    field.candidates?.forEach((candidate) => validateConfidence(candidate.confidence));
    if (field.evidence_blob_key) safeBlobKey(field.evidence_blob_key);
  }
  if (input.preview) {
    safeBlobContainer(input.preview.blob_container);
    safeBlobKey(input.preview.blob_key);
    if (input.preview.pages && input.preview.pages.length > 10_000) throw new DocumentProcessingError("too_many_preview_pages", 413);
    input.preview.pages?.forEach((page) => {
      if (!Number.isInteger(page.page_number) || page.page_number <= 0) throw new DocumentProcessingError("preview_page_invalid", 400);
      safeBlobContainer(page.blob_container);
      safeBlobKey(page.blob_key);
    });
  }
}

function validateConfidence(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new DocumentProcessingError("confidence_invalid", 400);
}

function safeBlobKey(value: string) {
  if (!value || value.length > 900 || value.includes("..") || /[?#\\]/.test(value)) throw new DocumentProcessingError("blob_key_invalid", 400);
}

function safeBlobContainer(value: string) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(value)) {
    throw new DocumentProcessingError("blob_container_invalid", 400);
  }
}

function collectReportedArtifacts(input: WorkerReport) {
  const evidenceContainer = process.env.AZURE_STORAGE_CONTAINER_EVIDENCE?.trim() || "evidence";
  const byLocation = new Map<string, NonNullable<WorkerReport["artifacts"]>[number]>();
  const add = (artifact: NonNullable<WorkerReport["artifacts"]>[number]) => {
    byLocation.set(`${artifact.blob_container}/${artifact.blob_key}`, artifact);
  };
  input.artifacts?.forEach(add);
  if (input.preview) {
    add({ kind: "preview", blob_container: input.preview.blob_container, blob_key: input.preview.blob_key, content_type: input.preview.content_type });
    input.preview.pages?.forEach((page) => add({
      kind: "preview",
      blob_container: page.blob_container,
      blob_key: page.blob_key,
      content_type: page.content_type,
      byte_size: page.byte_size,
    }));
  }
  for (const field of input.fields ?? []) {
    if (field.evidence_blob_key) add({ kind: "evidence", blob_container: evidenceContainer, blob_key: field.evidence_blob_key });
    for (const candidate of field.candidates ?? []) {
      if (candidate.evidence_blob_key) add({ kind: "evidence", blob_container: evidenceContainer, blob_key: candidate.evidence_blob_key });
    }
  }
  return [...byLocation.values()];
}

function safeWorkerId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100) || "pipeline-worker";
}

function safeErrorCode(error: unknown) {
  const value = error instanceof DatabricksAdapterError ? error.code : "worker_dispatch_failed";
  return /^[a-z0-9_]{3,80}$/.test(value) ? value : "worker_dispatch_failed";
}

function metric(operation: string, result: string, jobType: string) {
  recordPipelineMetric("pipeline.extraction.jobs", 1, "count", { operation, result, job_type: jobType });
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

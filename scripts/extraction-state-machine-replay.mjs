#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const state = loadTypeScriptModule(process.cwd(), "lib/extraction/extraction-state.ts");
const workerValidation = loadTypeScriptModule(process.cwd(), "lib/extraction/worker-report-validation.ts");
const provenance = loadTypeScriptModule(process.cwd(), "lib/extraction/worker-report-provenance.ts");
const blobPaths = loadTypeScriptModule(process.cwd(), "lib/extraction/blob-paths.ts");
const workerSource = readFileSync("lib/extraction/processing-worker.ts", "utf8");
const migration = readFileSync("database/migrations/0004_document_processing.sql", "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check("first transient failure requeues", state.getExtractionFailureDisposition(1, 5, true).status === "queued");
check("retry backoff grows", state.getExtractionFailureDisposition(4, 5, true).backoffSeconds > state.getExtractionFailureDisposition(1, 5, true).backoffSeconds);
check("last attempt dead-letters", state.getExtractionFailureDisposition(5, 5, true).status === "dead_letter");
check("non-retryable failure dead-letters immediately", state.getExtractionFailureDisposition(1, 5, false).status === "dead_letter");
check("future queued job cannot be claimed", !state.leaseCanBeClaimed("queued", 200, null, 100));
check("expired running lease can be reclaimed", state.leaseCanBeClaimed("running", 0, 99, 100));
check("completed job cannot be reclaimed", !state.leaseCanBeClaimed("succeeded", 0, 0, 100));
check("dead letter replay is allowed", state.isAllowedExtractionTransition("dead_letter", "queued"));
check("success cannot silently requeue", !state.isAllowedExtractionTransition("succeeded", "queued"));

const jobs = Array.from({ length: 1_000 }, (_, index) => ({ id: index, claimedBy: null }));
for (let worker = 0; worker < 4; worker += 1) {
  for (const job of jobs) {
    if (job.claimedBy === null && job.id % 4 === worker) job.claimedBy = worker;
  }
}
check("four-worker claim simulation has no duplicates", new Set(jobs.map((job) => job.id)).size === jobs.length && jobs.every((job) => job.claimedBy !== null));
check("database claim uses skip locked", workerSource.includes("for update skip locked"));
check("worker bounds provider retries", workerSource.includes("max_attempts") && workerSource.includes("getExtractionFailureDisposition"));
check("worker rejects stale callback attempts", workerSource.includes("stale_job_attempt") && workerSource.includes("attempt_token = ${input.attempt_token}"));
check(
  "provider attachment and reconciliation are fenced to the claimed attempt",
  (workerSource.match(/attempt_count = \$\{job\.attempt_count\} and attempt_token = \$\{job\.attempt_token\}::uuid/g) ?? []).length >= 3
    && workerSource.includes("and provider_job_id = ${job.provider_job_id}"),
);
check("heartbeat verifies its compare-and-swap update", workerSource.includes("if (!heartbeat[0]) throw new DocumentProcessingError(\"stale_job_attempt\""));
check(
  "packet aggregation gives unsafe document state precedence over stale field output",
  workerSource.includes("unsafe_document_count")
    && workerSource.includes("Number(state.unsafe_document_count) > 0 || Number(state.failed_count) > 0")
    && workerSource.includes("coalesce(${state.unsafe_failure_code}, failure_code, 'worker_output_missing')"),
);
check("provider success requires callback output", workerSource.includes("worker_callback_missing") && !workerSource.includes("finalizeSucceededRunWithoutCallback"));
check("dead-letter replay clears provider state", workerSource.includes("dead_lettered_at = null") && workerSource.includes("provider_job_id = null"));
check(
  "worker persists callback collections with set-based writes",
  workerSource.includes("upsertPreviewPages")
    && workerSource.includes("upsertArtifacts")
    && workerSource.includes("upsertExtractedFields")
    && (workerSource.match(/jsonb_to_recordset/g) ?? []).length >= 4,
);
const validWorkerReport = {
  extraction_job_id: "11111111-1111-4111-8111-111111111111",
  attempt_count: 1,
  attempt_token: "22222222-2222-4222-8222-222222222222",
  status: "succeeded",
};
check("valid worker reports pass executable validation", throwsCode(() => workerValidation.validateWorkerReport(validWorkerReport)) === "");
check(
  "worker rejects duplicate extracted field identities",
  throwsCode(() => workerValidation.validateWorkerReport({
    ...validWorkerReport,
    fields: [
      { field_key: "identity.name", proposed_value: "A", confidence: 0.9 },
      { field_key: "identity.name", proposed_value: "B", confidence: 0.8 },
    ],
  })) === "duplicate_field_key",
);
check(
  "worker rejects duplicate preview page identities",
  throwsCode(() => workerValidation.validateWorkerReport({
    ...validWorkerReport,
    preview: {
      blob_container: "artifacts",
      blob_key: "packet/preview.pdf",
      content_type: "application/pdf",
      pages: [1, 1].map((page_number) => ({
        page_number,
        blob_container: "artifacts",
        blob_key: `packet/pages/${page_number}.png`,
        content_type: "image/png",
      })),
    },
  })) === "duplicate_preview_page",
);
check(
  "worker rejects candidate evidence path traversal",
  throwsCode(() => workerValidation.validateWorkerReport({
    ...validWorkerReport,
    fields: [{
      field_key: "clinical.summary",
      proposed_value: "Synthetic",
      confidence: 0.9,
      candidates: [{ source: "document_intelligence", value: "Synthetic", confidence: 0.9, evidence_blob_key: "../escape.png" }],
    }],
  })) === "blob_key_invalid",
);
check(
  "worker rejects invalid source pages and bounding boxes",
  throwsCode(() => workerValidation.validateWorkerReport({
    ...validWorkerReport,
    fields: [{ field_key: "clinical.summary", proposed_value: "Synthetic", confidence: 0.9, source_page: 0 }],
  })) === "source_page_invalid"
    && throwsCode(() => workerValidation.validateWorkerReport({
      ...validWorkerReport,
      fields: [{ field_key: "clinical.summary", proposed_value: "Synthetic", confidence: 0.9, evidence_bbox: [0.8, 0.1, 0.2, 0.4] }],
    })) === "evidence_bbox_invalid",
);

const provenanceReport = {
  ...validWorkerReport,
  preview: {
    blob_container: "artifacts",
    blob_key: "packet/preview.pdf",
    content_type: "application/pdf",
    pages: [{ page_number: 3, blob_container: "artifacts", blob_key: "packet/page-3.png", content_type: "image/png", byte_size: 321, width: 1200, height: 1600 }],
  },
  artifacts: [{ kind: "ocr_json", blob_container: "ocr", blob_key: "packet/result.json", content_type: "application/json", byte_size: 456 }],
  fields: [{
    field_key: "clinical.summary",
    proposed_value: "Synthetic summary",
    confidence: 0.91,
    source_page: 3,
    evidence_blob_key: "packet/evidence-3.png",
    evidence_bbox: [0.1, 0.2, 0.8, 0.3],
    candidates: [{
      source: "document_intelligence",
      value: "Synthetic summary",
      confidence: 0.91,
      source_page: 3,
      evidence_blob_key: "packet/evidence-3.png",
      evidence_bbox: [0.1, 0.2, 0.8, 0.3],
    }],
  }],
};
const fieldRows = provenance.toExtractedFieldRows(provenanceReport.fields);
const candidateRows = provenance.toCandidateRows(provenanceReport.fields, new Map([["clinical.summary", "field-001"]]));
const artifactRows = provenance.toArtifactRows(provenance.collectReportedArtifacts(provenanceReport, "evidence"));
check(
  "callback provenance golden retains value, page, confidence, bounding box, evidence, and candidate identity",
  JSON.stringify(fieldRows) === JSON.stringify([{
    field_key: "clinical.summary", proposed_value: "Synthetic summary", confidence: 0.91,
    source_page: 3, evidence_blob_key: "packet/evidence-3.png", evidence_bbox: [0.1, 0.2, 0.8, 0.3],
  }])
    && JSON.stringify(candidateRows) === JSON.stringify([{
      referral_field_id: "field-001", source: "document_intelligence", candidate_value: "Synthetic summary",
      confidence: 0.91, source_page: 3, evidence_blob_key: "packet/evidence-3.png", evidence_bbox: [0.1, 0.2, 0.8, 0.3],
    }]),
);
check(
  "callback artifact golden deduplicates evidence while retaining preview and OCR artifacts",
  artifactRows.length === 4
    && artifactRows.some((row) => row.artifact_kind === "evidence" && row.blob_container === "evidence" && row.blob_key === "packet/evidence-3.png")
    && artifactRows.some((row) => row.artifact_kind === "preview" && row.blob_key === "packet/page-3.png")
    && artifactRows.some((row) => row.artifact_kind === "ocr_json" && row.byte_size === 456),
);
check("database enforces one active job per document type", migration.includes("extraction_jobs_active_document_type_idx"));
const opaquePath = blobPaths.buildOriginalBlobPath(
  "33333333-3333-4333-8333-333333333333",
  "file_001",
  "Client Name Referral Packet.PDF",
);
check("Blob paths use packet and opaque file ids", opaquePath === "33333333-3333-4333-8333-333333333333/original/file_001.pdf");
check("Blob paths never expose the original basename", !opaquePath.toLowerCase().includes("client") && !opaquePath.toLowerCase().includes("referral"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length) process.exit(1);

function throwsCode(fn) {
  try {
    fn();
    return "";
  } catch (error) {
    return error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  }
}

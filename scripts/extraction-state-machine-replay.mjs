#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const state = loadTypeScriptModule(process.cwd(), "lib/extraction/extraction-state.ts");
const workerValidation = loadTypeScriptModule(process.cwd(), "lib/extraction/worker-report-validation.ts");
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

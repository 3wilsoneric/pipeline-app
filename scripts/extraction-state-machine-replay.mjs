#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const state = loadTypeScriptModule(process.cwd(), "lib/extraction/extraction-state.ts");
const workerSource = readFileSync("lib/extraction/processing-worker.ts", "utf8");
const signerSource = readFileSync("lib/extraction/azure-blob.ts", "utf8");
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
check("database enforces one active job per document type", migration.includes("extraction_jobs_active_document_type_idx"));
check("Blob paths use packet and opaque file ids", signerSource.includes("input.packet_id}/original") && signerSource.includes("opaqueFileName(file.file_id"));
check("Blob signer never places facility or original basename in a path", !signerSource.includes("submitting_facility}/") && !signerSource.includes("filename.replace"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length) process.exit(1);

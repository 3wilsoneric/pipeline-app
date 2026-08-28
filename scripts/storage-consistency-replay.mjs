#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const reconciliation = loadTypeScriptModule(process.cwd(), "lib/extraction/durable-upload-reconciliation.ts");
const documentProcessing = readFileSync("lib/extraction/document-processing.ts", "utf8");
const integrityAudit = readFileSync("scripts/postgres-integrity-audit.mjs", "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });
const decide = (patch) => reconciliation.decideDurableUploadRecovery({
  database_state: "reserved",
  blob_state: "present",
  reservation_expired: false,
  work_expected: true,
  active_job_present: false,
  ...patch,
});

check("database reservation with no blob remains retryable", decide({ blob_state: "missing" }) === "await_upload");
check("expired reservation with no blob is explicitly expired", decide({ blob_state: "missing", reservation_expired: true }) === "expire_reservation");
check("blob success with database finalize failure retries finalization", decide({}) === "retry_finalize");
check("metadata mismatch is quarantined", decide({ blob_state: "size_mismatch" }) === "quarantine_mismatch");
check("Blob outage is distinguished from a missing object", decide({ blob_state: "unavailable" }) === "retry_storage_check");
check("blob without a database reservation enters orphan review", decide({ database_state: "missing" }) === "orphan_blob_review");
check("finalized database row with missing blob raises data-loss incident", decide({ database_state: "finalized", blob_state: "missing" }) === "data_loss_incident");
check("finalized upload with a missing queue job requests queue repair", decide({ database_state: "finalized" }) === "repair_queue_job");
check("fully finalized upload is complete and idempotent", decide({ database_state: "finalized", active_job_present: true }) === "complete");
check("upload reservation writes are atomic in PostgreSQL", documentProcessing.includes("await sql.begin(async (tx)")
  && documentProcessing.includes("insert into pipeline.packet_uploads")
  && documentProcessing.includes("insert into pipeline.packet_upload_files"));
check("finalization validates Blob before its database transaction", documentProcessing.indexOf("getBlobProperties")
  < documentProcessing.indexOf("const result = await sql.begin"));
check("finalization is retry-idempotent", documentProcessing.includes("files.every((file) => file.uploaded_at)")
  && documentProcessing.includes("on conflict (document_id, job_type)"));
check("expired reservations are visible to the integrity audit", integrityAudit.includes("expired upload reservations awaiting reconciliation")
  && integrityAudit.includes("reservation_expires_at < now()"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, scenarios: checks.length, checks }, null, 2));
if (failed.length) process.exit(1);

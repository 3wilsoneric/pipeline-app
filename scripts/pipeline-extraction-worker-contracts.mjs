#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const worker = readFileSync("databricks/pipeline_extraction_worker.py", "utf8");
const bundle = readFileSync("databricks.yml", "utf8");
const setup = readFileSync("scripts/configure-databricks-extraction.sh", "utf8");
const processingWorker = readFileSync("lib/extraction/processing-worker.ts", "utf8");
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

execFileSync("python3", ["scripts/test-pipeline-extraction-worker.py"], { stdio: "inherit" });

check("worker requires a Defender malware verdict", worker.includes("wait_for_malware_scan") && worker.includes("MALWARE_RESULT_TAG"));
check("worker verifies source bytes", worker.includes("hashlib.sha256") && worker.includes("validate_signature"));
check("worker uses managed service credentials", worker.includes("getServiceCredentialsProvider") && !worker.includes("AZURE_STORAGE_ACCOUNT_KEY"));
check("Document Intelligence receives a short-lived read-only user-delegation URL", worker.includes("get_user_delegation_key") && worker.includes("BlobSasPermissions(read=True)") && worker.includes('json={"urlSource": source_url}'));
check("worker uses the GA Document Intelligence API", worker.includes('DOCUMENT_INTELLIGENCE_API_VERSION = "2024-11-30"'));
check("worker extraction is deterministic and has no LLM client", worker.includes("build_intake_fields") && !/anthropic|openai|claude/i.test(worker));
check("worker logs only bounded operational identifiers", worker.includes("safe_log") && !/file_name|display_name|diagnosis|medication|date_of_birth/.test(worker.split("def safe_log", 2)[1] ?? ""));
check("worker callback is size bounded", worker.includes("MAX_CALLBACK_BYTES") && worker.includes("callback_payload_too_large"));
check("bundle owns one Pipeline-only job", bundle.includes("name: pipeline-referral-extraction") && (bundle.match(/^\s{4}pipeline_extraction:/gm) ?? []).length === 1);
check("bundle uses a service principal run identity", bundle.includes("service_principal_name: ${var.pipeline_service_principal}"));
check("bundle uses pinned worker dependencies", ["azure-storage-blob==", "PyMuPDF==", "requests=="].every((value) => bundle.includes(value)));
check("setup is plan-first and deletion-free", setup.includes('mode="plan"') && !/\bdelete\b|\bdestroy\b|\bremove\b/.test(setup));
check("setup cannot activate the production backend", !setup.includes("gh variable set PIPELINE_EXTRACTION_BACKEND"));
check("all successful worker callbacks require digest and malware status", processingWorker.includes('if (!input.verified_sha256)') && processingWorker.includes('if (!input.malware_scan_status)'));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);

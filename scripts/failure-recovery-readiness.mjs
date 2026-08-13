#!/usr/bin/env node

import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
const authenticatedFetch = read("lib/auth/authenticated-fetch.ts");
const apiLogging = read("lib/observability/api-logging.ts");
const database = read("lib/database/pipeline-database.ts");
const clinicalContracts = read("scripts/clinical-data-contracts.mjs");
const extractionReplay = read("scripts/extraction-state-machine-replay.mjs");
const browserTests = read("tests/e2e/pipeline-smoke.spec.ts");
const desktopTests = read("tests/e2e/desktop-readiness.spec.ts");
const collaborationLoad = read("scripts/collaboration-load-smoke.mjs");

const checks = [
  ["browser API calls have bounded timeouts and caller cancellation", authenticatedFetch.includes("defaultTimeoutMs") && authenticatedFetch.includes("controller.abort()") && authenticatedFetch.includes("Request cancelled.")],
  ["transient retries are bounded and honor retry-after", authenticatedFetch.includes('attempts = method === "GET" ? 2 : 1') && authenticatedFetch.includes("isTransientStatus") && authenticatedFetch.includes('headers.get("retry-after")')],
  ["expired sessions trigger reauthentication without retrying forbidden writes", authenticatedFetch.includes("response.status === 401") && authenticatedFetch.includes("beginReauthentication")],
  ["oversized browser responses fail before parsing", authenticatedFetch.includes("maxResponseBytes") && authenticatedFetch.includes("Pipeline response was too large")],
  ["unexpected API failures return generic responses", apiLogging.includes('error: "Internal server error"') && !apiLogging.includes("error.message")],
  ["database configuration fails closed", database.includes("Pipeline PostgreSQL storage is not connected") && database.includes("if (!readiness.ready) throw new Error")],
  ["clinical upstream status failures are explicitly mapped", [401, 403, 404, 409, 502, 503].every((status) => clinicalContracts.includes(`status: ${status}`))],
  ["extraction failures requeue, dead-letter, and reject stale callbacks", extractionReplay.includes("requeues") && extractionReplay.includes("dead-letters") && extractionReplay.includes("stale callback")],
  ["the UI preserves the last good referral snapshot on refresh failure", browserTests.includes("keeps the last successful referral snapshot when refresh fails")],
  ["document metadata and previews fail closed", browserTests.includes("fails document metadata and previews closed")],
  ["offline mode exposes no client records", desktopTests.includes("generic PHI-free offline screen")],
  ["ten-user contention expects one winner and nine conflicts", collaborationLoad.includes("userCount - 1") && collaborationLoad.includes("Same-section optimistic contention") && collaborationLoad.includes("Same-draft optimistic contention")],
].map(([name, ok]) => ({ name, ok: Boolean(ok) }));

const failed = checks.filter((check) => !check.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);

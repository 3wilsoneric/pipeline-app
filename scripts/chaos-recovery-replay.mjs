#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const governor = loadTypeScriptModule(root, "lib/reliability/request-governor.ts", { process });
const extractionState = loadTypeScriptModule(root, "lib/extraction/extraction-state.ts");
const database = loadTypeScriptModule(root, "lib/database/pipeline-database.ts", {
  process,
  require: (specifier) => {
    if (specifier === "postgres") return () => {
      throw new Error("The chaos replay must not open a database connection.");
    };
    return require(specifier);
  },
});
const read = (file) => readFileSync(file, "utf8");
const clinical = read("lib/clinical/clinical-data.ts");
const documentAssets = read("lib/extraction/document-assets.ts");
const worker = read("lib/extraction/processing-worker.ts");
const packetUpload = read("lib/pipeline/referral-packet-upload.ts");
const referralHome = read("components/pipeline/ReferralHome.tsx");
const browserFetch = read("lib/auth/authenticated-fetch.ts");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const testGovernor = new governor.RequestGovernor({ read: 1, mutation: 1, upload: 1, worker: 1 });
const firstLease = testGovernor.acquire("upload");
const overloaded = testGovernor.acquire("upload");
check("concurrent upload saturation rejects excess work", firstLease.ok && !overloaded.ok);
if (firstLease.ok) firstLease.release();
check("capacity recovers after the active request finishes", testGovernor.acquire("upload").ok);

if (!overloaded.ok) {
  const overloadResponse = governor.createOverloadResponse(overloaded, "00000000-0000-4000-8000-000000000000");
  const body = await overloadResponse.json();
  check("overload responses are retryable, private, and bounded", overloadResponse.status === 429
    && overloadResponse.headers.get("retry-after") === "1"
    && overloadResponse.headers.get("cache-control")?.includes("no-store")
    && body.error === "Pipeline is handling unusually high activity. Retry this request shortly.");
}

const previousMode = process.env.PIPELINE_DATABASE_MODE;
const previousUrl = process.env.PIPELINE_DATABASE_URL;
process.env.PIPELINE_DATABASE_MODE = "postgres";
delete process.env.PIPELINE_DATABASE_URL;
check("database loss fails closed before opening a connection", database.getPipelineDatabaseReadiness().ready === false
  && database.getPipelineDatabaseReadiness().missing_env.includes("PIPELINE_DATABASE_URL"));
restoreEnv("PIPELINE_DATABASE_MODE", previousMode);
restoreEnv("PIPELINE_DATABASE_URL", previousUrl);

check("transient extraction failure requeues with backoff", extractionState.getExtractionFailureDisposition(1, 5, true).status === "queued"
  && extractionState.getExtractionFailureDisposition(1, 5, true).backoffSeconds > 0);
check("repeated extraction failure dead-letters instead of looping", extractionState.getExtractionFailureDisposition(5, 5, true).status === "dead_letter");
check("stale extraction callbacks cannot finalize a newer attempt", worker.includes("stale_job_attempt")
  && worker.includes("attempt_token = ${input.attempt_token}"));
check("Alamo calls have bounded timeout and safe unavailable mapping", clinical.includes("new AbortController()")
  && clinical.includes("clinical_upstream_unavailable")
  && clinical.includes("clinical_token_unavailable"));
check("partial and oversized Alamo responses fail before use", clinical.includes("clinical_payload_invalid")
  && clinical.includes("clinical_payload_too_large")
  && clinical.includes("await reader.cancel()"));
check("Blob loss returns a safe preview failure", documentAssets.includes("asset_storage_unavailable")
  && documentAssets.includes("asset_storage_failed")
  && !documentAssets.includes("throw new Error(await upstream.text())"));
check("interrupted packet uploads remain retryable and never auto-retry mutations", packetUpload.includes("Retry the upload.")
  && browserFetch.includes('const attempts = method === "GET" ? 2 : 1')
  && packetUpload.indexOf("/api/uploads/complete") > packetUpload.indexOf("/api/uploads/create-url"));
check("failed queue refresh preserves the last successful snapshot", referralHome.includes("successfulReferralRequest.current !== requestKey")
  && referralHome.includes("await loadReferrals(undefined, true)")
  && referralHome.includes("without disturbing the current directory")
  && read("tests/e2e/pipeline-smoke.spec.ts").includes("keeps the last successful referral snapshot when refresh fails"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  scenarios: checks.length,
  checks,
  note: "These deterministic chaos replays validate failure boundaries without opening external connections or emitting record data. Deployed chaos drills remain a release-stage requirement.",
}, null, 2));
if (failed.length) process.exit(1);

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

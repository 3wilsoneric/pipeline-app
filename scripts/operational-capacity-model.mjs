#!/usr/bin/env node

import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");

const targets = {
  named_users: 250,
  concurrent_browser_users: 100,
  concurrent_referral_editors: 50,
  concurrent_api_reads: 250,
  concurrent_mutations: 100,
  concurrent_upload_reservations: 25,
  packet_status_polls_per_minute: 10_000,
  referral_reads_per_minute: 6_000,
  weekly_incremental_pages: 5_000,
  backlog_raw_storage_gb: 1_000,
  max_nextjs_binary_bytes: 0,
  max_api_json_body_kb: 64,
  max_list_response_bytes: 750_000,
};

const contracts = read("lib/extraction/contracts.ts");
const governor = read("lib/reliability/request-governor.ts");
const apiPolicy = read("scripts/api-route-policy-audit.mjs");
const queryPlan = read("scripts/query-plan-audit.mjs");
const storageReadiness = read("scripts/storage-capacity-readiness.mjs");
const operationalDoc = read("docs/OPERATIONAL_TESTING_STRATEGY.md");
const operationalRunner = read("scripts/operational-certification.mjs");
const operationalActors = read("tests/e2e/support/pipeline-actors.ts");
const highTrafficSpec = read("tests/e2e/operational/high-traffic-capacity.scaffold.spec.ts");
const defaultPlaywright = read("playwright.config.ts");
const operationalPlaywright = read("playwright.operational.config.ts");
const packageJson = JSON.parse(read("package.json"));

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check("Next.js API body stays bounded before parsing", contracts.includes("maxJsonBodyBytes = 64 * 1024") && contracts.includes("readJsonBody"));
check("upload reservations stay descriptor-only and capped", contracts.includes("maxUploadFilesPerRequest") && contracts.includes("maxUploadRequestBytes") && contracts.includes("maxUploadFileBytes"));
check("raw binaries stay out of standard upload orchestration", read("app/api/uploads/create-url/route.ts").includes("CreateUploadUrlRequest") && !read("app/api/uploads/create-url/route.ts").includes("formData()"));
check("API gateway has route-class concurrency governor", governor.includes("RequestCapacityClass") && governor.includes("PIPELINE_MAX_CONCURRENT_READS") && governor.includes("PIPELINE_MAX_CONCURRENT_MUTATIONS"));
check("overload failures are explicit 429s with retry-after", governor.includes("createOverloadResponse") && governor.includes('"Retry-After"') && governor.includes("429"));
check("route policy audits every API method for auth/logging/origin", apiPolicy.includes("centralized API logging") && apiPolicy.includes("rejects cross-origin browser mutations") && apiPolicy.includes("excludes the viewer role from writes"));
check("large listings use keyset pagination, not offset", queryPlan.includes("do not use SQL offset") && queryPlan.includes("maxPageSize = 200") && queryPlan.includes("keyset"));
check("storage capacity checks aggregate bytes without identifiers", storageReadiness.includes("source_bytes") && storageReadiness.includes("never returns record identifiers or filenames"));
check("operational testing strategy documents staged certification tiers", operationalDoc.includes("| Quick |") && operationalDoc.includes("| High Assurance |"));
check("default browser smoke excludes high-assurance operational scaffolds", defaultPlaywright.includes('testIgnore: "./tests/e2e/operational/**"'));
check("operational Playwright uses isolated stores and header-auth role mimics", operationalPlaywright.includes("PIPELINE_AUTH_MODE: \"headers\"") && operationalPlaywright.includes("PIPELINE_E2E_REFERRAL_STORE_PATH"));
check("synthetic account generator supports a 10x cohort", operationalActors.includes("operationalLoadActors") && operationalActors.includes("syntheticPipelineActor"));
check("high-traffic Playwright scaffold is opt-in", highTrafficSpec.includes("PIPELINE_HIGH_ASSURANCE_E2E") && highTrafficSpec.includes("operationalLoadActors(60)"));
check("certification runner has high-assurance and capacity tiers", operationalRunner.includes("high_assurance") && operationalRunner.includes("capacity"));
check("package exposes high-assurance operational commands", Boolean(packageJson.scripts["certify:operations:high"]) && Boolean(packageJson.scripts["certify:operations:capacity"]));

const failed = checks.filter((item) => !item.ok);

console.log(JSON.stringify({
  ok: failed.length === 0,
  targets,
  checks,
  note: "This model is static and PHI-free. It verifies the repository has the guardrails and test hooks needed to rehearse a 10x operating profile; it does not send traffic.",
}, null, 2));

if (failed.length) process.exit(1);

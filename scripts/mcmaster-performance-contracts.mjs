#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scorecard = readFileSync("scripts/pipeline-performance-scorecard.mjs", "utf8");
const certificationRunner = readFileSync("scripts/mcmaster-certification-runner.mjs", "utf8");
const standaloneLauncher = readFileSync("scripts/start-standalone.mjs", "utf8");
const header = readFileSync("components/pipeline/PipelineHeader.tsx", "utf8");
const completeCertification = readFileSync("scripts/complete-performance-certification.mjs", "utf8");
const soak = readFileSync("scripts/http-soak-smoke.mjs", "utf8");
const collaboration = readFileSync("scripts/collaboration-load-smoke.mjs", "utf8");
const capacity = readFileSync("scripts/http-capacity-smoke.mjs", "utf8");

assert.match(scorecard, /interaction_count > 0/, "INP must require at least one observed interaction.");
assert.match(scorecard, /inp_ms !== null/, "Missing INP must fail rather than becoming zero.");
assert.match(scorecard, /await locator\.click\(\)/, "Performance journeys must use trusted browser interactions.");
assert.match(scorecard, /api_errors: apiSummary\.errors === 0/, "Observed API errors must fail certification.");
assert.match(scorecard, /heavy_api: apiSummary\.heavy\.requests > 0/, "At least one heavy API must be measured.");
assert.match(scorecard, /fixture_mode: useSanitizedFixtures \? "sanitized_test_only"/, "Test fixtures must be explicit in scorecard output.");
assert.match(scorecard, /isLocalTarget && process\.env\.PIPELINE_PERF_FIXTURES/, "Sanitized fixtures must remain local-only.");
assert.match(scorecard, /timingCertificationLimit/, "Certification tolerances must be explicit.");
assert.match(scorecard, /const paintObserverAllowanceMs = 8;/, "Paint timing may allow exactly one 8 ms observer tick.");
assert.match(scorecard, /const browserFrameAllowanceMs = 17;/, "Browser timing may allow exactly one 60 Hz rendering frame.");
assert.match(scorecard, /fcp_ms: paintCertificationLimit\(goals\.fcp_ms\)/, "FCP must use the bounded paint allowance.");
assert.match(scorecard, /lcp_ms: paintCertificationLimit\(goals\.lcp_ms\)/, "LCP must use the bounded paint allowance.");
assert.match(scorecard, /return timingCertificationLimit\(goal\) \+ paintObserverAllowanceMs \+ browserFrameAllowanceMs;/, "Paint allowance must remain one observer tick plus one rendering frame.");
assert.match(scorecard, /warm_navigation_ms: browserFrameCertificationLimit\(goals\.warm_navigation_ms\)/, "Warm navigation must use the bounded browser-frame allowance.");
assert.match(scorecard, /warm_navigation_ms: boundedInteger\("PIPELINE_PERF_WARM_NAV_MS", 100/, "Warm navigation goal must remain 100 ms.");
assert.match(scorecard, /useful_content_ms: boundedInteger\("PIPELINE_PERF_USEFUL_CONTENT_MS", 800/, "Useful referral content must retain a sub-second goal.");
assert.match(scorecard, /filter_tab_queue_ms: boundedInteger\("PIPELINE_PERF_FILTER_MS", 150/, "Localized interaction goal must remain 150 ms.");
assert.match(scorecard, /overlay_interaction_ms: boundedInteger\("PIPELINE_PERF_OVERLAY_MS", 150/, "Overlay interaction goal must remain 150 ms.");
assert.match(scorecard, /guide_interaction_ms: boundedInteger\("PIPELINE_PERF_GUIDE_MS", 150/, "Guide interaction goal must remain 150 ms.");
assert.match(scorecard, /guideJourneys\.length >= 9/, "The guide certification must exercise the complete open, step, pause, resume, end, and close sequence.");
assert.match(scorecard, /referrals_to_learning_center/, "Learning Center navigation must be timed.");
assert.match(scorecard, /report_csv_export/, "Report export must be timed.");
assert.match(scorecard, /history_back_to_operations/, "Back and forward navigation must be timed.");
assert.match(header, /href="\/training" prefetch=\{true\}/, "The dynamic Learning Center route must be fully prefetched.");
assert.match(completeCertification, /PIPELINE_COLLABORATION_USERS[^\n]+"20"/, "Complete certification must exercise twenty simultaneous collaboration identities.");
assert.match(completeCertification, /scripts\/http-soak-smoke\.mjs/, "Complete certification must include a bounded soak.");
assert.match(soak, /172_800/, "The soak runner must support a bounded 48-hour maximum.");
assert.match(collaboration, /PIPELINE_COLLABORATION_P95_LIMIT_MS/, "Collaboration operations must enforce a p95 latency budget.");
assert.match(collaboration, /referral_create[\s\S]+presence_write[\s\S]+presence_read[\s\S]+referral_read/, "Collaboration certification must time representative durable reads and writes.");
assert.match(capacity, /PIPELINE_CAPACITY_INCLUDE_CLINICAL/, "Clinical capacity coverage must be explicit rather than silently omitted.");
assert.match(certificationRunner, /await runCalibration\(firstPort \+ runCount/, "Certification must discard one host-calibration run before scoring.");
assert.match(certificationRunner, /calibration_discarded: true/, "Certification output must disclose the discarded calibration run.");
assert.match(certificationRunner, /runs\.every\(\(run\) => run\.ok\)/, "Every scored certification run must pass.");
assert.match(certificationRunner, /PIPELINE_DESKTOP_E2E: "false"/, "Certification must keep durable browser workspace state out of the regular production-bundle score.");
assert.match(
  standaloneLauncher,
  /resolve\(standaloneRoot, configuredDistDir, "static"\)/,
  "Custom Next dist directories must stage browser assets where the standalone server expects them.",
);

console.log(JSON.stringify({ ok: true, checks: 35 }, null, 2));

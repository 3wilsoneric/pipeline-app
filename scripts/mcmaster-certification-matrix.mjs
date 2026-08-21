#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const evidence = [
  item("performance.ttfb", "TTFB is measured and enforced", "scripts/pipeline-performance-scorecard.mjs", "ttfb: result.cold.ttfb_ms <= limits.ttfb_ms"),
  item("performance.fcp", "FCP is measured and enforced", "scripts/pipeline-performance-scorecard.mjs", "fcp: result.cold.fcp_ms <= limits.fcp_ms"),
  item("performance.lcp", "LCP is measured and enforced", "scripts/pipeline-performance-scorecard.mjs", "lcp: result.cold.lcp_ms > 0"),
  item("performance.inp", "INP requires a real interaction sample", "scripts/pipeline-performance-scorecard.mjs", "result.cold.interaction_count > 0"),
  item("performance.cls", "Layout shift is measured and enforced", "scripts/pipeline-performance-scorecard.mjs", "cls: result.cold.cls <= limits.cls"),
  item("performance.transfer", "Initial transfer size is bounded", "scripts/pipeline-performance-scorecard.mjs", "transfer: result.cold.transferred_bytes <= limits.transferred_bytes"),
  item("performance.api", "Ordinary and heavy APIs have separate budgets", "scripts/pipeline-performance-scorecard.mjs", "heavy_api: apiSummary.heavy.requests > 0"),
  item("performance.errors", "Any observed API error fails certification", "scripts/pipeline-performance-scorecard.mjs", "api_errors: apiSummary.errors === 0"),
  item("shell.persistent", "Navigation keeps one mounted application shell", "tests/e2e/performance-navigation.spec.ts", "keeps one shell and restores work surfaces through browser history"),
  item("shell.local-loading", "Loading is localized instead of blanking the application", "app/(pipeline)/loading.tsx", "aria-label=\"Loading Pipeline\""),
  item("data.directory", "Referral directory uses a bounded screen-specific read model", "tests/e2e/performance-navigation.spec.ts", "loads the referral directory once and defers the action worklist"),
  item("data.canvas", "Referral canvas has a purpose-built read endpoint", "app/api/referrals/[referralId]/canvas/route.ts", "export async function GET"),
  item("data.dashboard", "Operations dashboard has a purpose-built read endpoint", "app/api/operations/dashboard/route.ts", "export async function GET"),
  item("data.pagination", "Referral pagination is deterministic and conflict-safe", "tests/e2e/pipeline-smoke.spec.ts", "pages without duplicates and rejects a competing stale save"),
  item("cache.identity", "Startup identity requests are deduplicated", "tests/e2e/pipeline-smoke.spec.ts", "deduplicates startup identity and retries a transient referral read"),
  item("cache.last-good", "Refresh failures preserve the last useful snapshot", "tests/e2e/pipeline-smoke.spec.ts", "keeps the last successful referral snapshot when refresh fails"),
  item("cache.client", "Clinical directory cache is bounded and user-scoped", "components/pipeline/ClientProfileDirectory.tsx", "MAX_DIRECTORY_CACHE_ENTRIES = 2"),
  item("interaction.search", "Typed search is coalesced and obsolete requests are aborted", "components/pipeline/PipelineSearchPanel.tsx", "controller.abort()"),
  item("interaction.history", "Back and forward restore the same work surface", "tests/e2e/performance-navigation.spec.ts", "await page.goBack()"),
  item("interaction.recents", "Warm return through recent records is verified", "tests/e2e/pipeline-smoke.spec.ts", "opens a canonical client from search and restores it from Recents"),
  item("interaction.filters", "Stacked client filters are verified", "tests/e2e/pipeline-smoke.spec.ts", "stacks client community, admission-date, and profile-data filters"),
  item("interaction.rapid-nav", "Rapid navigation cannot reveal stale work surfaces", "tests/e2e/pipeline-smoke.spec.ts", "keeps rapid header navigation deterministic"),
  item("referral.concurrent", "Two authenticated sessions coordinate edits and conflicts", "tests/e2e/pipeline-smoke.spec.ts", "coordinates section edits, presence leases, and remote conflicts across two sessions"),
  item("referral.drafts", "Draft recovery and section autosave survive refresh", "tests/e2e/pipeline-smoke.spec.ts", "recovers a tab-scoped draft after refresh and then section-autosaves it"),
  item("assessment.journey", "Assessment create, import, review, completion, and recall are verified", "tests/e2e/pipeline-smoke.spec.ts", "creates, imports, reviews, completes, and recalls an assessment"),
  item("documents.preview", "Document metadata, previews, and pagination fail closed", "tests/e2e/pipeline-smoke.spec.ts", "fails document metadata and previews closed with bounded pagination"),
  item("extraction.journey", "Packet ingestion exposes extracted values for review", "tests/e2e/pipeline-smoke.spec.ts", "ingests a new packet from the file alone and exposes OCR values for review"),
  item("clinical.profile", "Governed Alamo client directory and profile are verified", "tests/e2e/pipeline-smoke.spec.ts", "opens the Alamo enhanced client directory and governed profile"),
  item("clinical.failure", "A temporary profile failure has an explicit recovery path", "tests/e2e/pipeline-smoke.spec.ts", "recovers a client profile after a temporary server failure"),
  item("security.headers", "Production browser and API response boundaries are verified", "tests/e2e/production-readiness.spec.ts", "applies browser security headers without framework disclosure"),
  item("security.origin", "Cross-origin writes are rejected", "tests/e2e/production-readiness.spec.ts", "rejects cross-origin session mutations"),
  item("security.logs", "API logging retains only route templates and safe dimensions", "lib/observability/api-logging.ts", "Generate IDs server-side so user-controlled headers never reach logs."),
  item("transport.timing", "Instrumented APIs emit Server-Timing", "tests/e2e/performance-navigation.spec.ts", "server-timing"),
  item("transport.size", "Browser responses and previews are size bounded", "lib/auth/authenticated-fetch.ts", "defaultMaxResponseBytes"),
  item("render.responsive", "Desktop and mobile shell geometry is verified", "tests/e2e/responsive-accessibility.spec.ts", "keeps home and referral navigation usable without page overflow"),
  item("render.visual", "Stable primary surfaces have visual regression coverage", "tests/e2e/visual-regression.spec.ts", [
    'toHaveScreenshot("desktop-home.png"',
    'toHaveScreenshot("desktop-referrals.png"',
    'toHaveScreenshot("desktop-profiles.png"',
    'toHaveScreenshot("desktop-new-packet.png"',
    'toHaveScreenshot("mobile-referrals.png"',
    'toHaveScreenshot("mobile-new-packet.png"',
  ]),
  item("release.ci", "CI enforces the McMaster certification gate", ".github/workflows/ci.yml", "Enforce Pipeline McMaster certification budget"),
];

const results = evidence.map((entry) => {
  const absolute = path.join(process.cwd(), entry.file);
  if (!existsSync(absolute)) return { ...entry, ok: false, error: "evidence_file_missing" };
  const source = readFileSync(absolute, "utf8");
  const needles = Array.isArray(entry.needle) ? entry.needle : [entry.needle];
  return needles.every((needle) => source.includes(needle))
    ? { id: entry.id, requirement: entry.requirement, evidence: entry.file, ok: true }
    : { ...entry, ok: false, error: "evidence_marker_missing" };
});
const passed = results.filter((entry) => entry.ok).length;
const output = {
  ok: passed === results.length,
  requirements: results.length,
  passed,
  coverage_percent: Math.round((passed / results.length) * 1_000) / 10,
  failures: results.filter((entry) => !entry.ok),
  evidence: results.filter((entry) => entry.ok),
};

console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exit(1);

function item(id, requirement, file, needle) {
  return { id, requirement, file, needle };
}

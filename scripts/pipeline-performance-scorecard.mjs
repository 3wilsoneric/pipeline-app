#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const baseUrl = process.env.PIPELINE_PERF_BASE_URL?.trim();
if (!baseUrl) fail("Configure PIPELINE_PERF_BASE_URL before running the performance scorecard.");

const parsedBaseUrl = new URL(baseUrl);
const allowRemote = process.argv.includes("--allow-remote");
const enforce = process.argv.includes("--enforce");
const isLocalTarget = ["localhost", "127.0.0.1", "::1"].includes(parsedBaseUrl.hostname);
if (!allowRemote && !isLocalTarget) {
  fail("Remote performance checks require an explicit --allow-remote flag.");
}

const goals = {
  ttfb_ms: boundedInteger("PIPELINE_PERF_TTFB_MS", 200, 50, 10_000),
  fcp_ms: boundedInteger("PIPELINE_PERF_FCP_MS", 500, 50, 10_000),
  lcp_ms: boundedInteger("PIPELINE_PERF_LCP_MS", 750, 100, 20_000),
  inp_ms: boundedInteger("PIPELINE_PERF_INP_MS", 150, 25, 10_000),
  useful_content_ms: boundedInteger("PIPELINE_PERF_USEFUL_CONTENT_MS", 800, 100, 20_000),
  warm_navigation_ms: boundedInteger("PIPELINE_PERF_WARM_NAV_MS", 100, 25, 10_000),
  filter_tab_queue_ms: boundedInteger("PIPELINE_PERF_FILTER_MS", 150, 25, 10_000),
  overlay_interaction_ms: boundedInteger("PIPELINE_PERF_OVERLAY_MS", 150, 25, 10_000),
  guide_interaction_ms: boundedInteger("PIPELINE_PERF_GUIDE_MS", 150, 25, 10_000),
  ordinary_api_p95_ms: boundedInteger("PIPELINE_PERF_API_P95_MS", 200, 25, 10_000),
  heavy_api_p95_ms: boundedInteger("PIPELINE_PERF_HEAVY_API_P95_MS", 500, 50, 20_000),
  transferred_bytes: boundedInteger("PIPELINE_PERF_TRANSFER_BYTES", 1_048_576, 100_000, 50_000_000),
  cls: boundedNumber("PIPELINE_PERF_CLS", 0.02, 0, 1),
};
// Chromium reports paint entries on an 8 ms sampling grid and commits them on
// a rendering frame. Keep the engineering goals intact while allowing one
// observer tick plus one 60 Hz frame at the certification boundary.
const paintObserverAllowanceMs = 8;
const browserFrameAllowanceMs = 17;
const limits = {
  ttfb_ms: timingCertificationLimit(goals.ttfb_ms),
  fcp_ms: paintCertificationLimit(goals.fcp_ms),
  lcp_ms: paintCertificationLimit(goals.lcp_ms),
  inp_ms: timingCertificationLimit(goals.inp_ms),
  useful_content_ms: timingCertificationLimit(goals.useful_content_ms),
  warm_navigation_ms: browserFrameCertificationLimit(goals.warm_navigation_ms),
  filter_tab_queue_ms: timingCertificationLimit(goals.filter_tab_queue_ms),
  overlay_interaction_ms: timingCertificationLimit(goals.overlay_interaction_ms),
  guide_interaction_ms: timingCertificationLimit(goals.guide_interaction_ms),
  ordinary_api_p95_ms: timingCertificationLimit(goals.ordinary_api_p95_ms),
  heavy_api_p95_ms: timingCertificationLimit(goals.heavy_api_p95_ms),
  transferred_bytes: Math.ceil(goals.transferred_bytes * 1.1),
  cls: goals.cls,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(process.env.PIPELINE_PERF_STORAGE_STATE?.trim()
    ? { storageState: process.env.PIPELINE_PERF_STORAGE_STATE.trim() }
    : {}),
});
const page = await context.newPage();
const apiResponses = new Map();
let documentBytes = 0;
let assetBytes = 0;
let requestCount = 0;
const resourceSamples = [];
const useSanitizedFixtures = isLocalTarget && process.env.PIPELINE_PERF_FIXTURES !== "false";
const runId = randomUUID().slice(0, 8);
let seededReferralName = `McMaster QA ${runId}`;

if (useSanitizedFixtures) await installSanitizedClinicalFixtures(page);
if (useSanitizedFixtures) await installSanitizedTrainingFixture(page);
if (isLocalTarget && process.env.PIPELINE_PERF_SEED !== "false") {
  seededReferralName = await seedPerformanceReferral(context.request, parsedBaseUrl.origin, seededReferralName, runId);
}

await page.addInitScript(() => {
  globalThis.__pipelinePerformance = { cls: 0, lcp: 0, interactions: {} };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) globalThis.__pipelinePerformance.cls += entry.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const latest = entries.at(-1);
    if (latest) globalThis.__pipelinePerformance.lcp = latest.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.interactionId) continue;
        const key = String(entry.interactionId);
        globalThis.__pipelinePerformance.interactions[key] = Math.max(
          globalThis.__pipelinePerformance.interactions[key] ?? 0,
          entry.duration || 0,
        );
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch {
    // Certification fails below when Event Timing is unsupported or empty.
  }
});

page.on("request", () => {
  requestCount += 1;
});
page.on("response", (response) => {
  const request = response.request();
  const url = new URL(response.url());
  if (url.origin !== parsedBaseUrl.origin || !url.pathname.startsWith("/api/")) return;
  const serverDuration = parseServerTiming(response.headers()["server-timing"]);
  apiResponses.set(request, {
    route: routeTemplate(url.pathname),
    duration_ms: serverDuration,
    status: response.status(),
    kind: isHeavyApiRoute(url.pathname) ? "heavy" : "ordinary",
    fixture: response.headers()["x-pipeline-test-fixture"] === "sanitized",
  });
});
page.on("requestfinished", async (request) => {
  const response = await request.response();
  if (!response) return;
  const url = new URL(request.url());
  if (url.origin !== parsedBaseUrl.origin) return;
  const timing = request.timing();
  const duration = timing.responseEnd >= 0 ? timing.responseEnd : null;
  const sizes = await request.sizes().catch(() => null);
  const bytes = sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0;
  if (request.resourceType() === "document") documentBytes += bytes;
  else assetBytes += bytes;
  if (Number.isFinite(duration)) {
    resourceSamples.push({
      route: routeTemplate(url.pathname),
      resource_type: request.resourceType(),
      duration_ms: round(duration),
      bytes,
      status: response.status(),
    });
  }
  if (url.pathname.startsWith("/api/")) {
    const current = apiResponses.get(request);
    if (current) current.duration_ms ??= duration;
  }
});

const coldStartedAt = performance.now();
const response = await page.goto(new URL("/?view=referrals", parsedBaseUrl).toString(), { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Referral workspaces", exact: true }).waitFor({ state: "visible" });
if (isLocalTarget && process.env.PIPELINE_PERF_SEED !== "false") {
  await page.getByRole("button", { name: `Open ${seededReferralName} referral workspace`, exact: true }).waitFor({ state: "visible" });
}
const usefulContentMs = performance.now() - coldStartedAt;
await page.waitForLoadState("load");
await afterNextPaint(page);

const cold = await page.evaluate(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  return {
    ttfb_ms: navigation?.responseStart ?? 0,
    fcp_ms: fcp?.startTime ?? 0,
    load_ms: navigation?.loadEventEnd ?? 0,
    lcp_ms: globalThis.__pipelinePerformance?.lcp ?? 0,
    cls: globalThis.__pipelinePerformance?.cls ?? 0,
    dom_nodes: document.querySelectorAll("*").length,
  };
});

const journeys = [];
const navigationPhases = {};
await measureJourney("referrals_to_search", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Open search", exact: true }));
  await page.getByLabel("Search or ask", { exact: true }).waitFor({ state: "visible" });
});
await measureJourney("typed_search", "filter", async () => {
  const search = page.getByLabel("Search or ask", { exact: true });
  await search.fill(seededReferralName);
  await page.getByRole("button", { name: new RegExp(seededReferralName, "i") }).first().waitFor({ state: "visible" });
});
await measureJourney("search_to_referrals", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Open referrals", exact: true }));
  await page.getByRole("heading", { name: "Referral workspaces", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("referral_community_filter", "filter", async () => {
  const filteredDirectory = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return candidate.request().method() === "GET"
      && candidate.ok()
      && ["/api/referrals", "/api/referrals/directory"].includes(url.pathname)
      && url.searchParams.get("community") === "San Pablo";
  });
  await page.getByLabel("Filter workspaces by community").selectOption("San Pablo");
  await filteredDirectory;
  await page.getByRole("button", { name: `Open ${seededReferralName} referral workspace`, exact: true }).waitFor({ state: "visible" });
});
await page.getByLabel("Filter workspaces by community").selectOption("");
await measureJourney("referrals_to_home_summary", "queue", async () => {
  await activate(page.getByRole("button", { name: "Pipeline home", exact: true }));
  await page.getByRole("region", { name: "Workflow summary", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("home_summary_to_all_workspaces", "queue", async () => {
  await activate(page.getByRole("button", { name: "Open referrals", exact: true }));
  await page.getByLabel("Referral worklist", { exact: true }).waitFor({ state: "visible" });
});
await measureJourney("referrals_to_clients", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Open client profiles", exact: true }));
  await page.getByLabel("Search clients", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Open profile for / }).first().waitFor({ state: "visible" });
});
await measureJourney("client_filter", "filter", async () => {
  const communityFilter = page.getByLabel("Filter profiles by community", { exact: true });
  await communityFilter.waitFor({ state: "visible" });
  const firstCommunity = await communityFilter.locator("option:not([value=''])").first().getAttribute("value");
  if (!firstCommunity) throw new Error("The sanitized client directory did not expose a community filter option.");
  await communityFilter.selectOption(firstCommunity);
});
await measureJourney("open_client_profile", "navigation", async () => {
  await activate(page.getByRole("button", { name: /Open profile for / }).first());
  await page.getByTestId("profile-workspace").waitFor({ state: "visible" });
});
await measureJourney("profile_to_clients", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Open client profiles", exact: true }));
  await page.getByRole("button", { name: /Open profile for / }).first().waitFor({ state: "visible" });
});
await measureJourney("clients_to_new_referral", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Create new referral", exact: true }));
  await page.getByTestId("packet-workspace").waitFor({ state: "visible" });
});
if (isLocalTarget) {
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill("");
  await measureJourney("packet_field_input", "input", async () => {
    const nameField = page.getByRole("textbox", { name: "NAME", exact: true });
    await nameField.press("A");
    if (await nameField.inputValue() !== "A") throw new Error("Packet field did not update synchronously.");
  });
}
await measureJourney("packet_step_change", "tab", async () => {
  await activate(page.getByRole("button", { name: "Workspace files" }));
  await page.getByText("Signed Medication List", { exact: true }).waitFor({ state: "visible" });
});
await measureJourney("new_referral_to_home", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Pipeline home", exact: true }));
  await page.getByRole("region", { name: "Ready to schedule", exact: true }).waitFor({ state: "visible" });
});

await measureJourney("profile_menu_open", "overlay", async () => {
  await activate(page.getByRole("button", { name: /Open profile menu for / }).first());
  await page.getByRole("dialog", { name: "Profile menu", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("profile_menu_close", "overlay", async () => {
  await activate(page.getByRole("button", { name: /Open profile menu for / }).first());
  await page.getByRole("dialog", { name: "Profile menu", exact: true }).waitFor({ state: "hidden" });
});

await measureJourney("guide_library_open", "guide", async () => {
  await activate(page.getByRole("button", { name: "Open guided tutorials", exact: true }));
  await page.getByRole("dialog", { name: "Guided tutorial library", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("guide_walkthrough_start", "guide", async () => {
  await activate(page.getByRole("button", { name: /^Review team referral work / }).first());
  await page.getByRole("dialog", { name: "Review team referral work guided tutorial", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "Review the last 24 hours", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("guide_step_advance", "guide", async () => {
  await activate(page.getByRole("button", { name: "Continue", exact: true }));
  await page.getByRole("heading", { name: "Open the referral inventory", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("guide_step_back", "guide", async () => {
  await activate(page.getByRole("button", { name: "Back", exact: true }));
  await page.getByRole("heading", { name: "Review the last 24 hours", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("guide_pause", "guide", async () => {
  await activate(page.getByRole("button", { name: "Pause tutorial", exact: true }));
  await page.getByRole("dialog", { name: "Review team referral work guided tutorial", exact: true }).waitFor({ state: "hidden" });
});
await measureJourney("guide_library_reopen", "guide", async () => {
  await activate(page.getByRole("button", { name: "Open guided tutorials", exact: true }));
  await page.getByRole("dialog", { name: "Guided tutorial library", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("guide_resume", "guide", async () => {
  await activate(page.getByRole("button", { name: /^Continue where you stopped/ }).first());
  await page.getByRole("dialog", { name: "Review team referral work guided tutorial", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("guide_end", "guide", async () => {
  await activate(page.getByRole("button", { name: "End tutorial", exact: true }));
  await page.getByRole("dialog", { name: "Review team referral work guided tutorial", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("dialog", { name: "Guided tutorial library", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("guide_library_close", "guide", async () => {
  await activate(page.getByRole("button", { name: "Close guided tutorials", exact: true }));
  await page.getByRole("dialog", { name: "Guided tutorial library", exact: true }).waitFor({ state: "hidden" });
});

await measureJourney("home_to_calendar", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Open calendar", exact: true }));
  await page.getByRole("group", { name: "Calendar view", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("calendar_view_change", "tab", async () => {
  const month = page.getByRole("button", { name: "month", exact: true });
  await activate(month);
  if (await month.getAttribute("aria-pressed") !== "true") fail("Calendar view did not change synchronously.");
});
await measureJourney("calendar_filter", "filter", async () => {
  const community = page.getByLabel("Filter calendar by community", { exact: true });
  await community.selectOption("San Pablo");
  if (await community.inputValue() !== "San Pablo") fail("Calendar filter did not update synchronously.");
});

await measureJourney("calendar_to_operations", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Open reports", exact: true }));
  await page.getByRole("main", { name: "Reports", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("report_tab_change", "tab", async () => {
  await activate(page.getByRole("button", { name: "View Documents report", exact: true }));
  await page.getByRole("heading", { name: "Documents", exact: true }).waitFor({ state: "visible" });
});
await activate(page.getByRole("button", { name: "View Workspaces report", exact: true }));
await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor({ state: "visible" });
await page.getByLabel("Report community", { exact: true }).selectOption("San Pablo");
await measureJourney("report_filter_apply", "filter", async () => {
  const reportResponse = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return candidate.request().method() === "GET"
      && candidate.ok()
      && url.pathname === "/api/operations/reports"
      && url.searchParams.get("community") === "San Pablo";
  });
  await activate(page.getByRole("button", { name: "Apply", exact: true }));
  await reportResponse;
});
await measureJourney("report_csv_export", "export", async () => {
  const download = page.waitForEvent("download");
  await activate(page.getByRole("button", { name: "Export CSV", exact: true }));
  await download;
});
await measureJourney("operations_to_referrals", "navigation", async () => {
  await activate(page.getByRole("button", { name: "Open referrals", exact: true }));
  await page.getByRole("heading", { name: "Referral workspaces", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("history_back_to_operations", "navigation", async () => {
  await page.goBack();
  await page.getByRole("main", { name: "Reports", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("history_forward_to_referrals", "navigation", async () => {
  await page.goForward();
  await page.getByRole("heading", { name: "Referral workspaces", exact: true }).waitFor({ state: "visible" });
});

await measureJourney("referrals_to_learning_center", "navigation", async () => {
  const startedAt = performance.now();
  await activate(page.getByRole("button", { name: /Open profile menu for / }).first());
  navigationPhases.learning_profile_menu_ms = round(performance.now() - startedAt);
  const learningCenter = page.getByRole("link", { name: /Learning Center Guided walkthroughs and common tasks/ });
  await learningCenter.waitFor({ state: "visible" });
  const linkStartedAt = performance.now();
  await learningCenter.click({ noWaitAfter: true });
  navigationPhases.learning_link_click_ms = round(performance.now() - linkStartedAt);
  const commitStartedAt = performance.now();
  const academy = page.locator('[data-operator-academy="true"]');
  const hydratedAcademy = page.locator('[data-training-hydrated="true"]');
  const workflowAction = page.getByRole("button", { name: "Open full Pipeline walkthrough", exact: true });
  await Promise.all([
    recordPhase(navigationPhases, "learning_url_commit_ms", commitStartedAt, page.waitForURL((url) => url.pathname === "/training")),
    recordPhase(navigationPhases, "learning_dom_attached_ms", commitStartedAt, academy.waitFor({ state: "attached" })),
    recordPhase(navigationPhases, "learning_main_visible_ms", commitStartedAt, academy.waitFor({ state: "visible" })),
    recordPhase(navigationPhases, "learning_hydrated_ms", commitStartedAt, hydratedAcademy.waitFor({ state: "visible" })),
    recordPhase(navigationPhases, "learning_action_visible_ms", commitStartedAt, workflowAction.waitFor({ state: "visible" })),
  ]);
});
await measureJourney("learning_workflow_open", "overlay", async () => {
  await activate(page.getByRole("button", { name: "Open full Pipeline walkthrough", exact: true }));
  await page.getByRole("dialog", { name: "Full Pipeline walkthrough", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("learning_workflow_step", "overlay", async () => {
  await activate(page.getByRole("dialog", { name: "Full Pipeline walkthrough", exact: true }).getByRole("button", { name: "Next", exact: true }));
  await page.getByRole("heading", { name: "Create the referral workspace", exact: true }).waitFor({ state: "visible" });
});
await measureJourney("learning_workflow_close", "overlay", async () => {
  await activate(page.getByRole("button", { name: "Close full walkthrough", exact: true }));
  await page.getByRole("dialog", { name: "Full Pipeline walkthrough", exact: true }).waitFor({ state: "hidden" });
});
await measureJourney("learning_task_open", "overlay", async () => {
  await activate(page.getByRole("button", { name: "Open Complete an assessment", exact: true }));
  await page.getByRole("heading", { name: "Complete an assessment", exact: true }).waitFor({ state: "visible" });
});
await page.waitForLoadState("networkidle");
await afterNextPaint(page);

const interaction = await page.evaluate(() => {
  const durations = Object.values(globalThis.__pipelinePerformance?.interactions ?? {})
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  return {
    count: durations.length,
    inp_ms: durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.98))] : null,
    max_ms: durations.at(-1) ?? null,
  };
});
const apiSummary = summarizeApi([...apiResponses.values()]);
const transferredBytes = documentBytes + assetBytes;
const result = {
  ok: true,
  mode: enforce ? "enforced" : "baseline",
  target: `${parsedBaseUrl.origin}/`,
  cold: roundObject({
    ...cold,
    inp_ms: interaction.inp_ms,
    interaction_count: interaction.count,
    useful_content_ms: usefulContentMs,
    status: response?.status() ?? 0,
    request_count: requestCount,
    transferred_bytes: transferredBytes,
  }),
  warm_journeys: journeys.map((journey) => ({ ...journey, duration_ms: round(journey.duration_ms) })),
  api: apiSummary,
  navigation_phases: navigationPhases,
  slowest_resources: resourceSamples
    .toSorted((left, right) => right.duration_ms - left.duration_ms)
    .slice(0, 12),
  goals,
  certification_limits: limits,
  checks: {},
  fixture_mode: useSanitizedFixtures ? "sanitized_test_only" : "none",
  note: "The scorecard records route templates and aggregate timings only. It never records query strings, response bodies, client names, resident identifiers, referral identifiers, diagnoses, medications, documents, or tokens.",
};

const navigationJourneys = result.warm_journeys.filter((journey) => journey.kind === "navigation");
const localizedJourneys = result.warm_journeys.filter((journey) => ["filter", "queue", "tab", "input"].includes(journey.kind));
const overlayJourneys = result.warm_journeys.filter((journey) => ["overlay", "export"].includes(journey.kind));
const guideJourneys = result.warm_journeys.filter((journey) => journey.kind === "guide");
result.checks = {
  ttfb: result.cold.ttfb_ms <= limits.ttfb_ms,
  fcp: result.cold.fcp_ms <= limits.fcp_ms,
  lcp: result.cold.lcp_ms > 0 && result.cold.lcp_ms <= limits.lcp_ms,
  inp: result.cold.interaction_count > 0 && result.cold.inp_ms !== null && result.cold.inp_ms <= limits.inp_ms,
  useful_content: result.cold.useful_content_ms <= limits.useful_content_ms,
  cls: result.cold.cls <= limits.cls,
  transfer: result.cold.transferred_bytes <= limits.transferred_bytes,
  warm_navigation: navigationJourneys.length > 0 && navigationJourneys.every((journey) => journey.duration_ms <= limits.warm_navigation_ms),
  localized_interactions: localizedJourneys.length > 0 && localizedJourneys.every((journey) => journey.duration_ms <= limits.filter_tab_queue_ms),
  overlay_interactions: overlayJourneys.length > 0 && overlayJourneys.every((journey) => journey.duration_ms <= limits.overlay_interaction_ms),
  guide_interactions: guideJourneys.length >= 9 && guideJourneys.every((journey) => journey.duration_ms <= limits.guide_interaction_ms),
  ordinary_api: apiSummary.ordinary.requests > 0 && apiSummary.ordinary.p95_ms <= limits.ordinary_api_p95_ms,
  heavy_api: apiSummary.heavy.requests > 0 && apiSummary.heavy.p95_ms <= limits.heavy_api_p95_ms,
  api_errors: apiSummary.errors === 0,
  successful_navigation: result.cold.status >= 200 && result.cold.status < 400,
};
result.ok = Object.values(result.checks).every(Boolean);

await browser.close();
console.log(JSON.stringify(result, null, 2));
if (enforce && !result.ok) process.exit(1);

async function measureJourney(name, kind, action) {
  const startedAt = performance.now();
  await action();
  await afterNextPaint(page);
  journeys.push({ name, kind, duration_ms: performance.now() - startedAt });
}

async function activate(locator) {
  await locator.click();
}

async function recordPhase(target, name, startedAt, operation) {
  await operation;
  target[name] = round(performance.now() - startedAt);
}

function summarizeApi(samples) {
  const successful = samples.filter((sample) => sample.status >= 200 && sample.status < 400);
  const ordinary = summarizeApiClass(successful.filter((sample) => sample.kind === "ordinary"));
  const heavy = summarizeApiClass(successful.filter((sample) => sample.kind === "heavy"));
  const durations = successful.map((sample) => sample.duration_ms).filter(Number.isFinite).sort((left, right) => left - right);
  const statuses = {};
  for (const sample of samples) statuses[sample.status] = (statuses[sample.status] ?? 0) + 1;
  return {
    requests: samples.length,
    errors: samples.length - successful.length,
    p50_ms: round(percentile(durations, 0.5)),
    p95_ms: round(percentile(durations, 0.95)),
    max_ms: round(durations.at(-1) ?? 0),
    ordinary,
    heavy,
    statuses,
    routes: [...new Set(samples.map((sample) => sample.route))].sort(),
  };
}

function summarizeApiClass(samples) {
  const durations = samples.map((sample) => sample.duration_ms).filter(Number.isFinite).sort((left, right) => left - right);
  return {
    requests: samples.length,
    p50_ms: round(percentile(durations, 0.5)),
    p95_ms: round(percentile(durations, 0.95)),
    max_ms: round(durations.at(-1) ?? 0),
  };
}

function isHeavyApiRoute(pathname) {
  return /^\/api\/(clinical\/clients|profiles\/|files\/[^/]+\/preview)/.test(pathname);
}

function parseServerTiming(value) {
  const match = /(?:^|,)\s*app;dur=([0-9]+(?:\.[0-9]+)?)/i.exec(value ?? "");
  return match ? Number.parseFloat(match[1]) : null;
}

function routeTemplate(pathname) {
  return pathname
    .split("/")
    .map((segment) => (/^\d{1,15}$/.test(segment) || /^[0-9a-f-]{20,}$/i.test(segment) ? ":id" : segment))
    .join("/");
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1)];
}

async function installSanitizedClinicalFixtures(page) {
  const fixturePath = path.join(process.cwd(), "scripts/fixtures/alamo-pipeline-clinical.sanitized.json");
  const clinical = JSON.parse(readFileSync(fixturePath, "utf8"));
  const directory = {
    ...clinical.clients,
    clients: clinical.clients.clients.map((client) => ({
      ...client,
      workspace_origin: "alamo_platform",
      pipeline_client_id: null,
      referral_count: 0,
      document_count: client.source_documents?.length ?? 0,
    })),
    clinical_warning: clinical.clients.freshness.warning,
  };
  const profile = {
    ...clinical.client,
    resident: clinical.resident.resident,
    history: {
      status: "unavailable",
      source: null,
      data_as_of: null,
      imported_at: null,
      warning: "No legacy placement history fixture is loaded.",
      episode_count: 0,
      current_episode_count: 0,
      discharged_episode_count: 0,
      first_admit_date: null,
      latest_admit_date: null,
      quality_flags: [],
      episodes: [],
    },
    pipeline: {
      permissions: {
        can_create_identity_candidate: true,
        can_review_identity: true,
      },
      connection: {
        status: "unlinked",
        confirmed_link: null,
        candidates: [],
        suggestions: [],
        message: "No reviewed Pipeline identity link exists.",
      },
      referrals: [],
      assessments: [],
      requirements: [],
      documents: [],
      summary: {
        referral_count: 0,
        active_referral_count: 0,
        assessment_count: 0,
        latest_assessment_status: null,
        latest_assessment_completion_pct: null,
        open_requirement_count: 0,
        blocker_count: 0,
        document_count: 0,
        actions_needed: ["Create and review a resident link"],
      },
    },
  };
  const fixtureHeaders = {
    "cache-control": "private, no-store, max-age=0",
    "content-type": "application/json",
    "x-pipeline-test-fixture": "sanitized",
  };
  await page.route("**/api/profiles/**", (route) => route.fulfill({
    status: 200,
    headers: fixtureHeaders,
    body: JSON.stringify(profile),
  }));
  // Register the specific directory route last because Playwright resolves
  // matching routes in reverse registration order.
  await page.route(/\/api\/profiles\/directory(?:\?|$)/, (route) => route.fulfill({
    status: 200,
    headers: fixtureHeaders,
    body: JSON.stringify(directory),
  }));
}

async function installSanitizedTrainingFixture(page) {
  let revision = 0;
  let progress = {
    version: 2,
    curriculumVersion: "2026.08.operator.3",
    role: "admin",
    completedActivityIds: [],
    activeModuleId: "pipeline-purpose",
    activeActivityId: "learn",
    evidence: {},
    confidence: {},
    scenarioResults: {},
    tutorialResults: {},
  };
  const fixtureHeaders = {
    "cache-control": "private, no-store, max-age=0",
    "content-type": "application/json",
    "x-pipeline-test-fixture": "sanitized",
  };
  await page.route(/\/api\/training\/progress(?:\?|$)/, async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON();
      if (payload.expectedRevision !== revision) {
        await route.fulfill({ status: 409, headers: fixtureHeaders, body: JSON.stringify({ error: "revision_conflict" }) });
        return;
      }
      progress = payload.progress;
      revision += 1;
    }
    await route.fulfill({
      status: 200,
      headers: fixtureHeaders,
      body: JSON.stringify({ revision, progress, updatedAt: new Date().toISOString(), persistence: "sanitized_test_only" }),
    });
  });
}

async function seedPerformanceReferral(api, origin, name, runId) {
  const now = new Date().toISOString();
  const mutationOrigin = new URL(origin);
  if (["127.0.0.1", "::1"].includes(mutationOrigin.hostname)) mutationOrigin.hostname = "localhost";
  const membersResponse = await api.get(`${origin}/api/members`);
  if (!membersResponse.ok()) {
    fail(`Could not resolve the isolated McMaster workspace member (status ${membersResponse.status()}).`);
  }
  const memberDirectory = await membersResponse.json();
  const currentMember = memberDirectory.members?.find(
    (member) => member.principal_id === memberDirectory.current_principal_id,
  );
  if (!currentMember?.principal_id || !currentMember?.display_name) {
    fail("The isolated McMaster identity is not an active workspace member.");
  }
  const response = await api.post(`${origin}/api/referrals`, {
    headers: { Origin: mutationOrigin.origin },
    data: {
      client_mutation_id: `mcmaster-${runId}`,
      assignee_id: currentMember.principal_id,
      referral: {
        name,
        date: now.slice(0, 10),
        stage: "New",
        community: "San Pablo",
        source: "McMaster certification fixture",
        priority: "standard",
        tags: ["mcmaster-certification"],
        documentName: "",
        documentStatus: "Missing",
        owner: currentMember.display_name,
        note: "",
        createdAt: now,
        dob: "",
        phone: "",
        email: "",
        payer: "",
        requirements: [],
      },
    },
  });
  if (response.status() !== 201) {
    fail(`Could not seed the isolated McMaster referral fixture (status ${response.status()}).`);
  }
  const payload = await response.json();
  return payload.referral?.name || name;
}

async function afterNextPaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

function timingCertificationLimit(goal) {
  return Math.ceil(goal + Math.max(goal * 0.1, 50));
}

function paintCertificationLimit(goal) {
  return timingCertificationLimit(goal) + paintObserverAllowanceMs + browserFrameAllowanceMs;
}

function browserFrameCertificationLimit(goal) {
  return timingCertificationLimit(goal) + browserFrameAllowanceMs;
}

function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function boundedNumber(name, fallback, minimum, maximum) {
  const parsed = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function roundObject(value) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === "number" ? round(entry) : entry]));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_PERF_BASE_URL: Boolean(baseUrl) } }, null, 2));
  process.exit(1);
}

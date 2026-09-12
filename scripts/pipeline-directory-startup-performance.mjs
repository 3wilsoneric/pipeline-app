#!/usr/bin/env node
// Existing diagnostic session over stdin; only counts and durations leave this
// isolated browser. No clinical mutations, response bodies or identities logged.
import { chromium } from "@playwright/test";

if (!process.argv.includes("--allow-remote")) throw new Error("Live checks require --allow-remote.");
const base = new URL(process.env.PIPELINE_LIVE_PERF_BASE_URL || "https://alamo-pipeline.com");
const session = JSON.parse(await new Promise((resolve) => {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => resolve(input));
}));
const browser = await chromium.launch({ headless: true });
const result = { measured_at: new Date().toISOString(), samples: [], api_errors: [] };
try {
  for (let trial = 0; trial < 3; trial += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await context.addCookies([{ ...session, url: base.origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
      await context.route("**/api/**", (route) => {
        const request = route.request();
        const bookkeeping = /^\/api\/(?:me\/(?:recents|presence|work-continuity)|referrals\/\d+\/presence)$/.test(new URL(request.url()).pathname);
        return ["GET", "HEAD", "OPTIONS"].includes(request.method()) || bookkeeping ? route.continue() : route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__pipelineDirectoryTiming = { complete_at: null, total: null, pages: 0 };
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const response = await originalFetch(...args);
          const url = new URL(response.url);
          if (response.ok && url.pathname === "/api/profiles/directory" && url.searchParams.get("scope") === "current") {
            // Chromium's protocol body reader may lose routed responses; inspect
            // a native clone without an extra request or changing app consumption.
            void response.clone().json().then((payload) => {
              const timing = window.__pipelineDirectoryTiming;
              timing.total = payload.total;
              timing.pages += 1;
              if (!payload.next_cursor) timing.complete_at ??= Date.now();
            }).catch(() => {});
          }
          return response;
        };
      });
      page.setDefaultTimeout(15_000);
      const start = performance.now();
      const startedAt = Date.now();
      let workspaceReads = 0;
      let clientReads = 0;
      context.on("response", async (response) => {
        const url = new URL(response.url());
        if (!url.pathname.startsWith("/api/")) return;
        if (response.status() >= 400) result.api_errors.push({ trial, status: response.status(), surface: url.pathname.split("/")[2] });
        if (!response.ok()) return;
        if (url.pathname === "/api/referrals/directory") workspaceReads += 1;
        if (url.pathname === "/api/profiles/directory" && url.searchParams.get("scope") === "current") clientReads += 1;
      });
      result.stage = "home";
      await page.goto(base.href);
      await page.getByRole("region", { name: "Current work", exact: true }).waitFor();
      const homeMs = Math.round(performance.now() - start);
      // One second of ordinary Home dwell; same delay in before/after trials.
      await page.waitForTimeout(1_000);
      const clientsReadyBeforeClick = await page.evaluate(() => window.__pipelineDirectoryTiming.complete_at !== null);
      const workspaceReadsBefore = workspaceReads;
      const workspaceStart = performance.now();
      result.stage = "workspace_navigation";
      await page.getByRole("button", { name: "Open referrals", exact: true }).click();
      await page.waitForFunction(() => Boolean(document.querySelector('main[data-guide-target="workspace-directory"]')));
      result.stage = "workspace_actual_row";
      await page.getByRole("button", { name: /^Open .+ referral workspace$/ }).first().waitFor();
      const workspaceMs = Math.round(performance.now() - workspaceStart);
      const clientReadsBefore = clientReads;
      const clientStart = performance.now();
      result.stage = "client_navigation";
      await page.getByRole("button", { name: "Open client profiles", exact: true }).click();
      result.stage = "client_actual_card";
      await page.getByRole("button", { name: /^Open profile for / }).first().waitFor();
      const clientsMs = Math.round(performance.now() - clientStart);
      result.stage = "client_complete_roster";
      await page.getByText("Completing the directory. Results update as records arrive.", { exact: true }).waitFor({ state: "hidden" });
      await page.waitForFunction(() => window.__pipelineDirectoryTiming.complete_at !== null);
      const roster = await page.evaluate(() => window.__pipelineDirectoryTiming);
      if (roster.total > 100) await page.getByText(new RegExp(`^Showing \\d+ of ${roster.total}$`)).waitFor();
      result.samples.push({ trial, home_ms: homeMs, workspace_first_row_ms: workspaceMs, clients_first_card_ms: clientsMs,
        complete_roster_from_start_ms: roster.complete_at - startedAt, roster_total: roster.total, roster_pages: roster.pages,
        clients_ready_before_click: clientsReadyBeforeClick, workspace_reads_on_click: workspaceReads - workspaceReadsBefore,
        client_reads_on_click: clientReads - clientReadsBefore });
    } finally { await context.close(); }
  }
} catch (error) { result.failure = error.name; }
finally { await browser.close(); console.log(JSON.stringify(result, null, 2)); }
if (result.failure || result.api_errors.length || result.samples.length !== 3) process.exitCode = 1;

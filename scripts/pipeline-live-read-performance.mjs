#!/usr/bin/env node
// Tiny clinical-read-only production recheck. An existing short-lived session
// arrives over stdin, stays in memory, and is never included in the results.
import { chromium } from "@playwright/test";

if (!process.argv.includes("--allow-remote")) throw new Error("Live checks require --allow-remote.");
const base = new URL(process.env.PIPELINE_LIVE_PERF_BASE_URL || "https://alamo-pipeline.com");
const session = JSON.parse(await new Promise((resolve) => {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => resolve(input));
}));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const result = { environment: "production_actual_browser", measured_at: new Date().toISOString(), steps: [], api_errors: [] };
try {
  await context.addCookies([{ ...session, url: base.origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
  await context.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const bookkeeping = /^\/api\/(?:me\/(?:recents|presence|work-continuity)|referrals\/\d+\/presence)$/.test(path);
    return ["GET", "HEAD", "OPTIONS"].includes(request.method()) || bookkeeping
      ? route.continue() : route.abort("blockedbyclient");
  });
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === base.origin && url.pathname.startsWith("/api/") && response.status() >= 400) {
      result.api_errors.push({ status: response.status(), surface: url.pathname.split("/")[2] });
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  async function measure(name, action, ready, budget = 800) {
    const start = performance.now();
    await action(); await ready();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const ms = Math.round(performance.now() - start);
    result.steps.push({ name, ms, budget_ms: budget, over_budget: ms > budget });
  }
  const navigation = (name) => page.getByRole("button", { name, exact: true });
  const cards = () => page.getByRole("button", { name: /^Open profile for / });
  await measure("home_useful_content", () => page.goto(base.href), () => page.getByRole("region", { name: "Current work", exact: true }).waitFor());
  await measure("current_directory_first_card", () => navigation("Open client profiles").click(), () => cards().first().waitFor());
  for (let index = 0; index < Math.min(4, await cards().count()); index += 1) {
    const label = await cards().nth(index).getAttribute("aria-label");
    await measure(`unvisited_chart_${index + 1}`, () => page.getByRole("button", { name: label, exact: true }).click(),
      () => page.getByTestId("client-identity-title").waitFor());
    if (index === 0) {
      const thumbnails = page.locator('img[alt^="First-page thumbnail for "]');
      const count = await thumbnails.count();
      if (!count) throw new Error("No real source thumbnail sample was available.");
      await measure("source_gallery_decoded", async () => {
        for (let image = 0; image < count; image += 1) await thumbnails.nth(image).scrollIntoViewIfNeeded();
      }, () => page.waitForFunction((expected) => {
        const images = [...document.querySelectorAll('img[alt^="First-page thumbnail for "]')];
        return images.length === expected && images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
      }, count), 500);
      result.thumbnail_count = count;
      const link = page.locator('a[href*="/source-documents/"][href$="/preview"]').first();
      const target = new URL(await link.getAttribute("href"), base.origin).href;
      await measure("source_pdf_open_and_complete_browser_read", async () => {
        const responseReady = context.waitForEvent("response", { predicate: (response) => response.url() === target, timeout: 10_000 });
        const popupReady = page.waitForEvent("popup");
        await link.click();
        const response = await responseReady;
        const popup = await popupReady;
        try {
          if (!response.ok()) throw new Error("Clicked source PDF failed.");
          result.pdf_bytes = await page.evaluate(async (url) => {
            const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
            if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw new Error("PDF read failed.");
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("PDF bytes invalid.");
            return bytes.byteLength;
          }, target);
        } finally { await popup.close(); }
      }, async () => {}, 500);
    }
    await measure(`return_to_directory_${index + 1}`, () => navigation("Open client profiles").click(), () => cards().first().waitFor(), 100);
  }
  result.ok = result.steps.length >= 10 && result.api_errors.length === 0 && result.steps.every((step) => !step.over_budget);
} catch (error) {
  result.ok = false;
  result.failure = error.name;
} finally {
  await context.close(); await browser.close();
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv.includes("--enforce") && !result.ok) process.exitCode = 1;

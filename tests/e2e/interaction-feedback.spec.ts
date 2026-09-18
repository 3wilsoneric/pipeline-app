import { expect, test } from "@playwright/test";
import { clientDirectoryFixture } from "./support/pipeline-clinical-fixtures";

type CueMeasurement = { cost: number; duration: number | undefined };
type MeasuredWindow = Window & { feedbackMeasurements: CueMeasurement[] };

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`client feedback stays local and usable with ${reducedMotion} motion`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      const measuredWindow = window as unknown as MeasuredWindow;
      measuredWindow.feedbackMeasurements = [];
      const original = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const start = performance.now();
        const animation = original.call(this, keyframes, options);
        if (this.classList.contains("pipeline-feedback-cue")) {
          measuredWindow.feedbackMeasurements.push({
            cost: performance.now() - start,
            duration: typeof options === "object" ? Number(options.duration) : options,
          });
        }
        return animation;
      };
    });
    const base = clientDirectoryFixture.clients[0];
    const clients = ["Riley Perez", "Oscar Martin", "Taylor Chen"].map((name, index) => ({
      ...base,
      canonical_client_id: `feedback-${index}`,
      resident_numbers: [`F-${index}`],
      display_name: name,
      community_names: [index < 2 ? "A & A Health Services San Pablo" : "AHS Turlock OP LLC"],
      current_community: index < 2 ? "A & A Health Services San Pablo" : "AHS Turlock OP LLC",
      current_resident: true,
      admit_date: index < 2 ? "2026-07-08" : "2025-01-08",
    }));
    let directoryRequests = 0;
    await page.route("**/api/profiles/directory**", async (route) => {
      directoryRequests += 1;
      await route.fulfill({ json: {
        ...clientDirectoryFixture, clients, total: clients.length, next_cursor: null, data_as_of: "2026-08-07",
      } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByRole("button", { name: "Open A & A Health Services San Pablo file cabinet", exact: true })).toContainText("2 clients");
    await page.waitForLoadState("networkidle");
    const requestsBeforeFiltering = directoryRequests;
    expect(await page.evaluate(() => (window as unknown as MeasuredWindow).feedbackMeasurements)).toHaveLength(0);
    const browserSession = await page.context().newCDPSession(page);
    await browserSession.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    const admitted = page.getByLabel("Filter profiles by admission date");
    const count = page.locator('[aria-live="polite"]').filter({ hasText: /matching/ });
    await admitted.selectOption("last_12_months");
    await expect(count).toHaveText("2 matching");
    await expect(page.getByRole("button", { name: "Open AHS Turlock OP LLC file cabinet", exact: true })).toHaveCount(0);
    await expect(page.locator("label").filter({ has: admitted })).toHaveAttribute("data-filter-active", "true");

    // An unchanged count must still acknowledge a different filter, without a request.
    await admitted.focus();
    for (let index = 0; index < 20; index += 1) {
      await admitted.selectOption(index % 2 === 0 ? "last_6_months" : "last_3_months");
      await expect(count).toHaveText("2 matching");
      await expect(admitted).toBeFocused();
    }
    const measurements = await page.evaluate(() => (window as unknown as MeasuredWindow).feedbackMeasurements);
    if (reducedMotion === "reduce") {
      expect(measurements).toHaveLength(0);
    } else {
      expect(measurements).toHaveLength(21);
      expect(measurements.every(({ duration }) => duration === 320)).toBe(true);
      const costs = measurements.map(({ cost }) => cost).sort((a, b) => a - b);
      const p95 = costs[Math.ceil(costs.length * 0.95) - 1];
      expect(p95).toBeLessThan(5);
      await testInfo.attach("native-feedback-cost", {
        body: JSON.stringify({ cpuSlowdown: 4, samples: costs.length, p95Milliseconds: p95, maxMilliseconds: costs.at(-1) }),
        contentType: "application/json",
      });
    }
    expect(directoryRequests).toBe(requestsBeforeFiltering);
    await browserSession.send("Emulation.setCPUThrottlingRate", { rate: 1 });

    for (const width of [1440, 834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(admitted).toBeVisible();
      await expect(count).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      if (reducedMotion === "no-preference") {
        await page.screenshot({ path: testInfo.outputPath(`clients-${width}.png`), fullPage: true });
      }
    }
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(admitted).toHaveValue("any");
    await expect(page.getByRole("button", { name: "Open AHS Turlock OP LLC file cabinet", exact: true })).toBeVisible();
    await expect(page.locator('[data-filter-active="true"]')).toHaveCount(0);
    expect(directoryRequests).toBe(requestsBeforeFiltering);
  });
}

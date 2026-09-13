import { expect, test, type Page } from "@playwright/test";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });

declare global {
  interface Window {
    chartTransitionProbe: { calls: number; ready: boolean; finished: boolean; error?: string; duration?: string; sourceWidth?: number; paused?: number };
  }
}

async function fixtures(page: Page) {
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
    ...clientDirectoryFixture,
    clients: [{ ...clientDirectoryFixture.clients[0], profile_key: "transition-client" }],
    total: 1, next_cursor: null,
  } }));
}

async function probe(page: Page, freeze = false) {
  await page.addInitScript((freeze) => {
    window.chartTransitionProbe = { calls: 0, ready: false, finished: false };
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (options) => {
      const result = window.chartTransitionProbe;
      result.calls += 1;
      const source = Array.from(document.querySelectorAll<HTMLElement>("button, [data-client-chart-preview]")).find((node) => getComputedStyle(node).viewTransitionName.endsWith("pipeline-client-chart"));
      const transitionName = source ? getComputedStyle(source).viewTransitionName : "pipeline-client-chart";
      result.sourceWidth = source?.getBoundingClientRect().width;
      const transition = start(options);
      void transition.ready.then(() => {
        result.duration = getComputedStyle(document.documentElement, `::view-transition-group(${transitionName})`).animationDuration;
        if (freeze) {
          const animations = document.getAnimations().filter((animation) => animation.effect instanceof KeyframeEffect && animation.effect.pseudoElement?.startsWith("::view-transition"));
          for (const animation of animations) { animation.pause(); animation.currentTime = 90; }
          result.paused = animations.length;
        }
        result.ready = true;
      }, (error) => { result.error = String(error); });
      void transition.finished.then(() => { result.finished = true; }, (error) => { result.error = String(error); });
      return transition;
    };
  }, freeze);
}

for (const layout of ["cards", "list"] as const) {
  test(`expands the ${layout} preview into the cached chart without changing its route`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await fixtures(page);
    await probe(page, true);
    await page.goto("/?screen=profiles");
    if (layout === "list") await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
    const card = page.getByRole("button", { name: "Open profile for Avery Example", exact: true });
    const warm = page.waitForResponse((response) => response.url().endsWith("/api/profiles/transition-client"));
    await card.hover();
    await warm;
    await card.click();
    await expect(page).toHaveURL(/screen=profile&clientId=transition-client/);
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.ready)).toBe(true);
    const result = await page.evaluate(() => window.chartTransitionProbe);
    expect(result.error).toBeUndefined();
    expect(result.calls).toBe(1);
    expect(result.duration).toBe("0.24s");
    expect(result.paused).toBeGreaterThan(0);
    if (layout === "list") expect(result.sourceWidth).toBe(58);
    else expect(result.sourceWidth).toBeGreaterThan(600);
    await page.screenshot({ path: testInfo.outputPath(`chart-expansion-${layout}-midpoint.png`) });
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.finished)).toBe(true);
    await expect(page.getByTestId("client-profile-folder")).toHaveCSS("overflow-y", "visible");
    await expect(page.getByRole("button", { name: "Back to profiles", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.className)).not.toContain("transitionRoot");
    await expect(card).toHaveCSS("view-transition-name", "none");
  });
}

for (const fallback of ["reduce", "unsupported", "throws"] as const) {
  test(`opens the chart normally with ${fallback} transitions`, async ({ page }) => {
    await fixtures(page);
    await page.emulateMedia({ reducedMotion: fallback === "reduce" ? "reduce" : "no-preference" });
    if (fallback === "reduce") await probe(page);
    else await page.addInitScript((fallback) => {
      Object.defineProperty(document, "startViewTransition", { configurable: true, value: fallback === "unsupported" ? undefined : () => { throw new Error("Transition unavailable"); } });
    }, fallback);
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: "Open profile for Avery Example", exact: true }).click();
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await expect(page).toHaveURL(/screen=profile&clientId=transition-client/);
    if (fallback === "reduce") expect(await page.evaluate(() => window.chartTransitionProbe.calls)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.className)).not.toContain("transitionRoot");
  });
}

test("slow chart reads and failures never hold the directory behind an animation", async ({ page }) => {
  await fixtures(page);
  await probe(page);
  let finishRead: (() => void) | undefined;
  const pendingRead = new Promise<void>((resolve) => { finishRead = resolve; });
  await page.route("**/api/profiles/transition-client", async (route) => {
    await pendingRead;
    await route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
  });
  try {
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: "Open profile for Avery Example", exact: true }).click();
    await expect(page).toHaveURL(/screen=profile&clientId=transition-client/);
    await expect(page.getByLabel("Loading admitted-client profile", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.finished)).toBe(true);
    finishRead!();
    await expect(page.getByRole("alert").filter({ hasText: "This client profile could not be loaded." })).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open profile for Avery Example", exact: true })).toBeVisible();
  } finally { finishRead!(); }
});

test("back navigation interrupts a running expansion cleanly", async ({ page }) => {
  await fixtures(page);
  await probe(page, true);
  await page.goto("/?screen=profiles");
  await page.getByRole("button", { name: "Open profile for Avery Example", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.ready)).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/screen=profiles/);
  await expect(page.getByRole("button", { name: "Open profile for Avery Example", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.className)).not.toContain("transitionRoot");
});

test.describe("recorded motion preview", () => {
  test("opens a folder and list thumbnail at natural speed", async ({ page }) => {
    await fixtures(page);
    await probe(page);
    await page.goto("/?screen=profiles");
    const card = page.getByRole("button", { name: "Open profile for Avery Example", exact: true });
    const warm = page.waitForResponse((response) => response.url().endsWith("/api/profiles/transition-client"));
    await card.hover();
    await warm;
    await card.click();
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.finished)).toBe(true);
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
    await page.evaluate(() => { window.chartTransitionProbe.finished = false; });
    await card.click();
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.finished)).toBe(true);
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
  });
});

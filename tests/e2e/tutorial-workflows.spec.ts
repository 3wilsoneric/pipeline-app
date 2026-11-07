import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`tutorials stay removed from profile, saved sessions and events at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const progressKey = "pipeline-guided-coach:retirement-fixture";
    const progress = JSON.stringify({ activeTutorialId: "create-referral", mode: "active", stepIndex: 1 });
    await page.addInitScript(({ progressKey, progress }) => localStorage.setItem(progressKey, progress), { progressKey, progress });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && /\/api\/(referrals|assessments|files|uploads|packets|training)([/?]|$)/.test(new URL(request.url()).pathname)) writes.push(request.url());
    });
    await page.goto("/?view=referrals");
    await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();
    if (width < 640) await page.getByRole("button", { name: /^Open page menu/ }).click();
    await page.getByRole("button", { name: /^Open profile menu for/ }).click();
    const profile = page.getByRole("dialog", { name: "Profile settings", exact: true });
    await expect(profile).toBeVisible();
    await expect(profile.getByRole("link", { name: /Settings/ })).toBeVisible();
    await expect(profile.getByRole("link", { name: "Follow-up review" })).toBeVisible();
    await expect(page.getByRole("button", { name: /tutorial/i })).toHaveCount(0);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("pipeline:guided-coach", { detail: { type: "open-library" } }));
      window.dispatchEvent(new CustomEvent("pipeline:guided-coach", { detail: { type: "start", tutorialId: "create-referral" } }));
    });
    await expect(page.getByTestId("guided-coach-panel")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Tutorials", exact: true })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), progressKey)).toBe(progress);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`profile-${width}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(profile).toBeHidden();
    if (width < 640) await page.getByRole("button", { name: "Close page menu" }).click();
    await page.reload();
    await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();
    await expect(page.getByTestId("guided-coach-panel")).toHaveCount(0);
  });
}

for (const suffix of ["", "?task=prepare-packet", "?returnTo=https%3A%2F%2Fexample.com"]) {
  test(`retired tutorial link returns to Pipeline ${suffix || "without parameters"}`, async ({ page, baseURL }) => {
    await page.goto(`/tutorials/referral${suffix}`);
    await expect(page).toHaveURL(new URL("/", baseURL).toString());
    await expect(page.getByTestId("tutorial-referral-session")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
  });
}

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { AxeResults } from "axe-core";

for (const engine of ["chromium", "webkit"] as const) {
  for (const width of [1440, 1194, 1024, 834, 640, 390, 320]) {
    test(`${engine} folder labels and create action fit at ${width}px`, async ({ playwright, baseURL }, info) => {
      const browser = await playwright[engine].launch();
      try {
        const page = await browser.newPage({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 960 });
        await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
        await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
        const header = page.getByTestId("workspace-folder-header");
        const folder = page.getByTestId("intake-client-folder");
        const intake = header.getByRole("button", { name: "Intake", exact: true });
        const create = header.getByRole("button", { name: "Create referral", exact: true });
        await expect(create).toBeEnabled();
        await expect(create).toHaveText("Create referral");
        await expect(intake).toHaveCSS("font-size", width < 640 ? "16px" : "17px");
        await expect(header.getByTestId("workspace-identity-title").locator("span")).toHaveCSS("text-align", "center");
        await expect(intake).toHaveCSS("justify-content", "center");
        const headerBox = (await header.boundingBox())!;
        const folderBox = (await folder.boundingBox())!;
        const createBox = (await create.boundingBox())!;
        expect(createBox.height).toBeGreaterThanOrEqual(width < 640 ? 50 : 56);
        expect(headerBox.height).toBeLessThanOrEqual(width >= 960 ? 72 : 120);
        expect(Math.abs(folderBox.y - headerBox.y - headerBox.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(folderBox.y - createBox.y - createBox.height)).toBeLessThanOrEqual(1);
        for (const button of await header.getByRole("button").all()) {
          const box = (await button.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`folder-${engine}-${width}.png`) });
        await create.focus();
        await expect(create).toBeFocused();
        await header.getByRole("button", { name: "Workspace files", exact: true }).click();
        await expect(header.getByRole("button", { name: "Workspace files", exact: true })).toHaveAttribute("aria-current", "page");
        await intake.click();
        await expect(folder).toBeVisible();
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(intake).toHaveCSS("transition-duration", "0s");
        if (engine === "chromium" && [1440, 320].includes(width)) {
          await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
          const violations = await page.evaluate(async () => {
            const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
            return (await axe.run('[data-testid="workspace-folder-header"]', { runOnly: ["color-contrast", "button-name"] })).violations;
          });
          expect(violations).toEqual([]);
        }
      } finally { await browser.close(); }
    });
  }
}

test("the prominent create action still saves once and opens the same client's chart", async ({ page }, info) => {
  let creates = 0;
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/referrals") creates += 1; });
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  const name = `Avery ${randomUUID().replace(/[^a-z]/g, "")}`;
  await page.locator('[data-workspace-field="name"] input').fill(name);
  const create = page.getByRole("button", { name: "Create referral", exact: true });
  await create.click();
  await expect(page).toHaveURL(/referralId=\d+/);
  await expect(create).toHaveCount(0);
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  const chart = stages.getByRole("button", { name: /Chart$/ });
  await expect(chart).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
  expect(creates).toBe(1);
  for (const width of [1440, 1024, 834, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const tab of await stages.getByRole("button").all()) {
      await expect(tab).toBeInViewport();
      // Raised/overlapping tabs must not hide the label beneath a neighbour.
      expect(await tab.evaluate((button) => [...button.querySelectorAll("span")].filter((el) => el.getBoundingClientRect().width).every((label) => {
        const box = label.getBoundingClientRect();
        return [box.left + 1, box.right - 1].every((x) => button.contains(document.elementFromPoint(x, box.top + box.height / 2)));
      }))).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`saved-folder-${width}.png`) });
  }
  await page.reload();
  await expect(chart).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("workspace-identity-title")).toContainText("Avery");
});

for (const width of [1440, 834, 320]) {
  test(`assessment keeps the shared folder and raised tabs at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=diagnosis_clinical&demo=1");
    const folder = page.getByTestId("assessment-client-folder");
    const header = page.getByTestId("workspace-folder-header");
    const stages = header.getByRole("navigation", { name: "Workspace stages" });
    const assessment = stages.getByRole("button", { name: /Assessment$/ });
    await expect(folder).toBeVisible();
    await expect(assessment).toHaveAttribute("aria-current", "page");
    await expect(assessment).toHaveCSS("font-size", width < 640 ? "16px" : "17px");
    const bounds = (await header.boundingBox())!;
    await page.screenshot({ path: info.outputPath(`assessment-folder-${width}.png`) });
    await stages.getByRole("button", { name: /Chart$/ }).click();
    await expect(page.getByRole("region", { name: "Assessment chart review", exact: true })).toBeVisible();
    await assessment.click();
    await expect(folder).toBeVisible();
    const current = (await header.boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(current[key] - bounds[key])).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440) {
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      await expect(assessment).toHaveCSS("transition-duration", "0s");
      await assessment.focus();
      await expect(assessment).toBeFocused();
      await expect(assessment).toHaveCSS("border-bottom-width", "3px");
    }
  });
}

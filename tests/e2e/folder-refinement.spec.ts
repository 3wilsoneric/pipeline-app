import { closeTestBrowser } from "./support/browser-lifecycle";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

for (const engine of ["chromium", "webkit"] as const) {
  for (const width of [1440, 1194, 1024, 834, 640, 390, 320]) {
    test(`${engine} intake rail and create action remain usable at ${width}px`, async ({ playwright, baseURL }, info) => {
      const browser = await playwright[engine].launch();
      try {
        const page = await browser.newPage({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 960 });
        await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
        await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
        const header = page.getByTestId("workspace-folder-header");
        const folder = page.getByTestId("intake-client-folder");
        const stages = header.getByRole("navigation", { name: "Workspace stages" });
        const create = page.getByRole("button", { name: "Create referral", exact: true });
        await expect(folder).toBeVisible();
        await expect(create).toBeEnabled();
        if (width < 640) await expect(stages.getByLabel("Workspace view")).toHaveValue("1");
        else await expect(stages.getByRole("button", { name: "Intake", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toBeVisible();
        await create.scrollIntoViewIfNeeded();
        await expect(create).toBeInViewport();
        await create.focus();
        await expect(create).toBeFocused();
        for (const control of await header.getByRole("button").all()) {
          if (!(await control.isVisible())) continue;
          const box = (await control.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(width < 640 ? 44 : 26);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`intake-rail-${engine}-${width}.png`) });
        if (engine === "chromium" && [1440, 320].includes(width)) {
          await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
          const violations = await page.evaluate(async () => {
            const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
            return (await axe.run('[data-testid="workspace-folder-header"]', { runOnly: ["color-contrast", "button-name"] })).violations;
          });
          expect(violations).toEqual([]);
        }
      } finally { await closeTestBrowser(browser); }
    });
  }
}

test("the intake action creates once, opens the chart, and remains there after reload", async ({ page }) => {
  let creates = 0;
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/referrals") creates += 1; });
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  const surname = randomUUID().replace(/[^a-z]/g, "");
  const name = `Avery ${surname[0].toUpperCase()}${surname.slice(1)}`;
  await page.locator('[data-workspace-field="name"] input').fill(name);
  const create = page.getByRole("button", { name: "Create referral", exact: true });
  await create.click();
  await expect(page).toHaveURL(/referralId=\d+/);
  await expect(create).toHaveCount(0);
  await page.getByRole("region", { name: "Workspace created", exact: true }).getByRole("button", { name: "Dismiss workspace next steps", exact: true }).click();
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  await expect(stages.getByRole("button", { name: "Chart", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
  expect(creates).toBe(1);
  await page.reload();
  await expect(stages.getByRole("button", { name: "Chart", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("workspace-identity-title")).toContainText(name);
});

test("assessment stays reachable from the chart rail at desktop and phone widths", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic rail assessment", owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  await createOperationalAssessment(page.request, referral.id);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const stages = page.getByRole("navigation", { name: "Workspace stages" });
    await expect(page.locator("#packet-page-2")).toBeVisible();
    if (width < 640) await expect(stages.getByLabel("Workspace view")).toHaveValue("2");
    else await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("a client directory card opens the same profile with readable labels", async ({ page }) => {
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: clientDirectoryFixture }));
  await page.goto("/?screen=profiles");
  await page.getByRole("button", { name: /file cabinet$/ }).first().click();
  const card = page.getByRole("button", { name: "Open profile for Avery Example", exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await card.focus();
  await card.press("Enter");
  await expect(page.getByRole("main", { name: "Client profile for Avery Example" })).toBeVisible();
  await expect(page.getByTestId("client-profile-folder")).toBeVisible();
});

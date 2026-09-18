import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";

for (const width of [1440, 1194, 1024, 834, 768, 390, 320]) {
  test(`folder tabs connect directly to intake and retain the create flow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}&workspaceStage=intake`);
    const header = page.getByTestId("workspace-folder-header");
    const folder = page.getByTestId("intake-client-folder");
    const intake = header.getByRole("button", { name: "01 Intake", exact: true });
    const questionnaire = header.getByRole("button", { name: "02 Questionnaire", exact: true });
    const create = header.getByRole("button", { name: "Create referral", exact: true });
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await expect(intake).toHaveAttribute("aria-current", "page");
    await expect(questionnaire).toBeVisible();
    await expect(intake).toHaveCSS("color", "rgb(23, 108, 81)");
    await expect(questionnaire).toHaveCSS("color", "rgb(164, 66, 73)");
    await expect(folder.locator(":scope > strong")).toHaveCount(0);
    await expect(header.getByTestId("workspace-identity-title")).not.toContainText("Draft");
    await expect(page.getByTestId("workspace-save-status")).toHaveClass("sr-only");
    await expect(create).toBeEnabled();
    await expect(page.getByTestId("document-checklist-panel")).not.toHaveAttribute("open");
    const headerBox = (await header.boundingBox())!;
    const folderBox = (await folder.boundingBox())!;
    expect(Math.abs(folderBox.y - headerBox.y - headerBox.height)).toBeLessThanOrEqual(1);
    expect(headerBox.height).toBeLessThanOrEqual(width > 1100 ? 57 : 100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const filesBox = (await header.getByRole("button", { name: "Workspace files" }).boundingBox())!;
    const createBox = (await create.boundingBox())!;
    expect(filesBox.x).toBeGreaterThanOrEqual(createBox.x + createBox.width);
    expect((await questionnaire.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (width <= 1100) {
      for (const button of await header.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await expect(folder.locator('[data-workspace-field="name"] input')).toHaveCSS("font-size", "16px");
      expect((await folder.locator('[data-workspace-field="name"] input').boundingBox())!.y).toBeLessThan(340);
    }
    await page.screenshot({ path: testInfo.outputPath(`folder-tabs-${width}.png`), animations: "disabled" });
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[data-testid="workspace-folder-header"]', { runOnly: ["color-contrast", "button-name"] })).violations;
    });
    expect(violations).toEqual([]);

    const surname = randomUUID().replace(/[^a-z]/g, "");
    const name = `Avery ${surname[0].toUpperCase()}${surname.slice(1)}`;
    await folder.locator('[data-workspace-field="name"] input').fill(name);
    await folder.locator('[data-workspace-field="email"] input').fill("folder-tabs@example.invalid");
    await create.click();
    await expect(page).toHaveURL(/referralId=\d+/);
    await expect(create).toHaveCount(0);
    const referralId = new URL(page.url()).searchParams.get("referralId")!;
    await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral.email).toBe("folder-tabs@example.invalid");
    await expect(page.getByTestId("workspace-identity-title")).toHaveText(name);

    await questionnaire.focus();
    await page.keyboard.press("Enter");
    await expect(width < 640 ? page.locator("[data-phone-interview]") : page.getByTestId("preparation-client-folder")).toBeVisible();
    if (width >= 640) await expect(questionnaire).toHaveAttribute("aria-current", "page");
    if (width < 640) await page.getByRole("button", { name: "Close assessment", exact: true }).click();
    else await intake.click();
    await expect(folder.locator('[data-workspace-field="email"] input')).toHaveValue("folder-tabs@example.invalid");
    await header.getByRole("button", { name: "Workspace files" }).click();
    await expect(header.getByRole("button", { name: "Workspace files" })).toHaveAttribute("aria-current", "page");
    await header.getByRole("button", { name: "Workspace activity" }).click();
    await expect(page.getByRole("region", { name: "Referral ownership and activity" })).toBeVisible();
    await intake.click();
    await page.reload();
    await expect(folder.locator('[data-workspace-field="email"] input')).toHaveValue("folder-tabs@example.invalid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("save failures remain visible and retryable outside the quiet name tab", async ({ page }) => {
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}&workspaceStage=intake`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  await page.locator('[data-workspace-field="name"] input').fill("Synthetic failed save");
  await page.route("**/api/referrals", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 503, json: { error: "Synthetic save outage" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect(page.getByTestId("workspace-save-status").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create referral", exact: true })).toBeEnabled();
  await expect(page.locator('[data-workspace-field="name"] input')).toHaveValue("Synthetic failed save");
  await page.unroute("**/api/referrals");
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect(page).toHaveURL(/referralId=\d+/);
});

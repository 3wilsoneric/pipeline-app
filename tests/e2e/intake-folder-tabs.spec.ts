import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";

for (const width of [1440, 1194, 1024, 834, 768, 640, 390, 320]) {
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
    await expect(intake).toHaveCSS("font-size", width < 640 ? "13px" : "14px");
    await expect(header.getByTestId("workspace-identity-title").locator("span")).toHaveCSS("font-size", "16px");
    await expectRaisedTab(intake, questionnaire);
    await expect(folder.locator(":scope > strong")).toHaveCount(0);
    await expect(header.getByTestId("workspace-identity-title")).not.toContainText("Draft");
    await expect(page.getByTestId("workspace-save-status")).toHaveClass("sr-only");
    await expect(create).toBeEnabled();
    await expect(page.getByTestId("document-checklist-panel")).not.toHaveAttribute("open");
    const headerBox = (await header.boundingBox())!;
    const folderBox = (await folder.boundingBox())!;
    expect(Math.abs(folderBox.y - headerBox.y - headerBox.height)).toBeLessThanOrEqual(1);
    expect(headerBox.height).toBeLessThanOrEqual(width > 1100 ? 60 : 104);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const filesBox = (await header.getByRole("button", { name: "Workspace files" }).boundingBox())!;
    const createBox = (await create.boundingBox())!;
    expect(filesBox.x).toBeGreaterThanOrEqual(createBox.x + createBox.width);
    await expect(create).toHaveCSS("border-bottom-width", "1px");
    expect(await create.evaluate((button) => parseFloat(getComputedStyle(button).borderBottomRightRadius))).toBeGreaterThanOrEqual(5);
    if (width >= 768) expect(Math.abs(folderBox.y - createBox.y - createBox.height)).toBeLessThanOrEqual(1);
    const intakeBox = (await intake.boundingBox())!;
    const questionnaireBox = (await questionnaire.boundingBox())!;
    const overlap = intakeBox.x + intakeBox.width - questionnaireBox.x;
    expect(overlap).toBeGreaterThan(5);
    expect(overlap).toBeLessThan(20);
    expect((await questionnaire.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (width <= 1100) {
      for (const button of await header.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await expect(folder.locator('[data-workspace-field="name"] input')).toHaveCSS("font-size", "16px");
      // The live Beta review panel adds content above intake; keep the folder chrome compact.
      const review = page.getByRole("region", { name: "Extraction review", exact: true });
      await expect(review).toContainText("Beta");
      await expect.poll(async () => (await folder.locator('[data-workspace-field="name"] input').boundingBox())!.y - await review.evaluate((element) => element.getBoundingClientRect().height + parseFloat(getComputedStyle(element).marginBottom))).toBeLessThan(340);
      await expect(folder.locator('[data-workspace-field="name"] input')).toBeInViewport();
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

    const beforeUpdate = (await header.boundingBox())!;
    const current = (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral;
    const remoteUpdate = await page.request.patch(`/api/referrals/${referralId}`, { data: {
      if_match: current.version,
      if_match_sections: current.sectionVersions,
      patch: { phone: "(415) 555-0199" },
    } });
    expect(remoteUpdate.ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(folder.locator('[data-workspace-field="phone"] input')).toHaveValue("(415) 555-0199");
    await expect(header.getByTestId("workspace-sync-status")).toBeVisible();
    await expect(header.getByTestId("workspace-sync-status")).toContainText("merged into your open draft");
    await expect(page.getByRole("region", { name: "Remote changes", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("workspace-save-status")).toHaveClass("sr-only");
    expect((await header.boundingBox())!.height).toBe(beforeUpdate.height);
    await expectConnectedFolder(folder);

    await questionnaire.focus();
    await page.keyboard.press("Enter");
    await expect(width < 640 ? page.locator("[data-phone-interview]") : page.getByTestId("preparation-client-folder")).toBeVisible();
    if (width >= 640) {
      await expect(questionnaire).toHaveAttribute("aria-current", "page");
      await expectRaisedTab(questionnaire, intake);
      await expectConnectedFolder(page.getByTestId("preparation-client-folder"));
      await page.screenshot({ path: testInfo.outputPath(`folder-tabs-questionnaire-${width}.png`), animations: "disabled" });
    }
    if (width < 640) await page.getByRole("button", { name: "Back to referral", exact: true }).click();
    else await intake.click();
    await expectRaisedTab(intake, questionnaire);
    await expect(folder.locator('[data-workspace-field="email"] input')).toHaveValue("folder-tabs@example.invalid");
    await header.getByRole("button", { name: "Workspace files" }).click();
    await expect(header.getByRole("button", { name: "Workspace files" })).toHaveAttribute("aria-current", "page");
    await header.getByRole("button", { name: "Workspace activity" }).click();
    await expect(page.getByRole("region", { name: "Referral ownership and activity" })).toBeVisible();
    await intake.click();
    await page.reload();
    await expect(folder.locator('[data-workspace-field="email"] input')).toHaveValue("folder-tabs@example.invalid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440) {
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      await expect(intake).toHaveCSS("transition-duration", "0s");
      await questionnaire.focus();
      await page.keyboard.press("Enter");
      await expect(questionnaire).toHaveAttribute("aria-current", "page");
      await expectRaisedTab(questionnaire, intake);
      await expect(questionnaire).toHaveCSS("border-bottom-width", "3px");
    }
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

async function expectConnectedFolder(folder: Locator) {
  await expect(folder.locator(":scope > strong")).toHaveCount(0);
  // Editing fields scrolls the chart under its sticky tabs; measure the seam at the top.
  await expect.poll(() => folder.evaluate((element) => {
    element.closest<HTMLElement>('[data-guide-target="packet-workspace"]')?.scrollTo({ top: 0, behavior: "instant" });
    const header = element.closest('[data-testid="packet-workspace"]')!.querySelector('[data-testid="workspace-folder-header"]')!;
    const top = header.getBoundingClientRect();
    const body = element.getBoundingClientRect();
    return Math.max(Math.abs(body.y - top.bottom), Math.abs(body.x - top.x), Math.abs(body.width - top.width));
  })).toBeLessThanOrEqual(1);
}

async function expectRaisedTab(active: Locator, behind: Locator) {
  await expect.poll(async () => active.evaluate((button) => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(button).transform);
    return Math.round(transform.d * 100);
  })).toBe(110);
  const frontBox = (await active.boundingBox())!;
  const backBox = (await behind.boundingBox())!;
  expect(frontBox.height).toBeGreaterThan(backBox.height + 3);
  expect(Math.abs(frontBox.y + frontBox.height - backBox.y - backBox.height)).toBeLessThanOrEqual(1);
  expect(Number(await active.evaluate((button) => getComputedStyle(button).zIndex)))
    .toBeGreaterThan(Number(await behind.evaluate((button) => getComputedStyle(button).zIndex)));
  for (const tab of [active, behind]) {
    // Test painted hit targets, not just boxes: overlapping tabs must not cover labels.
    expect(await tab.evaluate((button) => [...button.querySelectorAll("span")].every((label) => {
      const box = label.getBoundingClientRect();
      return [box.left + 1, box.right - 1].every((x) => button.contains(document.elementFromPoint(x, box.top + box.height / 2)));
    }))).toBe(true);
  }
}

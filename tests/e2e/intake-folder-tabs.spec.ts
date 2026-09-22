import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";
import { createOperationalReferral } from "./support/operational-api";

test("workspace sync badge appears for a merged remote edit without displacing actions", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic sync status", owner: "", tags: [] });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  const header = page.getByTestId("workspace-folder-header");
  const status = header.getByTestId("workspace-sync-status");
  await expect(status).toHaveCount(0);
  const before = (await header.boundingBox())!;
  const current = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  const updated = await page.request.patch(`/api/referrals/${referral.id}`, { data: {
    if_match: current.version, if_match_sections: current.sectionVersions, patch: { phone: "(415) 555-0199" },
  } });
  expect(updated.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('[data-workspace-field="phone"] input')).toHaveValue("(415) 555-0199");
  await expect(status).toBeVisible();
  await expect(status).toContainText("were merged into your open draft.");
  await expect(page.getByRole("region", { name: "Remote changes", exact: true })).toHaveCount(0);
  expect((await header.boundingBox())!.height).toBe(before.height);
  await expect(header.getByRole("button", { name: "Workspace files", exact: true })).toBeEnabled();
});

for (const width of [1440, 1194, 1024, 834, 768, 640, 390, 320]) {
  test(`folder tabs connect directly to intake and retain the create flow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
    const header = page.getByTestId("workspace-folder-header");
    const folder = page.getByTestId("intake-client-folder");
    const picker = header.getByLabel("Workspace view");
    const phone = width < 640;
    const open = async (label: string) => {
      if (phone) await picker.selectOption({ label });
      else await header.getByRole("button", { name: label === "Files" ? "Workspace files" : label === "Activity" ? "Workspace activity" : label, exact: true }).click();
    };
    const create = header.getByRole("button", { name: "Create referral", exact: true });
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await expect(folder).toBeVisible();
    if (phone) {
      await expect(picker).toHaveValue("1");
      await expect(picker).toHaveCSS("font-size", "16px");
    } else {
      const intake = header.getByRole("button", { name: "Intake", exact: true });
      await expect(intake).toHaveAttribute("aria-current", "page");
      await expect(intake).toHaveCSS("color", "rgb(23, 108, 81)");
      await expect(intake).toHaveCSS("font-size", "17px");
    }
    await expect(header.getByRole("button", { name: "Assessment", exact: true })).toHaveCount(0);
    await expect(header.getByTestId("workspace-identity-title").locator("span")).toHaveCSS("font-size", "18px");
    const documentsToggle = page.getByTestId("document-checklist-toggle");
    await expect(documentsToggle.getByText("Beta", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Document suggestions", exact: true })).toHaveCount(0);
    await documentsToggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Extraction review", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("initial-packet-input")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("document-checklist-panel")).not.toHaveAttribute("open");
    await expect(folder.locator(":scope > strong")).toHaveCount(0);
    await expect(header.getByTestId("workspace-identity-title")).not.toContainText("Draft");
    await expect(page.getByTestId("workspace-save-status")).toHaveClass("sr-only");
    await expect(create).toBeEnabled();
    if (!phone) await expectConnectedFolder(folder);
    for (const button of await header.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`folder-tabs-${width}.png`), animations: "disabled" });
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[data-testid="workspace-folder-header"]', { runOnly: ["color-contrast", "button-name", "select-name"] })).violations;
    });
    expect(violations).toEqual([]);
    // Keep this geometry fixture a fixed length; UUID filtering produced 7–23
    // letters, randomly changing the name's line count at the 320px breakpoint.
    const surname = randomUUID().slice(0, 8).replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)));
    const name = `Avery ${surname[0].toUpperCase()}${surname.slice(1)}`;
    await folder.locator('[data-workspace-field="name"] input').fill(name);
    await folder.locator('[data-workspace-field="email"] input').fill("folder-tabs@example.invalid");
    await create.click();
    await expect(page).toHaveURL(/referralId=\d+/);
    await expect(create).toHaveCount(0);
    const referralId = new URL(page.url()).searchParams.get("referralId")!;
    await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral.email).toBe("folder-tabs@example.invalid");
    await expect(page.getByTestId("workspace-identity-title")).toHaveText(name);
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
    await expect(folder).toBeVisible();
    const beforeUpdate = (await header.boundingBox())!;
    const current = (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral;
    const remote = await page.request.patch(`/api/referrals/${referralId}`, { data: { if_match: current.version, if_match_sections: current.sectionVersions, patch: { phone: "(415) 555-0199" } } });
    expect(remote.ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(folder.locator('[data-workspace-field="phone"] input')).toHaveValue("(415) 555-0199");
    await expect(header.getByTestId("workspace-sync-status")).toBeVisible();
    await expect(page.getByRole("region", { name: "Remote changes", exact: true })).toHaveCount(0);
    if (!phone) expect((await header.boundingBox())!.height).toBe(beforeUpdate.height);
    else {
      // At 320px the merge status wraps to a second row; controls stay fitted and reachable.
      await expect(picker).toBeInViewport();
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(80);
      expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await open("Assessment");
    await expect(phone ? page.locator("[data-phone-interview]") : page.locator("[data-assessment-view]")).toBeVisible();
    if (phone) await expect(picker).toHaveValue("2");
    else await expectRaisedTab(header.getByRole("button", { name: "Assessment", exact: true }), header.getByRole("button", { name: "Chart", exact: true }));
    await open("Chart");
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toContainText(name);
    await open("Files");
    if (phone) await expect(picker).toHaveValue("files");
    else await expect(header.getByRole("button", { name: "Workspace files" })).toHaveAttribute("aria-current", "page");
    await open("Activity");
    await expect(page.getByRole("region", { name: "Referral ownership and activity" })).toBeVisible();
    await open("Chart");
    await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
    await page.reload();
    await expect(folder.locator('[data-workspace-field="email"] input')).toHaveValue("folder-tabs@example.invalid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440) {
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      const assessment = header.getByRole("button", { name: "Assessment", exact: true });
      await expect(assessment).toHaveCSS("transition-duration", "0s");
      await assessment.focus();
      await page.keyboard.press("Enter");
      await expect(assessment).toHaveAttribute("aria-current", "page");
      await expect(assessment).toHaveCSS("border-bottom-width", "3px");
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
  })).toBe(100);
  await expect.poll(async () => {
    const front = (await active.boundingBox())!;
    const back = (await behind.boundingBox())!;
    return Math.max(Math.abs(front.height - back.height), Math.abs(back.y - front.y - 3));
  }).toBeLessThan(0.1);
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

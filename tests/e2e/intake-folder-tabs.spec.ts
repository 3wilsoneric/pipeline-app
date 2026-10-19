import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";
import { createOperationalReferral } from "./support/operational-api";

test("workspace sync status appears for a merged remote edit without displacing actions", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic sync status", owner: "", tags: [] });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  const header = page.getByTestId("workspace-folder-header");
  const status = header.getByTestId("workspace-sync-status");
  await expect(status).toHaveCount(0);
  await expect(page.getByTestId("workspace-save-status")).toHaveClass("sr-only");
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
  test(`intake creates a chart and all workspace destinations stay reachable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
    const header = page.getByTestId("workspace-folder-header");
    const stages = header.getByRole("navigation", { name: "Workspace stages" });
    const folder = page.getByTestId("intake-client-folder");
    const create = page.getByRole("button", { name: "Create referral", exact: true });
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await expect(folder).toBeVisible();
    if (width < 640) await expect(stages.getByLabel("Workspace view")).toHaveValue("1");
    else await expect(stages.getByRole("button", { name: "Intake", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(create).toBeEnabled();
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[data-testid="workspace-folder-header"]', { runOnly: ["color-contrast", "button-name", "select-name"] })).violations;
    });
    expect(violations).toEqual([]);
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
    await page.getByRole("region", { name: "Workspace created", exact: true }).getByRole("button", { name: "Dismiss workspace next steps", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`workspace-rail-${width}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
    const current = (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral;
    const remote = await page.request.patch(`/api/referrals/${referralId}`, { data: { if_match: current.version, if_match_sections: current.sectionVersions, patch: { phone: "(415) 555-0199" } } });
    expect(remote.ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(folder.locator('[data-workspace-field="phone"] input')).toHaveValue("(415) 555-0199");
    await expect(header.getByTestId("workspace-sync-status")).toBeVisible();
    const openStage = async (label: string) => {
      if (width < 640) await stages.getByLabel("Workspace view").selectOption({ label });
      else await stages.getByRole("button", { name: label, exact: true }).click();
    };
    await openStage("Assessment");
    await expect(page.locator("[data-assessment-view]")).toBeVisible();
    await openStage("Chart");
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toContainText(name);
    if (width < 640) await stages.getByLabel("Workspace view").selectOption({ label: "Files" });
    else await header.getByRole("button", { name: "Workspace files" }).click();
    if (width < 640) await expect(stages.getByLabel("Workspace view")).toHaveValue("files");
    else await expect(header.getByRole("button", { name: "Workspace files" })).toHaveAttribute("aria-current", "page");
    if (width < 640) await stages.getByLabel("Workspace view").selectOption({ label: "Activity" });
    else await header.getByRole("button", { name: "Workspace activity" }).click();
    await expect(page.getByRole("region", { name: "Referral ownership and activity" })).toBeVisible();
    await openStage("Chart");
    await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
    await page.reload();
    await expect(folder.locator('[data-workspace-field="email"] input')).toHaveValue("folder-tabs@example.invalid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("save failures remain visible and retryable", async ({ page }) => {
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}&workspaceStage=intake`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  await page.locator('[data-workspace-field="name"] input').fill("Synthetic failed save");
  await page.route("**/api/referrals", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 503, json: { error: "Synthetic save outage" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic save outage" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create referral", exact: true })).toBeEnabled();
  await expect(page.locator('[data-workspace-field="name"] input')).toHaveValue("Synthetic failed save");
  await page.unroute("**/api/referrals");
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect(page).toHaveURL(/referralId=\d+/);
});

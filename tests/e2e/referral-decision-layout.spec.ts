import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires isolated desktop workspace state.");

async function expectAccessibleDecision(page: Page) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('[aria-label="Admission decision"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 834, 390, 320]) {
  test(`decision hierarchy and unsent acceptance at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Jordan Rivera", community: "San Pablo", owner: "", tags: [] });
    let sends = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await expect(panel.getByRole("heading", { name: "Placement decision", exact: true })).toBeVisible();
    await expect(panel.getByRole("complementary", { name: "Decision context" })).toContainText("Not started");
    await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeDisabled();
    await expect(panel.getByRole("button", { name: /^Advance to/ })).not.toBeVisible();
    await expect(panel.getByRole("combobox", { name: "Workflow stage" })).not.toBeVisible();
    await expect(panel.getByRole("radio")).toHaveCount(3);
    await expectAccessibleDecision(page);
    await page.screenshot({ path: info.outputPath(`decision-${width}.png`), animations: "disabled" });

    const accept = panel.getByRole("radio", { name: "Accept", exact: true });
    await accept.focus();
    await page.keyboard.press("Space");
    await expect(accept).toBeChecked();
    await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeEnabled();
    await panel.getByLabel("Reason (optional)", { exact: true }).fill("Synthetic placement decision for UI testing only.");
    page.once("dialog", (dialog) => dialog.dismiss());
    await panel.getByRole("button", { name: "Record decision", exact: true }).click();
    await expect(panel.getByRole("radio", { name: "Accept", exact: true })).toBeChecked();
    expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: "Record decision", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
    await expect(panel.getByRole("group", { name: "Recorded decision", exact: true })).toBeFocused();
    await expect(panel.getByRole("region", { name: "Prepare client handoff" })).toContainText("Sign the assessment before sending");
    await expect(panel.getByRole("button", { name: "Review email & packet", exact: true })).toBeEnabled();
    await expectAccessibleDecision(page);
    await page.screenshot({ path: info.outputPath(`accepted-${width}.png`), animations: "disabled" });
    await page.reload();
    await expect(panel.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
    await expect(panel).toContainText("Synthetic placement decision for UI testing only.");
    expect(sends).toBe(0);
  });
}

for (const outcome of ["Deny", "Under review"] as const) {
  test(`${outcome} saves without suggesting an admission handoff`, async ({ page }) => {
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Decision Followup", owner: "", tags: [] });
    await createOperationalAssessment(page.request, referral.id);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await panel.getByRole("radio", { name: outcome, exact: true }).check();
    await panel.getByRole("textbox").fill("Synthetic follow-up note.");
    if (outcome === "Deny") page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: outcome === "Deny" ? "Record decision" : "Save under review", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Review email & packet" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Advance to/ })).not.toBeVisible();
    await expectAccessibleDecision(page);
    await page.reload();
    await expect(panel.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    const workflow = (await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json());
    expect(workflow.review).toBeNull();
    if (outcome === "Deny") {
      expect(workflow.decision.outcome).toBe("declined");
      await expect(panel.getByRole("heading", { name: "Denied", exact: true })).toBeVisible();
    } else {
      expect(workflow.decision).toBeNull();
      expect(workflow.recommendation.outcome).toBe("needs_more_information");
      await expect(panel.getByRole("button", { name: "Save under review" })).toHaveCount(0);
      await panel.getByRole("textbox").fill("Updated synthetic follow-up note.");
      await expect(panel.getByRole("button", { name: "Save under review" })).toBeEnabled();
      await expect(panel.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
      await panel.getByRole("button", { name: "Save under review" }).click();
      await expect(panel.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    }
  });
}

test("read-only decision access is visibly read-only", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "", tags: [] });
  await page.route(`**/api/referrals/${referral.id}/workflow`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.capabilities.can_decide = false;
    payload.capabilities.can_recommend = false;
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  await expect(panel.getByRole("radio", { name: "Accept", exact: true })).toBeDisabled();
  await expect(panel.getByRole("textbox")).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeDisabled();
  await expect(panel).toContainText("your account cannot record it");
});

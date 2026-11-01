import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { activeOperationalAssessor, createOperationalAssessment, createOperationalReferral, signOperationalAssessment } from "./support/operational-api";

async function setup(page: Page) {
  const assessor = await activeOperationalAssessor(page.request);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic decision bookmark", owner: assessor.display_name, tags: [],
  }, { assigneeId: assessor.principal_id });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`;
  const read = async () => (await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json());
  return { referral, assessment, url, read };
}

for (const [width, outcome] of [[1440, "accept"], [834, "accept"], [390, "decline"], [320, "decline"]] as const) {
  test(`early ${outcome} survives reopening and becomes one explicit confirmation at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const { referral, assessment, url, read } = await setup(page);
    let sends = 0;
    page.on("request", request => { if (request.method() === "POST" && /meet-client-email|under-review-email/.test(request.url())) sends++; });
    await page.goto(`${url}&assessmentMode=prepare`);
    const bookmark = page.getByRole("combobox", { name: "Working decision", exact: true });
    await expect(bookmark).toBeEnabled();
    await bookmark.selectOption(outcome);
    await expect.poll(async () => (await read()).recommendation?.outcome).toBe(outcome);
    expect((await read()).decision).toBeNull();
    expect((await read()).referral.admissionDate).toBeFalsy();
    await page.reload();
    await expect(bookmark).toHaveValue(outcome);
    await page.screenshot({ path: info.outputPath(`bookmark-${width}.png`), animations: "disabled" });
    await page.goto(`${url}&assessmentMode=review`);
    await expect(bookmark).toHaveValue(outcome);
    await page.locator('footer[aria-label="Assessment actions"]').getByRole("button", { name: "Sign assessment", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Sign this assessment?" }).getByRole("button", { name: "Sign assessment", exact: true }).click();
    const decision = page.getByRole("region", { name: "Admission decision", exact: true });
    const confirmation = decision.getByRole("button", { name: outcome === "accept" ? "Record acceptance" : "Record denial", exact: true });
    await expect(confirmation).toBeEnabled();
    for (const control of [decision.getByRole("heading", { name: outcome === "accept" ? "Accept" : "Deny", exact: true }), confirmation]) {
      await expect.poll(() => control.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const covering = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return covering === element || element.contains(covering);
      })).toBe(true);
    }
    await expect(page).toHaveURL(/assessmentMode=review/);
    await expect(decision.getByRole("radio")).toHaveCount(0);
    await expect(bookmark).toHaveCount(0);
    expect((await read()).decision).toBeNull();
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    await page.evaluate(() => document.fonts.ready);
    await decision.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe.run('[aria-label="Admission decision"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations);
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`confirmation-${width}.png`), animations: "disabled" });
    // Closing and reopening after signing still offers confirmation, never automatic finalization.
    await page.reload();
    await expect(confirmation).toBeEnabled();
    expect((await read()).decision).toBeNull();
    await confirmation.click();
    await expect.poll(async () => (await read()).decision?.outcome).toBe(outcome === "accept" ? "accepted" : "declined");
    await expect(page.getByRole("alertdialog", { name: /this referral/ })).toHaveCount(0);
    if (outcome === "accept") await expect(page).toHaveURL(/workspaceView=email/);
    else await expect(decision.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeTruthy();
    expect(saved.meet_client_sent_at).toBeFalsy();
    expect((await read()).referral.admissionDate).toBeFalsy();
    expect(sends).toBe(0);
    // The nested chart action keeps the recorded decision reachable.
    const decisionLink = page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Decision", exact: true });
    if (await decisionLink.isVisible()) await decisionLink.click();
    else await page.getByRole("combobox", { name: "Workspace view" }).selectOption("workflow");
    await expect(page.getByRole("region", { name: "Admission decision", exact: true }).getByRole("heading", { name: outcome === "accept" ? "Accepted" : "Denied", exact: true })).toBeVisible();
    expect(referral.id).toBeGreaterThan(0);
  });
}

test("failed confirmation retains the earmark and retries the same command", async ({ page }) => {
  const { referral, assessment, url, read } = await setup(page);
  await page.goto(url);
  await page.getByRole("combobox", { name: "Working decision" }).selectOption("accept");
  await expect.poll(async () => (await read()).recommendation?.outcome).toBe("accept");
  await signOperationalAssessment(page.request, assessment);
  await page.goto(`${url}&assessmentMode=review`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  const commands: string[] = [];
  await page.route(`**/api/referrals/${referral.id}/decision`, async route => {
    commands.push(route.request().postDataJSON().client_mutation_id);
    if (commands.length === 1) return route.fulfill({ status: 503, json: { error: "Synthetic confirmation unavailable" } });
    return route.continue();
  });
  await panel.getByRole("button", { name: "Record acceptance", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Could not confirm whether the decision was saved");
  expect((await read()).decision).toBeNull();
  await expect(panel.getByRole("heading", { name: "Accept", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Record acceptance", exact: true }).click();
  await expect.poll(async () => (await read()).decision?.outcome).toBe("accepted");
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
});

test("an earmark can change in review without changing the stored choice until confirmation", async ({ page }) => {
  const { assessment, url, read } = await setup(page);
  await page.goto(url);
  await page.getByRole("combobox", { name: "Working decision" }).selectOption("accept");
  await expect.poll(async () => (await read()).recommendation?.outcome).toBe("accept");
  await signOperationalAssessment(page.request, assessment);
  await page.goto(`${url}&assessmentMode=review`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  await panel.getByRole("button", { name: "Change", exact: true }).click();
  await panel.getByRole("radio", { name: "Deny", exact: true }).check();
  await panel.getByLabel("Reason (optional)", { exact: true }).fill("Synthetic updated decision after review.");
  expect((await read()).recommendation.outcome).toBe("accept");
  expect((await read()).decision).toBeNull();
  await panel.getByRole("button", { name: "Record decision", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Deny this referral?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Record denial", exact: true }).click();
  await expect.poll(async () => (await read()).decision?.outcome).toBe("declined");
  expect((await read()).decision.reasonNote).toBe("Synthetic updated decision after review.");
});

for (const earlier of [false, true]) {
  test(`${earlier ? "an earlier assessment's earmark" : "no earmark"} still offers all decision choices after signing`, async ({ page }) => {
    const { referral, assessment, url, read } = await setup(page);
    if (earlier) {
      await page.goto(url);
      await page.getByRole("combobox", { name: "Working decision" }).selectOption("accept");
      await expect.poll(async () => (await read()).recommendation?.outcome).toBe("accept");
      await page.route(`**/api/referrals/${referral.id}/workflow`, async route => {
        const response = await route.fetch();
        const payload = await response.json();
        payload.recommendation.assessmentId = "synthetic-earlier-assessment";
        await route.fulfill({ response, json: payload });
      });
    }
    await signOperationalAssessment(page.request, assessment);
    await page.goto(`${url}&assessmentMode=review`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await expect(panel.getByRole("radio")).toHaveCount(3);
    await expect(panel.getByRole("button", { name: "Record acceptance", exact: true })).toHaveCount(0);
    if (earlier) await expect(panel).toContainText("Recorded for an earlier assessment.");
    await panel.getByRole("radio", { name: "Accept", exact: true }).check();
    await panel.getByRole("button", { name: "Record decision", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Accept this referral?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await read()).decision).toBeNull();
  });
}

test("loading the bookmark does not move the next action under a pointer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 950 });
  const { referral, url } = await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/referrals/${referral.id}/workflow`, async route => {
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`${url}&assessmentMode=prepare`);
    const next = page.locator('footer[aria-label="Assessment actions"]').getByRole("button", { name: /Next section|Begin interview/, exact: true });
    await expect(next).toBeVisible();
    const before = (await next.boundingBox())!;
    release();
    await expect(page.getByRole("combobox", { name: "Working decision", exact: true })).toBeVisible();
    const after = (await next.boundingBox())!;
    expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
  } finally { release(); }
});

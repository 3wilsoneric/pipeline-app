import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import {
  asAssessmentPayload,
  completeOperationalAssessment,
  createOperationalAssessment,
  createOperationalReferral,
  readOperationalReferral,
  scheduleOperationalAssessment,
  signOperationalAssessment,
  startOperationalAssessment,
  submitOperationalRecommendation,
} from "./support/operational-api";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires isolated desktop workspace state.");

async function expectAccessibleDecision(page: Page, selector = '[aria-label="Admission decision"]') {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async (selector) => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run(selector, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  }, selector);
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 834, 390, 320]) {
  test(`decision hierarchy and unsent acceptance at ${width}px`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 950 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Jordan Rivera", community: "San Pablo", owner: "", tags: [] });
    let sends = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await expect(panel.getByRole("heading", { name: "Placement decision", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("complementary", { name: "Decision context" })).toContainText("Open the assessment to review or continue it.");
    await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeDisabled();
    await expect(panel.getByRole("button", { name: /^Change stage to/ })).not.toBeVisible();
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
    const choices = await panel.getByRole("group", { name: "Final decision", exact: true }).boundingBox();
    const note = await panel.getByLabel("Reason (optional)", { exact: true }).evaluate((element) => {
      const bounds = element.closest("label")!.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width };
    });
    expect(choices).not.toBeNull();
    expect(note).not.toBeNull();
    expect(note!.y).toBeGreaterThanOrEqual(choices!.y + choices!.height);
    expect(Math.abs(note!.x - choices!.x)).toBeLessThan(2);
    expect(Math.abs(note!.width - choices!.width)).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath(`decision-note-${width}.png`), animations: "disabled" });
    await panel.getByRole("button", { name: "Record decision", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Records acceptance. Nothing is signed or sent.");
    await expectAccessibleDecision(page, '[role="alertdialog"]');
    await page.screenshot({ path: info.outputPath(`confirmation-${width}.png`), animations: "disabled" });
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(panel.getByRole("radio", { name: "Accept", exact: true })).toBeChecked();
    expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
    await panel.getByRole("button", { name: "Record decision", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Record acceptance", exact: true }).click();
    const placement = page.getByRole("region", { name: "Handoff follow-through" });
    await expect(placement).toBeVisible();
    await expect(placement.getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
    await expect(placement).toContainText("Accepted · Not sent");
    await expect(placement.getByRole("button", { name: "Review & sign assessment" })).toBeVisible();
    await expect(placement.getByRole("button", { name: "Open decision", exact: true })).toHaveCount(0);
    await expect(placement.getByRole("button", { name: "Placement did not happen" })).toHaveCount(0);
    await expect(placement.getByRole("button", { name: /confirm admission/i })).toHaveCount(0);
    await expect(placement.getByLabel("Planned admission date", { exact: true })).toHaveCount(0);
    await expectAccessibleDecision(page, '[aria-label="Handoff follow-through"]');
    await page.screenshot({ path: info.outputPath(`accepted-${width}.png`), animations: "disabled" });
    if (width < 640) await page.getByLabel("Workspace view", { exact: true }).selectOption({ label: "Decision" });
    else await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Decision", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Continue to Handoff" })).toBeEnabled();
    await expect(panel.getByRole("region", { name: "Admission follow-through" })).toHaveCount(0);
    await expectAccessibleDecision(page);
    await page.reload();
    await expect(panel.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
    await expect(panel).toContainText("Synthetic placement decision for UI testing only.");
    await panel.getByRole("button", { name: "Continue to Handoff" }).click();
    await expect(placement.getByRole("button", { name: "Handoff actions" })).toBeVisible();
    await placement.getByRole("button", { name: "Handoff actions" }).click();
    const placementActions = placement.getByRole("dialog", { name: "Handoff actions" });
    await expect(placementActions.getByRole("button", { name: "Placement did not happen" })).toBeVisible();
    await expect(placementActions).not.toContainText(/ElderMark|manual entry|Mark pending|Record issue/i);
    await placementActions.getByRole("button", { name: "Close handoff actions" }).click();
    await expect(placement).not.toContainText(/EHR handoff/i);
    await expectAccessibleDecision(page, '[aria-label="Handoff follow-through"]');
    if (width === 1440) await page.screenshot({ path: info.outputPath("placement-1440.png"), animations: "disabled" });
    expect(sends).toBe(0);
  });
}

for (const outcome of ["Accept", "Deny"] as const) {
  test(`${outcome} feedback follows the saved response without blocking navigation`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: outcome === "Deny" ? "reduce" : "no-preference" });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Decision Receipt", owner: "", tags: [] });
    let releaseSave!: () => void;
    const heldSave = new Promise<void>((resolve) => { releaseSave = resolve; });
    let saves = 0;
    let sends = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
    await page.route(`**/api/referrals/${referral.id}/decision`, async (route) => {
      saves++;
      await heldSave;
      await route.continue();
    });
    try {
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      const panel = page.getByRole("region", { name: "Admission decision", exact: true });
      const feedback = page.locator('[role="status"][data-outcome]');
      await panel.getByRole("radio", { name: outcome, exact: true }).check();
      await panel.getByLabel("Reason (optional)", { exact: true }).fill("Synthetic decision receipt check.");
      await panel.getByRole("button", { name: "Record decision", exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.getByRole("button", { name: outcome === "Accept" ? "Record acceptance" : "Record denial", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect(saves).toBe(0);
      await expect(panel.getByLabel("Reason (optional)", { exact: true })).toHaveValue("Synthetic decision receipt check.");
      await panel.getByRole("button", { name: "Record decision", exact: true }).click();
      await dialog.getByRole("button", { name: outcome === "Accept" ? "Record acceptance" : "Record denial", exact: true }).click();
      await expect.poll(() => saves).toBe(1);
      await expect(feedback).toHaveCount(0);
      expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
      releaseSave();
      await expect(feedback).toContainText(outcome === "Accept" ? "Accepted" : "Denied");
      await expect(feedback).toContainText("Decision recorded");
      expect(await feedback.evaluate((element) => element.contains(document.activeElement))).toBe(false);
      expect(await feedback.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
      const animation = await feedback.evaluate((element) => getComputedStyle(element).animationName);
      expect(animation === "none").toBe(outcome === "Deny");
      if (outcome === "Accept") await expect(page.getByRole("region", { name: "Handoff follow-through" })).toBeVisible();
      else await expect(panel.getByRole("heading", { name: "Denied", exact: true })).toBeVisible();
      await expect(feedback).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      await expect(feedback).toHaveCount(0);
      expect(saves).toBe(1);
      expect(sends).toBe(0);
    } finally {
      releaseSave();
    }
  });
}

test("a failed decision save keeps the note and never displays recorded feedback", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Failed Decision Receipt", owner: "", tags: [] });
  await page.route(`**/api/referrals/${referral.id}/decision`, (route) => route.fulfill({ status: 503, json: { error: "Synthetic save interruption" } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  await panel.getByRole("radio", { name: "Accept", exact: true }).check();
  await panel.getByLabel("Reason (optional)", { exact: true }).fill("Keep this explanation if the save fails.");
  await panel.getByRole("button", { name: "Record decision", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Record acceptance", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Could not confirm whether the decision was saved");
  await expect(page.locator('[role="status"][data-outcome]')).toHaveCount(0);
  await expect(panel.getByLabel("Reason (optional)", { exact: true })).toHaveValue("Keep this explanation if the save fails.");
  expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
});

for (const outcome of ["Deny", "Under review"] as const) {
  test(`${outcome} saves without suggesting an admission handoff`, async ({ page }) => {
    if (outcome === "Under review") await page.setViewportSize({ width: 390, height: 844 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Decision Followup", owner: "", tags: [] });
    let emailRequests = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/under-review-email")) emailRequests++; });
    await createOperationalAssessment(page.request, referral.id);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await panel.getByRole("radio", { name: outcome, exact: true }).check();
    await panel.getByRole("textbox").fill("Synthetic follow-up note.");
    await panel.getByRole("button", { name: outcome === "Deny" ? "Record decision" : "Save under review", exact: true }).click();
    if (outcome === "Deny") await page.getByRole("alertdialog").getByRole("button", { name: "Record denial", exact: true }).click();
    if (outcome === "Under review") {
      const email = page.getByRole("dialog", { name: "Under Review email" });
      await expect(email).toBeVisible();
      await expect(email.getByText("andrew@aaahealthservices.com; sandeep@aaahealthservices.com")).toBeVisible();
      await expect(email.getByLabel("Message")).toContainText("Synthetic follow-up note.");
      // Evaluate the rendered dialog after its entry fade, not a partially transparent frame.
      await email.evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined))));
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
        return (await axe.run('[aria-label="Under Review email"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
      });
      expect(violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(emailRequests).toBe(0);
      await email.getByLabel("Message").fill("Synthetic extra context for Andrew and Sandeep.");
      await email.getByRole("button", { name: "Send email" }).click();
      await expect(email.getByRole("alert")).toContainText("Email is not configured here");
      expect(emailRequests).toBe(1);
      await email.getByRole("button", { name: "Not now" }).click();
      await expect(email).toHaveCount(0);
    }
    await expect(panel.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Review email & packet" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Change stage to/ })).not.toBeVisible();
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
      await expect(page.getByRole("dialog", { name: "Under Review email" })).toBeVisible();
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

test("Meet the Client stays visible when Placement status cannot load", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Placement Fallback", owner: "", tags: [] });
  await page.route(`**/api/referrals/${referral.id}/workflow`, (route) => route.fulfill({ status: 503, json: { error: "Synthetic status interruption" } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const placement = page.getByRole("region", { name: "Handoff follow-through" });
  await expect(placement.getByRole("button", { name: "Retry status" })).toBeVisible();
  await expect(placement.getByRole("region", { name: "Email and referral packet" })).toBeVisible();
});

test("Meet the Client remains usable while Placement status is loading", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Slow Placement", owner: "", tags: [] });
  let releaseWorkflow!: () => void;
  const heldWorkflow = new Promise<void>((resolve) => { releaseWorkflow = resolve; });
  await page.route(`**/api/referrals/${referral.id}/workflow`, async (route) => {
    await heldWorkflow;
    await route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
    const placement = page.getByRole("region", { name: "Handoff follow-through" });
    await expect(placement.getByText("Loading handoff status…")).toBeVisible();
    await expect(placement.getByRole("region", { name: "Email and referral packet" })).toBeVisible();
  } finally {
    releaseWorkflow();
  }
});

test("the decision page keeps one assessment summary and records the decision without sending the packet", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Progress Milestones", owner: "", tags: [] });
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  let assessment = await createOperationalAssessment(page.request, referral.id);
  assessment = await scheduleOperationalAssessment(page.request, assessment);
  assessment = await startOperationalAssessment(page.request, assessment);

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  const context = panel.getByRole("complementary", { name: "Decision context" });
  await expect(context).toContainText("Open the assessment to review or continue it.");
  await expect(context.getByRole("list")).toHaveCount(0);

  assessment = await completeOperationalAssessment(page.request, assessment);
  assessment = await markOperationalInterviewComplete(page.request, assessment);
  await page.reload();
  await expect(context).toContainText("Open the assessment to review or continue it.");

  await signOperationalAssessment(page.request, assessment);
  await page.reload();
  await expect(context).toContainText("Signed and ready for the decision.");

  await panel.getByRole("radio", { name: "Accept", exact: true }).check();
  await panel.getByRole("button", { name: "Record decision", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Record acceptance", exact: true }).click();
  const placement = page.getByRole("region", { name: "Handoff follow-through" });
  await expect(placement.getByRole("heading", { name: "Meet the Client", level: 2, exact: true })).toBeVisible();
  await expect(placement).toContainText("Accepted · Not sent");
  const workflow = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
  expect(workflow.context.packetSentAt ?? null).toBeNull();
  expect(sends).toBe(0);
});

test("the working decision can be confirmed or changed with its original attribution", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Recommended Referral", owner: "", tags: [] });
  let assessment = await createOperationalAssessment(page.request, referral.id);
  assessment = await startOperationalAssessment(page.request, assessment);
  await submitOperationalRecommendation(page.request, await readOperationalReferral(page.request, referral.id), assessment);

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  await expect(panel.getByRole("heading", { name: "Accept", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Record acceptance", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Change", exact: true }).click();
  const recommendation = panel.getByRole("region", { name: "Recommendation on file", exact: true });
  await expect(recommendation).toContainText("Accept");
  const { user } = await (await page.request.get("/api/auth/me")).json();
  await expect(recommendation).toContainText(user.name);
  await expect(recommendation).toContainText(/\w{3} \d{1,2}, \d{4}/);
  await expect(recommendation).toContainText("It becomes final only when you record the decision.");
  await expect(panel.getByRole("radio", { name: "Accept", exact: true })).toBeChecked();
  await expect(panel.getByRole("heading", { name: "Accepted", exact: true })).toHaveCount(0);
  expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
});

test("administrative stage controls are separate, labeled, and only change the stage", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Administrative Controls", owner: "", tags: [] });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toHaveAttribute("aria-describedby", "decision-action-hint");
  await expect(panel.locator("#decision-action-hint")).toHaveText("Choose Accept, Deny, or Under review to continue.");
  await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeDisabled();
  await expect(panel.getByRole("combobox", { name: "Workflow stage" })).not.toBeVisible();

  await panel.getByRole("button", { name: "Decision settings" }).click();
  await page.getByRole("dialog", { name: "Decision settings" }).locator("summary").filter({ hasText: /^Administrative controls$/ }).click();
  await expect(panel).toContainText("They do not record the decision, sign the assessment, or send anything.");
  await panel.getByRole("combobox", { name: "Workflow stage", exact: true }).selectOption("Assessment");
  await expect(panel.getByText("Stage changed to Assessment", { exact: true })).toBeVisible();
  const after = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
  expect(after.referral.stage).toBe("Assessment");
  expect(after.decision).toBeNull();
  expect(after.context.assessmentSigned ?? false).toBeFalsy();
  expect(after.context.packetSentAt ?? null).toBeNull();
});

/** The interview appointment is completed through scheduling; signing is a separate action. */
async function markOperationalInterviewComplete(request: APIRequestContext, assessment: { assessment_id: string; version: number }) {
  const response = await request.post(`/api/assessments/${assessment.assessment_id}/schedule`, {
    data: {
      if_match: assessment.version,
      client_mutation_id: `interview-complete-${assessment.assessment_id}-${Date.now()}`,
      schedule: { status: "completed", start_at: new Date(Date.now() - 60 * 60 * 1_000).toISOString(), duration_minutes: 60, method: "in_person", location: "Synthetic room" },
    },
  });
  expect(response.status(), (await response.text()).slice(0, 300)).toBe(200);
  return asAssessmentPayload(await response.json());
}


test("pending Placement has one next action and preserves both assessment and decision navigation", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Placement Navigation", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  const emailUrl = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  await page.goto(emailUrl);
  const readiness = page.getByRole("region", { name: "Handoff readiness", exact: true });
  await expect(page.getByRole("heading", { name: "Placement follows an accepted decision", exact: true })).toHaveCount(0);
  await expect(readiness.getByRole("button", { name: "Review & sign assessment", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open decision", exact: true })).toHaveCount(1);
  await readiness.getByRole("button", { name: "Open decision", exact: true }).click();
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
  await page.goto(emailUrl);
  await readiness.getByRole("button", { name: "Review & sign assessment", exact: true }).click();
  await expect(page.getByRole("region", { name: "Assessment chart review", exact: true })).toBeVisible();
  await signOperationalAssessment(page.request, assessment);
  await page.goto(emailUrl);
  await expect(readiness.getByRole("button", { name: "Open decision", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open decision", exact: true })).toHaveCount(1);
  await expect(readiness.getByRole("button", { name: "Review & sign assessment", exact: true })).toHaveCount(0);
  expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
  expect(sends).toBe(0);
});

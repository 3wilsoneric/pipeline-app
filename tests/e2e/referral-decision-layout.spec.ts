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
    await expect(panel.getByRole("complementary", { name: "Decision context" })).toContainText("Answers not started");
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
    await panel.getByRole("button", { name: "Record decision", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(panel.getByRole("radio", { name: "Accept", exact: true })).toBeChecked();
    expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
    await panel.getByRole("button", { name: "Record decision", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Record acceptance", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
    await expect(panel.getByRole("group", { name: "Recorded decision", exact: true })).toBeFocused();
    await expect(panel.getByRole("region", { name: "Prepare client handoff" })).toContainText("Sign the assessment before sending");
    await expect(panel.getByRole("button", { name: "Review email & packet", exact: true })).toBeDisabled();
    await expect(panel).toContainText("An admit date is required before reviewing the email and packet.");
    await expectAccessibleDecision(page);
    await page.screenshot({ path: info.outputPath(`accepted-${width}.png`), animations: "disabled" });
    await page.reload();
    await expect(panel.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
    await expect(panel).toContainText("Synthetic placement decision for UI testing only.");
    await panel.getByLabel("Planned admission date", { exact: true }).fill("2026-10-01");
    await expect(panel.getByRole("button", { name: "Review email & packet", exact: true })).toBeEnabled();
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
    await panel.getByRole("button", { name: outcome === "Deny" ? "Record decision" : "Save under review", exact: true }).click();
    if (outcome === "Deny") await page.getByRole("alertdialog").getByRole("button", { name: "Record denial", exact: true }).click();
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

test("the decision page distinguishes saved answers, interview complete, signed, decision recorded, and packet sent", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Progress Milestones", owner: "", tags: [] });
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  let assessment = await createOperationalAssessment(page.request, referral.id);
  assessment = await scheduleOperationalAssessment(page.request, assessment);
  assessment = await startOperationalAssessment(page.request, assessment);

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  const context = panel.getByRole("complementary", { name: "Decision context" });
  const progress = context.getByRole("list", { name: "Where this referral stands" });
  await expect(progress).toContainText("Answers saved");
  await expect(progress).toContainText("Interview not complete");
  await expect(progress).toContainText("Assessment not signed");
  await expect(progress).toContainText("Decision not recorded");
  await expect(progress).toContainText("Meet the Client packet not sent");

  assessment = await completeOperationalAssessment(page.request, assessment);
  assessment = await markOperationalInterviewComplete(page.request, assessment);
  await page.reload();
  await expect(progress).toContainText("Answers saved");
  await expect(progress).toContainText("Interview complete");
  await expect(progress).toContainText("Assessment not signed");

  await signOperationalAssessment(page.request, assessment);
  await page.reload();
  await expect(progress).toContainText("Assessment signed");
  await expect(progress).toContainText("Decision not recorded");

  await panel.getByRole("radio", { name: "Accept", exact: true }).check();
  await panel.getByRole("button", { name: "Record decision", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Record acceptance", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
  await expect(progress).toContainText("Decision recorded: Accepted");
  await expect(progress).toContainText("Playwright QA");
  await expect(progress).toContainText("Meet the Client packet not sent");
  const workflow = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
  expect(workflow.context.packetSentAt ?? null).toBeNull();
  expect(sends).toBe(0);
});

test("the recommendation sits beside the final decision, attributed and dated", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Recommended Referral", owner: "", tags: [] });
  let assessment = await createOperationalAssessment(page.request, referral.id);
  assessment = await startOperationalAssessment(page.request, assessment);
  await submitOperationalRecommendation(page.request, await readOperationalReferral(page.request, referral.id), assessment);

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  const recommendation = panel.getByRole("region", { name: "Recommendation on file", exact: true });
  await expect(recommendation).toContainText("Accept");
  await expect(recommendation).toContainText("Playwright QA");
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
  await expect(panel.getByText("Choose Accept, Deny, or Under review to continue.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeDisabled();
  await expect(panel.getByRole("combobox", { name: "Workflow stage" })).not.toBeVisible();

  await panel.locator("summary").filter({ hasText: /^Administrative controls$/ }).click();
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

import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";

test("signing finishes before workspace navigation can change the active step", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic signing transition", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { entered = resolve; });
  await page.route(`**/api/assessments/${assessment.assessment_id}/sign`, async (route) => {
    entered();
    await pending;
    await route.continue();
  });
  await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Sign this assessment?", exact: true }).getByRole("button", { name: "Sign assessment", exact: true }).click();
  await requested;
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  try {
    await stages.getByRole("button", { name: "Chart", exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
    await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Open calendar", exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
    await expect(page).not.toHaveURL(/screen=calendar/);
  } finally { release(); }
  await expect(stages.getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("aria-current", "page");
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.signed_at).toBeTruthy();
  expect(saved.audit_events.filter((event: { action: string }) => event.action === "assessment_signed")).toHaveLength(1);
});

test("leaving Decision saves the admission date", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic decision transition", owner: "", tags: [] });
  await signOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  const current = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  await recordOperationalAcceptance(page.request, current);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const decision = page.getByRole("region", { name: "Admission decision", exact: true });
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  await decision.getByLabel("Planned admission date", { exact: true }).fill("2026-11-12");
  const saveRoute = `**/api/referrals/${referral.id}`;
  await page.route(saveRoute, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Synthetic date save interruption" } }) : route.continue());
  await stages.getByRole("button", { name: "Finish & send", exact: true }).click();
  await expect(decision.getByRole("alert")).toContainText("could not be saved");
  await expect(decision.getByLabel("Planned admission date", { exact: true })).toHaveValue("2026-11-12");
  await expect(stages.getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("aria-current", "page");
  await page.unroute(saveRoute);
  await stages.getByRole("button", { name: "Finish & send", exact: true }).click();
  await expect(stages.getByRole("button", { name: "Finish & send", exact: true })).toHaveAttribute("aria-current", "page");
  expect((await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.plannedAdmissionDate).toBe("2026-11-12");
  await stages.getByRole("button", { name: "Decision", exact: true }).click();
  await expect(decision.getByLabel("Planned admission date", { exact: true })).toHaveValue("2026-11-12");
});

test("unrecorded decisions stay open unless their changes are explicitly discarded", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic unrecorded decision", owner: "", tags: [] });
  await signOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const decision = page.getByRole("region", { name: "Admission decision", exact: true });
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  await decision.getByRole("radio", { name: "Deny", exact: true }).check();
  await decision.getByLabel("Reason (optional)").fill("Synthetic unrecorded decision note");
  await stages.getByRole("button", { name: "Assessment", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Leave without recording these changes?", exact: true }).getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(decision.getByLabel("Reason (optional)")).toHaveValue("Synthetic unrecorded decision note");
  await expect(decision.getByRole("alert")).toContainText("Record");
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Leave without recording these changes?", exact: true }).getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: "View assessment", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Leave without recording these changes?", exact: true }).getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
  expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
});

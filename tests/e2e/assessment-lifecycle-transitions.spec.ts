import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";

test("replays an interrupted assessment create without making a second draft", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic assessment create retry", owner: "Annette Everhart", dob: "1980-04-12",
  }, { assigneeId: "provisional:allo:annette" });
  const mutationIds: string[] = [];
  await page.route(`**/api/referrals/${referral.id}/assessments`, async (route) => {
    if (route.request().method() === "POST") {
      mutationIds.push((route.request().postDataJSON() as { client_mutation_id: string }).client_mutation_id);
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (mutationIds.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    } else {
      await route.continue();
    }
  });

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Assessment", exact: true }).click();
  await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[1]).toBe(mutationIds[0]);
  const saved = await page.request.get(`/api/referrals/${referral.id}/assessments`);
  expect(saved.ok()).toBe(true);
  expect((await saved.json()).assessments).toHaveLength(1);
});

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

test("a lost sign response replays one signature with the same mutation ID", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic signature replay", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const mutationIds: string[] = [];
  await page.route(`**/api/assessments/${assessment.assessment_id}/sign`, async (route) => {
    mutationIds.push((route.request().postDataJSON() as { client_mutation_id: string }).client_mutation_id);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (mutationIds.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Sign this assessment?", exact: true }).getByRole("button", { name: "Sign assessment", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("aria-current", "page");
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[1]).toBe(mutationIds[0]);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.audit_events.filter((event: { action: string }) => event.action === "assessment_signed")).toHaveLength(1);
});

for (const width of [1440, 390]) test(`a slow appointment save does not trap the assessor at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic schedule navigation", owner: "", tags: [],
  });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { entered = resolve; });
  let requests = 0;
  await page.route(`**/api/assessments/${assessment.assessment_id}/schedule`, async (route) => {
    requests += 1;
    entered();
    await pending;
    await route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
    await page.getByRole("button", { name: "Schedule interview", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await dialog.getByLabel("Assessment date and time", { exact: true }).fill("2026-10-12T10:30");
    await dialog.getByLabel("Assessment method", { exact: true }).selectOption("record_review");
    await dialog.getByRole("button", { name: "Schedule record review", exact: true }).click();
    await requested;
    await expect(dialog.getByRole("button", { name: "Back to assessment", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Back to assessment", exact: true }).click();
    if (width < 640) {
      await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption("files");
    } else {
      await page.getByRole("button", { name: "Workspace files", exact: true }).click();
    }
    await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
    await expect(page.getByText("Assessment appointment saving…")).toBeVisible();
    release();
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.scheduled_start_at).toBeTruthy();
    await expect(page.getByText("Assessment appointment saving…")).toHaveCount(0);
    expect(requests).toBe(1);
  } finally {
    release();
  }
});

test("a failed appointment save stays visible and retryable after visiting Files", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic schedule retry", owner: "", tags: [],
  });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { entered = resolve; });
  let fail = true;
  let requests = 0;
  await page.route(`**/api/assessments/${assessment.assessment_id}/schedule`, async (route) => {
    requests += 1;
    if (!fail) return route.continue();
    entered();
    await pending;
    return route.fulfill({ status: 503, json: { error: "Synthetic appointment save interruption" } });
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
    await page.getByRole("button", { name: "Schedule interview", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await dialog.getByLabel("Assessment date and time", { exact: true }).fill("2026-10-13T11:30");
    await dialog.getByLabel("Assessment method", { exact: true }).selectOption("record_review");
    await dialog.getByRole("button", { name: "Schedule record review", exact: true }).click();
    await requested;
    await dialog.getByRole("button", { name: "Back to assessment", exact: true }).click();
    await page.getByRole("button", { name: "Workspace files", exact: true }).click();
    release();
    await expect(page.getByText("Assessment needs attention. Check its save status.")).toBeVisible();
    expect((await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.scheduled_start_at).toBeFalsy();
    fail = false;
    await page.getByRole("button", { name: "Open Assessment", exact: true }).click();
    await expect(page.getByTestId("assessment-client-folder").getByRole("alert")).toContainText("Synthetic appointment save interruption");
    await page.getByRole("button", { name: "Schedule interview", exact: true }).click();
    await expect(dialog.getByLabel("Assessment date and time", { exact: true })).toHaveValue("2026-10-13T11:30");
    await dialog.getByRole("button", { name: "Schedule record review", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.scheduled_start_at).toBeTruthy();
    expect(requests).toBe(2);
  } finally {
    release();
  }
});

test("a failed referral refresh after signing does not reopen the signature or block Decision", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic signed refresh failure", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  let signed = false;
  let failedRefreshes = 0;
  await page.route(`**/api/referrals/${referral.id}/canvas`, (route) => {
    if (!signed || route.request().method() !== "GET") return route.continue();
    failedRefreshes += 1;
    return route.fulfill({ status: 503, json: { error: "Synthetic referral refresh unavailable" } });
  });
  await page.route(`**/api/assessments/${assessment.assessment_id}/sign`, async (route) => {
    const response = await route.fetch();
    signed = response.ok();
    await route.fulfill({ response });
  });

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Sign this assessment?", exact: true }).getByRole("button", { name: "Sign assessment", exact: true }).click();

  await expect.poll(() => failedRefreshes).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("aria-current", "page");
  expect(signed).toBe(true);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.signed_at).toBeTruthy();
  expect(saved.audit_events.filter((event: { action: string }) => event.action === "assessment_signed")).toHaveLength(1);
});

test("Finish & send saves the admission date before moving forward", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic decision transition", owner: "", tags: [] });
  await signOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  const current = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  await recordOperationalAcceptance(page.request, current);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const decision = page.getByRole("region", { name: "Admission decision", exact: true });
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  await decision.getByLabel("Planned admission date", { exact: true }).fill("2026-11-12");
  const saveRoute = `**/api/referrals/${referral.id}`;
  let attemptedSaves = 0;
  await page.route(saveRoute, (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    attemptedSaves += 1;
    return route.fulfill({ status: 503, json: { error: "Synthetic date save interruption" } });
  });
  await stages.getByRole("button", { name: "Finish & send", exact: true }).click();
  await expect(decision.getByRole("alert")).toContainText("Synthetic date save interruption");
  expect(attemptedSaves).toBe(1);
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
  await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
  await stages.getByRole("button", { name: "Decision", exact: true }).click();
  await expect(decision.getByLabel("Reason (optional)")).toHaveValue("Synthetic unrecorded decision note");
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Leave without recording these changes?", exact: true }).getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: "View assessment", exact: true }).click();
  await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Leave without recording these changes?", exact: true }).getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page).toHaveURL(/screen=calendar/);
  expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
});

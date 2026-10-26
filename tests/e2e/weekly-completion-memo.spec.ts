import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

const generatedAt = "2026-10-26T16:00:00.000Z";

async function setupMemo(page: Page, scope: "personal" | "team" = "personal") {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Memo test ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart", community: "Turlock",
  });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const client = {
    referral_id: referral.id, assessment_id: assessment.assessment_id, client_name: referral.name,
    community: "Turlock", owner: "Annette Everhart", status: "accepted", assessment_signed: false,
    tasks: [
      { id: "assessment:field:current_symptoms", group: "assessment", label: "Answer current symptoms", detail: "This required assessment answer is blank.", action: "Open question", location: { view: "assessment", assessmentMode: "interview", assessmentSection: "diagnosis_clinical", assessmentQuestion: "current_symptoms" } },
      { id: "assessment:field:cognition_orientation", group: "assessment", label: "Answer cognition / orientation", detail: "This required assessment answer is blank.", action: "Open question", location: { view: "assessment", assessmentMode: "interview", assessmentSection: "diagnosis_clinical", assessmentQuestion: "cognition_orientation" } },
      { id: "profile:county", group: "chart", label: "Record referring county", detail: "The referring county is blank in the chart.", action: "Open chart", location: { view: "intake", intakeField: "county" } },
    ],
  };
  const home = {
    generated_at: generatedAt, scope, viewer: { id: "weekly-assessor", name: "Weekly Assessor" },
    current_work: { total: 0, items: [] },
    workflow: {
      generated_at: generatedAt, active_total: 0, unassigned_total: 0, overall_completion_pct: null,
      flow_counts: { ready_to_schedule: 0, scheduled: 0, assessment: 0, complete_chart: 0 },
      active_items: [], board_items: [], all_board_items: [],
      ready_to_schedule: { total: 0, items: [] }, data_completion: { total: 0, items: [] },
      current_work: { generated_at: generatedAt, owner: { id: "weekly-assessor", name: "Weekly Assessor" }, total: 0, items: [] },
      completion_memo: { week_key: "2026-10-26", is_monday: true, scope, task_count: 3, clients: [client] },
    },
    upcoming: [], unscheduled: [], unscheduled_total: 0,
    continuity: { resume_items: [], new_assignments: [], assignment_tracking_started_at: null, needs_assignment_tracking_initialization: false, unavailable: false },
    unavailable_sections: [],
  };
  const initialTasks = [...client.tasks];
  await page.route("**/api/operations/home", async (route) => {
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    client.tasks = initialTasks.filter((task) => task.id === "profile:county"
      || task.id === "assessment:field:current_symptoms" && !saved.current_symptoms
      || task.id === "assessment:field:cognition_orientation" && !saved.cognition_orientation);
    home.workflow.completion_memo.task_count = home.workflow.completion_memo.clients.reduce((count, item) => count + item.tasks.length, 0);
    await route.fulfill({ json: home });
  });
  return { referral, assessment, client, home };
}

for (const width of [1440, 390]) {
  test(`Monday client opens the assessment with question-level hints at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date(generatedAt));
    const { referral, assessment } = await setupMemo(page);
    await page.goto("/?screen=completion");
    const list = page.getByRole("navigation", { name: "Clients in completion memo" });
    await expect(list.getByRole("button", { name: new RegExp(referral.name!) })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Current symptoms" })).toHaveCount(0);
    await list.getByRole("button", { name: new RegExp(referral.name!) }).click();
    await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}.*completionReview=${referral.id}|completionReview=${referral.id}.*referralId=${referral.id}`));
    await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
    const hint = page.locator("summary[aria-label='1 follow-up item for Current symptoms']");
    await expect(hint).toBeVisible();
    await hint.click();
    await expect(page.locator('[data-working-field="current_symptoms"]').getByText("This required assessment answer is blank.")).toBeVisible();
    const answer = page.getByRole("textbox", { name: "Current symptoms" });
    await answer.fill("Synthetic follow-up assessment answer.");
    await answer.blur();
    await expect(hint).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_symptoms)
      .toBe("Synthetic follow-up assessment answer.");
    const next = page.locator('summary[aria-label="1 follow-up item for Cognition / orientation"]');
    await expect(next).toBeInViewport();
    const nextAnswer = page.getByRole("textbox", { name: "Cognition / orientation" });
    if (width > 500) await expect(nextAnswer).toBeFocused();
    await nextAnswer.fill("Synthetic follow-up cognition answer.");
    await nextAnswer.blur();
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.cognition_orientation)
      .toBe("Synthetic follow-up cognition answer.");
    await expect(page.getByRole("status").filter({ hasText: "Assessment answers complete · 1 other item to review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open chart →" })).toBeVisible();
    await page.getByRole("button", { name: "Open chart →" }).click();
    await expect(page).toHaveURL(/workspaceField=county/);
  });
}

test("the Monday prompt is dismissible while the client list remains reachable", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  const { referral } = await setupMemo(page);
  await page.goto("/");
  const notice = page.getByRole("status", { name: "Completion memo" });
  await expect(notice).toBeVisible();
  await page.getByRole("tab", { name: "Board", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await notice.getByRole("button", { name: "Later" }).click();
  await page.reload();
  await expect(notice).toHaveCount(0);
  await page.getByRole("button", { name: /Open completion memo/ }).click();
  await expect(page.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: new RegExp(referral.name!) })).toBeVisible();
});

test("a coordinator can filter the client list by assessor", async ({ page }) => {
  const { client, home } = await setupMemo(page, "team");
  home.workflow.completion_memo.clients.push({ ...client, referral_id: client.referral_id + 1, client_name: "Other synthetic client", owner: "Another Assessor" });
  home.workflow.completion_memo.task_count += 2;
  await page.goto("/?screen=completion");
  const list = page.getByRole("navigation", { name: "Clients in completion memo" });
  await expect(list.getByRole("button", { name: /Other synthetic client/ })).toBeVisible();
  await page.getByLabel("Filter completion memo by assessor").selectOption("Another Assessor");
  await expect(list.getByRole("button", { name: /Other synthetic client/ })).toBeVisible();
  await expect(list.getByRole("button", { name: new RegExp(client.client_name!) })).toHaveCount(0);
});

test("a sent assessment opens the next sourced answer without resending Meet the Client", async ({ page }) => {
  const { referral, assessment, client, home } = await setupMemo(page);
  const signedResponse = await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, {
    data: { if_match: assessment.version, client_mutation_id: randomUUID() },
  });
  expect(signedResponse.status()).toBe(200);
  const signed = (await signedResponse.json()).assessment;
  let current = { ...signed, meet_client_sent_at: "2026-10-25T16:00:00.000Z", meet_client_sent_version: signed.version };
  client.assessment_signed = true;
  const initialTasks = [...client.tasks];
  const writes: string[] = [];
  await page.route(`**/api/referrals/${referral.id}/assessments*`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.assessments = body.assessments.map((item: { assessment_id: string }) => item.assessment_id === assessment.assessment_id ? current : item);
    await route.fulfill({ response, json: body });
  });
  await page.route(`**/api/assessments/${assessment.assessment_id}`, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { assessment: current } });
    const body = route.request().postDataJSON() as { patch: { data: Record<string, string>; post_send_review?: { field: string; source: string } } };
    expect(body.patch.post_send_review?.source).toBe("Synthetic interview note");
    writes.push(body.patch.post_send_review!.field);
    current = { ...current, ...body.patch.data, version: current.version + 1 };
    await route.fulfill({ json: { assessment: current } });
  });
  await page.route("**/api/operations/home", async (route) => {
    client.tasks = initialTasks.filter((task) => task.id === "profile:county"
      || task.id === "assessment:field:current_symptoms" && !current.current_symptoms
      || task.id === "assessment:field:cognition_orientation" && !current.cognition_orientation);
    home.workflow.completion_memo.task_count = client.tasks.length;
    await route.fulfill({ json: home });
  });
  await page.goto("/?screen=completion");
  await page.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: new RegExp(referral.name!) }).click();
  await page.locator('summary[aria-label="1 follow-up item for Current symptoms"]').click();
  await page.getByRole("button", { name: "Add answer" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add assessment answer" });
  await expect(dialog.getByRole("heading", { name: "Answer current symptoms" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Current symptoms" }).fill("Synthetic post-send symptoms.");
  await dialog.getByRole("textbox", { name: "Where did this added answer come from?" }).fill("Synthetic interview note");
  await dialog.getByRole("button", { name: "Add to assessment" }).click();
  await expect(dialog.getByRole("heading", { name: "Answer cognition / orientation" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Cognition / orientation" }).fill("Synthetic post-send cognition.");
  await dialog.getByRole("textbox", { name: "Where did this added answer come from?" }).fill("Synthetic interview note");
  await dialog.getByRole("button", { name: "Add to assessment" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Assessment answers complete · 1 other item to review" })).toBeVisible();
  expect(writes).toEqual(["current_symptoms", "cognition_orientation"]);
  expect(current.meet_client_sent_version).toBe(signed.version);
});

test("an unconfirmed save stays on the current follow-up answer", async ({ page }) => {
  const { referral, assessment } = await setupMemo(page);
  await page.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } }) : route.continue());
  await page.goto("/?screen=completion");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/referrals/${referral.id}/assessments`) && response.request().method() === "GET"),
    page.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: new RegExp(referral.name!) }).click(),
  ]);
  await expect(page.locator('summary[aria-label="1 follow-up item for Current symptoms"]')).toBeVisible();
  const failedSave = page.waitForResponse((response) => response.url().endsWith(`/api/assessments/${assessment.assessment_id}`)
    && response.request().method() === "PATCH" && response.status() === 503);
  const answer = page.getByRole("textbox", { name: "Current symptoms" });
  await answer.fill("Synthetic answer awaiting confirmation.");
  await expect(answer).toHaveValue("Synthetic answer awaiting confirmation.");
  await answer.blur();
  await failedSave;
  await expect(page.getByText("Waiting to sync", { exact: true })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_symptoms).toBeNull();
  await expect(page.getByRole("textbox", { name: "Cognition / orientation" })).not.toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Assessment answers complete" })).toHaveCount(0);
});

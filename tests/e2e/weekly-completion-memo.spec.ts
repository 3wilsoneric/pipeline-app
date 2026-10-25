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
      completion_memo: { week_key: "2026-10-26", is_monday: true, scope, task_count: 2, clients: [client] },
    },
    upcoming: [], unscheduled: [], unscheduled_total: 0,
    continuity: { resume_items: [], new_assignments: [], assignment_tracking_started_at: null, needs_assignment_tracking_initialization: false, unavailable: false },
    unavailable_sections: [],
  };
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
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
    await expect(page.getByText("This required assessment answer is blank.")).toBeVisible();
    const answer = page.getByRole("textbox", { name: "Current symptoms" });
    await answer.fill("Synthetic follow-up assessment answer.");
    await answer.blur();
    await expect(hint).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_symptoms)
      .toBe("Synthetic follow-up assessment answer.");
  });
}

test("the Monday prompt is dismissible while the client list remains reachable", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  const { referral } = await setupMemo(page);
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Later" }).click();
  await page.reload();
  await expect(dialog).toHaveCount(0);
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

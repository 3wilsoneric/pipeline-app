import { expect, test } from "@playwright/test";

const generatedAt = "2026-10-26T16:00:00.000Z";
const viewer = { id: "weekly-assessor", name: "Weekly Assessor" };
const memo = {
  week_key: "2026-10-26",
  is_monday: true,
  scope: "personal",
  task_count: 3,
  clients: [{
    referral_id: 23,
    assessment_id: "asm_memo_23",
    client_name: "Synthetic Memo Client",
    community: "Turlock",
    owner: viewer.name,
    status: "accepted",
    assessment_signed: false,
    tasks: [
      { id: "requirement:med", group: "follow_through", label: "Find or add medication list", detail: "No file is linked to this item. Check Files for an existing copy before uploading another one.", action: "Open files", location: { view: "files" } },
      { id: "profile:dob", group: "chart", label: "Record date of birth", detail: "This field is blank in the referral chart.", action: "Open chart", location: { view: "intake", intakeField: "dob" } },
      { id: "assessment:field:current_symptoms", group: "assessment", label: "Answer current symptoms", detail: "This required assessment answer is blank.", action: "Open question", location: { view: "assessment", assessmentMode: "interview", assessmentSection: "diagnosis_clinical", assessmentQuestion: "current_symptoms" } },
    ],
  }],
};
const home = {
  generated_at: generatedAt,
  scope: "personal",
  viewer,
  current_work: { total: 0, items: [] },
  workflow: {
    generated_at: generatedAt, active_total: 0, unassigned_total: 0, overall_completion_pct: null,
    flow_counts: { ready_to_schedule: 0, scheduled: 0, assessment: 0, complete_chart: 0 },
    active_items: [], board_items: [], all_board_items: [],
    ready_to_schedule: { total: 0, items: [] }, data_completion: { total: 0, items: [] },
    current_work: { generated_at: generatedAt, owner: viewer, total: 0, items: [] },
    completion_memo: memo,
  },
  upcoming: [], unscheduled: [], unscheduled_total: 0,
  continuity: {
    resume_items: [], new_assignments: [], assignment_tracking_started_at: null,
    needs_assignment_tracking_initialization: false, unavailable: false,
  },
  unavailable_sections: [],
};

test("Monday memo opens once per week, stays reachable, and takes staff to the exact fix", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Synthetic Memo Client" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Find or add medication list" })).toBeVisible();
  await expect(dialog.getByLabel("Choose item to review")).toBeVisible();
  await dialog.getByRole("button", { name: "Close completion memo" }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: /Open completion memo/ })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: /Open completion memo/ }).click();
  await dialog.getByRole("button", { name: "Open files" }).click();
  await expect(page).toHaveURL(/referralId=23.*workspaceView=files/);
});

test("the memo keeps its task actions reachable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.route("**/api/referrals/23", (route) => route.fulfill({ json: { referral: { id: 23, version: 1, dob: "", name: "Synthetic Memo Client", community: "Turlock" } } }));
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await expect(dialog.getByRole("heading", { name: "Synthetic Memo Client" })).toBeVisible();
  await dialog.getByLabel("Choose item to review").selectOption("profile:dob");
  await dialog.getByRole("button", { name: "Open full record" }).click();
  await expect(page).toHaveURL(/referralId=23.*workspaceField=dob/);
});

test("an assessment gap opens its exact interview question", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.route("**/api/assessments/asm_memo_23", (route) => route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 1, current_symptoms: null, unable_to_assess_reasons: {}, meet_client_sent_at: null } } }));
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await dialog.getByLabel("Choose item to review").selectOption("assessment:field:current_symptoms");
  await dialog.getByRole("button", { name: "Open full record" }).click();
  await expect(page).toHaveURL(/referralId=23.*assessmentQuestion=current_symptoms/);
});

test("an assessor can save one missing answer without opening the full assessment", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.route("**/api/assessments/asm_memo_23", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      expect(body.if_match).toBe(4);
      expect(body.patch.data.current_symptoms).toBe("Reported anxiety during interview.");
      await route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 5, current_symptoms: body.patch.data.current_symptoms, unable_to_assess_reasons: {}, meet_client_sent_at: null } } });
    } else {
      await route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 4, current_symptoms: null, unable_to_assess_reasons: {}, meet_client_sent_at: null } } });
    }
  });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await dialog.getByLabel("Choose item to review").selectOption("assessment:field:current_symptoms");
  await dialog.getByRole("textbox", { name: "Current symptoms" }).fill("Reported anxiety during interview.");
  await dialog.getByRole("button", { name: "Save answer" }).click();
  await expect(dialog.getByText("Answer saved to the assessment with its change history.")).toBeVisible();
});

test("a sent assessment receives an attributed correction without replacing its original answer", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.route("**/api/assessments/asm_memo_23", (route) => route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 9, current_symptoms: null, unable_to_assess_reasons: {}, signed_at: generatedAt, meet_client_sent_at: generatedAt } } }));
  let posted = false;
  await page.route("**/api/assessments/asm_memo_23/addenda", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.if_match).toBe(9);
    expect(body.reason_code).toBe("completion_review:current_symptoms");
    expect(body.note).toContain("Answer: Reported anxiety during interview.");
    expect(body.note).toContain("Source or reason: Interview notes");
    posted = true;
    await route.fulfill({ status: 201, json: { assessment: { assessment_id: "asm_memo_23", version: 10, current_symptoms: null, unable_to_assess_reasons: {}, signed_at: generatedAt, meet_client_sent_at: generatedAt } } });
  });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await dialog.getByLabel("Choose item to review").selectOption("assessment:field:current_symptoms");
  await dialog.getByRole("textbox", { name: "Current symptoms" }).fill("Reported anxiety during interview.");
  await dialog.getByRole("textbox", { name: /Where did this answer come from/ }).fill("Interview notes");
  await dialog.getByRole("button", { name: "Add correction" }).click();
  await expect(dialog.getByText(/Correction added to the signed assessment/)).toBeVisible();
  expect(posted).toBe(true);
});

test("a coordinator can filter the combined queue by assessor", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  const teamHome = structuredClone(home);
  teamHome.workflow.completion_memo.scope = "team";
  teamHome.workflow.completion_memo.clients.push({
    ...structuredClone(memo.clients[0]),
    referral_id: 24,
    client_name: "Second Synthetic Client",
    owner: "Another Assessor",
  });
  teamHome.workflow.completion_memo.task_count += 3;
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: teamHome }));
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await expect(dialog.getByRole("button", { name: /Second Synthetic Client/ })).toBeVisible();
  await dialog.getByLabel("Filter completion memo by assessor").selectOption("Another Assessor");
  await expect(dialog.getByRole("button", { name: /Second Synthetic Client/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Synthetic Memo Client/ })).toHaveCount(0);
});

test("a chart gap saves through the versioned referral route", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  let saved = false;
  await page.route("**/api/referrals/23", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      expect(body.if_match).toBe(6);
      expect(body.patch).toEqual({ dob: "1970-01-02" });
      saved = true;
      await route.fulfill({ json: { referral: { id: 23, version: 7, dob: "1970-01-02", name: "Synthetic Memo Client", community: "Turlock" } } });
    } else {
      await route.fulfill({ json: { referral: { id: 23, version: 6, dob: "", name: "Synthetic Memo Client", community: "Turlock" } } });
    }
  });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await dialog.getByLabel("Choose item to review").selectOption("profile:dob");
  await dialog.getByLabel("date of birth").fill("1970-01-02");
  await dialog.getByRole("button", { name: "Save answer" }).click();
  await expect(dialog.getByText("Chart value saved with its change history.")).toBeVisible();
  expect(saved).toBe(true);
});

test("a concurrent assessment edit keeps the assessor's draft for explicit review", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  let attempts = 0;
  await page.route("**/api/assessments/asm_memo_23", async (route) => {
    if (route.request().method() === "PATCH") {
      attempts += 1;
      const body = route.request().postDataJSON();
      if (attempts === 1) {
        expect(body.if_match).toBe(4);
        await route.fulfill({ status: 409, json: { error: "Record changed", assessment: { assessment_id: "asm_memo_23", version: 5, current_symptoms: "New answer from another assessor.", unable_to_assess_reasons: {}, meet_client_sent_at: null } } });
      } else {
        expect(body.if_match).toBe(5);
        await route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 6, current_symptoms: body.patch.data.current_symptoms, unable_to_assess_reasons: {}, meet_client_sent_at: null } } });
      }
    } else {
      await route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 4, current_symptoms: null, unable_to_assess_reasons: {}, meet_client_sent_at: null } } });
    }
  });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await dialog.getByLabel("Choose item to review").selectOption("assessment:field:current_symptoms");
  const answer = dialog.getByRole("textbox", { name: "Current symptoms" });
  await answer.fill("My interview answer.");
  await dialog.getByRole("button", { name: "Save answer" }).click();
  await expect(dialog.getByText("Latest saved value: New answer from another assessor.")).toBeVisible();
  await expect(answer).toHaveValue("My interview answer.");
  await expect(dialog.getByRole("button", { name: "Save answer" })).toBeDisabled();
  await dialog.getByRole("button", { name: "I reviewed the latest value; let me save my entry" }).click();
  await dialog.getByRole("button", { name: "Save answer" }).click();
  await expect(dialog.getByText("Answer saved to the assessment with its change history.")).toBeVisible();
  expect(attempts).toBe(2);
});

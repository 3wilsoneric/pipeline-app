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

async function openReview(page: import("@playwright/test").Page) {
  await page.getByRole("dialog", { name: "Completion memo" }).getByRole("button", { name: "Review items" }).click();
  const review = page.getByRole("main", { name: "Completion memo review" });
  await expect(review).toBeVisible();
  await expect(page).toHaveURL(/screen=completion/);
  await expect(review.getByRole("region", { name: "Synthetic Memo Client issues" })).toHaveCount(0);
  await review.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: /Synthetic Memo Client/ }).click();
  return review;
}

test("Monday memo opens once per week, stays reachable, and takes staff to the exact fix", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Your Monday follow-up" })).toBeVisible();
  await dialog.getByRole("button", { name: "Later" }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: /Open completion memo/ })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: /Open completion memo/ }).click();
  const review = page.getByRole("main", { name: "Completion memo review" });
  await expect(review.getByRole("region", { name: "Synthetic Memo Client issues" })).toHaveCount(0);
  await review.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: /Synthetic Memo Client/ }).click();
  await expect(review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Find or add medication list/ })).toBeVisible();
  await expect(review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Record date of birth/ })).toBeVisible();
  await expect(review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Answer current symptoms/ })).toBeVisible();
  const client = review.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: /Synthetic Memo Client/ });
  await expect(client).toHaveAttribute("aria-expanded", "true");
  await client.click();
  await expect(review.getByRole("region", { name: "Synthetic Memo Client issues" })).toHaveCount(0);
  await client.click();
  await review.getByRole("button", { name: "Open files" }).click();
  await expect(page).toHaveURL(/referralId=23.*workspaceView=files/);
});

test("the memo keeps its task actions reachable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.route("**/api/referrals/23", (route) => route.fulfill({ json: { referral: { id: 23, version: 1, dob: "", name: "Synthetic Memo Client", community: "Turlock" } } }));
  await page.goto("/");
  const review = await openReview(page);
  await expect(review.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: /Synthetic Memo Client/ })).toHaveAttribute("aria-expanded", "true");
  await review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Record date of birth/ }).click();
  await review.getByRole("button", { name: "Open full record" }).click();
  await expect(page).toHaveURL(/referralId=23.*workspaceField=dob/);
});

test("the review page lists every issue on a direct visit and keeps an unsaved answer when switching is cancelled", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.route("**/api/assessments/asm_memo_23", (route) => route.fulfill({ json: { assessment: {
    assessment_id: "asm_memo_23", version: 4, current_symptoms: null, unable_to_assess_reasons: {}, meet_client_sent_at: null,
  } } }));
  await page.goto("/?screen=completion");
  const review = page.getByRole("main", { name: "Completion memo review" });
  await expect(review.getByRole("region", { name: "Synthetic Memo Client issues" })).toHaveCount(0);
  await review.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: /Synthetic Memo Client/ }).click();
  const issues = review.getByRole("region", { name: "Synthetic Memo Client issues" });
  await expect(issues.getByRole("button", { name: /Record date of birth/ })).toBeVisible();
  await expect(issues.getByRole("button", { name: /Answer current symptoms/ })).toBeVisible();
  await expect(issues.getByRole("button", { name: /Find or add medication list/ })).toBeVisible();
  await issues.getByRole("button", { name: /Answer current symptoms/ }).click();
  const answer = review.getByRole("textbox", { name: "Current symptoms" });
  await answer.fill("Working answer that is not saved yet.");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Discard the unsaved answer");
    await dialog.dismiss();
  });
  await issues.getByRole("button", { name: /Record date of birth/ }).click();
  await expect(answer).toHaveValue("Working answer that is not saved yet.");
});

test("an assessment gap opens its exact interview question", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  await page.route("**/api/assessments/asm_memo_23", (route) => route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 1, current_symptoms: null, unable_to_assess_reasons: {}, meet_client_sent_at: null } } }));
  await page.goto("/");
  const review = await openReview(page);
  await review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Answer current symptoms/ }).click();
  await review.getByRole("button", { name: "Open full record" }).click();
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
  const review = await openReview(page);
  await review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Answer current symptoms/ }).click();
  await review.getByRole("textbox", { name: "Current symptoms" }).fill("Reported anxiety during interview.");
  await review.getByRole("button", { name: "Save answer" }).click();
  await expect(review.getByText("Answer saved to the assessment with its change history.")).toBeVisible();
});

test("a sent assessment gains the structured answer without another Meet the Client send", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: home }));
  let saved = false;
  await page.route("**/api/assessments/asm_memo_23", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      expect(body.if_match).toBe(9);
      expect(body.patch.data.current_symptoms).toBe("Reported anxiety during interview.");
      expect(body.patch.post_send_review).toEqual({ field: "current_symptoms", source: "Interview notes" });
      saved = true;
      await route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 10, current_symptoms: body.patch.data.current_symptoms, unable_to_assess_reasons: {}, signed_at: generatedAt, meet_client_sent_at: generatedAt } } });
    } else {
      await route.fulfill({ json: { assessment: { assessment_id: "asm_memo_23", version: 9, current_symptoms: null, unable_to_assess_reasons: {}, signed_at: generatedAt, meet_client_sent_at: generatedAt } } });
    }
  });
  await page.goto("/");
  const review = await openReview(page);
  await review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Answer current symptoms/ }).click();
  await review.getByRole("textbox", { name: "Current symptoms" }).fill("Reported anxiety during interview.");
  await review.getByRole("textbox", { name: /Where did this added answer come from/ }).fill("Interview notes");
  await review.getByRole("button", { name: "Add to assessment" }).click();
  await expect(review.getByText(/Answer added to the assessment/)).toBeVisible();
  expect(saved).toBe(true);
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
  const review = await openReview(page);
  await expect(review.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: /Second Synthetic Client/ })).toBeVisible();
  await review.getByLabel("Filter completion memo by assessor").selectOption("Another Assessor");
  await expect(review.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: /Second Synthetic Client/ })).toBeVisible();
  await expect(review.getByRole("navigation", { name: "Clients in completion memo" }).getByRole("button", { name: /Synthetic Memo Client/ })).toHaveCount(0);
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
  const review = await openReview(page);
  await review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Record date of birth/ }).click();
  await review.getByLabel("Date of birth", { exact: true }).fill("1970-01-02");
  await review.getByRole("button", { name: "Save answer" }).click();
  await expect(review.getByText("Chart value saved with its change history.")).toBeVisible();
  expect(saved).toBe(true);
});

test("saving a resolved gap opens the next issue in the client's queue", async ({ page }) => {
  await page.clock.setFixedTime(new Date(generatedAt));
  const currentHome = structuredClone(home);
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: currentHome }));
  await page.route("**/api/referrals/23", async (route) => {
    if (route.request().method() === "PATCH") {
      currentHome.workflow.completion_memo.clients[0].tasks =
        currentHome.workflow.completion_memo.clients[0].tasks.filter((item) => item.id !== "profile:dob");
      currentHome.workflow.completion_memo.task_count = 2;
      await route.fulfill({ json: { referral: { id: 23, version: 7, dob: "1970-01-02", name: "Synthetic Memo Client", community: "Turlock" } } });
    } else {
      await route.fulfill({ json: { referral: { id: 23, version: 6, dob: "", name: "Synthetic Memo Client", community: "Turlock" } } });
    }
  });
  await page.route("**/api/assessments/asm_memo_23", (route) => route.fulfill({ json: { assessment: {
    assessment_id: "asm_memo_23", version: 4, current_symptoms: null, unable_to_assess_reasons: {}, meet_client_sent_at: null,
  } } }));
  await page.goto("/");
  const review = await openReview(page);
  await review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Record date of birth/ }).click();
  await review.getByLabel("Date of birth", { exact: true }).fill("1970-01-02");
  await review.getByRole("button", { name: "Save answer" }).click();
  await expect(review.getByRole("region", { name: "Answer current symptoms review" })).toBeVisible();
  await expect(review.getByRole("region", { name: "Answer current symptoms review" })).toBeFocused();
  await expect(review.getByRole("status").getByText("Saved. Next item ready.")).toBeVisible();
  await expect(review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Record date of birth/ })).toHaveCount(0);
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
  const review = await openReview(page);
  await review.getByRole("region", { name: "Synthetic Memo Client issues" }).getByRole("button", { name: /Answer current symptoms/ }).click();
  const answer = review.getByRole("textbox", { name: "Current symptoms" });
  await answer.fill("My interview answer.");
  await review.getByRole("button", { name: "Save answer" }).click();
  await expect(review.getByText("Latest saved value: New answer from another assessor.")).toBeVisible();
  await expect(answer).toHaveValue("My interview answer.");
  await expect(review.getByRole("button", { name: "Save answer" })).toBeDisabled();
  await review.getByRole("button", { name: "I reviewed the latest value; let me save my entry" }).click();
  await review.getByRole("button", { name: "Save answer" }).click();
  await expect(review.getByText("Answer saved to the assessment with its change history.")).toBeVisible();
  expect(attempts).toBe(2);
});

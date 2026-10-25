import { expect, test } from "@playwright/test";

const generatedAt = "2026-10-26T16:00:00.000Z";
const viewer = { id: "weekly-assessor", name: "Weekly Assessor" };
const memo = {
  week_key: "2026-10-26",
  is_monday: true,
  scope: "personal",
  task_count: 2,
  clients: [{
    referral_id: 23,
    client_name: "Synthetic Memo Client",
    community: "Turlock",
    owner: viewer.name,
    status: "accepted",
    tasks: [
      { id: "requirement:med", label: "Find or add medication list", detail: "No file is linked to this item. Check Files for an existing copy before uploading another one.", action: "Open files", location: { view: "files" } },
      { id: "profile:dob", label: "Record date of birth", detail: "This field is blank in the referral chart.", action: "Open chart", location: { view: "intake", intakeField: "dob" } },
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
  await expect(dialog.getByText("Find or add medication list")).toBeVisible();
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
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Completion memo" });
  await expect(dialog.getByRole("heading", { name: "Synthetic Memo Client" })).toBeVisible();
  await dialog.getByRole("button", { name: "Open chart" }).click();
  await expect(page).toHaveURL(/referralId=23.*workspaceField=dob/);
});

import { expect, test, type Page } from "@playwright/test";

async function syntheticHome(page: Page) {
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const names = ["Taylor Rivera", "Jordan Ellis", "Morgan Chen", "Casey Brooks", "Alex Reed", "Riley Hart"];
    const statuses = ["ready_to_schedule", "profile_incomplete", "assessment_scheduled", "assessment_in_progress", "decision_pending", "admitted"];
    const actions = ["Schedule the assessment", "Complete the referral details", "Assessment on Thursday at 10:00 AM", "Continue Clinical", "Review the recommendation", "Admission recorded"];
    const items = names.map((name, index) => ({
      referral_id: 910101 + index, client_name: name, community: "San Pablo", stage: "New",
      workflow_status: statuses[index], flow_state: index < 2 ? "ready_to_schedule" : index < 4 ? "assessment" : "complete_chart",
      assessment_state: index === 2 ? "scheduled" : "in_progress", outcome_state: index === 5 ? "accepted" : "pending",
      assignment_state: "assigned", document_state: "partial", profile_state: "partial", assessment_is_reassessment: false,
      owner: "Example Assessor", priority: "standard", categories: [], primary_category: "follow_up", next_action: actions[index],
      blockers: [], missing_data: [], urgency: "normal", due_at: null, last_activity_at: "2026-09-17T15:00:00Z",
      age_hours: 1, completion_pct: 40, missing_document_count: 0, location: { view: index < 2 ? "intake" : "assessment" },
    }));
    payload.scope = "team";
    payload.unavailable_sections = [];
    payload.continuity.unavailable = false;
    payload.workflow.active_total = 5;
    payload.workflow.active_items = items.slice(0, 5);
    payload.workflow.board_items = items;
    payload.upcoming = [{ id: "preview-event", referralId: 910103, clientName: "Morgan Chen", community: "San Pablo",
      ownerId: payload.viewer.id, owner: "Example Assessor", date: "2026-09-17", startsAt: "2026-09-17T17:00:00Z",
      durationMinutes: 60, method: "in_person", kind: "assessment", status: "scheduled", title: "Assessment", scheduleStatus: "scheduled" }];
    payload.continuity.new_assignments = [{ event_id: "preview-assignment", action: "assigned", actor_id: "preview-supervisor",
      actor_name: "Example Supervisor", created_at: "2026-09-17T15:00:00Z", workspace: { referral_id: 910101,
        client_name: "Taylor Rivera", community: "San Pablo", owner_id: payload.viewer.id, owner: "Example Assessor",
        workflow_status: "intake_in_progress", priority: "standard", workspace_status: "active" }, attention: null }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/");
  await expect(page.locator("[data-board-card]")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [1440, 1024, 390]) {
  test(`emerald Home and assessment stay legible and usable at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await syntheticHome(page);
    await expect(page.locator('[data-guide-target="home-workspace"]')).toHaveCSS("background-color", "rgb(237, 243, 242)");
    await expect(page.locator('[data-home-module="current-work"]')).toHaveCSS("border-top-left-radius", "0px");
    const stageColors = await page.locator('[data-board-stage] > div:first-child').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundImage));
    expect(new Set(stageColors).size).toBe(4);
    await expect(page.locator("[data-home-surface]").first()).toHaveCSS("backdrop-filter", "none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) });
    await page.getByRole("button", { name: "Collapse Board", exact: true }).click();
    await expect(page.locator("[data-current-work-board]")).toHaveCount(0);
    await page.getByRole("button", { name: "Expand Board", exact: true }).click();
    await expect(page.locator("[data-board-card]")).toHaveCount(6);

    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=diagnosis_clinical&demo=1");
    const assessment = page.locator('[data-assessment-view="chart"]');
    await expect(assessment).toBeVisible();
    const secondary = assessment.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await expect(secondary).toHaveCSS("font-size", "16px");
    await secondary.fill("Synthetic referral history prepared for the interview.");
    await secondary.press("Tab");
    await expect(assessment.getByRole("complementary", { name: "Captured assessment answers" })).toHaveCSS("background-color", "rgb(255, 255, 255)");
    if (width >= 1024) {
      await expect(assessment.getByRole("complementary", { name: "Assessment navigation", exact: true })).toHaveCSS("background-color", "rgb(233, 241, 240)");
      await expect(assessment.locator('button[aria-current="step"]')).toHaveCSS("border-top-color", "rgb(152, 205, 183)");
    }
    if (width >= 1200) {
      const reference = await assessment.getByRole("complementary", { name: "Captured assessment answers" }).boundingBox();
      const editor = await assessment.locator('[data-assessment-question-editor]').boundingBox();
      expect(reference!.x + reference!.width).toBeLessThan(editor!.x);
      expect(Math.abs(reference!.y - editor!.y)).toBeLessThan(2);
    }
    expect(await assessment.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`assessment-${width}.png`) });
    await assessment.getByRole("button", { name: "Begin assessment", exact: true }).click();
    const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
    await expect(begin).toBeVisible();
    await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
    await expect(begin).toHaveCount(0);
    await expect(secondary).toHaveValue("Synthetic referral history prepared for the interview.");
    await assessment.locator("main").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(assessment.getByRole("button", { name: "Next section", exact: true })).toBeInViewport();
    await expect(assessment.getByRole("button", { name: "Sign assessment", exact: true })).toBeInViewport();
    expect(errors).toEqual([]);
  });
}

test("reduced motion removes card movement and the standalone lab stays unthemed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await syntheticHome(page);
  const card = page.locator("[data-board-card]").first();
  await card.hover();
  await expect(card).toHaveCSS("transform", "none");
  await expect(card).toHaveCSS("transition-duration", "0s");
  await card.focus();
  await expect(card).toHaveCSS("outline-width", "2px");
  await page.goto("/note-lab/practice");
  await expect(page.getByTestId("standalone-review-shell")).toBeVisible();
  await expect(page.locator(".pipeline-surfaces")).toHaveCount(0);
});

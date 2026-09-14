import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { clientDirectoryFixture } from "./support/pipeline-clinical-fixtures";
import { buildPipelineDemoReferral, getPipelineDemoScenario } from "@/lib/demo/demo-scenarios";

test.use({ timezoneId: "America/Los_Angeles", actionTimeout: 10_000 });

// Capture the application itself with isolated synthetic records. No live roster,
// production account, or hand-drawn imitation of an application screen is used.
test("captures the real screens used in the assessor orientation", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
  await page.clock.setFixedTime(new Date("2026-09-13T16:00:00-07:00"));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: clientDirectoryFixture }));
  const membersResponse = await page.request.get("/api/members?scope=assessors");
  expect(membersResponse.ok()).toBeTruthy();
  const { members } = await membersResponse.json();
  const owner = members.find((member: { display_name: string }) => member.display_name === "Playwright QA") ?? members[0];
  const created = await page.request.post("/api/referrals", { data: {
    client_mutation_id: randomUUID(), assignee_id: owner.principal_id,
    referral: { ...buildPipelineDemoReferral(getPipelineDemoScenario("new-intake")!, owner.display_name), name: "Taylor Rivera", priority: "standard" },
  } });
  const creation = await created.json();
  const existingId = created.status() === 409 && creation.suspected_duplicate ? creation.confirmation_referral_ids?.[0] : null;
  expect(created.ok() || Boolean(existingId), JSON.stringify(creation)).toBeTruthy();
  const { referral } = existingId ? await (await page.request.get(`/api/referrals/${existingId}`)).json() : creation;
  const appointment = { id: "orientation-appointment", referralId: referral.id, clientName: referral.name,
    community: referral.community, owner: owner.display_name, ownerId: owner.principal_id, date: "2026-09-14", startsAt: "2026-09-14T17:00:00.000Z",
    durationMinutes: 60, method: "zoom", kind: "assessment", status: "scheduled", title: "Assessment", detail: "Synthetic appointment", scheduleStatus: "scheduled" };
  await page.route("**/api/calendar/events**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, events: [appointment], unscheduled: [], unscheduledTotal: 0, unscheduledHasMore: false, assessors: [{ id: owner.principal_id, name: owner.display_name }] } });
  });
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.scope = "personal";
    payload.current_work = { total: 1, items: [{
      id: `intake:${referral.id}`, referral_id: referral.id, client_name: referral.name, community: referral.community,
      next_action: "Review the referral packet and complete intake", urgency: "normal", location: { view: "intake" },
    }] };
    payload.upcoming = [appointment];
    payload.continuity = {
      resume_items: [],
      new_assignments: [{ event_id: "orientation-assignment", created_at: new Date().toISOString(), workspace: {
        referral_id: referral.id, client_name: referral.name, community: referral.community,
        owner_id: owner.principal_id, owner: owner.display_name, workflow_status: "intake_in_progress", priority: "standard", workspace_status: "active",
      }, attention: null }],
      assignment_tracking_started_at: new Date().toISOString(), needs_assignment_tracking_initialization: false, unavailable: false,
    };
    await route.fulfill({ response, json: payload });
  });
  const capture = async (name: string) => {
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(name), animations: "disabled" });
  };

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Since your last visit" })).toContainText("Taylor Rivera");
  await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open referrals", exact: true })).toBeVisible();
  await capture("assessor-home.png");
  await page.getByRole("button", { name: "Open referrals", exact: true }).click();
  await expect(page.locator('[data-performance-ready="referrals"]')).toBeAttached();
  await expect(page.getByText("Taylor Rivera", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await capture("assessor-workspaces.png");
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
  await expect(page.getByRole("button", { name: "10:00 AM Taylor Rivera Assessment", exact: true })).toBeVisible();
  await capture("assessor-calendar.png");
  await page.getByRole("button", { name: "Open client profiles", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show clients as a list", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open profile for Avery Example", exact: true })).toBeVisible();
  await expect(page.getByText("Live census information is temporarily unavailable.", { exact: false })).toHaveCount(0);
  await capture("current-clients.png");

  await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=guided&demo=1");
  const interview = page.getByRole("dialog", { name: "Assessment interview" });
  await expect(interview).toHaveAttribute("data-guided-assessment", "true");
  await expect(interview.getByText("Taylor Rivera", { exact: true })).toBeVisible();
  await capture("assessment-interview.png");
  await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=guided&assessmentSection=prior_history&demo=1");
  await expect(interview).toHaveAttribute("data-guided-assessment", "true");
  for (let index = 0; index < 12 && await interview.getByRole("textbox", { name: "Prior placements", exact: true }).count() === 0; index += 1) {
    const previousScreen = await interview.getAttribute("data-screen-index");
    await interview.getByRole("button", { name: "Next", exact: true }).click();
    await expect(interview).not.toHaveAttribute("data-screen-index", previousScreen!);
  }
  const lab = interview.locator("details").filter({ has: page.getByLabel("Language Lab for Prior placements", { exact: true }) });
  await lab.locator("summary").click();
  await expect(lab.getByText("Use this order", { exact: true })).toBeVisible();
  await capture("assessment-language-lab.png");
  await interview.getByRole("button", { name: "Exit guided interview" }).click();
  await interview.getByRole("navigation", { name: "Assessment sections" }).getByRole("button", { name: /Review/ }).click();
  await expect(interview.getByRole("region", { name: "Practice assessment review" })).toBeVisible();
  await capture("assessment-review.png");

  // Keep the real workflow presentation and API shape, supplying a synthetic
  // signed state without manufacturing a signed clinical record in any store.
  let submitted = false;
  await page.route(`**/api/referrals/${referral.id}/workflow`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.referral.stage = "Assessment";
    payload.transitions = [{ target: "Accepted", blockers: [{ code: "decision_required", label: "Record the supervisor decision before acceptance." }] }];
    payload.context = { assessmentId: "orientation-assessment", assessmentSigned: true };
    payload.work_items = [];
    payload.recommendation = submitted ? { outcome: "accept", reasonCode: "clinical_fit", reasonNote: "Synthetic recommendation for this walkthrough only.", recommendedByName: owner.display_name, recommendedAt: new Date().toISOString() } : null;
    payload.review = submitted ? { reviewId: "orientation-review", status: "submitted", assessmentId: "orientation-assessment", assessmentVersion: 1, submittedBy: owner.principal_id, submittedByName: owner.display_name, submittedAt: new Date().toISOString(), assignedReviewerName: "Supervisor", submissionNumber: 1 } : null;
    payload.reviews = payload.review ? [payload.review] : [];
    payload.capabilities.can_decide = submitted;
    payload.capabilities.can_recommend = !submitted;
    payload.capabilities.can_request_changes = submitted;
    await route.fulfill({ response, json: payload });
  });
  const openWorkflow = async () => {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
    await page.getByRole("button", { name: "Admission workflow", exact: true }).click();
    await expect(page.getByRole("region", { name: "Admission workflow", exact: true })).toBeVisible();
  };
  await openWorkflow();
  await page.getByRole("textbox", { name: "Clinical rationale", exact: true }).fill("Synthetic case: recommend acceptance based on the completed assessment and documented support needs.");
  await expect(page.getByRole("button", { name: "Submit for supervisor review", exact: true })).toBeEnabled();
  await page.locator("details").filter({ has: page.getByText("Clinical recommendation", { exact: true }) }).screenshot({ path: testInfo.outputPath("assessment-submittal.png"), animations: "disabled" });
  submitted = true;
  await openWorkflow();
  await page.locator("details").filter({ has: page.getByText("Supervisor decision", { exact: true }) }).screenshot({ path: testInfo.outputPath("supervisor-decision.png"), animations: "disabled" });
});

test("keeps the scheduling walkthrough above the full-screen appointment form", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.route("**/api/training/progress", (route) => route.fulfill({ json: { progress: [] } }));
  await page.goto("/training/demo?slide=schedule-assessment");
  await page.getByRole("button", { name: "Try the scheduling walkthrough" }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
  const coach = page.getByTestId("guided-coach-panel");
  await expect(schedule).toBeVisible();
  await expect(coach).toBeVisible();
  await expect(page.getByTestId("guide-spotlight-outline")).toBeVisible();
  const layer = (locator: ReturnType<typeof page.getByRole>) => locator.evaluate((element) => Number(getComputedStyle(element).zIndex));
  expect(await layer(coach)).toBeGreaterThan(await layer(schedule));
  expect(await layer(page.getByTestId("guide-spotlight"))).toBeGreaterThan(await layer(schedule));
  await expect(schedule).toHaveAttribute("data-assessment-scheduling", "fullscreen");
  await schedule.getByLabel("Assessment method").selectOption("zoom");
  await schedule.getByLabel("Zoom meeting link").fill("https://example.invalid/assessment");
  await page.screenshot({ path: testInfo.outputPath("assessment-schedule.png"), animations: "disabled" });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
    await expect(coach.getByRole("heading")).toBeVisible();
    await expect(coach.getByRole("button", { name: "Pause tutorial" })).toBeVisible();
  }
  await coach.getByRole("button", { name: "Pause tutorial" }).click();
  await expect(coach).toBeHidden();
  await expect(schedule.getByLabel("Zoom meeting link")).toHaveValue("https://example.invalid/assessment");
});

test("shows a loaded real screen on every slide and supports keyboard enlargement", async ({ page }, testInfo) => {
  await page.goto("/training/demo");
  await page.evaluate(() => document.fonts.ready);
  const slideSelect = page.getByRole("combobox", { name: "Jump to slide" });
  const count = await slideSelect.locator("option").count();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
    for (let index = 0; index < count; index += 1) {
      await slideSelect.selectOption(String(index));
      const slide = page.getByRole("article", { name: `Presentation slide ${index + 1}` });
      await expect(slide.locator("figure img")).toBeVisible();
      await expect.poll(() => slide.locator("figure img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      for (const tab of await slide.getByRole("tab").all()) {
        await tab.click();
        await expect.poll(() => slide.locator("figure img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      }
      const size = await slide.evaluate((element) => ({
        width: element.clientWidth, scrollWidth: element.scrollWidth,
        height: element.clientHeight, scrollHeight: element.scrollHeight,
      }));
      expect(size.scrollWidth, `Slide ${index + 1} at ${width}px: horizontal overflow`).toBeLessThanOrEqual(size.width);
      if (width === 1280) {
        expect(size.scrollHeight, `Slide ${index + 1} at ${width}px: vertical overflow`).toBeLessThanOrEqual(size.height + 1);
      }
      if (width === 1280 && [0, 5, 6, 8].includes(index)) {
        await page.screenshot({ path: testInfo.outputPath(`slide-${index + 1}.png`), animations: "disabled" });
      }
    }
  }
  await page.getByRole("tab", { name: "Supervisor decision", exact: true }).click();
  await page.getByRole("button", { name: "Enlarge Supervisor decision screenshot" }).click();
  const enlarged = page.getByRole("dialog", { name: "Supervisor decision full-size screen" });
  await expect(enlarged).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(slideSelect).toHaveValue(String(count - 1));
  await page.keyboard.press("Escape");
  await expect(enlarged).toBeHidden();
  await expect(page.getByRole("button", { name: "Enlarge Supervisor decision screenshot" })).toBeFocused();
});

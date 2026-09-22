import { expect, test, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type CalendarRequest = {
  from: string;
  to: string;
  queueLimit: number;
  queueSearch: string;
  queueCommunity: string;
  queueOwner: string;
  queueMine: boolean;
};

test.describe("Pipeline calendar characterization", () => {
  test("preserves views, filters, conflict display, cached recovery, and overlay dismissal", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-09-09T12:00:00.000Z"));
    const requests: CalendarRequest[] = [];
    let failNextRequest = false;
    await page.route("**/api/calendar/events**", async (route) => {
      const request = calendarRequest(route);
      requests.push(request);
      if (failNextRequest) {
        failNextRequest = false;
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Calendar fixture unavailable." }),
        });
        return;
      }
      const response = calendarResponse(request);
      const payload = JSON.parse(response.body);
      payload.events.push({ ...payload.events[1], id: "other-assessor-appointment", ownerId: "assessor-b", owner: "Bailey Assessor", clientName: "Bailey Client" });
      await route.fulfill({ ...response, body: JSON.stringify(payload) });
    });

    await page.goto("/?screen=calendar");
    await expect(page.getByText("My schedule", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show calendar filters" }).click();
    await expect(page.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Continue working", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "week", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Calendar view", exact: true }).getByRole("button")).toHaveCount(2);
    await page.getByRole("button", { name: "week", exact: true }).click();
    await expect(page.getByRole("region", { name: "Timed assessment week" })).toBeVisible();
    await expect.poll(() => requests.at(-1)?.queueMine).toBe(true);
    await expect(page.getByRole("button", { name: /Scheduling queue\s+15/ })).toBeVisible();
    await expect(page.getByText("Bailey Client", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("calendar-default-mine.png") });
    await expect(page.getByRole("combobox", { name: "Filter calendar by assessor" })).toHaveCount(0);
    await page.getByRole("button", { name: "Team", exact: true }).click();
    await page.getByRole("combobox", { name: "Filter calendar by assessor" }).selectOption("id:assessor-b");
    await expect(page.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Bailey Client", { exact: true })).toBeVisible();
    await expect(page.getByText("Scheduled Client", { exact: true })).toHaveCount(0);
    await expect.poll(() => requests.at(-1)?.queueMine).toBe(false);
    await page.getByRole("button", { name: "Mine", exact: true }).click();
    await expect(page.getByText("Bailey Client", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Filter calendar by assessor" })).toHaveCount(0);
    await page.getByRole("button", { name: "Team", exact: true }).click();
    await expect(page.getByText("Team schedule", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Supervisor team week" })).toBeVisible();
    await expect(page.getByText("2 overlapping appointments", { exact: true })).toBeVisible();
    await expect(page.getByText("Assignment Only", { exact: true })).toHaveCount(0);
    await expect(page.locator('button[title^="Scheduled Client - Assessment scheduled"]').first()).toBeVisible();

    await page.getByRole("combobox", { name: "Filter calendar by assessor" }).selectOption("id:assessor-a");
    await expect(page.getByRole("region", { name: "Timed assessment week" })).toBeVisible();
    await expect.poll(() => requests.at(-1)?.queueOwner).toBe("id:assessor-a");

    await page.getByRole("combobox", { name: "Filter calendar by community" }).selectOption("San Pablo");
    await expect.poll(() => requests.at(-1)?.queueCommunity).toBe("San Pablo");
    await expect(page.getByRole("combobox", { name: "Filter calendar by event type" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Records follow-up/ })).toBeHidden();
    await page.getByText("Dated follow-ups", { exact: false }).click();
    await expect(page.getByRole("button", { name: /Records follow-up/ })).toBeVisible();
    await expect(page.getByText("Scheduled Client", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByRole("region", { name: "Supervisor team week" })).toBeVisible();
    await page.getByRole("button", { name: /^Show appointments for / }).first().click();
    await expect(page.getByRole("region", { name: /^Appointments on / })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare assessment for Scheduled Client", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "month", exact: true }).click();
    await expect(page.locator('button[title^="Scheduled Client - Assessment scheduled"]').first()).toBeVisible();

    const requestCountBeforePrevious = requests.length;
    await page.getByRole("button", { name: "Previous calendar range" }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(requestCountBeforePrevious);
    await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();

    await page.clock.setFixedTime(new Date("2026-09-09T12:00:16.000Z"));
    failNextRequest = true;
    await page.getByRole("button", { name: "Refresh calendar" }).click();
    await expect(page.getByText("Calendar fixture unavailable.", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Calendar updated" })).toHaveCount(0);
    await expect(page.locator('button[title^="Scheduled Client - Assessment scheduled"]').first()).toBeVisible();

    await page.locator('button[title^="Scheduled Client - Assessment scheduled"]').first().click();
    await expect(page.getByRole("dialog", { name: "Calendar item" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Calendar item" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");

    await page.getByRole("button", { name: /Scheduling queue\s+30/ }).click();
    const queue = page.getByRole("dialog", { name: "Scheduling queue" });
    await expect(queue).toBeVisible();
    const closeQueue = queue.getByRole("button", { name: "Close scheduling queue" });
    await expect(closeQueue.locator("xpath=ancestor::body")).toHaveClass(/pipeline-interactions/);
    await closeQueue.hover();
    await page.mouse.down();
    await expect(closeQueue).toHaveCSS("background-image", /linear-gradient/);
    await expect(closeQueue).toHaveCSS("scale", "0.97");
    await page.screenshot({ path: testInfo.outputPath("calendar-portal-pressed.png") });
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await page.mouse.click(10, 10);
    await expect(queue).toHaveCount(0);

    for (const width of [834, 390]) {
      await page.setViewportSize({ width, height: 932 });
      await expect(width < 621 ? page.getByRole("combobox", { name: "Calendar view", exact: true }) : page.getByRole("button", { name: "week", exact: true })).toBeVisible();
      for (const name of ["Show calendar filters", "Refresh calendar", "Scheduling queue 30"]) {
        const control = await page.getByRole("button", { name, exact: true }).boundingBox();
        expect(control).not.toBeNull();
        expect(control!.x).toBeGreaterThanOrEqual(0);
        expect(control!.x + control!.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath(`calendar-${width}.png`), fullPage: true });
    }
  });

  test("preserves queue paging, assessment creation, collision override, and no-show mutation", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-09-09T12:00:00.000Z"));
    const calendarRequests: CalendarRequest[] = [];
    const createAssessmentRequests: Record<string, unknown>[] = [];
    const scheduleRequests: Array<{ assessmentId: string; body: Record<string, unknown> }> = [];
    let scheduleAttempts = 0;
    let finishFirstSchedule!: () => void;
    const firstSchedule = new Promise<void>((resolve) => { finishFirstSchedule = resolve; });

    await page.route("**/api/calendar/events**", async (route) => {
      const request = calendarRequest(route);
      calendarRequests.push(request);
      await route.fulfill(calendarResponse(request));
    });
    await page.route("**/api/referrals/501/assessments", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessments: [] }) });
        return;
      }
      createAssessmentRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assessment: assessmentRecord("created-assessment", 7, "unscheduled") }),
      });
    });
    await page.route("**/api/assessments/*/schedule", async (route) => {
      const assessmentId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
      const body = route.request().postDataJSON() as Record<string, unknown>;
      scheduleRequests.push({ assessmentId, body });
      if (assessmentId === "created-assessment" && scheduleAttempts++ === 0) {
        await firstSchedule;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "The assessor already has an overlapping appointment.", code: "assessment_schedule_conflict", can_override: true }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assessment: assessmentRecord(assessmentId, 8) }),
      });
    });
    await page.route("**/api/assessments/existing-assessment", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assessment: assessmentRecord("existing-assessment", 11) }),
      });
    });

    await page.goto("/?screen=calendar");
    await expect(page.getByRole("main", { name: "Calendar", exact: true })).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Show calendar filters" }).click();
    await page.getByRole("button", { name: "Team", exact: true }).click();
    await page.getByRole("button", { name: /Scheduling queue\s+30/ }).click();
    const queue = page.getByRole("dialog", { name: "Scheduling queue" });
    await expect(queue.getByRole("button", { name: /Ready Xu/ })).toBeVisible();
    await queue.getByRole("button", { name: "Load more" }).click();
    await expect.poll(() => calendarRequests.at(-1)?.queueLimit).toBe(48);
    await expect(queue.getByRole("button", { name: /Ready Davis/ })).toBeVisible();

    await queue.getByPlaceholder("Search client, community, or assessor").fill("Ready Adams");
    await expect.poll(() => calendarRequests.at(-1)?.queueSearch).toBe("Ready Adams");
    await expect(queue.getByRole("button", { name: /Ready Adams/ })).toBeVisible();
    await expect(queue.getByRole("button", { name: /Ready Baker/ })).toHaveCount(0);
    await queue.locator("li").filter({ hasText: "Ready Adams" }).getByRole("button", { name: "Schedule interview", exact: true }).click();

    const scheduleDialog = page.getByRole("dialog").filter({ hasText: "Ready Adams" });
    await expect(scheduleDialog).toHaveAttribute("data-assessment-scheduling", "modal");
    const modalBounds = (await scheduleDialog.boundingBox())!;
    expect(modalBounds.width).toBe(660);
    expect(modalBounds.x).toBe(390);
    expect(modalBounds.y).toBeGreaterThan(0);
    expect(modalBounds.y + modalBounds.height).toBeLessThan(900);
    await scheduleDialog.getByLabel("Date and time").fill("2026-09-10T09:00");
    await scheduleDialog.getByLabel("Method").selectOption("zoom");
    await scheduleDialog.getByLabel("Zoom link").fill("https://zoom.us/j/calendar-characterization");
    await scheduleDialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(scheduleDialog).toHaveAttribute("aria-busy", "true");
    await expect(scheduleDialog.getByLabel("Date and time")).toBeDisabled();
    await expect(scheduleDialog.getByRole("button", { name: "Close scheduling" })).toBeEnabled();
    await page.keyboard.press("Tab");
    await expect(scheduleDialog.getByRole("button", { name: "Close scheduling" })).toBeFocused();
    finishFirstSchedule();
    await expect(scheduleDialog.getByRole("alert")).toContainText("overlapping appointment");
    await expect(scheduleDialog.getByRole("button", { name: "Schedule anyway" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(scheduleDialog.getByRole("alert")).toBeInViewport();
    await expect(scheduleDialog.getByRole("button", { name: "Schedule anyway" })).toBeInViewport();
    await expect(scheduleDialog.getByRole("button", { name: "Schedule", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("appointment-conflict-320.png") });
    await scheduleDialog.getByRole("button", { name: "Schedule anyway" }).click();
    await expect(scheduleDialog).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "week", exact: true }).click();

    expect(createAssessmentRequests).toHaveLength(1);
    expect(createAssessmentRequests[0]).toMatchObject({ data: {} });
    expect(scheduleRequests.slice(0, 2)).toEqual([
      expect.objectContaining({
        assessmentId: "created-assessment",
        body: expect.objectContaining({
          if_match: 7,
          allow_conflict: false,
          schedule: {
            status: "scheduled",
            start_at: "2026-09-10T16:00:00.000Z",
            duration_minutes: 60,
            method: "zoom",
            location: "https://zoom.us/j/calendar-characterization",
          },
        }),
      }),
      expect.objectContaining({
        assessmentId: "created-assessment",
        body: expect.objectContaining({ if_match: 7, allow_conflict: true }),
      }),
    ]);

    await page.locator('button[title^="Scheduled Client - Assessment scheduled"]').first().click();
    const itemDrawer = page.getByRole("dialog", { name: "Calendar item" });
    await expect(itemDrawer.getByRole("link", { name: /Join Zoom/ })).toHaveAttribute("href", "https://zoom.us/j/existing-assessment");
    await itemDrawer.getByRole("button", { name: "Mark no-show" }).click();
    await page.getByRole("alertdialog", { name: "Mark as a no-show?" }).getByRole("button", { name: "Record no-show", exact: true }).click();
    await expect(itemDrawer).toHaveCount(0);

    const noShow = scheduleRequests.find((request) => request.assessmentId === "existing-assessment");
    expect(noShow?.body).toMatchObject({
      if_match: 11,
      schedule: {
        status: "no_show",
        start_at: "2026-09-09T16:00:00.000Z",
        duration_minutes: 60,
        method: "zoom",
        location: "https://zoom.us/j/existing-assessment",
      },
    });
    await expect(page.getByText("No-show recorded", { exact: true })).toBeVisible();
  });

  test("defaults assessors to Week, opens day details, and resumes the saved assessment section", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-09-09T12:00:00.000Z"));
    await page.route("**/api/calendar/events**", async (route) => {
      const response = calendarResponse(calendarRequest(route));
      const payload = JSON.parse(response.body);
      payload.scope = "personal";
      payload.assessors = [payload.assessors[0]];
      delete payload.events.find((event: { kind: string }) => event.kind === "follow_up").ownerId;
      await route.fulfill({ ...response, body: JSON.stringify(payload) });
    });
    await page.route("**/api/me/work-continuity", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: {
        schema: 1,
        acknowledgedAssignmentIds: [],
        lastWorkspace: { referralId: 500, location: { view: "assessment", assessmentSection: "functional_adl" }, visitedAt: "2026-09-09T11:00:00.000Z" },
      } }) });
    });
    await page.goto("/?screen=calendar");
    await expect(page.getByRole("button", { name: "week", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^Show appointments for / }).first().click();
    await expect(page.getByText("My schedule", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter calendar by assessor" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Whose schedule", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
    await page.getByText("Dated follow-ups", { exact: false }).click();
    await expect(page.getByRole("button", { name: /Records follow-up/ })).toBeVisible();
    const schedule = page.getByRole("region", { name: /^Appointments on / });
    await expect(schedule.getByText("Records follow-up")).toHaveCount(0);
    await expect(schedule.getByText("Meeting link:", { exact: true })).toBeVisible();
    await expect(schedule.getByRole("link", { name: "Join Zoom for Scheduled Client" })).toHaveAttribute("href", "https://zoom.us/j/existing-assessment");
    await expect(schedule.getByText("Interview room", { exact: false })).toBeVisible();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 834, height: 932 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      const action = schedule.getByRole("button", { name: "Prepare assessment for Scheduled Client", exact: true });
      const box = await action.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath(`assessment-agenda-${viewport.width}.png`), fullPage: true });
    }
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Element, options: object) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[]; failureSummary: string }[] }[] }> } }).axe;
      const result = await axe.run(document.querySelector('[data-guide-target="calendar-workspace"]')!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)).map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) }));
    });
    expect(violations).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "month", exact: true }).click();
    await page.clock.setFixedTime(new Date("2026-09-09T12:00:16.000Z"));
    await page.getByRole("button", { name: "Show calendar filters" }).click();
    await page.getByRole("button", { name: "Refresh calendar" }).click();
    await expect(page.getByRole("button", { name: "month", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "week", exact: true }).click();
    await page.getByRole("button", { name: /^Show appointments for / }).first().click();
    await schedule.getByRole("button", { name: "Prepare assessment for Scheduled Client", exact: true }).click();
    await expect(page).toHaveURL(/referralId=500/);
    await expect(page).toHaveURL(/workspaceStage=assessment/);
    await expect(page).toHaveURL(/assessmentSection=functional_adl/);
  });

  test("exposes every appointment on busy days and lets staff either fill contact gaps or schedule", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-09T12:00:00.000Z"));
    let scheduleWrites = 0;
    await page.route("**/api/assessments/*/schedule", async (route) => { scheduleWrites += 1; await route.abort(); });
    await page.route("**/api/calendar/events**", async (route) => {
      const response = calendarResponse(calendarRequest(route));
      const payload = JSON.parse(response.body);
      const appointment = payload.events.find((event: { kind: string }) => event.kind === "assessment");
      payload.events.push(...["Adams", "Baker", "Carter", "Davis", "Evans"].map((surname) => ({ ...appointment, id: `busy-${surname}`, assessmentId: `busy-${surname}`, clientName: `Busy ${surname}` })));
      payload.unscheduled[0].nextAction = "complete_contact";
      await route.fulfill({ ...response, body: JSON.stringify(payload) });
    });
    await page.goto("/?screen=calendar");
    await expect(page.locator('button[title^="Busy Evans -"]')).toBeVisible();
    await page.getByRole("button", { name: "Show calendar filters" }).click();
    await page.getByRole("button", { name: "Team", exact: true }).click();
    const week = page.getByRole("region", { name: "Supervisor team week" });
    await page.getByRole("button", { name: "week", exact: true }).click();
    await week.locator("summary").filter({ hasText: "4 more" }).click();
    await expect(week.locator('button[title^="Busy Evans -"]')).toBeVisible();
    await week.locator('button[title^="Busy Evans -"]').click();
    await expect(page.getByRole("dialog", { name: "Calendar item" })).toContainText("Busy Evans");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "month", exact: true }).click();
    await page.locator("summary").filter({ hasText: "5 more" }).click();
    await expect(page.locator('button[title^="Busy Evans -"]')).toBeVisible();
    await page.getByRole("button", { name: /Scheduling queue\s+30/ }).click();
    const item = page.getByRole("dialog", { name: "Scheduling queue" }).locator("li").filter({ hasText: "Ready Adams" });
    await expect(item.getByRole("button", { name: "Schedule interview", exact: true })).toBeEnabled();
    await item.getByRole("button", { name: "Complete contact", exact: true }).click();
    await expect(page).toHaveURL(/referralId=501/);
    await expect(page).toHaveURL(/workspaceField=phone/);
    expect(scheduleWrites).toBe(0);
  });

  test("captures the updated calendar for the assessor presentation", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-09-13T16:00:00-07:00"));
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.route("**/api/calendar/events**", async (route) => {
      const response = calendarResponse(calendarRequest(route));
      const payload = JSON.parse(response.body);
      payload.scope = "personal";
      payload.events = [{ ...payload.events[1], clientName: "Taylor Rivera", date: "2026-09-14", startsAt: "2026-09-14T17:00:00.000Z", location: "https://zoom.us/j/example-assessment" }];
      payload.unscheduled = [];
      payload.unscheduledTotal = 0;
      payload.unscheduledHasMore = false;
      await route.fulfill({ ...response, body: JSON.stringify(payload) });
    });
    await page.goto("/?screen=calendar");
    await expect(page.locator('button[title^="Taylor Rivera -"]')).toBeVisible();
    await page.getByRole("button", { name: /Show appointments for Monday, Sep 14/ }).click();
    await expect(page.getByRole("region", { name: /^Appointments on / })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare assessment for Taylor Rivera" })).toBeVisible();
    if (process.env.PIPELINE_MOCK_USER_ROLES === "reviewer,viewer") await expect(page.getByRole("button", { name: "Open reports", exact: true })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath("assessor-calendar.png"), animations: "disabled" });
  });
});

function calendarRequest(route: Route): CalendarRequest {
  const url = new URL(route.request().url());
  expect(url.searchParams.get("include_assignments")).toBe("false");
  expect(url.searchParams.get("include_work")).toBe("true");
  return {
    from: url.searchParams.get("from") ?? "2026-09-06",
    to: url.searchParams.get("to") ?? "2026-09-12",
    queueLimit: Number(url.searchParams.get("queue_limit") ?? "24"),
    queueSearch: url.searchParams.get("queue_q") ?? "",
    queueCommunity: url.searchParams.get("queue_community") ?? "",
    queueOwner: url.searchParams.get("queue_owner") ?? "",
    queueMine: url.searchParams.get("queue_mine") === "true",
  };
}

function calendarResponse(request: CalendarRequest) {
  const surnames = [
    "Adams", "Baker", "Carter", "Diaz", "Evans", "Foster", "Garcia", "Harris", "Irving", "Jones",
    "Keller", "Lewis", "Miller", "Nelson", "Owens", "Parker", "Quinn", "Reed", "Smith", "Turner",
    "Underwood", "Vega", "White", "Xu", "Young", "Zimmer", "Archer", "Brooks", "Clark", "Davis",
  ];
  const items = Array.from({ length: 30 }, (_, index) => ({
    referralId: 501 + index,
    clientName: `Ready ${surnames[index]}`,
    community: index % 2 === 0 ? "San Pablo" : "Turlock",
    ownerId: index % 2 === 0 ? "assessor-a" : "assessor-b",
    owner: index % 2 === 0 ? "Alex Assessor" : "Bailey Assessor",
    receivedDate: request.from,
    workflowStatus: "ready_to_schedule",
    nextAction: "schedule",
  })).filter((item) => {
    if (request.queueSearch && ![item.clientName, item.community, item.owner].some((value) => value.toLowerCase().includes(request.queueSearch.toLowerCase()))) return false;
    if (request.queueCommunity && item.community !== request.queueCommunity) return false;
    if (request.queueOwner && `id:${item.ownerId}` !== request.queueOwner) return false;
    if (request.queueMine && item.ownerId !== "assessor-a") return false;
    return true;
  });
  const eventDate = request.from;
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      from: request.from,
      to: request.to,
      events: [{
        id: "referral-assigned:hidden",
        referralId: 499,
        clientName: "Assignment Only",
        community: "San Pablo",
        ownerId: "assessor-a",
        owner: "Alex Assessor",
        date: eventDate,
        kind: "referral_assigned",
        status: "assigned",
        title: "Referral assigned",
        detail: "Assigned referral",
      }, {
        id: "assessment:existing-assessment",
        referralId: 500,
        assessmentId: "existing-assessment",
        clientName: "Scheduled Client",
        community: "San Pablo",
        ownerId: "assessor-a",
        owner: "Alex Assessor",
        date: eventDate,
        startsAt: `${eventDate}T16:00:00.000Z`,
        durationMinutes: 60,
        method: "zoom",
        location: "https://zoom.us/j/existing-assessment",
        scheduleStatus: "scheduled",
        kind: "assessment",
        status: "draft",
        title: "Assessment scheduled",
        detail: "Scheduled assessment",
      }, {
        id: "assessment:overlap",
        referralId: 502,
        assessmentId: "overlap",
        clientName: "Overlap Client",
        community: "Turlock",
        ownerId: "assessor-a",
        owner: "Alex Assessor",
        date: eventDate,
        startsAt: `${eventDate}T16:30:00.000Z`,
        durationMinutes: 60,
        method: "in_person",
        location: "Interview room",
        scheduleStatus: "scheduled",
        kind: "assessment",
        status: "draft",
        title: "Assessment scheduled",
        detail: "Scheduled assessment",
      }, {
        id: "follow-up:records",
        referralId: 503,
        clientName: "Follow Up Client",
        community: "San Pablo",
        ownerId: "assessor-a",
        owner: "Alex Assessor",
        date: eventDate,
        kind: "follow_up",
        status: "due",
        title: "Records follow-up",
        detail: "Assessment follow-up due",
      }],
      unscheduled: items.slice(0, request.queueLimit),
      unscheduledTotal: items.length,
      unscheduledHasMore: items.length > request.queueLimit,
      assessors: [
        { id: "assessor-a", name: "Alex Assessor" },
        { id: "assessor-b", name: "Bailey Assessor" },
      ],
      scope: "team",
      viewer: { id: "assessor-a", name: "Alex Assessor" },
      timezone: "America/Los_Angeles",
      generated_at: "2026-09-09T12:00:00.000Z",
    }),
  };
}

function assessmentRecord(assessmentId: string, version: number, scheduleStatus = "scheduled") {
  return {
    assessment_id: assessmentId,
    referral_id: 501,
    version,
    schedule_status: scheduleStatus,
    scheduled_start_at: "2026-09-09T16:00:00.000Z",
    scheduled_duration_minutes: 60,
    scheduled_method: "zoom",
    scheduled_location: `https://zoom.us/j/${assessmentId}`,
  };
}

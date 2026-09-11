import { expect, test, type Route } from "@playwright/test";

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
  test("preserves views, filters, conflict display, cached recovery, and overlay dismissal", async ({ page }) => {
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
      await route.fulfill(calendarResponse(request));
    });

    await page.goto("/?screen=calendar");
    await expect(page.getByText("Team schedule", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Supervisor team week" })).toBeVisible();
    await expect(page.getByText("1 conflict", { exact: true })).toBeVisible();
    await expect(page.getByText("Assignment Only", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Scheduled Client.*Assessment scheduled/ }).first()).toBeVisible();

    await page.getByRole("combobox", { name: "Filter calendar by assessor" }).selectOption("id:assessor-a");
    await expect(page.getByRole("region", { name: "Timed assessment week" })).toBeVisible();
    await expect.poll(() => requests.at(-1)?.queueOwner).toBe("id:assessor-a");

    await page.getByRole("combobox", { name: "Filter calendar by community" }).selectOption("San Pablo");
    await expect.poll(() => requests.at(-1)?.queueCommunity).toBe("San Pablo");
    await page.getByRole("combobox", { name: "Filter calendar by event type" }).selectOption("follow_up");
    await expect(page.getByRole("button", { name: /Records follow-up/ })).toBeVisible();
    await expect(page.getByText("Scheduled Client", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByRole("region", { name: "Supervisor team week" })).toBeVisible();
    await page.getByRole("button", { name: "agenda", exact: true }).click();
    await expect(page.getByRole("button", { name: /Scheduled Client.*Assessment scheduled/ }).first()).toBeVisible();
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
    await page.mouse.click(10, 10);
    await expect(queue).toHaveCount(0);

    await page.setViewportSize({ width: 430, height: 932 });
    await expect(page.getByRole("button", { name: "agenda", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBeTruthy();
  });

  test("preserves queue paging, assessment creation, collision override, and no-show mutation", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-09T12:00:00.000Z"));
    const calendarRequests: CalendarRequest[] = [];
    const createAssessmentRequests: Record<string, unknown>[] = [];
    const scheduleRequests: Array<{ assessmentId: string; body: Record<string, unknown> }> = [];
    let scheduleAttempts = 0;

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
    await queue.locator("li").filter({ hasText: "Ready Adams" }).getByRole("button", { name: "Schedule", exact: true }).click();

    const scheduleDialog = page.getByRole("dialog").filter({ hasText: "Ready Adams" });
    await scheduleDialog.getByLabel("Date and time").fill("2026-09-10T09:00");
    await scheduleDialog.getByLabel("Method").selectOption("zoom");
    await scheduleDialog.getByLabel("Zoom link").fill("https://zoom.us/j/calendar-characterization");
    await scheduleDialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(scheduleDialog.getByRole("alert")).toContainText("overlapping appointment");
    await expect(scheduleDialog.getByRole("button", { name: "Schedule anyway" })).toBeVisible();
    await scheduleDialog.getByRole("button", { name: "Schedule anyway" }).click();
    await expect(scheduleDialog).toHaveCount(0);

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

    page.on("dialog", (dialog) => dialog.accept());
    await page.locator('button[title^="Scheduled Client - Assessment scheduled"]').first().click();
    const itemDrawer = page.getByRole("dialog", { name: "Calendar item" });
    await expect(itemDrawer.getByRole("link", { name: /Join Zoom/ })).toHaveAttribute("href", "https://zoom.us/j/existing-assessment");
    await itemDrawer.getByRole("button", { name: "Mark no-show" }).click();
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
});

function calendarRequest(route: Route): CalendarRequest {
  const url = new URL(route.request().url());
  expect(url.searchParams.get("include_assignments")).toBe("false");
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

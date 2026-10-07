import { expect, test } from "@playwright/test";
import { defaultPipelineHomeDashboardLayout } from "../../lib/pipeline/home-dashboard-layout";

// Home customization is persisted on the server in desktop mode, not just in
// this test context. Reset it so ordering and previous specs cannot change Home.
test.beforeEach(async ({ request }, testInfo) => {
  if (testInfo.title === "shows only the Pipeline census briefing in Reports") return;
  const response = await request.put("/api/me/home-layout", { data: { layout: defaultPipelineHomeDashboardLayout() } });
  expect(response.ok()).toBe(true);
});
test.afterEach(async ({ request }, testInfo) => {
  if (testInfo.title === "shows only the Pipeline census briefing in Reports") return;
  const response = await request.put("/api/me/home-layout", { data: { layout: defaultPipelineHomeDashboardLayout() } });
  expect(response.ok()).toBe(true);
});

const testAssessor = {
  id: "provisional:allo:annette",
  name: "Annette Everhart",
} as const;

function emptyContinuity() {
  return {
    resume_items: [],
    new_assignments: [],
    assignment_tracking_started_at: null,
    needs_assignment_tracking_initialization: false,
    unavailable: false,
  };
}

test.describe("role-scoped home and reports", () => {
  for (const role of ["reviewer", "viewer", "assessment_coordinator", "admin"]) {
    test(`restricts Reports navigation and direct entry for ${role}`, async ({ page }) => {
      await page.route("**/api/auth/me", async (route) => {
        const response = await route.fetch();
        const payload = await response.json();
        payload.user.roles = [role];
        await route.fulfill({ response, json: payload });
      });
      let reportRequests = 0;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/clinical/census") reportRequests += 1;
      });
      await page.goto("/?screen=operations");
      const allowed = role === "admin" || role === "assessment_coordinator";
      if (allowed) {
        await expect(page.getByRole("button", { name: "Open reports", exact: true })).toBeVisible();
        await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
        await expect(page.getByTestId("operations-workspace")).toBeVisible();
      } else {
        await expect(page).not.toHaveURL(/screen=operations/);
        await expect(page.getByRole("button", { name: "Open reports", exact: true })).toHaveCount(0);
        await expect(page.getByTestId("operations-workspace")).toHaveCount(0);
        expect(reportRequests).toBe(0);
      }
    });
  }

  test("hides Reports from a supervisor who is not on the approved identity list", async ({ page }) => {
    await page.route("**/api/auth/me", async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.user.id = "unapproved-supervisor@aaahealthservices.com";
      payload.user.email = "unapproved-supervisor@aaahealthservices.com";
      payload.user.roles = ["assessment_coordinator"];
      await route.fulfill({ response, json: payload });
    });
    await page.goto("/?screen=operations");
    await expect(page).not.toHaveURL(/screen=operations/);
    await expect(page.getByRole("button", { name: "Open reports", exact: true })).toHaveCount(0);
  });

  test("presents the operational briefing without dashboard clutter", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "New assignments", exact: true }).click();
    await expect(page.getByRole("region", { name: "Since your last visit" })).toBeVisible();
    await page.getByRole("tab", { name: "Board", exact: true }).click();
    await page.getByRole("tab", { name: "Upcoming assessments", exact: true }).click();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
    await page.getByRole("tab", { name: "Board", exact: true }).click();
    await expect(page.getByRole("region", { name: "Search", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Continue working", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Recent" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Data completion" })).toHaveCount(0);
    await expect(page.getByText("Team view", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Email to decision flow", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Community snapshot", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Last 24 hours" })).toHaveCount(0);
  });

  test("customizes, reorders, saves, and restores the user's Home modules", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "Edit Home", exact: true }).click();
    await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Search" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Continue working" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add module" }).click();

    const library = page.getByRole("dialog", { name: "Home module library" });
    await expect(library).toBeVisible();
    await library.getByRole("checkbox", { name: "Search", exact: true }).check();
    await library.getByRole("checkbox", { name: "Recent work", exact: true }).check();
    await library.getByRole("checkbox", { name: "Assessments to schedule" }).check();
    await expect(library.getByRole("checkbox", { name: "Board" })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Assessments to schedule" })).toHaveCount(0);
    await library.getByRole("button", { name: "Add 3 modules", exact: true }).click();
    await expect(library).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add module", exact: true })).toBeFocused();

    await expect(page.getByRole("region", { name: "Assessments to schedule" })).toBeVisible();
    await page.getByRole("button", { name: "Remove Upcoming assessments from Home" }).click();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toHaveCount(0);

    await page.getByRole("button", { name: "Move Assessments to schedule", exact: true }).press("ArrowUp");
    await page.getByRole("button", { name: "Move Assessments to schedule", exact: true }).press("ArrowUp");
    await page.getByRole("button", { name: "Move Assessments to schedule", exact: true }).press("ArrowUp");
    await page.getByRole("button", { name: "Move Assessments to schedule", exact: true }).press("ArrowUp");
    await expect.poll(async () => page.locator("[data-home-module]").evaluateAll((elements) => (
      elements.map((element) => element.getAttribute("data-home-module"))
    ))).toEqual(["current-work", "scheduling-queue", "new-assignments", "search", "recent-work"]);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).not.toHaveURL(/editHome=1/);
    await expect(page.getByRole("button", { name: "Edit Home" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("region", { name: "Assessments to schedule" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toHaveCount(0);
    await expect.poll(async () => page.locator("[data-home-module]").evaluateAll((elements) => (
      elements.map((element) => element.getAttribute("data-home-module"))
    ))).toEqual(["current-work", "new-assignments", "scheduling-queue", "search", "recent-work"]);

    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/settings");
    await page.getByRole("link", { name: "Edit Home", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add module" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Done" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("keeps new assignments visible until the user explicitly acknowledges them", async ({ page }) => {
    const assignment = {
            event_id: "home-activity-1",
            action: "referral_assigned",
            actor_id: "coordinator-1",
            actor_name: "Case Coordinator",
            created_at: "2026-09-04T15:30:00.000Z",
            workspace: {
              referral_id: 424243,
              client_name: "Home Activity Client",
              community: "San Pablo",
              owner_id: "playwright",
              owner: "Playwright QA",
              workflow_status: "assessment_scheduled",
              priority: "standard",
              workspace_status: "active",
            },
            attention: null,
    };
    await page.route("**/api/operations/home", async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.continuity = {
        resume_items: [],
        new_assignments: [assignment],
        assignment_tracking_started_at: "2026-09-04T12:00:00.000Z",
        needs_assignment_tracking_initialization: false,
        unavailable: false,
      };
      await route.fulfill({ response, json: payload });
    });
    let acknowledgment: unknown = null;
    await page.route("**/api/me/work-continuity", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.acknowledgeAssignmentIds) acknowledgment = body;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: { schema: 1, acknowledgedAssignmentIds: [assignment.event_id] } }) });
    });

    await page.goto("/");
    await page.getByRole("tab", { name: "New assignments", exact: true }).click();
    const summary = page.getByRole("region", { name: "Since your last visit" });
    await expect(summary).toContainText("Home Activity Client");
    await expect(summary).toContainText("New assignments");
    await expect(summary.getByRole("button", { name: /Home Activity Client/ })).toContainText("Assigned");
    expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("pipeline:last-activity-visit:")))).toBe(false);

    await summary.getByRole("button", { name: /Home Activity Client/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("424243");
    await expect.poll(() => acknowledgment).toEqual({ acknowledgeAssignmentIds: [assignment.event_id] });
  });

  test("returns only current personal assignments from the assignment feed", async ({ page }) => {
    const delegated = await page.request.post("/api/auth/assessor-session", {
      data: { target_principal_id: testAssessor.id },
    });
    expect(delegated.status(), await delegated.text()).toBe(200);
    const createdAt = new Date().toISOString();
    const created = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `home-assignment-${Date.now()}`,
        assignee_id: testAssessor.id,
        referral: {
          name: `New Assignment ${Date.now()}`,
          date: createdAt.slice(0, 10),
          stage: "New",
          community: "San Pablo",
          source: "Home assignment feed test",
          priority: "standard",
          tags: [],
          documentName: "",
          documentStatus: "Missing",
          owner: testAssessor.name,
          note: "",
          createdAt,
          dob: "",
          phone: "",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    const createdPayload = await created.json() as { referral: { id: number; ownerId?: string } };
    expect(created.status(), JSON.stringify(createdPayload)).toBe(201);

    const since = new Date(Date.parse(createdAt) - 60_000).toISOString();
    const response = await page.request.get(`/api/operations/activity?scope=assigned&limit=20&since=${encodeURIComponent(since)}`);
    const payload = await response.json() as {
      scope: string;
      items: Array<{ action: string; workspace: { referral_id: number; owner_id: string | null } }>;
    };
    expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
    expect(payload.scope).toBe("assigned");
    expect(payload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "referral_assigned",
        workspace: expect.objectContaining({
          referral_id: createdPayload.referral.id,
          owner_id: createdPayload.referral.ownerId,
        }),
      }),
    ]));
    expect(payload.items.every((item) => item.action === "referral_assigned")).toBeTruthy();
  });

  test("keeps the assessor home personal and omits supervisor metrics", async ({ page }) => {
    await page.route("**/api/me/home-layout", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ layout: null }),
    }));
    await page.route("**/api/operations/home", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: "2026-09-03T12:00:00.000Z",
          scope: "personal",
          viewer: { id: "assessor-1", name: "Alex Assessor" },
          current_work: { total: 0, items: [] },
          workflow: {
            generated_at: "2026-09-03T12:00:00.000Z",
            active_total: 0,
            unassigned_total: 0,
            overall_completion_pct: null,
            flow_counts: {
              ready_to_schedule: 0,
              scheduled: 0,
              assessment: 0,
              complete_chart: 0,
            },
            active_items: [],
            ready_to_schedule: { total: 0, items: [] },
            data_completion: { total: 0, items: [] },
            current_work: {
              generated_at: "2026-09-03T12:00:00.000Z",
              owner: { id: "assessor-1", name: "Alex Assessor" },
              total: 0,
              items: [],
            },
          },
          upcoming: [],
          unscheduled: [],
          unscheduled_total: 0,
          continuity: emptyContinuity(),
          unavailable_sections: [],
        }),
      });
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toHaveCount(0);
    await expect(page.getByText("Your work", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work", exact: true })).toContainText("No referrals here");
    await expect(page.getByRole("dialog", { name: "Current work" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open current work" }).click();
    await expect(page).toHaveURL(/work=current/);
    await expect(page.getByRole("dialog", { name: "Current work" })).toContainText("No referrals here");
    await page.getByRole("button", { name: "Close current work" }).click();
    await expect(page).not.toHaveURL(/work=current/);
    await page.getByRole("tab", { name: "Upcoming assessments", exact: true }).click();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toContainText("No assessments are scheduled");
    await expect(page.getByRole("region", { name: "Data completion" })).toHaveCount(0);
  });

  test("opens current work as a URL-backed focus view and returns to it from a referral", async ({ page }) => {
    await page.route("**/api/operations/home", async (route) => {
      const item = {
        referral_id: 424242,
        client_name: "Morgan Test",
        community: "San Pablo",
        stage: "Pre-Admission Packet",
        workflow_status: "ready_to_schedule",
        owner: "Alex Assessor",
        priority: "standard",
        categories: ["ready_to_schedule"],
        primary_category: "ready_to_schedule",
        flow_state: "ready_to_schedule",
        next_action: "Schedule the assessment",
        blockers: [],
        missing_data: [],
        urgency: "normal",
        due_at: null,
        last_activity_at: "2026-09-03T12:00:00.000Z",
        age_hours: 2,
        completion_pct: 40,
        missing_document_count: 0,
        location: { view: "assessment" },
        board: { stage: "received", detail: "Referral received", next_action: "Add referral information", location: { view: "intake" } },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: "2026-09-03T12:00:00.000Z",
          scope: "personal",
          viewer: { id: "assessor-1", name: "Alex Assessor" },
          current_work: { total: 1, items: [] },
          workflow: {
            generated_at: "2026-09-03T12:00:00.000Z",
            active_total: 1,
            unassigned_total: 0,
            overall_completion_pct: 40,
            flow_counts: { ready_to_schedule: 1, scheduled: 0, assessment: 0, complete_chart: 0 },
            active_items: [item],
            ready_to_schedule: { total: 1, items: [item] },
            data_completion: { total: 0, items: [] },
            current_work: {
              generated_at: "2026-09-03T12:00:00.000Z",
              owner: { id: "assessor-1", name: "Alex Assessor" },
              total: 1,
              items: [],
            },
          },
          upcoming: [],
          unscheduled: [],
          unscheduled_total: 0,
          continuity: emptyContinuity(),
          unavailable_sections: [],
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Open current work" }).click();
    await expect(page).toHaveURL(/work=current/);
    await expect(page.getByRole("dialog", { name: "Current work" })).toBeVisible();

    await page.getByRole("dialog", { name: "Current work", exact: true }).getByRole("button", { name: "Open Morgan Test" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("424242");

    await page.goBack();
    await expect(page.getByRole("dialog", { name: "Current work" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/work=current/);
    await expect(page.getByRole("dialog", { name: "Current work" })).toHaveCount(0);
  });

  test("shows the lifecycle Board expanded above the remaining Home modules", async ({ page }) => {
    const stages = ["ready_to_schedule", "scheduled", "assessment", "complete_chart"] as const;
    const statuses = ["ready_to_schedule", "assessment_scheduled", "assessment_in_progress", "decision_pending"] as const;
    const firstNames = ["Avery", "Blake", "Casey", "Dana", "Elliot", "Finley", "Gray", "Harper", "Indigo", "Jules", "Kai"];
    const items = Array.from({ length: 11 }, (_, index) => ({
      referral_id: 6001 + index,
      client_name: `${firstNames[index]} Ribbon`,
      community: "San Pablo",
      stage: "Pre-Admission Packet",
      workflow_status: statuses[index % stages.length],
      owner: "Alex Assessor",
      priority: "standard",
      categories: [stages[index % stages.length]],
      primary_category: stages[index % stages.length],
      flow_state: stages[index % stages.length],
      next_action: "Open the next assessment action",
      blockers: [],
      missing_data: [],
      urgency: "normal",
      due_at: null,
      last_activity_at: "2026-09-03T12:00:00.000Z",
      age_hours: 2,
      completion_pct: 40,
      missing_document_count: 0,
      location: { view: "assessment" },
      board: { stage: ["received", "in_progress", "in_progress", "decision"][index % statuses.length], detail: ["Referral received", "Assessment scheduled", "Assessment underway", "Under review"][index % statuses.length], next_action: "Open the next assessment action", location: { view: "assessment" } },
    }));
    const flowCounts = {
      ready_to_schedule: 3,
      scheduled: 3,
      assessment: 3,
      complete_chart: 2,
    };
    const boardItems = [
      ...items,
      { ...items[0], referral_id: 7001, client_name: "Mara Denied", workflow_status: "declined", outcome_state: "declined", flow_state: "complete", next_action: "Decision recorded", board: { stage: "decision", detail: "Denied", next_action: "Review decision", location: { view: "workflow" } } },
      { ...items[0], referral_id: 7002, client_name: "Nora Admitted", workflow_status: "admitted", outcome_state: "accepted", flow_state: "complete", next_action: "Admission recorded", board: { stage: null, detail: "Completed", next_action: "Open workspace", location: { view: "chart" } } },
    ];
    await page.route("**/api/operations/home", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generated_at: "2026-09-03T12:00:00.000Z",
        scope: "team",
        viewer: { id: "supervisor-1", name: "Alex Supervisor" },
        current_work: { total: items.length, items: [] },
        workflow: {
          generated_at: "2026-09-03T12:00:00.000Z",
          active_total: items.length,
          unassigned_total: 0,
          overall_completion_pct: 40,
          flow_counts: flowCounts,
          active_items: items,
          board_items: boardItems,
          ready_to_schedule: { total: 3, items: items.filter((item) => item.flow_state === "ready_to_schedule") },
          data_completion: { total: 0, items: [] },
          current_work: { generated_at: "2026-09-03T12:00:00.000Z", owner: { id: "supervisor-1", name: "Alex Supervisor" }, total: items.length, items: [] },
        },
        upcoming: [],
        unscheduled: [],
        unscheduled_total: 0,
        continuity: emptyContinuity(),
        unavailable_sections: [],
      }),
    }));

    await page.goto("/");
    const homeModule = page.getByRole("region", { name: "Current work", exact: true });
    await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveCount(1);
    await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(homeModule.getByText("Team referrals", { exact: true })).toHaveCount(0);
    const homeBoard = homeModule.getByRole("region", { name: "Current work board" });
    await expect(homeBoard.locator("[data-board-card]")).toHaveCount(12);
    for (const stage of ["Referral received", "In progress", "Decision"]) await expect(homeBoard.getByRole("heading", { name: stage })).toBeVisible();
    await expect(page.locator("[data-home-module]").first()).toHaveAttribute("data-home-module", "current-work");
    await expect(page.getByRole("tab", { name: "Upcoming assessments", exact: true })).toBeVisible();
    await expect(homeModule.getByRole("button", { name: /^(Collapse|Expand) Board$/ })).toHaveCount(0);
    await expect(homeBoard).toBeVisible();
    await page.getByRole("button", { name: "Open current work" }).click();
    const board = page.getByRole("dialog", { name: "Current work", exact: true }).getByRole("region", { name: "Current work board" });
    const cards = board.locator("[data-board-card]");
    await expect(cards).toHaveCount(12);
    await expect(board.getByRole("button", { name: "Open Kai Ribbon" })).toBeVisible();
    for (const stage of ["Referral received", "In progress", "Decision"]) await expect(board.getByRole("heading", { name: stage })).toBeVisible();
    await expect(board.getByRole("button", { name: "Open Blake Ribbon" })).toContainText("Assessment scheduled");
    await expect(board.getByRole("button", { name: "Open Dana Ribbon" })).toContainText("Under review");
    await expect(board.getByRole("button", { name: "Open Mara Denied", exact: true })).toContainText("Denied");
    await expect(board.getByRole("button", { name: "Open Nora Admitted", exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => board.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await board.getByRole("combobox", { name: "Referral stage" }).selectOption("in_progress");
    await expect(board.getByRole("button", { name: "Open Kai Ribbon" })).toContainText("Alex Assessor");
    await board.getByRole("button", { name: "Open Kai Ribbon" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("6011");
    await page.goBack();
    await board.getByRole("combobox", { name: "Referral stage" }).selectOption("in_progress");
    await expect(board.getByRole("button", { name: "Open Kai Ribbon" })).toBeVisible();
    await expect(board.locator("[data-board-card]")).toHaveCount(12);
  });

  test("shows only the Pipeline census briefing in Reports", async ({ page }) => {
    let legacyReportRequests = 0;
    let censusRequests = 0;
    let censusAvailable = true;
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/operations/reports" || path === "/api/operations/briefing") legacyReportRequests += 1;
      if (path === "/api/clinical/census") censusRequests += 1;
    });
    await page.route("**/api/clinical/census", (route) => censusAvailable ? route.fulfill({ status: 200, json: {
      source: "alamo_platform", snapshot_id: "test-census", generated_at: "2026-09-28T15:00:00Z",
      data_as_of: "2026-09-28", retrieved_at: "2026-09-28T15:00:00Z",
      freshness: { status: "fresh", age_hours: 0, max_age_hours: 24, warning: null },
      portfolio_census_total: 108, roster_count: 108, reconciliation_status: "matched", delta: 0,
      communities: [
        { community_id: "337", community_name: "San Pablo", city: "San Pablo", state: "CA", current_census: 72, roster_count: 72, reconciliation_status: "matched", delta: 0 },
        { community_id: "342", community_name: "Victoria's House", city: "San Francisco", state: "CA", current_census: 36, roster_count: 36, reconciliation_status: "matched", delta: 0 },
      ],
    } }) : route.fulfill({ status: 503, json: { error: "Clinical data is not connected. Configure the Alamo Platform clinical API first." } }));

    await page.goto("/?screen=operations");
    await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
    await expect(page.getByTestId("operations-workspace")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Census briefing" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Census metrics" })).toContainText("108");
    await expect(page.getByText("San Pablo", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Platform" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Report", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Exceptions", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
    expect(legacyReportRequests).toBe(0);
    expect(censusRequests).toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.getByRole("main", { name: "Reports" }).evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    censusAvailable = false;
    await page.reload();
    await expect(page.getByTestId("operations-workspace").getByRole("alert")).toContainText("Current census information is unavailable in Pipeline right now");
    await expect(page.getByText("Connect Platform")).toHaveCount(0);
    censusAvailable = true;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("region", { name: "Census metrics" })).toContainText("108");
  });
});

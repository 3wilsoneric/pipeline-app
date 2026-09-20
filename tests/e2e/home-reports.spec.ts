import { expect, test } from "@playwright/test";

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
        if (new URL(request.url()).pathname === "/api/operations/reports") reportRequests += 1;
      });
      await page.goto("/?screen=operations");
      const allowed = role === "admin" || role === "assessment_coordinator";
      if (allowed) {
        await expect(page.getByRole("button", { name: "Open reports", exact: true })).toBeVisible();
        await expect(page.getByLabel("Report", { exact: true })).toBeVisible();
        await expect.poll(() => reportRequests).toBeGreaterThan(0);
      } else {
        await expect(page).not.toHaveURL(/screen=operations/);
        await expect(page.getByRole("button", { name: "Open reports", exact: true })).toHaveCount(0);
        await expect(page.getByLabel("Report", { exact: true })).toHaveCount(0);
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
    await expect(page.getByRole("region", { name: "Current work", exact: true })).toContainText("No active referral work");
    await expect(page.getByRole("dialog", { name: "Current work" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open current work" }).click();
    await expect(page).toHaveURL(/work=current/);
    await expect(page.getByRole("dialog", { name: "Current work" })).toContainText("No active referral work");
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
    }));
    const flowCounts = {
      ready_to_schedule: 3,
      scheduled: 3,
      assessment: 3,
      complete_chart: 2,
    };
    const boardItems = [
      ...items,
      { ...items[0], referral_id: 7001, client_name: "Mara Denied", workflow_status: "declined", outcome_state: "declined", flow_state: "complete", next_action: "Decision recorded" },
      { ...items[0], referral_id: 7002, client_name: "Nora Admitted", workflow_status: "admitted", outcome_state: "accepted", flow_state: "complete", next_action: "Admission recorded" },
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
    await expect(homeBoard.getByRole("button", { name: /^Open / })).toHaveCount(11);
    for (const stage of ["Referral received", "In progress", "Decision"]) await expect(homeBoard.getByRole("heading", { name: stage })).toBeVisible();
    await expect(page.locator("[data-home-module]").first()).toHaveAttribute("data-home-module", "current-work");
    await expect(page.locator('[data-home-module="upcoming-assessments"]')).toBeVisible();
    await expect(homeModule.getByRole("button", { name: /^(Collapse|Expand) Board$/ })).toHaveCount(0);
    await expect(homeBoard).toBeVisible();
    await page.getByRole("button", { name: "Open current work" }).click();
    const board = page.getByRole("dialog", { name: "Current work", exact: true }).getByRole("region", { name: "Current work board" });
    const cards = board.getByRole("button", { name: /^Open / });
    await expect(cards).toHaveCount(11);
    await expect(board.getByRole("button", { name: "Open Kai Ribbon" })).toBeVisible();
    for (const stage of ["Referral received", "In progress", "Decision"]) await expect(board.getByRole("heading", { name: stage })).toBeVisible();
    await expect(board.getByRole("button", { name: "Open Blake Ribbon" })).toContainText("Assessment scheduled");
    await expect(board.getByRole("button", { name: "Open Dana Ribbon" })).toContainText("Under review");
    await board.locator("summary").click();
    await expect(board.getByRole("button", { name: /Mara Denied.*Declined/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /Nora Admitted.*Admitted/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => board.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await board.getByRole("combobox", { name: "Referral stage" }).selectOption("in_progress");
    await expect(board.getByRole("button", { name: "Open Kai Ribbon" })).toContainText("Alex Assessor");
    await board.getByRole("button", { name: "Open Kai Ribbon" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("6011");
    await page.goBack();
    await board.getByRole("combobox", { name: "Referral stage" }).selectOption("in_progress");
    await expect(board.getByRole("button", { name: "Open Kai Ribbon" })).toBeVisible();
    await expect(board.locator('button[aria-label^="Open "]')).toHaveCount(11);
  });

  test("runs a report, exposes only contextual filters, and exports the current scope", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open reports" }).click();

    await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reports", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("combobox", { name: "Report", exact: true })).toHaveValue("clients_by_community");
    await expect(page.getByRole("region", { name: "Report results" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
    let releaseReport!: () => void;
    const reportGate = new Promise<void>((resolve) => { releaseReport = resolve; });
    await page.route("**/api/operations/reports**", async (route) => {
      await reportGate;
      await route.continue();
    });
    try {
      await page.getByRole("combobox", { name: "Report", exact: true }).selectOption("assessment_schedule");
      await expect(page.getByRole("status").filter({ hasText: "Updating report..." })).toBeVisible();
      await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    } finally {
      releaseReport();
    }
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
    await expect(page.getByRole("region", { name: "Report results" }).locator("time")).toBeVisible();
    await page.unroute("**/api/operations/reports**");
    await expect(page.getByLabel("Report month")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report community" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report owner" })).toBeVisible();

    await page.getByRole("combobox", { name: "Report", exact: true }).selectOption("assessment_completion");
    await expect(page.getByLabel("Report month")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report community" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Report owner" })).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^pipeline-assessment_completion-\d{4}-\d{2}\.csv$/);
    const results = page.getByRole("region", { name: "Report results" });
    const generatedAt = await results.locator("time").getAttribute("datetime");
    await page.route("**/api/operations/reports**", (route) => route.fulfill({
      status: 500, json: { error: "Report unavailable." },
    }));
    await page.getByLabel("Report month").fill("2020-01");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Report unavailable." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    await expect(results.locator("time")).toHaveAttribute("datetime", generatedAt!);
    const animations = await results.locator(".pipeline-feedback-cue").evaluate(async (element) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return element.getAnimations().length;
    });
    expect(animations).toBe(0);
  });

  test("turns canonical supervisor exceptions into direct recovery work", async ({ page }) => {
    await page.route("**/api/operations/supervisor-queue", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: "2026-09-08T17:00:00.000Z",
          total: 3,
          counts: {
            unassigned_referral: 1,
            decision_needed: 1,
            resident_link_collision: 1,
          },
          items: [
            {
              id: "unassigned_referral:424242",
              kind: "unassigned_referral",
              severity: "critical",
              label: "Referral has no owner",
              detail: "Assign an accountable assessor.",
              referral_id: 424242,
              resident_link_id: null,
              client_name: "Zachary Laman- LA JAIL",
              community: "San Pablo",
              owner: null,
              due_at: "2026-09-07T17:00:00.000Z",
              age_hours: 24,
              profile_id: "pipeline-client-424242",
            },
            {
              id: "decision_needed:424243",
              kind: "decision_needed",
              severity: "attention",
              label: "Admission decision is needed",
              detail: "Review the signed assessment and recommendation.",
              referral_id: 424243,
              resident_link_id: null,
              client_name: "Morgan Rivera",
              community: "San Francisco",
              owner: "Annette Everhart",
              due_at: null,
              age_hours: 6,
              profile_id: "pipeline-client-424243",
            },
            {
              id: "resident_link_collision:link-1",
              kind: "resident_link_collision",
              severity: "review",
              label: "Resident link collision needs review",
              detail: "Verify the governed resident identity before connecting records.",
              referral_id: null,
              resident_link_id: "link-1",
              client_name: "Taylor Morgan",
              community: "San Pablo",
              owner: null,
              due_at: null,
              age_hours: 3,
              profile_id: "resident-42",
            },
          ],
        }),
      });
    });

    await page.goto("/?screen=operations");
    await page.getByRole("button", { name: "Exceptions", exact: true }).click();
    const commandCenter = page.getByRole("region", { name: "Supervisor command center" });
    await expect(commandCenter).toBeVisible();
    await expect(commandCenter.getByText("Zachary Laman", { exact: true })).toBeVisible();
    await expect(commandCenter.getByText("Zachary Laman- LA JAIL", { exact: true })).toHaveCount(0);
    await expect(commandCenter.getByText("Unassigned", { exact: true })).toHaveCount(2);
    await expect(commandCenter.getByText("Annette Everhart", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await commandCenter.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await commandCenter.getByRole("button", { name: "Assign for Zachary Laman" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("424242");

    await page.goBack();
    await expect(commandCenter).toBeVisible();
    await commandCenter.getByRole("button", { name: "Review match for Taylor Morgan" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("clientId")).toBe("resident-42");
  });

  test("keeps experimental assessment patterns out of Reports", async ({ page }) => {
    let graphRequests = 0;
    await page.route("**/api/operations/work-assessment-graph", async (route) => {
      graphRequests += 1;
      await route.abort();
    });

    await page.goto("/?screen=operations");
    await expect(page.getByRole("article", { name: "Clients by community report" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Report results" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Work assessment graph" })).toHaveCount(0);
    expect(graphRequests).toBe(0);
  });

  test("keeps the report workflow available when the command-center queue is unavailable", async ({ page }) => {
    await page.route("**/api/operations/supervisor-queue", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Supervisor queue is temporarily unavailable." }),
      });
    });

    await page.goto("/?screen=operations");

    await page.getByRole("button", { name: "Exceptions", exact: true }).click();
    const commandCenter = page.getByRole("region", { name: "Supervisor command center" });
    await expect(commandCenter.getByRole("alert")).toContainText("Supervisor queue is temporarily unavailable.");
    await expect(commandCenter.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Report results" })).toBeVisible();
  });
});

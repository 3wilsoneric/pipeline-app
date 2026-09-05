import { expect, test } from "@playwright/test";

test.describe("role-scoped home and reports", () => {
  test("presents the operational briefing without dashboard clutter", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Since your last visit" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Data completion" })).toHaveCount(0);
    await expect(page.getByText("Team view", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Email to decision flow", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Community snapshot", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Last 24 hours" })).toHaveCount(0);
  });

  test("customizes, reorders, saves, and restores the user's Home modules", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    await page.getByRole("button", { name: "Edit Home" }).click();
    await page.getByRole("button", { name: "Add module" }).click();

    const library = page.getByRole("dialog", { name: "Home module library" });
    await expect(library).toBeVisible();
    const schedulingCard = library.locator("article").filter({ hasText: "Assessments to schedule" });
    await schedulingCard.getByRole("button", { name: "Add" }).click();
    await library.getByRole("button", { name: "Done" }).click();

    await expect(page.getByRole("region", { name: "Assessments to schedule" })).toBeVisible();
    await page.getByRole("button", { name: "Remove Upcoming assessments from Home" }).click();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toHaveCount(0);

    await page.getByRole("button", { name: "Move Assessments to schedule", exact: true }).press("ArrowUp");
    await page.getByRole("button", { name: "Move Assessments to schedule", exact: true }).press("ArrowUp");
    await expect.poll(async () => page.locator("[data-home-module]").evaluateAll((elements) => (
      elements.map((element) => element.getAttribute("data-home-module"))
    ))).toEqual(["scheduling-queue", "current-work", "new-assignments"]);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "Edit Home" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("region", { name: "Assessments to schedule" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toHaveCount(0);
    await expect.poll(async () => page.locator("[data-home-module]").evaluateAll((elements) => (
      elements.map((element) => element.getAttribute("data-home-module"))
    ))).toEqual(["scheduling-queue", "current-work", "new-assignments"]);

    await page.setViewportSize({ width: 320, height: 720 });
    await page.getByRole("button", { name: "Edit Home" }).click();
    await expect(page.getByRole("button", { name: "Add module" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Done" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("summarizes referrals assigned since the last visit and opens the existing workspace", async ({ page }) => {
    await page.route("**/api/operations/activity?**", async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("scope")).toBe("assigned");
      expect(url.searchParams.get("limit")).toBe("6");
      expect(Date.parse(url.searchParams.get("since") ?? "")).not.toBeNaN();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: "2026-09-04T16:00:00.000Z",
          scope: "assigned",
          can_view_team: true,
          items: [{
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
          }],
        }),
      });
    });

    await page.goto("/");
    const summary = page.getByRole("region", { name: "Since your last visit" });
    await expect(summary).toContainText("Home Activity Client");
    await expect(summary).toContainText("New assignments");
    await expect(summary.getByRole("button", { name: /Home Activity Client/ })).toContainText("Assigned");
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("pipeline:last-activity-visit:")))).toBe(true);

    await summary.getByRole("button", { name: /Home Activity Client/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("424243");
  });

  test("returns only current personal assignments from the assignment feed", async ({ page }) => {
    const createdAt = new Date().toISOString();
    const created = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `home-assignment-${Date.now()}`,
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
          owner: "Playwright QA",
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
          unavailable_sections: [],
        }),
      });
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toHaveCount(0);
    await expect(page.getByText("Your work", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work" })).toContainText("0 active referrals");
    await expect(page.getByRole("dialog", { name: "Current work" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open current work" }).click();
    await expect(page).toHaveURL(/work=current/);
    await expect(page.getByRole("dialog", { name: "Current work" })).toContainText("No active referral work");
    await page.getByRole("button", { name: "Close current work" }).click();
    await expect(page).not.toHaveURL(/work=current/);
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
        next_action: "Schedule the assessment",
        blockers: [],
        missing_data: [],
        urgency: "normal",
        due_at: null,
        last_activity_at: "2026-09-03T12:00:00.000Z",
        age_hours: 2,
        completion_pct: 40,
        missing_document_count: 0,
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
          unavailable_sections: [],
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Open current work" }).click();
    await expect(page).toHaveURL(/work=current/);
    await expect(page.getByRole("dialog", { name: "Current work" })).toBeVisible();

    await page.getByRole("button", { name: "Open Morgan Test" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("424242");

    await page.goBack();
    await expect(page.getByRole("dialog", { name: "Current work" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/work=current/);
    await expect(page.getByRole("dialog", { name: "Current work" })).toHaveCount(0);
  });

  test("runs a report, exposes only contextual filters, and exports the current scope", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open reports" }).click();

    await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View Workspaces report" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", { name: "Report library" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Report results" })).toBeVisible();

    await page.getByRole("button", { name: "View Assessment calendar report" }).click();
    await expect(page.getByLabel("Report month")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report community" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report owner" })).toBeVisible();

    await page.getByRole("button", { name: "View Completed assessments report" }).click();
    await expect(page.getByLabel("Report month")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report community" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Report owner" })).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^pipeline-assessment_completion-\d{4}-\d{2}\.csv$/);
  });
});

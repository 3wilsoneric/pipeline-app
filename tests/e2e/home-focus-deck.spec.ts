import { expect, test, webkit, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { calendarToday } from "@/lib/pipeline/assessment-calendar";
import { getReferralBoardState } from "@/lib/pipeline/referral-flow";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { WorkspaceStateProjection } from "@/lib/pipeline/workspace-state";

// These UI tests supply the Home payload through request routes. A service worker
// can bypass those routes and show unrelated server fixtures instead.
test.use({ serviceWorkers: "block" });
test("accepted board cards show the highest-priority open admission items", () => {
  const requirement = {
    id: "tb-result",
    type: "tb_test",
    requiredFor: "move_in",
    status: "needed",
    label: "TB test result",
    blocker: true,
    dueAt: "2026-09-28T00:00:00Z",
    nextStep: "Request a current TB result and verify its date.",
  } as NonNullable<Referral["requirements"]>[number];
  const referral = {
    stage: "Assessment",
    workflowStatus: "approved_for_placement",
    requirements: [
      { ...requirement, id: "optional", type: "conservatorship_document", label: "Conservatorship evidence", blocker: false, dueAt: "2026-09-25T00:00:00Z" },
      requirement,
      { ...requirement, id: "medications", type: "medication_list", label: "Signed medication list", requiredFor: "admission_decision", dueAt: "2026-09-28T00:00:00Z" },
      { ...requirement, id: "agreement", type: "signed_admission_agreement", label: "Signed admission agreement", dueAt: "2026-09-29T00:00:00Z" },
    ],
  } as Referral;
  const state = {
    lifecycle: "active",
    outcome: "accepted",
    assessment: "signed",
    assessment_is_reassessment: false,
  } as WorkspaceStateProjection;

  expect(getReferralBoardState(referral, {}, state)).toMatchObject({
    stage: "decision",
    detail: "Accept",
    next_action: "Signed medication list, TB test result, Signed admission agreement",
    location: { view: "files" },
  });
  expect(getReferralBoardState({ ...referral, requirements: [{ ...requirement, status: "reviewed" }] }, {}, state)).toMatchObject({
    detail: "Awaiting admit",
    next_action: "Record admission",
  });
});

test("board folders show document work without an overall completion percentage", async ({ page }, testInfo) => {
  await homeFixture(page);
  await page.goto("/");
  const card = page.locator("[data-board-card]").first();
  await expect(card).toContainText(/1 document needed/);
  await expect(card).not.toContainText("File progress");
  await expect(card).not.toContainText(/\d+% complete/);
  await card.screenshot({ path: testInfo.outputPath("board-card.png"), animations: "disabled" });
});

for (const width of [1440, 390]) {
  test(`two board sections include received referrals and preserve status at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    await homeFixture(page, undefined, 2);
    await page.goto("/");
    await expect(page.locator("[data-board-stage]")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Open referral received folder", exact: true })).toHaveCount(0);
    for (const stage of ["in_progress", "decision"]) {
      const column = page.locator(`[data-board-stage="${stage}"]`);
      await expect(column).toBeVisible();
      const count = stage === "in_progress" ? 6 : 0;
      await expect(column.locator("[data-board-card]")).toHaveCount(0);
      await expect(column.locator("[data-open-folder]")).toContainText(`${count} files`);
      await expect(column.locator("[data-open-folder]")).toHaveCSS("border-top-color", stage === "in_progress" ? "rgb(47, 84, 200)" : "rgb(23, 113, 79)");

      if (stage === "in_progress") {
        await expect(page.getByRole("region", { name: "Recent clients" }).getByRole("button", { name: "Open Avery Rivera", exact: true })).toHaveAccessibleDescription("Referral received Resume");
        await expect(page.getByRole("region", { name: "Recent clients" }).getByRole("button", { name: "Open Jordan Rivera", exact: true })).toHaveAccessibleDescription("Assessment underway Resume");
      }
      await page.screenshot({ path: info.outputPath(`two-section-board-${width}-${stage}.png`), animations: "disabled" });
      await column.locator("[data-open-folder]").click();
      const folder = page.getByRole("dialog");
      await expect(folder).toBeVisible();
      await expect(folder.locator("[data-board-card]")).toHaveCount(count);
      await page.keyboard.press("Escape");
      await expect(folder).toHaveCount(0);
    }
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run("[data-current-work-board]", { runOnly: ["color-contrast"] })).violations;
    });
    expect(violations).toEqual([]);
  });
}

async function homeFixture(page: Page, moduleIds = ["current-work", "new-assignments", "upcoming-assessments"], filesPerStage = 0, withFinished = false, longLabels = false, scope?: "mixed" | "team-only", upcomingCount = 1, includeTeamRecents = false) {
  const acknowledgments: unknown[] = [];
  let layout = { schema: 3, module_ids: moduleIds, locked: true };
  const { viewer } = await (await page.request.get("/api/operations/home")).json();
  const appointmentDate = calendarToday();
  const appointments = Array.from({ length: upcomingCount }, (_, index) => ({
    id: `synthetic-appointment-${index}`, referralId: 910502 + index,
    clientName: upcomingCount === 1 ? "Jordan Appointment" : `Appointment Client ${["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet"][index] ?? "Additional"}`,
    community: "San Pablo", owner: viewer.name, ownerId: viewer.id,
    date: appointmentDate, startsAt: `${appointmentDate}T17:00:00Z`, method: "in_person",
    kind: "assessment", status: "scheduled", scheduleStatus: "scheduled", title: "Assessment",
  }));
  await page.route("**/api/calendar/events?**", async route => {
    const params = new URL(route.request().url()).searchParams;
    await route.fulfill({ json: { from: params.get("from"), to: params.get("to"), viewer, events: appointments } });
  });
  await page.addInitScript(({ key, layout }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(layout));
  }, { key: `pipeline:home-layout:v1:${encodeURIComponent(viewer.id)}`, layout });
  await page.route("**/api/me/home-layout", async (route) => {
    if (route.request().method() === "PUT") layout = route.request().postDataJSON().layout;
    await route.fulfill({ json: { layout } });
  });
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const item = {
      board: { stage: "received", detail: "Referral received", next_action: "Add referral information", location: { view: "intake" } },
      referral_id: 910501, client_name: "Avery Board", community: "San Pablo", stage: "New",
      workflow_status: "ready_to_schedule", flow_state: "ready_to_schedule", assessment_state: "not_started",
      outcome_state: "pending", assignment_state: "assigned", document_state: "partial", profile_state: "partial",
      assessment_is_reassessment: false, owner: "Example Assessor", priority: "standard", categories: [],
      primary_category: "follow_up", next_action: "Schedule the assessment", blockers: [], missing_data: [],
      urgency: "normal", due_at: null, last_activity_at: "2026-09-20T15:00:00Z", age_hours: 1,
      completion_pct: 40, missing_document_count: 1, location: { view: "intake" },
    };
    payload.unavailable_sections = [];
    const boardItems = filesPerStage ? [
      { name: "Avery", workflow_status: "ready_to_schedule", assessment_state: "not_started" },
      { name: "Jordan", workflow_status: "assessment_in_progress", assessment_state: "in_progress" },
      { name: "Morgan", workflow_status: "decision_pending", assessment_state: "signed" },
    ].flatMap((stage, stageIndex) => Array.from({ length: filesPerStage }, (_, index) => ({
      ...item, referral_id: 920000 + stageIndex * 100 + index,
      client_name: `${stage.name} ${["Rivera", "Brooks", "Chen", "Patel", "Torres", "Bennett", "Parker", "Reed", "Hayes", "Ellis"][index]}`,
      workflow_status: stage.workflow_status, assessment_state: stage.assessment_state,
      board: { stage: ["received", "in_progress", "decision"][stageIndex], detail: ["Referral received", "Assessment underway", "Under review"][stageIndex], next_action: ["Add referral information", "Continue assessment", "Record decision"][stageIndex], location: { view: ["intake", "assessment", "workflow"][stageIndex] } },
    }))) : [item];
    if (longLabels) Object.assign(boardItems[0], {
      client_name: "Alexandria Montgomery-Rivera", owner: "Christopher Montgomery-Williams",
      next_action: "Confirm the current medication list and the assessment location with the referring case manager.",
      board: { ...boardItems[0].board, next_action: "Confirm the current medication list and the assessment location with the referring case manager." },
    });
    payload.workflow = { ...payload.workflow, active_items: boardItems, board_items: boardItems, active_total: boardItems.length };
    if (withFinished) {
      payload.workflow.board_items = [...boardItems,
        { ...item, referral_id: 930001, client_name: "Accepted Client", workflow_status: "approved_for_placement", outcome_state: "accepted", flow_state: "complete_chart", board: { stage: "decision", detail: "Accept", next_action: "Signed medication list, TB test result, Signed admission agreement", location: { view: "files" } } },
        { ...item, referral_id: 930002, client_name: "Denied Client", workflow_status: "declined", outcome_state: "declined", flow_state: "complete", board: { stage: "decision", detail: "Denied", next_action: "Review decision", location: { view: "workflow" } } },
        { ...item, referral_id: 930003, client_name: "Admitted Client", workflow_status: "admitted", outcome_state: "accepted", flow_state: "complete", board: { stage: null, detail: "Admitted", next_action: "Send Meet the Client", location: { view: "email" } } },
        { ...item, referral_id: 930004, client_name: "Awaiting Client", workflow_status: "approved_for_placement", outcome_state: "accepted", flow_state: "complete", board: { stage: "decision", detail: "Awaiting admit", next_action: "Record admission", location: { view: "workflow" } } },
        { ...item, referral_id: 930005, client_name: "Reassessment Client", workflow_status: "assessment_in_progress", outcome_state: "accepted", assessment_state: "in_progress", board: { stage: "in_progress", detail: "Assessment underway", next_action: "Continue assessment", location: { view: "assessment" } } },
      ];
    }
    payload.workflow.all_board_items = [...payload.workflow.board_items];
    if (scope) {
      for (const [index, workflow_status] of ["ready_to_schedule", "assessment_in_progress", "approved_for_placement", "admitted"].entries()) {
        payload.workflow.all_board_items.push({ ...item, referral_id: 940000 + index, client_name: `Team ${["Rivera", "Brooks", "Chen", "Patel"][index]}`, workflow_status,
          owner: "Another Assessor", outcome_state: ["approved_for_placement", "admitted"].includes(workflow_status) ? "accepted" : "pending",
          board: { stage: ["received", "in_progress", "decision", null][index], detail: ["Referral received", "Assessment underway", "Awaiting admit", "Admitted"][index], next_action: "Open workspace", location: { view: "workflow" } } });
      }
      if (scope === "team-only") Object.assign(payload.workflow, { active_items: [], board_items: [], active_total: 0 });
    }
    payload.upcoming = appointments.slice(0, 8);
    payload.continuity = { ...payload.continuity, recent_referral_ids: payload.workflow.board_items.filter((item: { board: { stage: string | null } }) => item.board.stage !== null).map((item: { referral_id: number }) => item.referral_id), unavailable: false, needs_assignment_tracking_initialization: false,
      new_assignments: Array.from({ length: 7 }, (_, index) => ({ event_id: `focus-assignment-${index}`, action: "referral_assigned", actor_id: "coordinator", actor_name: "Example Coordinator", created_at: new Date().toISOString(), workspace: { referral_id: 910510 + index, client_name: `New Client ${index + 1}`, community: "San Pablo", owner: "Example Assessor", workflow_status: "intake_in_progress", workspace_status: "active" }, attention: null })),
    };
    if (includeTeamRecents) payload.continuity.recent_referral_ids.unshift(940000);
    await route.fulfill({ response, json: payload });
  });
  await page.route("**/api/me/work-continuity", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const body = route.request().postDataJSON();
    if (body.acknowledgeAssignmentIds) acknowledgments.push(body);
    await route.fulfill({ json: { state: { schema: 1, acknowledgedAssignmentIds: [] } } });
  });
  return acknowledgments;
}

for (const width of [1440]) test(`folder All and Mine switch instantly without changing stages at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await homeFixture(page, undefined, 2, true, false, "mixed");
  await page.goto("/");
  for (const [index, title] of ["In progress", "Clients in handoff"].entries()) {
    const opener = page.getByRole("button", { name: `Open ${title.toLowerCase()} folder`, exact: true });
    await opener.click();
    const folder = page.getByRole("dialog", { name: `${title} folder`, exact: true });
    const toggle = folder.getByRole("group", { name: "Folder scope" });
    await expect(toggle.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "true");
    await folder.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
    const mineCount = index === 0 ? 7 : 2;
    const extra = index === 0 ? 2 : 1;
    await expect(folder.locator("[data-board-card]")).toHaveCount(mineCount);
    // All data is already present. Even a disconnected browser can switch scopes.
    await page.context().setOffline(true);
    await toggle.getByRole("button", { name: "All", exact: true }).click();
    await expect(folder.locator("[data-board-card]")).toHaveCount(mineCount + extra);
    await expect(folder.getByRole("button", { name: `Open Team ${["Rivera", "Chen"][index]}`, exact: true })).toBeVisible();
    if (index === 1) await expect(folder.getByRole("button", { name: "Open Team Patel", exact: true })).toHaveCount(0);
    await expect(folder.locator("h2")).toContainText(`${mineCount + extra} files`);
    expect(await folder.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const box = await toggle.getByRole("button", { name: "All", exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (index === 0) await page.screenshot({ path: info.outputPath(`folder-scope-${width}.png`), animations: "disabled" });
    await toggle.getByRole("button", { name: "Mine", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(folder.locator("[data-board-card]")).toHaveCount(mineCount);
    await page.context().setOffline(false);
    await page.keyboard.press("Escape");
    await expect(folder).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

test("All is reachable when Mine is empty without pulling admitted referrals back into Decision", async ({ page }) => {
  await homeFixture(page, undefined, 0, false, false, "team-only");
  await page.goto("/");
  for (const title of ["In progress", "Clients in handoff"]) {
    await page.getByRole("button", { name: `Open ${title.toLowerCase()} folder`, exact: true }).click();
    const folder = page.getByRole("dialog", { name: `${title} folder`, exact: true });
    await expect(folder).toContainText("None assigned to you here.");
    await folder.getByRole("button", { name: "All", exact: true }).click();
    await expect(folder.locator("[data-board-card]").first()).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

for (const width of [1440, 834, 390, 320]) test(`Home ribbon opens its accessible schedule without retired Home items at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const acknowledged = await homeFixture(page);
  await page.goto("/");
  const home = page.locator('main');
  await expect(home.getByRole("tab")).toHaveCount(0);
  await expect(home.getByRole("heading", { name: "Board", exact: true })).toHaveCount(0);
  await expect(home.getByRole("button", { name: "New assignments", exact: true })).toHaveCount(0);
  await expect(home.getByText(/(?:Team|My) follow-up/)).toHaveCount(0);
  await expect(home.getByRole("button", { name: "Open Avery Board" })).toBeVisible();
  const upcoming = home.getByRole("button", { name: "Upcoming assessments", exact: true });
  await expect(upcoming).toContainText("1");
  expect((await upcoming.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  const priorities = home.locator("[data-home-priorities]");
  const buttons = priorities.locator("button");
  await expect(buttons).toHaveCount(3);
  const boxes = await buttons.evaluateAll(nodes => nodes.map(node => { const {x,y,width,height}=node.getBoundingClientRect(); return {x,y,width,height}; }));
  for (const box of boxes.slice(1)) { expect(box.height).toBeGreaterThanOrEqual(48); expect(box.height).toBeLessThanOrEqual(64); }
  expect(Math.abs(boxes[1].height - boxes[2].height)).toBeLessThan(2);
  expect(boxes[1].y).toBeCloseTo(boxes[2].y, 0);
  await expect(priorities.locator('[data-open-folder] svg')).toHaveCount(0);
  if (width >= 768) { expect(boxes[1].y).toBeLessThan(boxes[0].y + boxes[0].height); expect(boxes[1].width).toBeLessThan(boxes[2].width); }
  else { expect(boxes[1].y).toBeGreaterThan(boxes[0].y); expect(Math.abs(boxes[1].width - boxes[2].width)).toBeLessThan(2); }
  expect((await priorities.boundingBox())!.y).toBeLessThan((await home.getByRole("region", {name: "Recent clients"}).boundingBox())!.y);
  await priorities.screenshot({ path: info.outputPath(`home-priorities-${width}.png`), animations: "disabled" });
  await upcoming.focus();
  await page.keyboard.press("Enter");
  const schedule = page.getByRole("dialog", { name: "Upcoming assessments", exact: true });
  await expect(schedule).toBeVisible();
  await expect(schedule).toHaveAttribute("data-origin-motion", "true");
  await expect(schedule.locator("[data-calendar-day]")).toHaveCount(7);
  await expect(schedule.getByRole("button", { name: /Jordan Appointment/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await schedule.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await schedule.screenshot({ path: info.outputPath(`home-upcoming-${width}.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(schedule).toHaveCount(0);
  await expect(upcoming).toBeFocused();
  await expect(home.getByRole("button", { name: "Open Avery Board" })).toBeVisible();
  expect(acknowledged).toEqual([]);
});

test("schedule shortcut preserves its assessment destination", async ({ page }) => {
  await homeFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Upcoming assessments", exact: true }).click();
  await page.getByRole("dialog", { name: "Upcoming assessments", exact: true }).getByRole("button", { name: /Jordan Appointment/ }).click();
  await expect(page).toHaveURL(/referralId=910502/);
  await expect(page).toHaveURL(/workspaceStage=assessment/);
});

test("weekly schedule includes appointments beyond the Home summary limit", async ({ page }) => {
  await homeFixture(page, undefined, 0, false, false, undefined, 10);
  await page.goto("/");
  const open = page.getByRole("button", { name: "Upcoming assessments", exact: true });
  await expect(open).toContainText("8");
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Upcoming assessments", exact: true });
  await expect(dialog.getByRole("button", { name: /Appointment Client/ })).toHaveCount(10);
  const last = dialog.getByRole("button", { name: /Appointment Client Juliet/ });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
});

for (const unavailable of [false, true]) test(`Home ribbon distinguishes ${unavailable ? "unavailable" : "empty"} personal schedules`, async ({ page }) => {
  await homeFixture(page, undefined, 0, false, false, undefined, 0);
  if (unavailable) await page.route("**/api/calendar/events?**", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.upcoming = [];
    payload.unavailable_sections = unavailable ? ["upcoming"] : [];
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/");
  const open = page.getByRole("button", { name: "Upcoming assessments", exact: true });
  await expect(open).toContainText(unavailable ? "Unavailable" : "0");
  if (unavailable) await expect(open).not.toContainText("0");
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Upcoming assessments", exact: true });
  await expect(dialog).toContainText(unavailable ? "Upcoming assessments are unavailable." : "No assessments scheduled this week.");
  if (unavailable) await expect(dialog).not.toContainText("No assessments scheduled");
});

for (const width of [1440, 390]) test(`Home separates accepted handoffs from pending decisions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 });
  await homeFixture(page, undefined, 1, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Open clients in handoff folder", exact: true }).click();
  for (const [name, status, token] of [
    ["Accepted Client", "Accept", "--color-status-done"],
    ["Awaiting Client", "Awaiting admit", "--color-status-done"],
  ]) {
    const card = page.getByRole("dialog").getByRole("button", { name: `Open ${name}`, exact: true });
    await expect(card.locator("[data-board-status]")).toHaveText(status);
    const expected = await card.evaluate((element, token) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      element.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, token);
    await expect(card.locator("[data-board-status]")).toHaveCSS("color", expected);
  }
  await expect(page.getByRole("dialog").getByRole("button", { name: "Open Morgan Rivera", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Open Reassessment Client", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Denied Client", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Admitted Client", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Open Morgan Rivera", exact: true })).toHaveAccessibleDescription("Under review Record decision");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Open Reassessment Client", exact: true })).toHaveAccessibleDescription("Assessment underway Continue assessment");
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run("[data-current-work-board]", { runOnly: ["color-contrast"] })).violations;
  });
  expect(violations).toEqual([]);
});

test("Home customization preserves the ribbon and cannot restore retired modules", async ({ page }) => {
  await homeFixture(page, ["current-work", "search", "new-assignments", "upcoming-assessments"]);
  await page.goto("/?editHome=1");
  await expect(page.getByRole("button", { name: "Upcoming assessments", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Upcoming assessments from Home" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove New assignments from Home" })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove Search from Home" }).click();
  await page.getByRole("button", { name: "Add module", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Home module library", exact: true });
  await expect(library).toBeVisible();
  await expect(library.getByRole("heading", { name: "New assignments", exact: true })).toHaveCount(0);
  await expect(library.getByRole("heading", { name: "Upcoming assessments", exact: true })).toHaveCount(0);
  await expect(library.getByRole("checkbox", { name: "Search", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upcoming assessments", exact: true })).toHaveCount(1);
  await expect(page.locator('[data-home-module="search"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New assignments", exact: true })).toHaveCount(0);
});

for (const width of [1440, 834, 390, 320]) test(`stage folder expands in place with all thirty combined files at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await homeFixture(page, undefined, 10);
  await page.goto("/");
  const source = page.locator('[data-board-stage="in_progress"]');
  const open = source.getByRole("button", { name: "Open in progress folder", exact: true });
  await expect(open).toBeVisible();
  await expect(open).toContainText("In progress30 files");
  const hitArea = (await open.boundingBox())!;
  expect(hitArea.height).toBeGreaterThanOrEqual(48);
  expect(hitArea.width).toBeGreaterThan((await source.boundingBox())!.width * .85);
  if (width === 1440) {
    await page.getByRole("button", { name: "Upcoming assessments", exact: true }).hover();
    const before = (await source.boundingBox())!;
    await open.hover();
    expect((await source.boundingBox())!.width).toBe(before.width);
  }
  const originalUrl = page.url();
  let homeReads = 0;
  page.on("request", request => { if (request.url().endsWith("/api/operations/home")) homeReads++; });
  await open.click({ position: { x: hitArea.width - 12, y: hitArea.height / 2 } });
  const dialog = page.getByRole("dialog", { name: "In progress folder", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
  await expect(dialog.getByRole("heading", { name: /^In progress 30 files$/i })).toBeVisible();
  await expect(dialog.locator("[data-board-card]")).toHaveCount(30);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);
  expect(homeReads).toBe(0);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBeCloseTo(width < 640 ? width : Math.min(width - 32, 1120), 0);
  expect(bounds.height).toBeGreaterThan(900);
  const cards = dialog.locator("[data-board-card]");
  const positions = await cards.evaluateAll(elements => elements.map(element => {
    const { left, top, bottom } = element.getBoundingClientRect();
    return { left, top, bottom, margin: getComputedStyle(element).marginBottom };
  }));
  for (let index = 0; index < positions.length; index++) {
    expect(positions[index].margin).toBe("0px");
    const above = positions.slice(0, index).filter(card => Math.abs(card.left - positions[index].left) < 1).at(-1);
    if (above) expect(positions[index].top).toBeCloseTo(above.bottom, 0);
  }
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('dialog[open]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`folder-open-${width}.png`), animations: "disabled" });
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
  await open.click();
  await dialog.getByRole("button", { name: "Open Avery Ellis", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/referralId=920009/);
});

test("handoff retains accepted statuses and excludes closed or pending clients", async ({ page }, info) => {
  await homeFixture(page, undefined, 1, true);
  await page.goto("/");
  await expect(page.locator('[data-board-stage]')).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Open Admitted Client", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open clients in handoff folder", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clients in handoff folder", exact: true });
  const accepted = dialog.getByRole("button", { name: "Open Accepted Client", exact: true });
  await expect(accepted).toHaveAccessibleDescription("Accept Open Files");
  await expect(accepted.locator('[title="Signed medication list, TB test result, Signed admission agreement"]')).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open Admitted Client", exact: true })).toHaveCount(0);
  await expect(dialog.locator("[data-board-status]")).toHaveText(["Accept", "Awaiting admit"]);
  const colors = await dialog.locator("[data-board-status]").evaluateAll(tabs => tabs.map(tab => getComputedStyle(tab).color));
  expect(new Set(colors).size).toBe(1);
  await dialog.screenshot({ path: info.outputPath("decision-tabs.png"), animations: "disabled" });
});

test("Board action opens its named file tab even when the last visit was Chart", async ({ page }) => {
  await homeFixture(page, undefined, 0, true);
  await page.route("**/api/me/work-continuity", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { state: {
      schema: 1,
      acknowledgedAssignmentIds: [],
      recentWorkspaces: [{ referralId: 930001, location: { view: "chart" }, visitedAt: new Date().toISOString() }],
    } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open clients in handoff folder", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open Accepted Client", exact: true }).click();
  await expect(page).toHaveURL(/referralId=930001/);
  await expect(page).toHaveURL(/workspaceView=files/);
  await expect(page).not.toHaveURL(/workspaceEntry=resume/);
});

test("folder expansion respects reduced motion and empty stages", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await homeFixture(page);
  await page.goto("/");
  const open = page.getByRole("button", { name: "Open clients in handoff folder", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Clients in handoff folder", exact: true });
  await expect(dialog).toContainText("No referrals in this folder.");
  expect(await dialog.evaluate(element => element.getAnimations().length)).toBe(0);
  await dialog.getByRole("button", { name: "Close clients in handoff folder", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test("Escape returns from the full list to the same recent clients", async ({ page }) => {
  await homeFixture(page, undefined, 3);
  await page.goto("/");
  const recent = page.getByRole("region", { name: "Recent clients" });
  await expect(recent.locator("[data-client-file]")).toHaveCount(6);
  const before = await recent.locator("[data-client-file]").evaluateAll(elements => elements.map(element => element.getAttribute("data-client-file")));
  expect(before).toEqual(["920000", "920001", "920002", "920100", "920101", "920102"]);
  const open = page.getByRole("button", { name: "Open in progress folder", exact: true });
  await open.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Open Jordan Rivera", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(await recent.locator("[data-client-file]").evaluateAll(elements => elements.map(element => element.getAttribute("data-client-file")))).toEqual(before);
});

test("an expanded stage stays visible when the window becomes narrow", async ({ page }) => {
  await homeFixture(page, undefined, 3);
  await page.goto("/");
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  const folder = page.getByRole("dialog", { name: "In progress folder", exact: true });
  await expect(folder).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(folder).toBeVisible();
  await expect(folder.getByRole("button", { name: "Open Jordan Chen", exact: true })).toBeVisible();
  await folder.getByRole("button", { name: "Close in progress folder", exact: true }).click();
  await expect(folder).toHaveCount(0);
  await expect(page.getByLabel("Referral stage")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open in progress folder", exact: true })).toBeFocused();
});

test("expanded folders retain stage accents and long file labels stay readable", async ({ page }, info) => {
  await homeFixture(page, undefined, 3, true, true);
  await page.goto("/");
  const colors = new Set<string>();
  for (const title of ["In progress", "Clients in handoff"]) {
    await page.getByRole("button", { name: `Open ${title.toLowerCase()} folder`, exact: true }).click();
    const folder = page.getByRole("dialog", { name: `${title} folder`, exact: true });
    await expect(folder).toBeVisible();
    await folder.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
    colors.add(await folder.locator("h2").evaluate(element => getComputedStyle(element.parentElement!.parentElement!).backgroundImage));
    await page.screenshot({ path: info.outputPath(`stage-${title.toLowerCase().replaceAll(" ", "-")}.png`), animations: "disabled" });
    await folder.getByRole("button", { name: `Close ${title.toLowerCase()} folder`, exact: true }).click();
    await expect(folder).toHaveCount(0);
  }
  expect(colors.size).toBe(2);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  const folder = page.getByRole("dialog", { name: "In progress folder", exact: true });
  const file = folder.getByRole("button", { name: "Open Alexandria Montgomery-Rivera", exact: true });
  await expect(file).not.toContainText("Christopher Montgomery-Williams");
  await expect(file).toContainText("Alexandria Montgomery-Rivera");
  await page.evaluate(() => document.fonts.ready);
  await folder.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
  const clipped = await file.evaluate(element => [...element.querySelectorAll("span:not(.sr-only), strong")].filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map(node => node.textContent));
  expect(clipped).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("long-labels-phone.png"), animations: "disabled" });
  await page.emulateMedia({ forcedColors: "active" });
  await expect(folder.getByRole("button", { name: "Close in progress folder", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("folder-high-contrast.png"), animations: "disabled" });
});

test("iPad folder scrolling does not turn the Home deck", async ({ baseURL }) => {
  const browser = await webkit.launch();
  const context = await browser.newContext({ baseURL, viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    await homeFixture(page, undefined, 10);
    await page.goto("/");
    const open = page.getByRole("button", { name: "Open in progress folder", exact: true });
    await open.tap();
    const dialog = page.getByRole("dialog", { name: "In progress folder", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-board-card]")).toHaveCount(30);
    const grid = dialog.locator("[data-expanded-folder]");
    await grid.dispatchEvent("pointerdown", { pointerId: 8, isPrimary: true, pointerType: "touch", button: 0, clientX: 200, clientY: 300 });
    await grid.dispatchEvent("pointermove", { pointerId: 8, clientX: 80, clientY: 304 });
    await grid.dispatchEvent("pointerup", { pointerId: 8, clientX: 80, clientY: 304 });
    await dialog.locator("[data-board-card]").last().scrollIntoViewIfNeeded();
    await expect(dialog.locator("[data-board-card]").last()).toBeInViewport();
    await dialog.getByRole("button", { name: "Close in progress folder", exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
    await expect(open).toBeFocused();
  } finally { try { await context.close(); } finally { await browser.close(); } }
});

for (const width of [1440, 390]) test(`most recent workspace leads five more without pin controls at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await homeFixture(page, undefined, 4);
  await page.goto("/");
  const recent = page.getByRole("region", { name: "Recent clients" });
  const cards = recent.locator("[data-client-file]");
  await expect(cards).toHaveCount(6);
  await expect(cards.locator("[data-folder-name]")).toHaveText(["Avery Rivera", "Avery Brooks", "Avery Chen", "Avery Patel", "Jordan Rivera", "Jordan Brooks"]);
  await expect(cards.first()).toHaveAttribute("data-featured", "true");
  await expect(recent.locator("[data-client-file][data-featured]")).toHaveCount(1);
  expect((await cards.first().boundingBox())!.height).toBeGreaterThan((await cards.nth(1).boundingBox())!.height);
  await expect(page.getByRole("button", { name: /^(Unpin|Pin) / })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Pinned clients" })).toHaveCount(0);
  await expect(page.locator("[data-folder-stack]")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Referral stage" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /^(Unpin|Pin) / })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Open Morgan Patel", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(cards).toHaveCount(6);
  await expect(cards.first().locator("[data-folder-name]")).toHaveText("Avery Rivera");
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run("[data-current-work-board]", { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`recent-six-${width}.png`), fullPage: true, animations: "disabled" });
});

test("a short history shows only real recent workspaces", async ({ page }) => {
  await homeFixture(page);
  await page.goto("/");
  const recent = page.getByRole("region", { name: "Recent clients" });
  await expect(recent.locator("[data-client-file]")).toHaveCount(1);
  await expect(recent.locator("[data-client-file][data-featured]")).toHaveCount(1);
});

test("recent Resume honors the user's saved page", async ({ page }) => {
  await homeFixture(page);
  await page.route("**/api/me/work-continuity", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { state: { schema: 1, acknowledgedAssignmentIds: [],
      recentWorkspaces: [{ referralId: 910501, location: { view: "files" }, visitedAt: new Date().toISOString() }],
    } } });
  });
  await page.goto("/");
  await page.getByRole("region", { name: "Recent clients" }).getByRole("button", { name: "Open Avery Board", exact: true }).click();
  await expect(page).toHaveURL(/referralId=910501/);
  await expect(page).toHaveURL(/workspaceView=files/);
  await expect(page).toHaveURL(/workspaceEntry=resume/);
});


test("unavailable work counts stay distinct from zero and leave the schedule accessible", async ({ page }) => {
  await page.route("**/api/operations/home", async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.unavailable_sections = [...payload.unavailable_sections.filter((section: string) => section !== "upcoming"), "workflow"];
    payload.upcoming = [];
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/");
  const priorities = page.locator("[data-home-priorities]");
  for (const name of ["Open in progress folder", "Open clients in handoff folder"]) {
    const button = priorities.getByRole("button", { name, exact: true });
    await expect(button).toBeDisabled();
    await expect(button).toContainText("Unavailable");
  }
  await priorities.getByRole("button", { name: "Upcoming assessments", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Upcoming assessments", exact: true })).toBeVisible();
});

for (const width of [320, 390]) test(`phone shows only personal work even with team history at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await homeFixture(page, ["search", "recent-work"], 2, true, false, "mixed", 1, true);
  await page.goto("/");
  const recent = page.getByRole("region", { name: "Recent clients" });
  await expect(recent.locator("[data-client-file]")).toHaveCount(6);
  await expect(recent.getByText("Team Rivera", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upcoming assessments", exact: true })).toBeVisible();
  for (const [index, title] of ["In progress", "Clients in handoff"].entries()) {
    await page.getByRole("button", { name: `Open ${title.toLowerCase()} folder`, exact: true }).click();
    const folder = page.getByRole("dialog", { name: `${title} folder`, exact: true });
    await expect(folder.getByRole("group", { name: "Folder scope" })).toHaveCount(0);
    await expect(folder.locator("[data-board-card]")).toHaveCount(index === 0 ? 7 : 2);
    await expect(folder.getByText(/Team (Rivera|Brooks|Chen)/)).toHaveCount(0);
    expect(await folder.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(folder).toHaveCount(0);
  }
  await page.screenshot({ path: info.outputPath(`personal-phone-${width}.png`), fullPage: true, animations: "disabled" });
  // Mobile ignores desktop module preferences without overwriting them.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-home-module="search"]')).toBeVisible();
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  await expect(page.getByRole("group", { name: "Folder scope" })).toBeVisible();
});

import { confirmReferralFileLabels } from "./support/referral-upload";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { HomeBriefingSnapshot } from "../../lib/pipeline/home-briefing-types";
import type { ReferralWorklistItem } from "../../lib/pipeline/operations-types";
import type { AdmissionRequirement, Referral } from "../../lib/pipeline/referral-types";
import { getWorkspaceState } from "../../lib/pipeline/workspace-state";
import { syntheticReferralInput } from "./support/pipeline-actors";

async function mockHopper(page: Page, referrals: Referral[] = [], team = false) {
  const response = await page.request.get("/api/operations/home");
  expect(response.ok()).toBe(true);
  const briefing = await response.json() as HomeBriefingSnapshot;
  const specs = [
    ["Taylor Rivera", "ready_to_schedule", "ready_to_schedule", "Schedule the assessment", "intake", "received", "Preparation"],
    ["Morgan Bennett", "scheduled", "assessment_scheduled", "Attend the scheduled assessment", "assessment", "in_progress", "Preparation"],
    ["Avery Chen", "scheduled", "assessment_scheduled", "Attend the scheduled assessment", "assessment", "in_progress", "Preparation"],
    ["Jordan Reed", "assessment", "assessment_in_progress", "Continue the assessment", "assessment", "in_progress", "Preparation"],
    ["Casey Brooks", "assessment", "changes_requested", "Update the medication details", "assessment", "in_progress", "Preparation"],
    ["Riley Hart", "complete_chart", "recommendation_submitted", "Review the submitted assessment", "workflow", "decision", "Under review"],
    ["Quinn Patel", "complete_chart", "approved_for_placement", "Upload the medication list", "files", "decision", "Accept"],
  ] as const;
  const items: ReferralWorklistItem[] = specs.map((spec, index) => ({
    board: { stage: spec[5], detail: spec[6], next_action: spec[3], location: { view: spec[4] } },
    referral_id: referrals[index]?.id ?? 910001 + index,
    client_name: referrals[index]?.name ?? spec[0], community: "Santa Clarita", stage: "New",
    workflow_status: spec[2], flow_state: spec[1], assignment_state: "assigned",
    assessment_state: index === 5 ? "signed" : index >= 3 ? "in_progress" : "scheduled",
    outcome_state: index === 6 ? "accepted" : "pending", document_state: "partial", profile_state: "complete",
    assessment_is_reassessment: false, owner: briefing.viewer.name, priority: "standard",
    categories: ["follow_up"], primary_category: "follow_up", next_action: spec[3], blockers: [], missing_data: [],
    urgency: index === 4 ? "blocked" : "normal", due_at: null,
    last_activity_at: briefing.generated_at, age_hours: index * 8, completion_pct: 40,
    missing_document_count: index === 6 ? 2 : 0, location: { view: spec[4] },
  }));
  briefing.scope = team ? "team" : "personal";
  briefing.current_work = { total: 2, items: [] };
  Object.assign(briefing.workflow, { active_total: 7, active_items: items, board_items: items,
    flow_counts: { ready_to_schedule: 1, scheduled: 2, assessment: 2, complete_chart: 2 } });
  briefing.continuity = { resume_items: [], new_assignments: [], assignment_tracking_started_at: null,
    needs_assignment_tracking_initialization: false, unavailable: false };
  briefing.unavailable_sections = [];
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: briefing }));
  const key = `pipeline:home-layout:v1:${encodeURIComponent(briefing.viewer.id)}`;
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ schema: 2, module_ids: [], locked: true })), { key });
  await page.route("**/api/me/home-layout", (route) => route.fulfill({ json: { layout: { schema: 2, module_ids: [], locked: true } } }));
  return { briefing, items };
}

async function createReferral(request: APIRequestContext) {
  const members = (await (await request.get("/api/members?scope=assessors")).json()).members;
  const assignee = members[0];
  expect(assignee?.principal_id).toBeTruthy();
  const token = randomUUID().replace(/[0-9-]/g, (value) => String.fromCharCode(97 + value.charCodeAt(0) % 26));
  const response = await request.post("/api/referrals", { data: {
    client_mutation_id: randomUUID(), assignee_id: assignee.principal_id, referral: {
      ...syntheticReferralInput("admin"),
      name: `Test ${token}`, date: "2026-09-14", community: "Santa Clarita", stage: "New", source: "Synthetic referral facility",
      owner: assignee.display_name, priority: "standard", tags: [], documentName: "Synthetic packet.pdf",
      documentStatus: "Uploaded", note: "Synthetic hopper fixture", createdAt: new Date().toISOString(),
      dob: "1984-06-12", gender: "Female", phone: "555-0101", email: "fixture@example.invalid",
    },
  } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).referral as Referral;
}

test("assessment can return to Intake, add documents and resume the same saved interview", async ({ page }, testInfo) => {
  const referral = await createReferral(page.request);
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { current_location: "Synthetic placement" },
  } });
  expect(created.status(), await created.text()).toBe(201);
  const assessment = (await created.json()).assessment;
  const scheduledStart = new Date(Date.now() + (28 * 24 + referral.id * 2) * 60 * 60 * 1000).toISOString();
  const scheduled = await page.request.post(`/api/assessments/${assessment.assessment_id}/schedule`, { data: {
    if_match: assessment.version, client_mutation_id: randomUUID(), schedule: {
      status: "scheduled", start_at: scheduledStart, duration_minutes: 60, method: "record_review",
    },
  } });
  expect(scheduled.status(), await scheduled.text()).toBe(200);
  await page.goto(`/?screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await page.getByRole("button", { name: "Begin assessment", exact: true }).click();
  await page.getByRole("dialog", { name: "Begin assessment", exact: true }).getByRole("button", { name: "Begin assessment", exact: true }).click();
  const chart = page.locator('[data-assessment-view="assessment"]');
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const control = width < 640 ? stages.getByLabel("Workspace view", { exact: true }) : stages.getByRole("button", { name: "Chart", exact: true });
    await expect(control).toBeVisible();
    const bounds = (await control.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await stages.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`assessment-chart-header-${width}.png`) });
  }
  await chart.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("prior_history");
  const answer = chart.getByRole("textbox", { name: /Prior 5150/ });
  await answer.fill("Synthetic answer kept while updating intake and adding a document.");
  await stages.getByRole("button", { name: "Chart", exact: true }).click();
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  await expect(chart).toHaveCount(0);
  const intake = page.getByTestId("intake-client-folder");
  await expect(intake).toBeVisible();
  const phoneSaved = page.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}`) && response.request().method() === "PATCH" && response.ok());
  await page.getByRole("textbox", { name: "Referrer phone:", exact: true }).fill("555-0199");
  await page.getByRole("textbox", { name: "Referrer phone:", exact: true }).blur();
  await phoneSaved;
  await page.getByRole("button", { name: "Workspace files", exact: true }).click();
  await page.getByLabel("Choose referral documents").setInputFiles({
    name: "during-assessment-note.pdf", mimeType: "application/pdf", buffer: Buffer.from("Synthetic supporting note during assessment"),
  });
    await confirmReferralFileLabels(page);
  await expect.poll(async () => {
    const payload = await (await page.request.get(`/api/files?referral_id=${referral.id}`)).json();
    return payload.files.map((file: { name: string }) => file.name);
  }).toContain("during-assessment-note.pdf");
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.scheduled_start_at).toBe(scheduledStart);
  expect(new Date(saved.started_at).getTime()).toBeLessThan(new Date(scheduledStart).getTime());
  expect(saved.prior_5150_5250_holds).toContain("Synthetic answer kept");
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Assessment/ }).click();
  await expect(chart).toBeVisible();
  await chart.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("prior_history");
  await chart.getByRole("button", { name: /Edit Prior 5150/ }).click();
  await expect(answer).toHaveValue("Synthetic answer kept while updating intake and adding a document.");
  await stages.getByRole("button", { name: "Chart", exact: true }).click();
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  await expect(intake).toBeVisible();
  const resumed = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(resumed.assessment_id).toBe(assessment.assessment_id);
  expect(resumed.started_at).toBe(saved.started_at);
  expect(resumed.scheduled_start_at).toBe(saved.scheduled_start_at);
  expect(resumed.prior_5150_5250_holds).toBe(saved.prior_5150_5250_holds);
  const assessments = (await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
  expect(assessments).toHaveLength(1);
});

for (const width of [390, 1440]) {
  test(`Home always shows all seven assigned active referrals at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const { items } = await mockHopper(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
    const hopper = page.getByRole("region", { name: "Current work", exact: true });
    await expect(hopper.locator("[data-board-card]")).toHaveCount(7);
    for (const item of items) {
      if (width < 1024) await hopper.getByRole("combobox", { name: "Referral stage", exact: true }).selectOption(item.board.stage!);
      await expect(hopper.getByRole("button", { name: `Open ${item.client_name}`, exact: true })).toBeVisible();
    }
    await expect(hopper.getByRole("button", { name: "Open Quinn Patel", exact: true })).toContainText("Documents needed2");
    await expect(hopper.getByRole("button", { name: "Open Casey Brooks", exact: true })).toContainText("Update the medication details");
    expect(await page.locator("[data-home-module]").count()).toBe(1);
    expect(await hopper.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`hopper-${width}.png`) });
    await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
    await page.reload();
    if (width < 1024) await hopper.getByRole("combobox", { name: "Referral stage", exact: true }).selectOption("decision");
    await expect(hopper.getByRole("button", { name: "Open Quinn Patel", exact: true })).toBeVisible();
  });
}

test("supervisors see submitted referrals as review work, not a personal waiting task", async ({ page }) => {
  await mockHopper(page, [], true);
  await page.goto("/");
  const hopper = page.getByRole("region", { name: "Current work", exact: true });
  await expect(hopper.getByRole("button", { name: "Open Riley Hart", exact: true })).toContainText("Review the submitted assessment");
  await expect(hopper).not.toContainText("Waiting for supervisor");
});

test("the board cannot be removed and its expanded view remains operable and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockHopper(page);
  await page.goto("/?editHome=1");
  await expect(page.getByRole("button", { name: "Remove Board from Home", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open current work", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Current work", exact: true });
  const select = dialog.getByRole("combobox", { name: "Referral stage", exact: true });
  await expect(select).toHaveValue("received");
  await select.selectOption("decision");
  await expect(dialog.getByRole("button", { name: "Open Riley Hart", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close current work", exact: true }).click();
  await page.getByRole("button", { name: "Open current work", exact: true }).click();
  await select.selectOption("decision");
  await expect(dialog.getByRole("button", { name: "Open Riley Hart", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open current work", exact: true })).toBeFocused();
});

for (const failure of [false, true]) {
  test(`returning to Workspaces preserves an edit during a ${failure ? "failed" : "pending"} server save`, async ({ page }) => {
    const first = await createReferral(page.request);
    const second = await createReferral(page.request);
    await mockHopper(page, [first, second]);
    await page.goto(`/?screen=packet&referralId=${first.id}&workspaceStage=intake&workspaceField=name`);
    const open = page.getByRole("button", { name: "Workspaces", exact: true });
    await expect(open).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let saving = false;
    await page.route(`**/api/referrals/${first.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      saving = true;
      if (failure) return route.fulfill({ status: 503, json: { error: "Synthetic save failure" } });
      await gate;
      await route.continue();
    });
    try {
      await page.getByRole("textbox", { name: "Referrer phone:", exact: true }).fill("555-0199");
      await open.click();
      await expect.poll(() => saving).toBe(true);
      await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
      if (failure) {
        const saved = (await (await page.request.get(`/api/referrals/${first.id}`)).json()).referral;
        expect(saved.phone).toBe(first.phone);
        await page.goto(`/?screen=packet&referralId=${first.id}&workspaceStage=intake&workspaceField=name`);
        await expect(page.getByRole("textbox", { name: "Referrer phone:", exact: true })).toHaveValue("555-0199");
        await page.unroute(`**/api/referrals/${first.id}`);
        const phone = page.getByRole("textbox", { name: "Referrer phone:", exact: true });
        await phone.fill("555-0110");
        await phone.blur();
        await expect.poll(async () => (await (await page.request.get(`/api/referrals/${first.id}`)).json()).referral.phone).toBe("555-0110");
      } else {
        release();
        await expect.poll(async () => (await (await page.request.get(`/api/referrals/${first.id}`)).json()).referral.phone).toBe("555-0199");
        await page.goto(`/?screen=packet&referralId=${first.id}&workspaceStage=intake&workspaceField=name`);
        await expect(page.getByRole("textbox", { name: "Referrer phone:", exact: true })).toHaveValue("555-0199");
      }
    } finally { release(); }
  });
}

test("signed review and accepted requirements retain hopper membership until canonical completion", async ({ request }) => {
  const referral = await createReferral(request);
  const signed = { assessmentExists: true, assessmentSigned: true, assessmentComplete: true, requirements: [] };
  expect(getWorkspaceState(referral, signed).focus).toBe("follow_up");
  const decision = { decisionId: "fixture-decision", outcome: "accepted" as const, reasonCode: "fixture", reasonNote: "Synthetic",
    decidedBy: "fixture", decidedByName: "Fixture", decidedAt: "2026-09-14T12:00:00Z", version: 1 };
  const requirement: AdmissionRequirement = { id: "fixture-document", type: "medication_list", label: "Medication list", status: "needed",
    requiredFor: "move_in", owner: referral.owner, dueAt: "", nextStep: "Upload medication list", blocker: false, updatedAt: decision.decidedAt };
  expect(getWorkspaceState(referral, { ...signed, decision, requirements: [requirement] }).focus).toBe("follow_up");
  expect(getWorkspaceState(referral, { ...signed, decision, requirements: [{ ...requirement, status: "received" }] }).focus).toBe("complete");
});

test("a save in another tab refreshes the hopper and supersedes an older pending read", async ({ page, context }) => {
  const referral = await createReferral(page.request);
  const { briefing } = await mockHopper(page, [referral]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: `Open ${referral.name}`, exact: true })).toBeVisible();
  const editor = await context.newPage();
  await editor.goto(`/?screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=name`);
  await expect(editor.getByRole("textbox", { name: "Referrer phone:", exact: true })).toBeVisible();
  await page.unroute("**/api/operations/home");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const stale = structuredClone(briefing);
  const fresh = structuredClone(briefing);
  fresh.workflow.active_items[0].client_name = "Updated Client";
  fresh.workflow.board_items![0].client_name = "Updated Client";
  await page.route("**/api/operations/home", async (route) => {
    reads += 1;
    if (reads === 1) { await gate; await route.fulfill({ json: stale }).catch(() => undefined); }
    else await route.fulfill({ json: fresh });
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => reads).toBe(1);
    const saved = editor.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}`) && response.request().method() === "PATCH" && response.ok());
    await editor.getByRole("textbox", { name: "Referrer phone:", exact: true }).fill("555-0188");
    await editor.getByRole("textbox", { name: "Referrer phone:", exact: true }).blur();
    await saved;
    await expect(page.getByRole("button", { name: "Open Updated Client", exact: true })).toBeVisible();
    release();
    await expect(page.getByRole("button", { name: `Open ${referral.name}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work", exact: true }).locator("[data-board-card]")).toHaveCount(7);
    await expect(editor.getByRole("textbox", { name: "Referrer phone:", exact: true })).toHaveValue("555-0188");
  } finally { release(); await editor.close(); }
});

test("desktop and phone assessments keep answers and position after using the workspace switcher", async ({ page }, testInfo) => {
  const referral = await createReferral(page.request);
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { current_location: "Synthetic placement" },
  } });
  expect(created.status(), await created.text()).toBe(201);
  let assessment = (await created.json()).assessment;
  const scheduled = await page.request.post(`/api/assessments/${assessment.assessment_id}/schedule`, { data: {
    if_match: assessment.version, client_mutation_id: randomUUID(), schedule: {
      start_at: new Date(Date.UTC(2026, 9, 1 + referral.id, 17, 30)).toISOString(), duration_minutes: 60, method: "record_review", status: "scheduled",
    },
  } });
  expect(scheduled.status(), await scheduled.text()).toBe(200);
  assessment = (await scheduled.json()).assessment;
  const started = await page.request.post(`/api/assessments/${assessment.assessment_id}/start`, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } });
  expect(started.status(), await started.text()).toBe(200);
  await mockHopper(page, [referral]);
  await page.goto(`/?screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  const chart = page.locator('[data-assessment-view="assessment"]');
  await expect(chart).toBeVisible();
  const section = chart.getByRole("combobox", { name: "Assessment section", exact: true });
  await section.selectOption("prior_history");
  const answer = chart.getByRole("textbox", { name: /Prior 5150/ });
  await answer.fill("Synthetic assessment answer preserved across the referral switcher.");
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.prior_5150_5250_holds).toContain("Synthetic assessment answer preserved");
  await page.goBack();
  await expect(chart).toBeVisible();
  await expect(section).toHaveValue("prior_history");
  await chart.getByRole("button", { name: /Edit Prior 5150/ }).click();
  await expect(answer).toHaveValue("Synthetic assessment answer preserved across the referral switcher.");
  await page.setViewportSize({ width: 320, height: 900 });
  const phone = page.locator("[data-phone-interview]");
  await expect(phone).toBeVisible();
  await phone.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
  await picker.getByRole("searchbox", { name: "Find a question", exact: true }).fill("Prior 5150");
  await picker.getByRole("button", { name: /Prior 5150/ }).click();
  await expect(phone.getByRole("textbox", { name: /Prior 5150/ })).toHaveValue("Synthetic assessment answer preserved across the referral switcher.");
  expect(await phone.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("assessment-phone-resume.png") });

});

for (const preset of [false, true]) {
  test(`${preset ? "preset" : "typed"} search replaces old and removed rows after a saved change in another tab`, async ({ page, context }) => {
    const referral = await createReferral(page.request);
    await mockHopper(page, [referral]);
    let changed = false;
    await page.route("**/api/search?**", (route) => {
      const referrals = changed ? [{ ...referral, name: "Harper Lee" }] : [
        { ...referral, name: "Robin Lane" }, { ...referral, id: referral.id + 10000, name: "Dana Perez" },
      ];
      return route.fulfill({ json: { query: "ClinicalDelta", interpreted_query: "ClinicalDelta", referrals,
        files: [], clients: [], destinations: [], counts: { referrals: referrals.length, files: 0, clients: 0, destinations: 0, total: referrals.length } } });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Quinn Patel", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-pipeline-keyboard-shortcuts-ready", "true");
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "Search Pipeline", exact: true });
    await expect(search).toBeVisible();
    if (preset) await search.getByRole("button", { name: "Show my assigned workspaces.", exact: true }).click();
    else await search.getByRole("textbox", { name: "Search or ask", exact: true }).fill("ClinicalDelta");
    await expect(search.getByRole("button", { name: "Open workspace for Dana Perez", exact: true })).toBeVisible();
    const editor = await context.newPage();
    try {
      await editor.goto(`/?screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=name`);
      const phone = editor.getByRole("textbox", { name: "Referrer phone:", exact: true });
      await expect(phone).toBeVisible();
      changed = true;
      const saved = editor.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}`) && response.request().method() === "PATCH" && response.ok());
      await phone.fill("555-0177");
      await phone.blur();
      await saved;
      await expect(search.getByRole("button", { name: "Open workspace for Harper Lee", exact: true })).toBeVisible();
      await expect(search.getByRole("button", { name: "Open workspace for Robin Lane", exact: true })).toHaveCount(0);
      await expect(search.getByRole("button", { name: "Open workspace for Dana Perez", exact: true })).toHaveCount(0);
    } finally { await editor.close(); }
  });
}

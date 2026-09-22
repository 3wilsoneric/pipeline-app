import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";

test("interview completion preserves answers, editability, original appointment and audit history", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Calendar ${randomUUID().replaceAll(/[^a-z]/g, "")}`, owner: "Annette Everhart", documentName: "", documentStatus: "Missing", tags: [],
  }, { assigneeId: "provisional:allo:annette" });
  if (!referral.name) throw new Error("The created referral must retain its name.");
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { current_symptoms: "Synthetic retained answer" } } });
  expect(created.status()).toBe(201);
  let assessment = (await created.json()).assessment;
  const assessmentUrl = `/api/assessments/${assessment.assessment_id}`;
  const originalStart = "2026-08-20T16:00:00.000Z";
  const schedule = { status: "scheduled", start_at: originalStart, duration_minutes: 60, method: "phone", location: "555-0100" };
  const booked = await page.request.post(`${assessmentUrl}/schedule`, { data: { if_match: assessment.version, client_mutation_id: randomUUID(), schedule } });
  expect(booked.status(), await booked.text()).toBe(200);
  assessment = (await booked.json()).assessment;
  await page.goto("/?screen=calendar");
  await page.getByRole("button", { name: "Show calendar filters" }).click();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  const continuing = page.getByRole("region", { name: "Continue working", exact: true });
  await continuing.locator("summary").click();
  await continuing.getByRole("button", { name: new RegExp(referral.name) }).first().click();
  const drawer = page.getByRole("dialog", { name: "Calendar item", exact: true });
  await expect(drawer.getByText("Appointment outcome not recorded", { exact: true }).last()).toBeVisible();
  const mutation = page.waitForRequest((request) => request.url().endsWith(`${assessmentUrl}/schedule`) && request.method() === "POST");
  await drawer.getByRole("button", { name: "Interview completed", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Record interview completion?", exact: true }).getByRole("button", { name: "Record completion", exact: true }).click();
  const body = (await mutation).postDataJSON();
  await expect(drawer).toHaveCount(0);
  const read = async () => (await (await page.request.get(assessmentUrl)).json()).assessment;
  assessment = await read();
  expect(assessment).toMatchObject({ status: "draft", current_symptoms: "Synthetic retained answer", schedule_status: "completed", scheduled_start_at: originalStart, signed_at: null });
  expect(assessment.meet_client_sent_at).toBeFalsy();
  expect(assessment.audit_events.filter((event: { action: string }) => event.action === "assessment_interview_completed")).toHaveLength(1);
  const updatedReferral = await (await page.request.get(`/api/referrals/${referral.id}`)).json();
  expect(updatedReferral.referral.workflowStatus).toBe("assessment_in_progress");
  const replay = await page.request.post(`${assessmentUrl}/schedule`, { data: body });
  expect(replay.status()).toBe(200);
  expect((await read()).version).toBe(assessment.version);
  const stale = await page.request.post(`${assessmentUrl}/schedule`, { data: { ...body, client_mutation_id: randomUUID() } });
  expect(stale.status()).toBe(409);
  const patched = await page.request.patch(assessmentUrl, { data: { if_match: assessment.version, client_mutation_id: randomUUID(), patch: { data: { current_symptoms: "Synthetic documentation finished tomorrow" } } } });
  expect(patched.status(), await patched.text()).toBe(200);
  expect((await read()).current_symptoms).toBe("Synthetic documentation finished tomorrow");
  await page.reload();
  await page.getByRole("button", { name: "Show calendar filters" }).click();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await continuing.locator("summary").click();
  await expect(continuing).toContainText(referral.name);
  await expect(continuing).toContainText("Interview completed · documentation unfinished");
});

test("weekly calendar, contacts, previews, follow-up saves and layouts work on desktop, iPad and phone", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-09-18T18:00:00Z"));
  const appointment = { id: "assessment:calendar-test", assessmentId: "calendar-test", assessmentVersion: 1, referralId: 808, clientName: "Morgan Sample", community: "San Pablo", ownerId: "assessor-a", owner: "Annette Everhart", workspaceOwner: "Sandeep Supervisor", date: "2026-09-18", startsAt: "2026-09-18T18:00:00Z", durationMinutes: 60, method: "phone", location: "555-0100", scheduleStatus: "scheduled", kind: "assessment", status: "draft", title: "Assessment scheduled", detail: "Scheduled assessment" };
  const work = { ...appointment, id: "assessment:unfinished", assessmentId: "unfinished", clientName: "Jordan Sample", date: "2026-09-17", startsAt: "2026-09-17T18:00:00Z", scheduleStatus: "completed" };
  await page.route("**/api/calendar/events**", (route) => route.fulfill({ json: { events: [appointment, { ...appointment, id: "follow-up:records", kind: "follow_up", title: "Medication list", date: "2026-09-17", startsAt: undefined, status: "overdue" }], continuing: [work], unscheduled: [{ referralId: 809, clientName: "Taylor Sample", community: "San Pablo", ownerId: "assessor-a", owner: "Annette Everhart", receivedDate: "2026-09-16", workflowStatus: "profile_incomplete", nextAction: "complete_contact" }], unscheduledTotal: 1, unscheduledHasMore: false, assessors: [{ id: "assessor-a", name: "Annette Everhart" }], viewer: { id: "assessor-a", name: "Annette Everhart" }, scope: "team", timezone: "America/Los_Angeles" } }));
  await page.route("**/api/referrals/808/contacts", (route) => route.fulfill({ json: { contacts: [{ id: "contact-1", role: "scheduling_contact", relationship: "Case manager", primaryForScheduling: true, notes: "Ask for the front desk", contact: { firstName: "Casey", lastName: "Contact", phone: "555-0101", email: "casey@example.invalid", organization: "Sample Facility", bestContactTime: "Mornings" } }] } }));
  await page.route("**/api/files?referral_id=808&limit=6", (route) => route.fulfill({ json: { files: [{ id: "referral-808", name: "Sample packet.pdf", category: "Referral packet", previewUrl: "/synthetic-packet", previewStatus: "ready" }] } }));
  await page.route("**/synthetic-packet", (route) => route.fulfill({ contentType: "text/html", body: "Synthetic packet preview" }));
  let item = { id: randomUUID(), version: 1, label: "Medication list", status: "requested", dueAt: "2026-09-17", nextStep: "Request records", owner: "Annette Everhart", requestedFrom: "Sample Facility", blocker: false, requiredFor: "admission_decision", type: "medication_list" };
  await page.route("**/api/referrals/808/work-items", (route) => route.fulfill({ json: { work_items: [item] } }));
  await page.route(`**/api/referrals/808/work-items/${item.id}`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.if_match).toBe(1);
    expect(body.patch.status).toBeUndefined();
    item = { ...item, ...body.patch, version: 2 };
    await route.fulfill({ json: { work_item: item } });
  });
  await page.goto("/?screen=calendar");
  await expect(page.getByRole("region", { name: "Continue working", exact: true })).toContainText("Jordan Sample");
  await page.getByRole("button", { name: "month", exact: true }).click();
  await expect(page.getByRole("region", { name: "Continue working", exact: true })).toContainText("Jordan Sample");
  await page.locator("summary").filter({ hasText: "Dated follow-ups" }).click();
  await expect(page.getByText("Medication list", { exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Dated follow-ups" }).click();
  await page.getByRole("button", { name: "week", exact: true }).click();
  await page.getByRole("button", { name: "Scheduling queue 1", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Scheduling queue", exact: true }).getByRole("button", { name: "Schedule interview", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.locator('button[title^="Morgan Sample -"]').click();
  const drawer = page.getByRole("dialog", { name: "Calendar item", exact: true });
  await expect(drawer).toContainText("Casey Contact");
  await expect(drawer).toContainText("555-0101");
  await expect(drawer).toContainText("Sandeep Supervisor");
  await drawer.getByRole("button", { name: "Preview Sample packet.pdf", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Preview Sample packet.pdf", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  await drawer.locator("summary").filter({ hasText: "Medication list" }).click();
  await drawer.getByLabel("Next step for Medication list").fill("Confirm the returned records");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog", { name: "Leave without saving?", exact: true }).getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(drawer.getByLabel("Next step for Medication list")).toHaveValue("Confirm the returned records");
  await drawer.getByLabel("Follow-up date for Medication list").fill("2026-09-21");
  await drawer.getByRole("button", { name: "Save follow-up", exact: true }).click();
  await expect.poll(() => item.version).toBe(2);
  expect(item.status).toBe("requested");
  await expect(drawer.getByLabel("Next step for Medication list")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await page.getByRole("heading", { level: 1 }).click();
  const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  await page.addScriptTag({ content: axeSource });
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`calendar-workflow-${width}.png`), fullPage: true });
  }
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (root: Element, options: object) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe;
    return (await axe.run(document.querySelector('[data-guide-target="calendar-workspace"]')!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.filter((item) => ["critical", "serious"].includes(item.impact));
  });
  expect(violations).toEqual([]);
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.locator('button[title^="Morgan Sample -"]').click();
    await expect(drawer.getByText("Casey Contact", { exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Interview completed", exact: true })).toBeInViewport();
    await expect(drawer.getByRole("button", { name: "Cancel appointment", exact: true })).toBeInViewport();
    await expect.poll(async () => { const bounds = await drawer.boundingBox(); return bounds!.x + bounds!.width; }).toBeLessThanOrEqual(width + 1);
    const box = await drawer.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`calendar-drawer-${width}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  }
});

// Item 9: Mine/Team scope, assessor filtering, and empty states that name the active scope.
test("Mine and Team scope, assessor filters and empty states explain what is shown", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-18T18:00:00Z"));
  const mine = { id: "assessment:mine", assessmentId: "mine", referralId: 901, clientName: "Mine Sample", community: "San Pablo", ownerId: "assessor-a", owner: "Alex Assessor", date: "2026-09-18", startsAt: "2026-09-18T18:00:00Z", durationMinutes: 60, method: "phone", scheduleStatus: "scheduled", kind: "assessment", status: "draft", title: "Assessment scheduled", detail: "Scheduled assessment" };
  const theirs = { ...mine, id: "assessment:theirs", assessmentId: "theirs", referralId: 902, clientName: "Their Sample", community: "Turlock", ownerId: "assessor-b", owner: "Bailey Assessor" };
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;
  let fail = false;
  await page.route("**/api/calendar/events**", async (route) => {
    if (gate) { const pending = gate; gate = null; await pending; }
    if (fail) { await route.fulfill({ status: 500, json: { error: "Calendar fixture unavailable." } }); return; }
    await route.fulfill({ json: { events: [mine, theirs], continuing: [], unscheduled: [], unscheduledTotal: 0, unscheduledHasMore: false, assessors: [{ id: "assessor-a", name: "Alex Assessor" }, { id: "assessor-b", name: "Bailey Assessor" }], viewer: { id: "assessor-a", name: "Alex Assessor" }, scope: "team", timezone: "America/Los_Angeles" } });
  });
  await page.goto("/?screen=calendar");

  // Mine is the default scope and the assessor filter belongs to Team only.
  const scope = page.getByRole("group", { name: "Whose schedule", exact: true });
  await expect(scope.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('button[title^="Mine Sample -"]').first()).toBeVisible();
  await expect(page.getByText("Their Sample", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show calendar filters" }).click();
  await expect(page.getByRole("combobox", { name: "Filter calendar by assessor" })).toHaveCount(0);

  await scope.getByRole("button", { name: "Team", exact: true }).click();
  await expect(page.getByRole("region", { name: "Supervisor team week" })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter calendar by assessor" }).selectOption("id:assessor-b");
  await expect(page.locator('button[title^="Their Sample -"]').first()).toBeVisible();
  await expect(page.getByText("Mine Sample", { exact: true })).toHaveCount(0);

  // An empty filtered result names the scope and offers the matching way out.
  await page.getByRole("combobox", { name: "Filter calendar by community" }).selectOption("San Pablo");
  const empty = page.getByRole("region", { name: "No matching appointments", exact: true });
  await expect(empty).toContainText("No appointments on Bailey Assessor's schedule in San Pablo");
  await expect(empty).toContainText("Showing Team, filtered to one assessor.");
  await empty.getByRole("button", { name: "Show all assessors", exact: true }).click();
  await expect(page.locator('button[title^="Mine Sample -"]').first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter calendar by assessor" })).toHaveValue("");

  // Clearing filters keeps the chosen scope; it is not itself a filter.
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(scope.getByRole("button", { name: "Team", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Filter calendar by community" })).toHaveValue("");

  // Mine with nothing scheduled explains the scope and offers the team.
  await page.getByRole("button", { name: "Previous calendar range" }).click();
  await expect(empty).toContainText("No appointments on your schedule for");
  await expect(empty).toContainText("Showing Team: every assessor's appointments.");
  await scope.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(empty).toContainText("Showing Mine: only appointments assigned to you.");
  await empty.getByRole("button", { name: "View team schedule", exact: true }).click();
  await expect(scope.getByRole("button", { name: "Team", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Loading is not an empty schedule.
  gate = new Promise<void>((resolve) => { openGate = resolve; });
  await page.getByRole("button", { name: "Next calendar range" }).click();
  await expect(page.getByRole("main", { name: "Calendar", exact: true })).toHaveAttribute("aria-busy", "true");
  await expect(empty).toHaveCount(0);
  await expect.poll(() => openGate).not.toBeNull();
  openGate!();
  await expect(page.locator('button[title^="Mine Sample -"]').first()).toBeVisible();

  // Neither is a failed request: it says so instead of reporting an empty schedule.
  fail = true;
  await page.getByRole("button", { name: "Next calendar range" }).click();
  await expect(page.getByRole("alert").first()).toContainText("Calendar fixture unavailable.");
  await expect(page.getByText("Appointments could not be loaded.", { exact: true })).toBeVisible();
  await expect(empty).toHaveCount(0);
});

// Item 9: one scheduling dialog reached from Chart and Assessment; cancelling books nothing.
test("Chart and Assessment open the same scheduling dialog, cancel books nothing, and a saved time opens the right workspace", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Schedule ${randomUUID().replaceAll(/[^a-z]/g, "")}`, owner: "Annette Everhart", documentName: "", documentStatus: "Missing", tags: [],
  }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  expect(created.status()).toBe(201);
  const assessmentId = (await created.json()).assessment.assessment_id;
  const assessmentUrl = `/api/assessments/${assessmentId}`;
  let scheduleWrites = 0;
  await page.route(`**${assessmentUrl}/schedule`, async (route) => { scheduleWrites += 1; await route.continue(); });

  // Chart surfaces scheduling beside the referral's contact and coordination details.
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=chart`);
  const contact = page.getByRole("region", { name: "Contact information", exact: true });
  await expect(contact).toContainText("No assessment appointment booked yet.");
  await contact.getByRole("button", { name: "Schedule interview", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
  await expect(dialog).toBeVisible();

  // Cancelling makes no booking.
  await dialog.getByLabel("Assessment date and time").fill("2026-09-24T10:00");
  await dialog.getByRole("button", { name: "Back to assessment", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(scheduleWrites).toBe(0);
  expect((await (await page.request.get(assessmentUrl)).json()).assessment.scheduled_start_at).toBeFalsy();

  // Assessment opens the same dialog and saves the appointment.
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  await page.getByRole("region", { name: "Assessment progress", exact: true }).getByRole("button", { name: "Schedule interview", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Assessment date and time").fill("2026-09-24T10:00");
  await dialog.getByLabel("Assessment method").selectOption("phone");
  await dialog.getByRole("button", { name: "Schedule interview", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get(assessmentUrl)).json()).assessment.schedule_status).toBe("scheduled");
  expect(scheduleWrites).toBe(1);

  // The saved appointment appears on the calendar and opens the assessment workspace.
  await page.clock.setFixedTime(new Date("2026-09-24T16:00:00Z"));
  await page.goto("/?screen=calendar");
  await page.getByRole("button", { name: "Team", exact: true }).click();
  const open = page.getByRole("button", { name: `Prepare assessment for ${referral.name}`, exact: true });
  await expect(open.first()).toBeVisible();
  await open.first().click();
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}`));
  await expect(page).toHaveURL(/workspaceStage=assessment/);
});

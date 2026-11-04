import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";
import { openHandoffConfirmation, waitForAssessmentReady } from "./support/assessment-navigation";

test("signing requires a performed date and starting records its source", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Timing ${randomUUID()}`, owner: "" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  expect(created.status()).toBe(201);
  const assessment = (await created.json()).assessment;
  const signUrl = `/api/assessments/${assessment.assessment_id}/sign`;
  const undated = await page.request.post(signUrl, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } });
  expect(undated.status()).toBe(422);
  expect((await undated.json()).error).toContain("date the assessment was performed");

  const booked = await page.request.post(`/api/assessments/${assessment.assessment_id}/schedule`, { data: {
    if_match: assessment.version,
    client_mutation_id: randomUUID(),
    schedule: { status: "scheduled", start_at: "2026-11-05T18:00:00.000Z", duration_minutes: 60, method: "phone", location: "Synthetic appointment" },
  } });
  expect(booked.status()).toBe(200);
  const scheduled = (await booked.json()).assessment;
  const start = await page.request.post(`/api/assessments/${assessment.assessment_id}/start`, { data: { if_match: scheduled.version, client_mutation_id: randomUUID() } });
  expect(start.status()).toBe(200);
  const started = (await start.json()).assessment;
  expect(started.assessment_date).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(started.started_at)));
  expect(started.field_provenance.assessment_date.at(-1).source_field_key).toBe("assessment.started_at");
  const signed = await page.request.post(signUrl, { data: { if_match: started.version, client_mutation_id: randomUUID() } });
  expect(signed.status()).toBe(200);
});

for (const width of [1440, 834, 390, 320]) {
  test(`appointment is separate from answering, resuming and signing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Appointment ${randomUUID()}`, owner: "", community: "San Pablo" });
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { assessment_date: "2026-09-20", secondary_diagnoses: ["Synthetic retained answer"] } } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    let startRequests = 0;
    await page.route("**/api/assessments/*/start", (route) => { startRequests++; return route.fulfill({ status: 503, json: { error: "No start call should be needed" } }); });
    const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=identity`;
    await page.goto(url);
    await waitForAssessmentReady(page);
    const progress = page.getByRole("region", { name: "Interview", exact: true });
    const schedule = progress.getByRole("button", { name: "Schedule interview", exact: true });
    await expect(schedule).toBeInViewport();
    expect((await schedule.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`appointment-${width}.png`), animations: "disabled" });

    expect((await read()).assessment_date).toBe("2026-09-20");
    expect((await read()).started_at).toBeNull();

    await schedule.click();
    const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await dialog.getByLabel("Assessment date and time").fill("2027-09-20T10:00");
    await dialog.getByRole("button", { name: "Schedule interview", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(progress).toContainText("Sep 20");
    const booked = await read();
    expect(booked.started_at).toBeNull();
    expect(booked.assessment_date).toBe("2026-09-20");
    expect(booked.scheduled_start_at).toBe("2027-09-20T17:00:00.000Z");

    await page.reload();
    const reschedule = progress.getByRole("button", { name: "Edit assessment appointment", exact: true });
    await expect(reschedule).toBeVisible();
    await reschedule.click();
    await dialog.getByLabel("Assessment date and time").fill("2027-09-21T11:00");
    await dialog.getByRole("button", { name: "Save new time", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(progress).toContainText("Sep 21");
    expect((await read()).assessment_date).toBe("2026-09-20");

    await openHandoffConfirmation(page);
    await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Synthetic retained answer");
    await page.getByRole("button", { name: "Confirm chart", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Everything correct and included?", exact: true }).getByRole("button", { name: "Confirm & continue", exact: true }).click();
    await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
    const signed = await read();
    expect(signed.signed_at).toBeTruthy();
    expect(signed.started_at).toBeNull();
    expect(signed.assessment_date).toBe("2026-09-20");
    expect(signed.secondary_diagnoses).toEqual(["Synthetic retained answer"]);
    expect(signed.meet_client_sent_at).toBeFalsy();
    expect(startRequests).toBe(0);
  });
}

test("a previously recorded start can be rescheduled from Calendar without overwriting history", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Legacy Start ${randomUUID()}`, owner: "" });
  const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  const { assessment } = await response.json();
  const booked = await page.request.post(`/api/assessments/${assessment.assessment_id}/schedule`, { data: { if_match: assessment.version, client_mutation_id: randomUUID(), schedule: { status: "scheduled", start_at: "2026-08-20T16:00:00.000Z", duration_minutes: 60, method: "phone", location: "Synthetic appointment" } } });
  expect(booked.status()).toBe(200);
  const scheduled = (await booked.json()).assessment;
  const start = await page.request.post(`/api/assessments/${assessment.assessment_id}/start`, { data: { if_match: scheduled.version, client_mutation_id: randomUUID() } });
  expect(start.status()).toBe(200);
  const startedAt = (await start.json()).assessment.started_at;
  // Scheduling is available from the Calendar after the interview starts.
  await page.goto("/?screen=calendar");
  await page.getByRole("button", { name: "Show calendar filters" }).click();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  const continuing = page.getByRole("region", { name: "Continue working", exact: true });
  await continuing.locator("summary").click();
  await continuing.getByRole("button", { name: new RegExp(referral.name!) }).first().click();
  const drawer = page.getByRole("dialog", { name: "Calendar item", exact: true });
  await drawer.getByRole("button", { name: "Reschedule", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: referral.name!, exact: true });
  await dialog.getByLabel("Date and time", { exact: true }).fill("2027-09-22T11:00");
  await dialog.getByRole("button", { name: "Save new time", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.started_at).toBe(startedAt);
  expect(saved.scheduled_start_at).toBe("2027-09-22T18:00:00.000Z");
});

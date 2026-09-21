import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

async function review(page: Page) {
  if (page.viewportSize()!.width < 640) {
    await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    await page.getByRole("dialog", { name: "Questionnaire sections" }).getByRole("button", { name: /^Review assessment/ }).click();
  } else {
    await page.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("provenance_qc");
    await page.locator('footer[aria-label="Assessment actions"]').getByRole("button", { name: "Review assessment", exact: true }).click();
  }
}

for (const width of [1440, 834, 390, 320]) {
  test(`appointment is separate from answering, resuming and signing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Appointment ${randomUUID()}`, owner: "", community: "San Pablo" });
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Synthetic retained answer"] } } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    let startRequests = 0;
    await page.route("**/api/assessments/*/start", (route) => { startRequests++; return route.fulfill({ status: 503, json: { error: "No start call should be needed" } }); });
    const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=identity`;
    await page.goto(url);
    const appointment = page.getByRole("region", { name: "Assessment appointment", exact: true });
    const schedule = appointment.getByRole("button", { name: "Schedule assessment", exact: true });
    await expect(schedule).toBeInViewport();
    expect((await schedule.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`appointment-${width}.png`), animations: "disabled" });

    if (width < 640) {
      await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
      await page.getByRole("dialog", { name: "Questionnaire sections" }).getByRole("button", { name: /Date assessment performed/ }).click();
    }
    const performed = page.getByLabel("Date assessment performed", { exact: true });
    await performed.fill("2026-09-20");
    await performed.blur();
    await expect.poll(async () => (await read()).assessment_date).toBe("2026-09-20");
    expect((await read()).started_at).toBeNull();

    await schedule.click();
    const dialog = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
    await dialog.getByLabel("Assessment date and time").fill("2027-09-20T10:00");
    await dialog.getByRole("button", { name: "Schedule assessment", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(appointment).toContainText("Sep 20, 2027");
    const booked = await read();
    expect(booked.started_at).toBeNull();
    expect(booked.assessment_date).toBe("2026-09-20");
    expect(booked.scheduled_start_at).toBe("2027-09-20T17:00:00.000Z");

    await page.reload();
    const reschedule = appointment.getByRole("button", { name: "Reschedule assessment", exact: true });
    await expect(reschedule).toBeVisible();
    await reschedule.click();
    await dialog.getByLabel("Assessment date and time").fill("2027-09-21T11:00");
    await dialog.getByRole("button", { name: "Save new time", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(appointment).toContainText("Sep 21, 2027");
    expect((await read()).assessment_date).toBe("2026-09-20");

    await review(page);
    await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Synthetic retained answer");
    await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
    await page.getByRole("dialog", { name: "Sign assessment", exact: true }).getByRole("button", { name: "Sign assessment", exact: true }).click();
    await expect(page.locator("#admission-workflow")).toBeVisible();
    const signed = await read();
    expect(signed.signed_at).toBeTruthy();
    expect(signed.started_at).toBeNull();
    expect(signed.assessment_date).toBe("2026-09-20");
    expect(signed.secondary_diagnoses).toEqual(["Synthetic retained answer"]);
    expect(signed.meet_client_sent_at).toBeFalsy();
    expect(startRequests).toBe(0);
  });
}

test("a previously recorded start does not hide rescheduling or overwrite history", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Legacy Start ${randomUUID()}`, owner: "" });
  const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  const { assessment } = await response.json();
  const start = await page.request.post(`/api/assessments/${assessment.assessment_id}/start`, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } });
  expect(start.status()).toBe(200);
  const startedAt = (await start.json()).assessment.started_at;
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  await page.getByRole("region", { name: "Assessment appointment" }).getByRole("button", { name: "Schedule assessment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
  await dialog.getByLabel("Assessment date and time").fill("2027-09-22T11:00");
  await dialog.getByRole("button", { name: "Schedule assessment", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.started_at).toBe(startedAt);
  expect(saved.scheduled_start_at).toBe("2027-09-22T18:00:00.000Z");
});

import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";
import { isoToOperationalInput } from "../../components/pipeline/pipeline-calendar-model";

async function createFromIntake(page: Page) {
  const suffix = randomUUID().slice(0, 8).replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)));
  const name = `Handoff ${suffix[0].toUpperCase()}${suffix.slice(1)}`;
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  const handoff = page.getByRole("dialog", { name: "Workspace created", exact: true });
  await expect(handoff).toContainText(name);
  const id = new URL(page.url()).searchParams.get("referralId")!;
  expect(id).toBeTruthy();
  return { handoff, id };
}

for (const width of [1440, 390]) {
  test(`create, book, prepare and begin remain distinct at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { handoff, id } = await createFromIntake(page);
    expect(await handoff.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`created-${width}.png`) });
    await handoff.getByRole("button", { name: /Schedule assessment/ }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await expect(dialog).toBeVisible();
    const read = async () => (await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments;
    expect(await read()).toHaveLength(1);
    expect((await read())[0]).toMatchObject({ started_at: null, assessment_date: null, schedule_status: "unscheduled" });
    // Canceling never creates an appointment, and leaves a visible route to booking.
    await dialog.getByRole("button", { name: "Back to assessment", exact: true }).click();
    expect((await read())[0].scheduled_start_at).toBeUndefined();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await page.getByRole("button", { name: "Schedule interview", exact: true }).click();
    await dialog.getByLabel("Assessment date and time").fill("2028-09-21T10:00");
    await dialog.getByLabel("Assessment method").selectOption("phone");
    await dialog.getByLabel("Phone number to call").fill("555-010-2000");
    await page.screenshot({ path: info.outputPath(`schedule-${width}.png`) });
    // A failed booking keeps the modal, entered values and retry action.
    await page.route("**/api/assessments/*/schedule", (route) => route.fulfill({ status: 503, json: { error: "Synthetic booking unavailable" } }));
    await dialog.getByRole("button", { name: "Schedule interview", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Synthetic booking unavailable");
    await expect(dialog.getByLabel("Assessment date and time")).toHaveValue("2028-09-21T10:00");
    expect((await read())[0].scheduled_start_at).toBeUndefined();
    await page.unroute("**/api/assessments/*/schedule");
    await dialog.getByRole("button", { name: "Schedule interview", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const scheduled = (await read())[0];
    expect(scheduled).toMatchObject({ schedule_status: "scheduled", started_at: null, assessment_date: null, scheduled_start_at: "2028-09-21T17:00:00.000Z", scheduled_method: "phone", scheduled_location: "555-010-2000" });
    await expect(page.locator('#assessment-assessment_date')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit assessment appointment", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Begin interview", exact: true }).click();
    const begin = page.getByRole("dialog", { name: "Begin interview", exact: true });
    await expect(begin).toBeVisible();
    expect((await read())[0].started_at).toBeNull();
    await begin.getByRole("button", { name: "Begin interview", exact: true }).click();
    await expect(begin).toHaveCount(0);
    const started = (await read())[0];
    expect(started.started_at).toBeTruthy();
    expect(started.assessment_date).toBe(isoToOperationalInput(started.started_at).slice(0, 10));
    expect(started.assessment_date).not.toBe("2028-09-21");
    expect(started.audit_events.find((event: { action: string }) => event.action === "assessment_started").changed_fields).toContain("assessment_date");
    await expect(page.locator('#assessment-assessment_date')).toHaveCount(0);
    await page.locator('summary[aria-label="Assessment details"]').click();
    await page.getByRole("button", { name: /^Interview date/ }).click();
    const dateDialog = page.getByRole("dialog", { name: "Interview date", exact: true });
    await dateDialog.locator('#assessment-assessment_date').fill("2026-09-18");
    await dateDialog.getByRole("button", { name: "Close interview date" }).click();
    await expect.poll(async () => (await read())[0].assessment_date).toBe("2026-09-18");
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Workspace created", exact: true })).toHaveCount(0);
    expect(await read()).toHaveLength(1);
    expect((await read())[0].scheduled_start_at).toBe(scheduled.scheduled_start_at);
  });
}

test("prepare first and dismiss both leave usable workspace navigation", async ({ page }) => {
  const { handoff, id } = await createFromIntake(page);
  await handoff.getByRole("button", { name: "Assessment prep", exact: false }).click();
  await expect(page.getByRole("region", { name: "Assessment progress" })).toContainText("Prepare assessment");
  await expect(page.getByRole("button", { name: "Begin interview", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Schedule interview", exact: true })).toHaveCount(0);
  const records = (await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments;
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ started_at: null, schedule_status: "unscheduled" });
  expect(records[0].scheduled_start_at).toBeUndefined();
  const second = await createFromIntake(page);
  await second.handoff.getByRole("button", { name: "Close workspace created" }).click();
  const tabs = page.getByRole("navigation", { name: "Workspace stages" });
  await expect(tabs.getByRole("button", { name: /Chart$/ })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("button", { name: /Assessment$/ }).click();
  await expect(page.getByRole("button", { name: "Schedule interview", exact: true })).toBeVisible();
});

test("starting preserves a historical interview date, with normal optimistic concurrency", async ({ request }) => {
  const referral = await createOperationalReferral(request, "assessmentCoordinator", { name: `Historical start ${randomUUID()}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const created = await request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { assessment_date: "2026-08-15" } } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  const url = `/api/assessments/${assessment.assessment_id}/start`;
  const mutation = { if_match: assessment.version, client_mutation_id: randomUUID() };
  const started = await request.post(url, { data: mutation });
  expect(started.status()).toBe(200);
  const saved = (await started.json()).assessment;
  expect(saved.assessment_date).toBe("2026-08-15");
  expect(saved.started_at).toBeTruthy();
  const replay = await request.post(url, { data: mutation });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).assessment.started_at).toBe(saved.started_at);
  const stale = await request.post(url, { data: { ...mutation, client_mutation_id: randomUUID() } });
  expect(stale.status()).toBe(409);
});

test("leaving the intake handoff returns to the same choice until an option is chosen", async ({ page }) => {
  await page.goto("/");
  const { handoff, id } = await createFromIntake(page);
  const name = await handoff.locator("p.text-xl").innerText();
  await page.goBack();
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).locator("[data-folder-name]").click();
  await expect(handoff).toBeVisible();
  expect((await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments).toHaveLength(0);
  await handoff.getByRole("button", { name: /Schedule assessment/ }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
  await expect(schedule).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).locator("[data-folder-name]").click();
  await expect(handoff).toHaveCount(0);
  await expect(schedule).toBeVisible();
  await schedule.getByRole("button", { name: "Back to assessment", exact: true }).click();
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).locator("[data-folder-name]").click();
  await expect(handoff).toHaveCount(0);
  await expect(schedule).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare assessment", exact: true })).toHaveAttribute("aria-pressed", "true");
});

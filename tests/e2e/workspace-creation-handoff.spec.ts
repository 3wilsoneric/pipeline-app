import type { AxeResults } from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { activeOperationalAssessor, createOperationalReferral } from "./support/operational-api";
import { isoToOperationalInput } from "../../components/pipeline/pipeline-calendar-model";
import { createCanvas } from "@napi-rs/canvas";
import { confirmReferralFileLabels } from "./support/referral-upload";

async function createFromIntake(page: Page) {
  const suffix = randomUUID().slice(0, 8).replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)));
  const name = `Handoff ${suffix[0].toUpperCase()}${suffix.slice(1)}`;
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  const handoff = page.getByRole("region", { name: "Workspace created", exact: true });
  await expect(handoff).toContainText(name);
  const id = new URL(page.url()).searchParams.get("referralId")!;
  expect(id).toBeTruthy();
  return { handoff, id, name };
}


async function openPreparation(page: Page) {
  const picker = page.getByRole("combobox", { name: "Workspace view", exact: true });
  const prep = page.getByRole("button", { name: "Assessment prep", exact: true });
  if (await prep.isVisible()) await prep.click();
  else if (await picker.isVisible()) await picker.selectOption({ label: "Assessment" });
  else await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Assessment", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Where the client is now", exact: true })).toBeVisible();
  if (await picker.isVisible()) await expect(picker.locator("option:checked")).toHaveText("Chart");
  else await expect(page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true })).toHaveAttribute("aria-current", "page");
}

for (const width of [1440, 820, 390, 320]) {
  test(`create, book, prepare and begin remain distinct at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { handoff, id } = await createFromIntake(page);
    expect(await handoff.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`created-${width}.png`) });
    await expect(handoff.getByRole("button", { name: /Schedule assessment/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Assessment prep", exact: true })).toBeEnabled();
    await expect(page.getByRole("dialog", { name: "Schedule interview", exact: true })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Where the client is now", exact: true })).toHaveCount(0);
    expect((await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments).toHaveLength(0);
    await openPreparation(page);
    const topActions = page.getByRole("region", { name: "Interview", exact: true });
    const bottomActions = page.getByRole("region", { name: "Interview actions", exact: true });
    for (const actions of [topActions, bottomActions]) {
      const scheduleAction = actions.getByRole("button", { name: "Schedule interview", exact: true });
      await expect(scheduleAction).toBeEnabled();
      await expect(actions.getByRole("button", { name: "Start now", exact: true })).toBeEnabled();
      await scheduleAction.scrollIntoViewIfNeeded();
      await expect(scheduleAction).toBeInViewport();
      expect((await scheduleAction.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await actions.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await expect(page.locator('[data-guide-target="assessment-schedule-open"]')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`preparation-bottom-${width}.png`), animations: "disabled" });
    await topActions.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`preparation-actions-${width}.png`), animations: "disabled" });
    if (width === 1440 || width === 390) {
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe.run('[data-interview-entry]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations);
      expect(violations).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await bottomActions.getByRole("button", { name: "Schedule interview", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await expect(dialog).toBeVisible();
    const read = async () => (await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments;
    expect(await read()).toHaveLength(1);
    expect((await read())[0]).toMatchObject({ started_at: null, assessment_date: null, schedule_status: "unscheduled" });
    // Canceling never creates an appointment, and leaves a visible route to booking.
    await dialog.getByRole("button", { name: "Back to assessment", exact: true }).click();
    expect((await read())[0].scheduled_start_at).toBeUndefined();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await expect(bottomActions.getByRole("button", { name: "Schedule interview", exact: true })).toBeFocused();
    await page.getByRole("region", { name: "Interview", exact: true }).getByRole("button", { name: "Schedule interview", exact: true }).click();
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
    await expect(page.getByRole("region", { name: "Interview", exact: true }).getByRole("button", { name: "Edit assessment appointment", exact: true })).toBeVisible();
    const workspacePicker = page.getByRole("combobox", { name: "Workspace view", exact: true });
    if (await workspacePicker.isVisible()) await workspacePicker.selectOption({ label: "Chart" });
    else await page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Chart", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("region", { name: "Assessment prep", exact: true })).toContainText("Sep 21");
    await page.getByRole("button", { name: "Begin interview", exact: true }).click();
    await expect(page).toHaveURL(/assessmentMode=interview/);
    await expect(page.getByRole("dialog", { name: "Begin interview", exact: true })).toHaveCount(0);
    const started = (await read())[0];
    expect(started.started_at).toBeTruthy();
    expect(started.assessment_date).toBe(isoToOperationalInput(started.started_at).slice(0, 10));
    expect(started.assessment_date).not.toBe("2028-09-21");
    expect(started.audit_events.find((event: { action: string }) => event.action === "assessment_started").changed_fields).toContain("assessment_date");
    await expect(page.locator('#assessment-assessment_date')).toHaveCount(0);
    await page.getByRole("button", { name: /^Interview date/ }).click();
    const dateDialog = page.getByRole("dialog", { name: "Interview date", exact: true });
    await dateDialog.locator('#assessment-assessment_date').fill("2026-09-18");
    await dateDialog.getByRole("button", { name: "Close interview date" }).click();
    await expect.poll(async () => (await read())[0].assessment_date).toBe("2026-09-18");
    await page.reload();
    await expect(page.getByRole("region", { name: "Workspace created", exact: true })).toHaveCount(0);
    expect(await read()).toHaveLength(1);
    expect((await read())[0].scheduled_start_at).toBe(scheduled.scheduled_start_at);
  });
}

test("preparation builds the chart, preserves answers, and starts without booking", async ({ page }, info) => {
  const { id } = await createFromIntake(page);
  await openPreparation(page);
  const read = async () => (await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments;
  const source = page.getByRole("textbox", { name: "Where the client is now", exact: true });
  await expect(source).toBeVisible();
  expect(await read()).toHaveLength(1);
  const assessmentId = (await read())[0].assessment_id;
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  await expect(stages.getByRole("button", { name: "Chart", exact: true }).locator("..").getByRole("button", { name: "Decision", exact: true })).toHaveCount(0);
  await stages.getByRole("button", { name: "Assessment", exact: true }).locator("..").getByRole("button", { name: "Decision", exact: true }).click();
  await expect(page).toHaveURL(/workspaceView=workflow/);
  await stages.getByRole("button", { name: "Assessment", exact: true }).click();
  expect((await read())[0].started_at).toBeNull();
  await source.fill("Synthetic referring facility");
  await source.press("Tab");
  await expect.poll(async () => (await read())[0]?.current_location).toBe("Synthetic referring facility");
  expect((await read())[0]).toMatchObject({ started_at: null, schedule_status: "unscheduled" });
  await expect(page).toHaveURL(/workspaceStage=assessment/);
  await page.reload();
  await expect(source).toHaveValue("Synthetic referring facility");
  await page.getByRole("textbox", { name: "County", exact: true }).fill("Synthetic County");
  await page.getByRole("textbox", { name: "Referrer", exact: true }).fill("Synthetic record contact");
  const notes = page.getByRole("textbox", { name: "Notes", exact: true });
  await notes.fill("Synthetic preparation note carried into the interview.");
  await page.getByRole("region", { name: "Interview actions", exact: true }).getByRole("button", { name: "Start now", exact: true }).click();
  await expect(page).toHaveURL(/assessmentMode=interview/);
  await expect(page.getByRole("dialog", { name: "Begin interview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Where the client is now", exact: true })).toContainText("Synthetic referring facility");
  await expect(source).toHaveCount(0);
  expect((await read())[0].current_location).toBe("Synthetic referring facility");
  await expect(page.locator("html")).toHaveAttribute("data-interview-focus", "true");
  await expect(notes).toHaveValue("Synthetic preparation note carried into the interview.");
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${id}/notes`)).json()).blocks.find((block: { block_key: string }) => block.block_key === "notes")?.body).toBe("Synthetic preparation note carried into the interview.");
  expect(await read()).toHaveLength(1);
  expect((await read())[0].assessment_id).toBe(assessmentId);
  expect((await read())[0].started_at).toBeTruthy();
  expect((await read())[0].scheduled_start_at ?? null).toBeNull();
  const startTime = (await read())[0].started_at;
  const reference = page.getByRole("complementary", { name: "Current information", exact: true });
  // Record-only information is present beside the interview, without asking it again.
  await expect(reference.getByRole("button", { name: "Edit Referrer", exact: true })).toContainText("Synthetic record contact");
  await expect(page.getByRole("textbox", { name: "Referrer", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("interview-with-prepared-record.png") });
  await reference.getByRole("button", { name: "Edit Referrer", exact: true }).click();
  await expect(page).toHaveURL(/workspaceStage=assessment/);
  await page.getByRole("textbox", { name: "Referrer", exact: true }).fill("Updated synthetic record contact");
  await page.getByRole("region", { name: "Interview actions", exact: true }).getByRole("button", { name: "Continue interview", exact: true }).click();
  await expect(page).toHaveURL(/assessmentMode=interview/);
  await expect(reference.getByRole("button", { name: "Edit Referrer", exact: true })).toContainText("Updated synthetic record contact");
  await expect.poll(async () => (await read())[0].referrer_name).toBe("Updated synthetic record contact");
  expect((await read())[0].started_at).toBe(startTime);
  await page.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("prior_placement");
  await expect(reference.getByRole("button", { name: "Edit County", exact: true })).toContainText("Synthetic County");
  await reference.getByRole("button", { name: "Edit County", exact: true }).click();
  await page.getByRole("textbox", { name: "County", exact: true }).fill("Updated Synthetic County");
  await page.getByRole("region", { name: "Interview actions", exact: true }).getByRole("button", { name: "Continue interview", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("prior_placement");
  await expect(reference.getByRole("button", { name: "Edit County", exact: true })).toContainText("Updated Synthetic County");
  expect(await read()).toHaveLength(1);
});

test("starting preserves a historical interview date, with normal optimistic concurrency", async ({ request }) => {
  const owner = await activeOperationalAssessor(request);
  const referral = await createOperationalReferral(request, "assessmentCoordinator", { name: `Historical start ${randomUUID()}`, owner: owner.display_name }, { assigneeId: owner.principal_id });
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

test("reopening Assessment keeps an unfinished appointment draft available", async ({ page }) => {
  const { id } = await createFromIntake(page);
  await openPreparation(page);
  await page.getByRole("region", { name: "Interview", exact: true }).getByRole("button", { name: "Schedule interview", exact: true }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
  await schedule.getByLabel("Assessment date and time").fill("2028-09-21T10:00");
  await schedule.getByLabel("Assessment method").selectOption("phone");
  await schedule.getByLabel("Phone number to call").fill("555-010-2000");
  await schedule.getByRole("button", { name: "Back to assessment", exact: true }).click();
  await page.goto("/?view=referrals");
  await page.goto(`/?view=referrals&screen=packet&referralId=${id}&workspaceStage=assessment&assessmentMode=prepare`);
  await expect(schedule).toHaveCount(0);
  await page.getByRole("region", { name: "Interview", exact: true }).getByRole("button", { name: "Schedule interview", exact: true }).click();
  await expect(schedule.getByLabel("Assessment date and time")).toHaveValue("2028-09-21T10:00");
  await expect(schedule.getByLabel("Phone number to call")).toHaveValue("555-010-2000");
  const records = (await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments;
  expect(records).toHaveLength(1);
  expect(records[0].scheduled_start_at).toBeUndefined();
});


test("phone preparation keeps later sections reachable", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { id } = await createFromIntake(page);
  await openPreparation(page);
  await expect(page.getByRole("textbox", { name: "Where the client is now", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next section", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Earlier care placements", exact: true })).toBeVisible();
  const answer = page.getByRole("textbox", { name: "Earlier care placements", exact: true });
  await answer.fill("Synthetic previous placement");
  await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label: "Files" });
  await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label: "Assessment" });
  await expect(answer).toHaveValue("Synthetic previous placement");
  await page.screenshot({ path: info.outputPath("chart-preparation-phone.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments[0].prior_placements).toBe("Synthetic previous placement");
});


test("failed history loading cannot replace a prepared assessment", async ({ page }) => {
  const { id } = await createFromIntake(page);
  await openPreparation(page);
  const source = page.getByRole("textbox", { name: "Where the client is now", exact: true });
  const read = async () => (await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments;
  await source.fill("Synthetic preserved chart");
  await source.press("Tab");
  await expect.poll(async () => (await read())[0].current_location).toBe("Synthetic preserved chart");
  const originalId = (await read())[0].assessment_id;
  let creationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/referrals/${id}/assessments` && request.method() === "POST") creationRequests++;
  });
  const url = `**/api/referrals/${id}/assessments`;
  await page.route(url, (route) => route.request().method() === "GET"
    ? route.fulfill({ status: 503, json: { error: "Synthetic history unavailable" } })
    : route.continue());
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic history unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start now", exact: true })).toHaveCount(0);
  expect(creationRequests).toBe(0);
  await page.unroute(url);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(source).toHaveValue("Synthetic preserved chart");
  expect(creationRequests).toBe(0);
  expect(await read()).toHaveLength(1);
  expect((await read())[0].assessment_id).toBe(originalId);
});

for (const width of [1440, 390]) {
  test(`source files remain available while building and interviewing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { id } = await createFromIntake(page);
    await openPreparation(page);
    const source = page.getByRole("textbox", { name: "Where the client is now", exact: true });
    await source.fill("Synthetic source retained while reviewing files");
    await source.blur();
    // The reference opens the canonical Files tool, including upload and labels.
    if (width < 640) await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption("files");
    else await page.getByRole("button", { name: "Open Files", exact: true }).click();
    const canvas = createCanvas(300, 200);
    const drawing = canvas.getContext("2d");
    drawing.fillStyle = "white";
    drawing.fillRect(0, 0, 300, 200);
    drawing.fillStyle = "black";
    drawing.fillText("SYNTHETIC CHART SOURCE", 20, 40);
    const name = "synthetic-chart-source.png";
    await page.getByLabel("Choose referral documents").setInputFiles({ name, mimeType: "image/png", buffer: canvas.toBuffer("image/png") });
    await confirmReferralFileLabels(page, { [name]: "assessment" });
    await expect(page.getByTestId("workspace-save-status")).toContainText("Files uploaded");
    const preview = page.getByRole("dialog", { name: `Preview ${name}`, exact: true });
    if (width < 640) {
      await page.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
      await expect(preview.getByRole("img", { name: `Preview ${name}`, exact: true })).toBeVisible();
      await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    }
    await openPreparation(page);
    await expect(source).toHaveValue("Synthetic source retained while reviewing files");
    const documents = page.locator("summary").filter({ hasText: /^Documents/ });
    if (width >= 640) {
      await documents.click();
      await page.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
      await expect(preview.getByRole("img", { name: `Preview ${name}`, exact: true })).toBeVisible();
      await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    }
    await page.getByRole("region", { name: "Interview", exact: true }).getByRole("button", { name: "Start now", exact: true }).click();
    await expect(page).toHaveURL(/assessmentMode=interview/);
    await expect(source).toHaveCount(0);
    if (width < 640) await page.getByRole("button", { name: "Client info", exact: true }).click();
    if (!(await documents.evaluate((element) => (element.parentElement as HTMLDetailsElement).open))) await documents.click();
    await page.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
    await expect(preview.getByRole("img", { name: `Preview ${name}`, exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.screenshot({ path: info.outputPath(`interview-reference-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Open Files", exact: true }).click();
    await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.goto(`/?view=referrals&screen=packet&referralId=${id}&workspaceStage=chart`);
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Drop files or choose files", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue interview", exact: true })).toBeEnabled();
    const assessments = (await (await page.request.get(`/api/referrals/${id}/assessments`)).json()).assessments;
    expect(assessments).toHaveLength(1);
    expect(assessments[0].current_location).toBe("Synthetic source retained while reviewing files");
  });
}

import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";
import { createOperationalAssessment, createOperationalReferral, scheduleOperationalAssessment, startOperationalAssessment } from "./support/operational-api";
import { isoToOperationalInput } from "../../components/pipeline/pipeline-calendar-model";

async function scheduledWorkspace(page: Page) {
  const suffix = randomUUID().slice(0, 8).replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)));
  const name = `Return ${suffix[0].toUpperCase()}${suffix.slice(1)}`;
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const created = await createOperationalAssessment(page.request, referral.id);
  const assessment = await scheduleOperationalAssessment(page.request, created);
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  // Keep Home deterministic without mocking the assessment, booking, start, or saves.
  await page.route("**/api/me/home-layout", (route) => route.fulfill({ json: { layout: { schema: 3, module_ids: ["current-work", "upcoming-assessments", "new-assignments"], locked: true } } }));
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const current = await read();
    payload.unavailable_sections = [];
    payload.upcoming = [{ id: `assessment:${current.assessment_id}`, referralId: referral.id, assessmentId: current.assessment_id, clientName: name, community: "San Pablo", owner: "Annette Everhart", date: isoToOperationalInput(current.scheduled_start_at).slice(0, 10), startsAt: current.scheduled_start_at, startedAt: current.started_at, method: "zoom", kind: "assessment", status: current.status, title: "Assessment scheduled" }];
    await route.fulfill({ response, json: payload });
  });
  const home = async () => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Upcoming assessments", exact: true }).click();
    return page.getByRole("region", { name: "Upcoming assessments", exact: true }).getByRole("button", { name: new RegExp(name) });
  };
  return { referral, assessment, read, home };
}

for (const width of [1440, 390]) test(`leave, begin deliberately, and resume the same section at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral, read, home } = await scheduledWorkspace(page);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  const progress = page.getByRole("region", { name: "Assessment progress", exact: true });
  await expect(progress).toContainText("Assessment prep");
  await expect(progress.getByLabel("Assessment appointment", { exact: true })).toContainText(/Scheduled.*(PDT|PST)/);
  await expect(progress.getByRole("button", { name: "Edit assessment appointment" })).toBeVisible();
  await expect(page.locator("#assessment-assessment_date")).toHaveCount(0);
  expect(await read()).toMatchObject({ started_at: null, assessment_date: null });
  expect(await progress.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  expect(await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('[aria-label="Assessment progress"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(({ id }) => id);
  })).toEqual([]);
  await page.screenshot({ path: info.outputPath(`scheduled-prep-${width}.png`) });
  await progress.getByRole("button", { name: "Edit assessment appointment" }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
  await expect(schedule.getByLabel("Assessment date and time")).toHaveValue(isoToOperationalInput((await read()).scheduled_start_at));
  await schedule.getByRole("button", { name: "Cancel", exact: true }).click();
  const entry = await home();
  await expect(entry).toContainText("Begin assessment");
  await page.screenshot({ path: info.outputPath(`upcoming-${width}.png`) });
  await entry.click();
  const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
  await expect(begin).toBeVisible();
  expect((await read()).started_at).toBeNull();
  await begin.getByRole("button", { name: "Keep preparing", exact: true }).click();
  await page.reload();
  await expect(progress).toBeVisible();
  await expect(begin).toHaveCount(0);
  expect((await read()).started_at).toBeNull();
  await progress.getByRole("button", { name: "Begin assessment", exact: true }).click();
  await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
  await expect(begin).toHaveCount(0);
  const started = await read();
  expect(started.started_at).toBeTruthy();
  expect(started.assessment_date).toBe(isoToOperationalInput(started.started_at).slice(0, 10));
  const picker = page.getByLabel("Assessment section", { exact: true });
  if (width < 640) {
    await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
    await sections.getByRole("searchbox", { name: "Find a question", exact: true }).fill("Secondary diagnosis");
    await sections.getByRole("button", { name: /^Secondary diagnosis/ }).click();
  } else await picker.selectOption("diagnosis_clinical");
  await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
  const resume = await home();
  await expect(resume).toContainText("Resume assessment");
  await resume.click();
  await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
  if (width < 640) await expect(page.getByRole("region", { name: "Guided assessment", exact: true })).toBeVisible();
  else await expect(picker).toHaveValue("diagnosis_clinical");
  await expect(begin).toHaveCount(0);
  expect((await read()).started_at).toBe(started.started_at);
  expect((await read()).audit_events.filter((event: { action: string }) => event.action === "assessment_started")).toHaveLength(1);
});

test("a stale Begin card resumes an interview already started elsewhere", async ({ page }) => {
  const { assessment, read, home } = await scheduledWorkspace(page);
  const entry = await home();
  await expect(entry).toContainText("Begin assessment");
  await startOperationalAssessment(page.request, assessment);
  const started = await read();
  await entry.click();
  await expect(page.getByLabel("Assessment section", { exact: true }).locator("option")).toHaveCount(12);
  await expect(page.getByRole("dialog", { name: "Begin assessment", exact: true })).toHaveCount(0);
  expect((await read()).started_at).toBe(started.started_at);
});

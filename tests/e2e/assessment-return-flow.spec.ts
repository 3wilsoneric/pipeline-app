import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";
import { createOperationalAssessment, createOperationalReferral, scheduleOperationalAssessment, startOperationalAssessment } from "./support/operational-api";
import { leaveInterviewFullScreen, waitForAssessmentReady } from "./support/assessment-navigation";
import { isoToOperationalInput } from "../../components/pipeline/pipeline-calendar-model";

for (const width of [1440, 834]) test(`questionnaire section link lands after loading and saves without jumping at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Section Entry", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  const route = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview&assessmentSection=functional_adl`;
  await page.goto(route);
  const heading = page.locator('[data-assessment-group-heading="functional_adl"]');
  const picker = page.getByLabel("Assessment section", { exact: true });
  await expect(picker).toHaveValue("functional_adl");
  await expect(heading).toBeInViewport();
  await expect.poll(async () => {
    const title = (await heading.boundingBox())!;
    const navigation = (await page.getByRole("navigation", { name: "Assessment sections", exact: true }).boundingBox())!;
    return title.y - navigation.y - navigation.height;
  }).toBeLessThan(56);
  const answer = page.locator("#assessment-adl_needs");
  await answer.fill("Synthetic support detail for local questionnaire regression.");
  await answer.press("Tab");
  await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.adl_needs).toBe("Synthetic support detail for local questionnaire regression.");
  await expect(answer).toBeInViewport();
  // A question-specific link takes precedence over the section heading, even after that answer is recorded.
  await page.goto(`${route}&assessmentQuestion=adl_needs`);
  await expect(answer).toHaveValue("Synthetic support detail for local questionnaire regression.");
  await expect(answer).toBeInViewport();
  await expect(answer).toBeFocused();
});

async function scheduledWorkspace(page: Page) {
  const suffix = randomUUID().slice(0, 8).replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)));
  const name = `Return ${suffix[0].toUpperCase()}${suffix.slice(1)}`;
  const membersResponse = await page.request.get("/api/members?scope=assessors");
  expect(membersResponse.ok()).toBe(true);
  const { members } = await membersResponse.json();
  const assessor = members.find((member: { active: boolean }) => member.active);
  expect(assessor).toBeTruthy();
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name, owner: assessor.display_name }, { assigneeId: assessor.principal_id });
  const created = await createOperationalAssessment(page.request, referral.id);
  const assessment = await scheduleOperationalAssessment(page.request, created);
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  const { user } = await (await page.request.get("/api/auth/me")).json();
  await page.clock.setFixedTime(new Date((await read()).scheduled_start_at));
  // Keep Home deterministic without mocking the assessment, booking, start, or saves.
  await page.route("**/api/me/home-layout", (route) => route.fulfill({ json: { layout: { schema: 3, module_ids: ["current-work", "upcoming-assessments", "new-assignments"], locked: true } } }));
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const current = await read();
    payload.unavailable_sections = [];
    payload.upcoming = [{ id: `assessment:${current.assessment_id}`, referralId: referral.id, assessmentId: current.assessment_id, clientName: name, community: "San Pablo", owner: assessor.display_name, date: isoToOperationalInput(current.scheduled_start_at).slice(0, 10), startsAt: current.scheduled_start_at, startedAt: current.started_at, method: "zoom", kind: "assessment", status: current.status, title: "Assessment scheduled" }];
    await route.fulfill({ response, json: payload });
  });
  // Home now reads its personal week from Calendar. Keep only that projection
  // deterministic; opening, booking, starting and saving use the real workspace.
  await page.route("**/api/calendar/events?**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const current = await read();
    payload.events = [{ id: `assessment:${current.assessment_id}`, referralId: referral.id, assessmentId: current.assessment_id, clientName: name, community: "San Pablo", ownerId: user.id, owner: user.name, date: isoToOperationalInput(current.scheduled_start_at).slice(0, 10), startsAt: current.scheduled_start_at, startedAt: current.started_at, method: "zoom", kind: "assessment", status: current.status }];
    await route.fulfill({ response, json: payload });
  });
  const home = async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Upcoming assessments", exact: true }).click();
    return page.getByRole("dialog", { name: "Upcoming assessments", exact: true }).getByRole("button", { name: new RegExp(name) });
  };
  return { referral, assessment, read, home, name };
}

for (const width of [1440, 390]) test(`leave, begin deliberately, and resume the same section at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral, read, home, name } = await scheduledWorkspace(page);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  const progress = page.getByRole("region", { name: "Interview", exact: true });
  await expect(page.locator('[data-assessment-phase="preparation"]')).toBeVisible();
  await expect(progress).toContainText(/PDT|PST/);
  await expect(progress.getByRole("button", { name: "Edit assessment appointment" })).toBeVisible();
  await expect(page.locator("#assessment-assessment_date")).toHaveCount(0);
  expect(await read()).toMatchObject({ started_at: null, assessment_date: null });
  expect(await progress.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  expect(await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('[aria-label="Interview"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(({ id }) => id);
  })).toEqual([]);
  await page.screenshot({ path: info.outputPath(`scheduled-prep-${width}.png`) });
  await progress.getByRole("button", { name: "Edit assessment appointment" }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
  await expect(schedule.getByLabel("Assessment date and time")).toHaveValue(isoToOperationalInput((await read()).scheduled_start_at));
  await schedule.getByRole("button", { name: "Back to assessment", exact: true }).click();
  const entry = await home();
  await expect(entry).toHaveAttribute("title", "Prepare assessment");
  await page.screenshot({ path: info.outputPath(`upcoming-${width}.png`) });
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}(?:&|$)`));
  await expect(progress).toBeVisible();
  const begin = page.getByRole("dialog", { name: "Begin interview", exact: true });
  await expect(begin).toHaveCount(0);
  expect((await read()).started_at).toBeNull();
  await page.reload();
  await expect(progress).toBeVisible();
  await expect(begin).toHaveCount(0);
  expect((await read()).started_at).toBeNull();
  await progress.getByRole("button", { name: "Start now", exact: true }).click();
  await expect.poll(async () => Boolean((await read()).started_at)).toBe(true);
  const started = await read();
  expect(started.started_at).toBeTruthy();
  expect(started.assessment_date).toBe(isoToOperationalInput(started.started_at).slice(0, 10));
  const picker = page.getByLabel("Assessment section", { exact: true });
  if (width < 640) {
    await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
    await sections.getByRole("searchbox", { name: "Find a question", exact: true }).fill("Current symptoms");
    await sections.getByRole("button", { name: /^Current symptoms/ }).click();
  } else await picker.selectOption("diagnosis_clinical");
  if (width < 640) await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
  else await expect(picker).toHaveValue("diagnosis_clinical");
  const answer = page.locator("#assessment-current_symptoms");
  await answer.pressSequentially("Synthetic answer saved before closing");
  await expect(answer).toHaveValue("Synthetic answer saved before closing");
  await answer.blur();
  await expect.poll(async () => (await read()).current_symptoms).toContain("Synthetic answer saved before closing");
  if (width < 640) await expect(page).toHaveURL(/assessmentQuestion=current_symptoms/);
  if (width < 640) {
    await page.getByRole("button", { name: /^Open page menu/ }).click();
    await page.getByRole("dialog", { name: "Pipeline pages", exact: true }).getByRole("button", { name: "Open referrals", exact: true }).click();
  } else await page.getByRole("button", { name: "Open referrals", exact: true }).click();
  await page.locator("#workspace-directory-search").fill(name);
  await page.getByRole("button", { name: new RegExp(`Open ${name}.*referral workspace`) }).click();
  // A deliberate return restores the saved question, even after its answer is saved.
  await expect(answer).toBeInViewport();
  await expect(page).toHaveURL(/assessmentQuestion=current_symptoms/);
  // Leave an earlier gap blank and move farther into the section. Resume must
  // retain this working question instead of always jumping to the first gap.
  const unfinishedAnswer = page.locator("#assessment-cognition_orientation");
  if (width < 640) {
    const next = page.getByRole("navigation", { name: "Question steps", exact: true }).getByRole("button", { name: "Next", exact: true });
    await next.click();
  }
  else await unfinishedAnswer.focus();
  await expect(unfinishedAnswer).toBeInViewport();
  if (width < 640) await expect(page).toHaveURL(/assessmentQuestion=cognition_orientation/);
  // Leave through the app checkpoint before unloading. Desktop keeps focus local
  // while typing and publishes the durable return target when navigating away.
  if (width < 640) {
    await page.getByRole("button", { name: /^Open page menu/ }).click();
    await page.getByRole("dialog", { name: "Pipeline pages", exact: true }).getByRole("button", { name: "Open referrals", exact: true }).click();
  } else await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
  // The helper below creates a fresh document. Confirm the server bookmark
  // before unloading, then verify the next document reads that durable value.
  await expect.poll(async () => {
    const { state } = await (await page.request.get("/api/me/work-continuity")).json();
    return state.recentWorkspaces.find((item: { referralId: number }) => item.referralId === referral.id)?.location.assessmentQuestion;
  }).toBe("cognition_orientation");
  const resume = await home();
  await expect(resume).toHaveAttribute("title", "Continue assessment");
  await resume.click();
  await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
  if (width < 640) await expect(page.getByRole("region", { name: "Guided assessment", exact: true })).toBeVisible();
  else await expect(picker).toHaveValue("diagnosis_clinical");
  await expect(page).toHaveURL(/assessmentQuestion=cognition_orientation/);
  await expect(unfinishedAnswer).toBeInViewport();
  // A full reload must use the saved bookmark after the answer is no longer dirty.
  await page.reload();
  await expect(unfinishedAnswer).toBeInViewport();
  expect((await read()).current_symptoms).toContain("Synthetic answer saved before closing");
  await expect(begin).toHaveCount(0);
  expect((await read()).started_at).toBe(started.started_at);
  expect((await read()).audit_events.filter((event: { action: string }) => event.action === "assessment_started")).toHaveLength(1);
});

test("a stale preparation card resumes an interview already started elsewhere", async ({ page }) => {
  const { assessment, read, home } = await scheduledWorkspace(page);
  const entry = await home();
  await expect(entry).toHaveAttribute("title", "Prepare assessment");
  await startOperationalAssessment(page.request, assessment);
  const started = await read();
  await entry.click();
  await expect(page.getByLabel("Assessment section", { exact: true }).locator('option:not([value="all-questions"])')).toHaveCount(12);
  await expect(page.getByRole("dialog", { name: "Begin interview", exact: true })).toHaveCount(0);
  expect((await read()).started_at).toBe(started.started_at);
});

// Batch 1, item 1: the working position survives Chart, Files, Activity and a
// cold return, and the resolution order stays explicit target → saved position
// for this user and workspace → existing default entry.
for (const width of [1440, 834]) test(`assessment keeps its section and question through Files, Activity and a cold return at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Continuity", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  const workspace = `/?view=referrals&screen=packet&referralId=${referral.id}`;
  const savedPosition = async () => {
    const { state } = await (await page.request.get("/api/me/work-continuity")).json();
    const visit = state.recentWorkspaces?.find((item: { referralId: number }) => item.referralId === referral.id);
    return visit?.location.view === "assessment" && visit.location.assessmentSection ? visit.location : visit?.assessmentLocation;
  };
  const answer = page.locator("#assessment-family_involvement");

  await page.goto(`${workspace}&workspaceStage=assessment&assessmentSection=social_support`);
  await waitForAssessmentReady(page);
  await answer.focus();
  await expect(answer).toBeFocused();

  // The sticky header and footer must never cover the question being answered.
  const field = (await answer.boundingBox())!;
  const header = (await page.getByRole("navigation", { name: "Assessment sections", exact: true }).boundingBox())!;
  const footer = (await page.locator('footer[aria-label="Assessment actions"]').boundingBox())!;
  expect(field.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(field.y + field.height).toBeLessThanOrEqual(footer.y);
  await page.screenshot({ path: info.outputPath(`continuity-working-${width}.png`), animations: "disabled" });

  await leaveInterviewFullScreen(page);
  for (const away of ["Workspace files", "Workspace activity"]) {
    await page.getByRole("button", { name: away, exact: true }).click();
    await expect(page.locator("[data-assessment-working-section]")).toBeHidden();
    await expect(page.locator("[data-assessment-working-section]").locator("xpath=ancestor::*[@inert][1]")).toHaveAttribute("inert", "");
    // Visiting another page must not discard the assessment position.
    await expect.poll(async () => (await savedPosition())?.assessmentSection).toBe("social_support");
    await expect.poll(async () => (await savedPosition())?.assessmentQuestion).toBe("family_involvement");
  }
  await page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: /Assessment$/ }).click();
  await expect(page).toHaveURL(/assessmentSection=social_support/);
  await expect(page).toHaveURL(/assessmentQuestion=family_involvement/);
  await expect(answer).toBeFocused();

  // A cold entry with no requested section resumes the saved position instead of
  // the first section or the next unanswered item.
  await page.goto(`${workspace}&workspaceView=activity`);
  await page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: /Assessment$/ }).click();
  await expect(page).toHaveURL(/assessmentSection=social_support/);
  await expect(answer).toBeFocused();

  // An explicit request still wins over the saved position.
  await page.goto(`${workspace}&workspaceStage=assessment&assessmentSection=medication`);
  await expect(page.getByLabel("Assessment section", { exact: true })).toHaveValue("medication");

  // Another workspace never inherits this one's position.
  const other = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Continuity Two", owner: "", tags: [] });
  await startOperationalAssessment(page.request, await createOperationalAssessment(page.request, other.id));
  await page.goto(`/?view=referrals&screen=packet&referralId=${other.id}&workspaceStage=assessment`);
  await expect(page.getByLabel("Assessment section", { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/social_support/);
});

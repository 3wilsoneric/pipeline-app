import { expect, test } from "@playwright/test";
import { openAllQuestions } from "../support/assessment-navigation";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";

// Interview layout edge cases (docs/design/DECISIONS.md, "Interview layout"): the record rail is tucked away during
// the interview behind a labeled assessment control, comes back everywhere else, and the information beside the questions is the
// filled-in information for the topic being asked.
test.describe("interview layout", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Run with the operational configuration and PIPELINE_DESIGN_V2=true.");

  test("tucks the rail away only during the interview and shows the topic's own information", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessor = await actorApiContext("assessorA", url);
    expect((await assessor.get("/api/members")).status()).toBe(200);
    expect((await coordinator.get("/api/members")).status()).toBe(200);
    const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
    const assessment = await createOperationalAssessment(assessor, referral.id);
    expect((await assessor.post(`/api/assessments/${assessment.assessment_id}/start`, { data: { if_match: assessment.version } })).status()).toBe(200);
    const { page, context } = await actorPage(browser, "assessorA", url);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview`);
      const root = page.locator("html");
      const rail = page.getByRole("navigation", { name: "Workspace stages" });
      const bar = page.getByRole("navigation", { name: "Assessment sections" });
      const picker = bar.getByRole("combobox", { name: "Assessment section" });
      const info = page.locator("[data-interview-split]");
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      await expect(info.locator("[data-client-notes]")).toContainText("All notes saved");
      await expect(rail).toBeHidden();

      // No All questions / Interview trail in the interview bar; the dropdown lists All questions first, then the
      // sections, and choosing a section snaps straight to it.
      await expect(bar.getByRole("button", { name: "Interview", exact: true })).toBeHidden();
      await expect(picker.locator("option").first()).toHaveText("All questions");
      await picker.selectOption("physical_health");
      await expect(page.locator('[data-assessment-group-heading="physical_health"]')).toBeInViewport({ timeout: 300 });
      await picker.selectOption("identity");

      // The information follows the topic: only that topic, only what is filled in.
      await expect(info.locator('[data-split-topic="identity"]')).toContainText("Operational Referral");
      await picker.selectOption("medication");
      await expect(info.locator("[data-split-topic]")).toHaveCount(1);
      await expect(info.locator('[data-split-topic="medication"]')).toBeVisible();
      // The picker holds the chosen topic while the page scrolls there.
      const seen = await page.evaluate(async () => {
        const select = document.querySelector<HTMLSelectElement>('select[aria-label="Assessment section"]')!;
        const values = new Set<string>();
        for (let frame = 0; frame < 20; frame++) { values.add(select.value); await new Promise((resolve) => requestAnimationFrame(resolve)); }
        return [...values];
      });
      expect(seen).toEqual(["medication"]);

      // A topic with many long answers: the answers scroll inside the sheet and the notes stay in view below them.
      await picker.selectOption("diagnosis_clinical");
      const long = "Reports low mood most days for the past month, sleeping four to five hours, appetite reduced. Denies current suicidal ideation; one past attempt years ago. Engaged with outpatient psychiatry until spring, then lost contact after moving.";
      const clinical = page.locator('[data-assessment-group-heading="diagnosis_clinical"] ~ section').first().locator("textarea");
      for (let index = 0; index < Math.min(4, await clinical.count()); index++) { await clinical.nth(index).fill(long); await clinical.nth(index).blur(); }
      await picker.selectOption("identity");
      await picker.selectOption("diagnosis_clinical");
      await expect(page.locator('[data-assessment-group-heading="diagnosis_clinical"]')).toBeInViewport();
      const topicSheet = info.locator('[data-split-topic="diagnosis_clinical"]');
      await expect(topicSheet).toContainText("Reports low mood");
      await page.setViewportSize({ width: 1440, height: 520 });
      await expect(info.locator("[data-client-notes] textarea").first()).toBeInViewport();
      await expect.poll(() => page.evaluate(() => {
        const sheet = document.querySelector("[data-interview-split] [data-split-chart] > div")!.getBoundingClientRect();
        const bar = document.querySelector('[aria-label="Assessment actions"]')!.getBoundingClientRect();
        return sheet.bottom <= bar.top + 1;
      })).toBe(true);
      await page.screenshot({ path: test.info().outputPath("long-answers.png") });
      await page.setViewportSize({ width: 1440, height: 900 });

      // The assessment control brings the rail back; the app sidebar keeps its separate arrow.
      const workspaceToggle = page.locator("[data-interview-rail-toggle]");
      await expect(workspaceToggle).toHaveAccessibleName("Show workspace");
      await expect(workspaceToggle).toHaveAttribute("aria-controls", "workspace-record-rail");
      await workspaceToggle.click();
      await expect(workspaceToggle).toHaveAccessibleName("Focus assessment");
      await expect(rail).toBeVisible();
      await expect(workspaceToggle).toBeInViewport();
      await page.screenshot({ path: test.info().outputPath("workspace-rail-shown.png") });
      await rail.getByRole("button", { name: "Chart", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Referral chart", exact: true })).toBeVisible();
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await expect(page.locator("[data-interview-rail-toggle]")).toBeHidden();
      await rail.getByRole("button", { name: "Assessment", exact: true }).click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      await expect(rail).toBeVisible();
      await page.reload();
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      await expect(rail).toBeVisible();
      await page.getByRole("button", { name: "Focus assessment" }).click();
      await expect(rail).toBeHidden();
      await page.reload();
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      await expect(rail).toBeHidden();

      // All questions is the normal page with the rail; Interview tucks it away again.
      await openAllQuestions(page);
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await expect(rail).toBeVisible();
      await page.getByRole("button", { name: "Return to interview", exact: true }).click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");

      // A narrow window keeps the normal layout with the rail.
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await Promise.all([coordinator.dispose(), assessor.dispose()]);
    }
  });

  test("preparation has one interview action, preserves saves, and records the start only after confirmation", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessor = await actorApiContext("assessorA", url);
    expect((await assessor.get("/api/members")).status()).toBe(200);
    expect((await coordinator.get("/api/members")).status()).toBe(200);
    const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
    const assessment = await createOperationalAssessment(assessor, referral.id);
    const read = async () => (await (await assessor.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    const { page, context } = await actorPage(browser, "assessorA", url);
    let releaseSave = () => {};
    const saveHeld = new Promise<void>((resolve) => { releaseSave = resolve; });
    let starts = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith(`/assessments/${assessment.assessment_id}/start`)) starts++; });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=prepare`);
      const progress = page.getByRole("region", { name: "Assessment progress", exact: true });
      await expect(progress.getByRole("button", { name: /Schedule interview|Edit assessment appointment/ })).toHaveCount(1);
      const bar = page.getByRole("navigation", { name: "Assessment sections" });
      await expect(bar.getByRole("combobox", { name: "Assessment section" })).toBeVisible();
      await expect(progress).toHaveAttribute("data-compact-preparation", "true");
      await expect(page.getByRole("list", { name: "Preparation and interview" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open interview", exact: true })).toHaveCount(0);
      const begin = page.getByRole("button", { name: "Begin interview", exact: true });
      await expect(begin).toHaveCount(1);
      await expect(begin).toBeInViewport();
      const notes = page.locator('[data-client-notes] [data-note-heading="notes"] textarea');
      await notes.fill("Synthetic preparation note stays with this client.");
      await expect.poll(async () => (await (await assessor.get(`/api/referrals/${referral.id}/notes`)).json()).blocks.find((block: { block_key: string }) => block.block_key === "notes")?.body).toBe("Synthetic preparation note stays with this client.");

      // A slow ordinary save must not block opening or cancelling the start dialog.
      await page.route(`**/api/assessments/${assessment.assessment_id}`, async (route) => {
        if (route.request().method() === "PATCH") await saveHeld;
        await route.continue();
      });
      const answer = "Synthetic location prepared before the interview.";
      await page.getByRole("textbox", { name: "Current location", exact: true }).fill(answer);
      await begin.click({ timeout: 2_000 });
      const dialog = page.getByRole("dialog", { name: "Begin interview", exact: true });
      await expect(dialog).toBeVisible({ timeout: 1_000 });
      expect(starts).toBe(0);
      expect((await read()).started_at).toBeNull();
      await dialog.getByRole("button", { name: "Keep preparing", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Current location", exact: true })).toHaveValue(answer);
      releaseSave();
      await expect.poll(async () => (await read()).current_location).toBe(answer);
      await page.unroute(`**/api/assessments/${assessment.assessment_id}`);
      await begin.click();
      await dialog.getByRole("button", { name: "Begin interview", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-interview-focus", "true");
      const started = await read();
      expect(started.started_at).toBeTruthy();
      expect(started.current_location).toBe(answer);
      await bar.getByRole("combobox", { name: "Assessment section" }).selectOption("identity");
      await expect(notes).toHaveValue("Synthetic preparation note stays with this client.");
      await openAllQuestions(page);
      // Back in All questions after the interview began: nothing to schedule, no appointment line.
      await expect(page.locator('[data-assessment-working-section][data-assessment-phase="preparation"]')).toBeVisible();
      await expect(page.getByRole("button", { name: /Schedule interview|Edit assessment appointment/ })).toHaveCount(0);
      await expect(page.locator('[aria-label="Assessment appointment"]')).toHaveCount(0);
      await expect(begin).toHaveCount(0);
      const resume = page.getByRole("button", { name: "Return to interview", exact: true });
      await expect(resume).toHaveCount(1);
      await resume.click();
      await expect(page.locator("html")).toHaveAttribute("data-interview-focus", "true");
      expect((await read()).started_at).toBe(started.started_at);
      expect(starts).toBe(1);
      expect((await (await assessor.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments).toHaveLength(1);
    } finally {
      releaseSave();
      await context.close();
      await Promise.all([coordinator.dispose(), assessor.dispose()]);
    }
  });
});

import { expect, test, type Page } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { preparationGroupForSection } from "../../../lib/assessment/assessment-preparation";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";

// Full-screen interview edge cases (docs/design/DECISIONS.md, "Full-screen interview"): what people actually do
// around it — leave and come back, open things from inside it, step away to other pages, resize — and that it
// never loses their place, strands keyboard focus, or leaves covered controls reachable.
test.describe("full-screen interview", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Run with the operational configuration and PIPELINE_DESIGN_V2=true.");

  test("keeps the person's place, focus, and reach through every way in and out", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessor = await actorApiContext("assessorA", url);
    expect((await assessor.get("/api/members")).status()).toBe(200);
    expect((await coordinator.get("/api/members")).status()).toBe(200);
    const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
    await createOperationalAssessment(assessor, referral.id);
    const { page, context } = await actorPage(browser, "assessorA", url);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview`);
      const root = page.locator("html");
      const bar = page.getByRole("navigation", { name: "Assessment sections" });
      const picker = bar.getByRole("combobox", { name: "Assessment section" });
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      await expect(page.locator("[data-interview-split] [data-client-notes]")).toContainText("All notes saved");

      // Covered app controls are out of reach, not just out of sight.
      await expect.poll(() => appBarCovered(page)).toBe(true);

      // The picker holds the chosen topic while the page scrolls there (no flicking through the topics passed).
      await picker.selectOption("medication");
      const seen = await page.evaluate(async () => {
        const select = document.querySelector<HTMLSelectElement>('select[aria-label="Assessment section"]')!;
        const values = new Set<string>();
        for (let frame = 0; frame < 20; frame++) { values.add(select.value); await new Promise((resolve) => requestAnimationFrame(resolve)); }
        return [...values];
      });
      expect(seen).toEqual(["medication"]);

      // Closing (even before the scroll arrives) goes to All questions on the matching group, with focus on
      // Interview; Interview goes straight back to the same topic, full screen.
      await picker.selectOption("behavioral_risk");
      await page.mouse.move(900, 500);
      await bar.getByRole("button", { name: "Close", exact: true }).click();
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      const group = preparationGroupForSection("behavioral_risk").key;
      await expect(picker).toHaveValue(group);
      await expect(page.locator(`[data-assessment-group-heading="${group}"]`)).toBeInViewport();
      const interview = page.getByRole("button", { name: "Interview", exact: true });
      await expect(interview).toBeFocused();
      await expect.poll(() => appBarCovered(page)).toBe(false);
      await interview.click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      await expect(picker).toHaveValue("behavioral_risk");
      await page.keyboard.press("Escape");
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await interview.click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");

      // A document opened from the chart side shows over full screen; Escape closes only the document.
      const documentButton = page.locator("[data-interview-split]").getByRole("button", { name: /^Preview / }).first();
      if (await documentButton.count()) {
        await documentButton.click();
        const preview = page.getByRole("dialog").last();
        await expect(preview).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(preview).toBeHidden();
        await expect(root).toHaveAttribute("data-interview-focus", "true");
      }

      // Begin interview opens its dialog over full screen, and Escape closes only the dialog.
      const begin = bar.getByRole("button", { name: "Begin interview", exact: true });
      if (await begin.count()) {
        await begin.click();
        const dialog = page.getByRole("dialog").filter({ hasText: "Begin interview" }).last();
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(root).toHaveAttribute("data-interview-focus", "true");
      }

      // A narrow window drops full screen; widening brings it back (the preference is still on).
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(root).toHaveAttribute("data-interview-focus", "true");

      // Another step from the slid-out rail leaves full screen for that step; coming back restores it.
      await page.mouse.move(4, 450);
      const rail = page.getByRole("navigation", { name: "Workspace stages" });
      await rail.getByRole("button", { name: "Decision", exact: true }).click();
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await expect(rail.getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("aria-current", "page");
      await expectNoCoveredControls(page);
      await rail.getByRole("button", { name: "Assessment", exact: true }).click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      // The Chart step is drawn by the same editor; full screen must still step aside there.
      await page.mouse.move(4, 450);
      await rail.getByRole("button", { name: "Chart", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Referral chart", exact: true })).toBeVisible();
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await expect(rail.getByRole("button", { name: "Chart", exact: true })).toBeInViewport();
      await expectNoCoveredControls(page);
      await rail.getByRole("button", { name: "Assessment", exact: true }).click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");

      // After a reload on another step, Assessment reopens in the interview, the mode last used here.
      await page.mouse.move(4, 450);
      await rail.getByRole("button", { name: "Chart", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Referral chart", exact: true })).toBeVisible();
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
      await expect(page.getByRole("heading", { name: "Referral chart", exact: true })).toBeVisible();
      await rail.getByRole("button", { name: "Assessment", exact: true }).click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");

      // All questions is not the interview: full screen steps aside and returns with it.
      await bar.getByRole("button", { name: "All questions", exact: true }).click();
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await expectNoCoveredControls(page);
      await page.getByRole("button", { name: "Interview", exact: true }).click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");

      // Review assessment leaves the interview for the review, with nothing left covered.
      await page.getByRole("button", { name: "Review assessment" }).click();
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await expectNoCoveredControls(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await Promise.all([coordinator.dispose(), assessor.dispose()]);
    }
  });

  test("Schedule interview and the appointment show only until the interview begins", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessor = await actorApiContext("assessorA", url);
    expect((await assessor.get("/api/members")).status()).toBe(200);
    expect((await coordinator.get("/api/members")).status()).toBe(200);
    const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
    await createOperationalAssessment(assessor, referral.id);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=prepare`);
      const progress = page.getByRole("region", { name: "Assessment progress", exact: true });
      await expect(progress.getByRole("button", { name: /Schedule interview|Edit assessment appointment/ })).toHaveCount(1);
      await progress.getByRole("button", { name: "Begin interview", exact: true }).click();
      await page.getByRole("dialog", { name: "Begin interview", exact: true }).getByRole("button", { name: "Begin interview", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-interview-focus", "true");
      await page.getByRole("navigation", { name: "Assessment sections" }).getByRole("button", { name: "Close", exact: true }).click();
      // Back in All questions after the interview began: nothing to schedule, no appointment line.
      await expect(page.getByRole("button", { name: "Prepare assessment", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: /Schedule interview|Edit assessment appointment/ })).toHaveCount(0);
      await expect(page.locator('[aria-label="Assessment appointment"]')).toHaveCount(0);
    } finally {
      await context.close();
      await Promise.all([coordinator.dispose(), assessor.dispose()]);
    }
  });
});

// Whether the app bar is out of reach (inert) behind full screen.
function appBarCovered(page: Page) {
  return page.locator('button[aria-label="Open referrals"]').first().evaluate((button) => Boolean(button.closest("[inert]")));
}

// Outside full screen nothing stays inert, so the app bar is reachable again.
async function expectNoCoveredControls(page: Page) {
  await expect.poll(() => appBarCovered(page)).toBe(false);
}

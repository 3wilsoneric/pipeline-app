import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";

// Interview layout edge cases (docs/design/DECISIONS.md, "Interview layout"): the record rail is tucked away during
// the interview behind an arrow, comes back everywhere else, and the information beside the questions is the
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
    await createOperationalAssessment(assessor, referral.id);
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

      // The arrow brings the rail back and hides it again; the choice holds while in the interview.
      await page.getByRole("button", { name: "Expand navigation" }).last().click();
      await expect(rail).toBeVisible();
      await page.getByRole("button", { name: "Collapse navigation" }).last().click();
      await expect(rail).toBeHidden();

      // Another step shows the rail as usual; coming back to the interview tucks it away again.
      await page.getByRole("button", { name: "Expand navigation" }).last().click();
      await rail.getByRole("button", { name: "Chart", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Referral chart", exact: true })).toBeVisible();
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await expect(rail).toBeVisible();
      await expect(page.locator("[data-interview-rail-toggle]")).toBeHidden();
      await rail.getByRole("button", { name: "Assessment", exact: true }).click();
      await expect(root).toHaveAttribute("data-interview-focus", "true");
      await expect(rail).toBeHidden();

      // All questions is the normal page with the rail; Interview tucks it away again.
      await bar.getByRole("button", { name: "All questions", exact: true }).click();
      await expect(root).not.toHaveAttribute("data-interview-focus", "true");
      await expect(rail).toBeVisible();
      await page.getByRole("button", { name: "Interview", exact: true }).click();
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
      await page.getByRole("button", { name: "All questions", exact: true }).click();
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

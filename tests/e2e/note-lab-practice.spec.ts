import { expect, test } from "@playwright/test";

test.describe("Assessment practice lab", () => {
  test("moves from field guidance to the anchored question and then to the next question", async ({ page }) => {
    const clinicalRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/(assessments|referrals)(?:\/|$)/.test(new URL(request.url()).pathname)) clinicalRequests.push(request.url());
    });

    const response = await page.goto("/note-lab/practice");
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel("Resident name *", { exact: true })).toHaveValue("Jordan Practice");
    await expect(page.getByText("Practice", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Client & referral" })).toBeVisible();
    await expect(page.getByText("Save and continue", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open guide launcher" })).toHaveCount(0);

    await page.getByRole("button", { name: "Open guidance for Resident name" }).click();
    const guidance = page.getByRole("dialog", { name: "Resident name" });
    await expect(guidance).toBeVisible();
    await expect(guidance.getByText("What to capture", { exact: true })).toBeVisible();
    await expect(guidance.getByText("How to answer", { exact: true })).toBeVisible();
    await guidance.getByRole("button", { name: "OK, go to question" }).click();

    const guidedStep = page.getByRole("dialog", { name: "Guided step for Resident name" });
    await expect(guidedStep).toBeVisible();
    await expect(guidedStep.getByText("Do this question", { exact: true })).toBeVisible();
    await guidedStep.getByRole("button", { name: "Next question" }).click();
    await expect(page.getByRole("dialog", { name: "Date of birth" })).toBeVisible();

    expect(clinicalRequests).toEqual([]);
  });

  test("uses canonical conditionals and field-specific narrative guidance", async ({ page }) => {
    await page.goto("/note-lab/practice");

    await page.getByLabel("Section", { exact: true }).selectOption("functional_adl");
    await expect(page.getByRole("heading", { name: "Function" })).toBeVisible();
    await page.getByLabel("Ability to dress *", { exact: true }).selectOption("some_assistance");
    await expect(page.getByLabel("Dressing assistance needed *", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open guidance for Dressing assistance needed" }).click();
    const writingGuidance = page.getByRole("dialog", { name: "Dressing assistance needed" });
    await expect(writingGuidance.getByText("Note structure", { exact: true })).toBeVisible();
    await expect(writingGuidance.getByText("Example", { exact: true })).toBeVisible();
    await writingGuidance.getByRole("button", { name: "OK, go to question" }).click();
    await page.getByLabel("Dressing assistance needed *", { exact: true }).fill("Synthetic client needs one verbal cue for buttons each morning, per training staff.");

    await page.getByLabel("Section", { exact: true }).selectOption("physical_health");
    await expect(page.getByLabel("Brief changing support *", { exact: true })).toHaveCount(0);
    await page.getByRole("group", { name: "Incontinence issues", exact: true }).getByRole("button", { name: "Yes", exact: true }).click();
    const briefSupport = page.getByLabel("Brief changing support *", { exact: true });
    await expect(briefSupport).toBeVisible();
    await briefSupport.selectOption("needs_help_changing_briefs");
    await expect(briefSupport).toHaveValue("needs_help_changing_briefs");
  });

  test("starts at question one, resets locally, and remains usable on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/note-lab/practice");
    await expect(page.getByLabel("Assessment section", { exact: true })).toBeVisible();
    await page.getByLabel("Resident name *", { exact: true }).fill("Changed synthetic name");
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByLabel("Resident name *", { exact: true })).toHaveValue("Jordan Practice");
    await page.getByRole("button", { name: "Start walkthrough" }).click();
    await expect(page.getByRole("dialog", { name: "Resident name" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

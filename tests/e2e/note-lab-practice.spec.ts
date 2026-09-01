import { expect, test } from "@playwright/test";

test.describe("Assessment practice lab", () => {
  test("uses canonical conditionals and writing help without clinical requests", async ({ page }) => {
    const clinicalRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/(assessments|referrals)(?:\/|$)/.test(new URL(request.url()).pathname)) clinicalRequests.push(request.url());
    });

    const response = await page.goto("/note-lab/practice");
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel("Resident name *", { exact: true })).toHaveValue("Jordan Practice");
    await expect(page.getByText("Practice", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Client & referral" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open guide launcher" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Guided practice" })).toBeVisible();
    await expect(page.getByText("Assessment lab", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /Function/ }).click();
    await expect(page.getByRole("heading", { name: "Function" })).toBeVisible();
    await page.getByLabel("Ability to dress *", { exact: true }).selectOption("some_assistance");
    await expect(page.getByLabel("Dressing assistance needed *", { exact: true })).toBeVisible();
    await page.getByLabel("Dressing assistance needed *", { exact: true }).fill("Synthetic client needs one verbal cue for buttons each morning, per training staff.");

    await page.getByRole("button", { name: /Clinical/ }).click();
    const currentSymptoms = page.locator('[data-guide-target="practice-current-symptoms"]');
    await currentSymptoms.getByText("Example", { exact: true }).click();
    await expect(currentSymptoms.getByText("Observation and report", { exact: true })).toBeVisible();
    await expect(currentSymptoms.getByText("Good note", { exact: true })).toBeVisible();

    expect(clinicalRequests).toEqual([]);
  });

  test("opens the compact guide from the assessment header", async ({ page }) => {
    await page.goto("/note-lab/practice");
    await page.getByRole("button", { name: "Guided practice" }).click();
    const guide = page.getByRole("dialog", { name: "Practice the assessment guided tutorial" });
    await expect(guide).toBeVisible();
    await expect(guide.getByText("Step 1 of 5", { exact: true })).toBeVisible();
    await expect(guide.getByText("Select Function in the section rail.", { exact: true })).toBeVisible();
    await expect(guide.getByPlaceholder("Ask: why, safety, next, back...")).toHaveCount(0);
  });

  test("resets local practice state and remains usable on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/note-lab/practice");
    await expect(page.getByLabel("Assessment section", { exact: true })).toBeVisible();
    await page.getByLabel("Resident name *", { exact: true }).fill("Changed synthetic name");
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByLabel("Resident name *", { exact: true })).toHaveValue("Jordan Practice");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

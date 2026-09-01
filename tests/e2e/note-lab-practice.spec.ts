import { expect, test } from "@playwright/test";

test.describe("Assessment practice lab", () => {
  test("uses canonical conditionals and writing help without clinical requests", async ({ page }) => {
    const clinicalRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/(assessments|referrals)(?:\/|$)/.test(new URL(request.url()).pathname)) clinicalRequests.push(request.url());
    });

    const response = await page.goto("/note-lab/practice");
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel("Resident name*")).toHaveValue("Jordan Practice");
    await expect(page.getByText("Synthetic")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Client & referral" })).toBeVisible();

    await page.getByRole("button", { name: /05 Function/ }).click();
    await expect(page.getByRole("heading", { name: "Function" })).toBeVisible();
    await page.getByLabel("Ability to dress*").selectOption("some_assistance");
    await expect(page.getByLabel("Dressing assistance needed*")).toBeVisible();
    await page.getByLabel("Dressing assistance needed*").fill("Synthetic client needs one verbal cue for buttons each morning, per training staff.");

    await page.getByRole("button", { name: /04 Clinical/ }).click();
    await page.locator('[data-guide-target="practice-current-symptoms"]').getByRole("button", { name: "Writing help" }).click();
    await expect(page.getByText("Observation and report", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Example:/)).toBeVisible();

    expect(clinicalRequests).toEqual([]);
  });

  test("resets local practice state and remains usable on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/note-lab/practice");
    await expect(page.getByLabel("Section", { exact: true })).toBeVisible();
    await page.getByLabel("Resident name*").fill("Changed synthetic name");
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByLabel("Resident name*")).toHaveValue("Jordan Practice");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

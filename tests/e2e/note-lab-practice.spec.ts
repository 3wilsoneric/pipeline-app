import { expect, test } from "@playwright/test";

test.describe("Assessment practice lab", () => {
  test("keeps obvious fields plain and guides only authored narrative fields", async ({ page }) => {
    const clinicalRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/(assessments|referrals)(?:\/|$)/.test(new URL(request.url()).pathname)) clinicalRequests.push(request.url());
    });

    const response = await page.goto("/note-lab/practice");
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("standalone-review-shell")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pipeline home" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Open profile menu for/ })).toHaveCount(0);
    await expect(page.getByLabel("Resident name *", { exact: true })).toHaveValue("Jordan Practice");
    await expect(page.getByText("Practice", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Client & referral" })).toBeVisible();
    await expect(page.getByText("Save and continue", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open guide launcher" })).toHaveCount(0);

    await expect(page.getByText("Note help", { exact: true })).toHaveCount(0);

    const sectionRail = page.getByRole("complementary", { name: "Assessment section navigation" });
    await sectionRail.getByRole("button", { name: /^History\b/ }).click();
    await page.getByRole("button", { name: "Open guide for History" }).click();
    const guidance = page.getByRole("dialog", { name: "Guided step for Prior placements" });
    await expect(guidance).toBeVisible();
    await expect(guidance.getByText(/Explain where the client lived, how long, why each setting ended/)).toBeVisible();
    await expect(guidance.getByText(/Board-and-care \| approximately 8 months/)).toBeVisible();
    await guidance.getByRole("button", { name: "Next field" }).click();
    await expect(page.getByRole("dialog", { name: "Guided step for Prior AWOL / failed placements" })).toBeVisible();

    expect(clinicalRequests).toEqual([]);
  });

  test("uses canonical conditionals and field-specific narrative guidance", async ({ page }) => {
    await page.goto("/note-lab/practice");

    const sectionRail = page.getByRole("complementary", { name: "Assessment section navigation" });
    await sectionRail.getByRole("button", { name: /^Function\b/ }).click();
    await page.getByRole("button", { name: "Open guide for Function" }).click();
    await expect(sectionRail.getByRole("button", { name: /^Function\b/ })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("heading", { name: "Function" })).toBeVisible();
    const adlGuidance = page.getByRole("dialog", { name: "Guided step for ADL needs" });
    await expect(adlGuidance).toBeVisible();
    await expect(adlGuidance.getByText(/State exactly what the client can do/)).toBeVisible();
    await expect(adlGuidance.getByText(/Laundry \| completes sorting and folding/)).toBeVisible();
    await adlGuidance.getByRole("button", { name: "Next field" }).click();
    const peerGuidance = page.getByRole("dialog", { name: "Guided step for Peer interaction notes" });
    await expect(peerGuidance).toBeVisible();
    await expect(peerGuidance.getByText(/Describe actual communication, interaction, and program participation patterns/)).toBeVisible();
    await expect(peerGuidance.getByText(/joins peers for meals daily/)).toBeVisible();
    await page.getByLabel("Ability to dress *", { exact: true }).selectOption("some_assistance");
    await expect(page.getByLabel("Dressing assistance needed *", { exact: true })).toBeVisible();
    await page.getByLabel("Dressing assistance needed *", { exact: true }).fill("Synthetic client needs one verbal cue for buttons each morning, per training staff.");
    await expect(page.getByRole("heading", { name: "Function" })).toBeVisible();

    await sectionRail.getByRole("button", { name: /^Physical health\b/ }).click();
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
    await expect(page.getByRole("button", { name: "Open guide for Client & referral" })).toBeDisabled();
    await page.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
    await page.getByRole("button", { name: "Open guide for History" }).click();
    await expect(page.getByRole("dialog", { name: "Guided step for Prior placements" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

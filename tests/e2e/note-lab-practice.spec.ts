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
    await expect(page.getByRole("button", { name: "Save and continue" })).toBeVisible();
    await expect(page.getByText("Autosaved in this browser", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open guide launcher" })).toHaveCount(0);

    await expect(page.getByText("Note help", { exact: true })).toHaveCount(0);

    const sectionRail = page.getByRole("complementary", { name: "Assessment section navigation" });
    await sectionRail.getByRole("button", { name: /^History\b/ }).click();
    const guidance = page.locator("details").filter({ has: page.getByLabel("Answer help for Prior placements") });
    await expect(guidance).not.toHaveAttribute("open", "");
    await page.getByLabel("Answer help for Prior placements").click();
    await expect(guidance).toHaveAttribute("open", "");
    await expect(guidance.getByText(/Explain where the client lived, how long, why each setting ended/)).toBeVisible();
    await expect(guidance.getByText(/Board-and-care; approximately 8 months/)).toBeVisible();
    const nextGuidance = page.locator("details").filter({ has: page.getByLabel("Answer help for Prior AWOL / failed placements") });
    await expect(nextGuidance).not.toHaveAttribute("open", "");
    await page.getByLabel("Answer help for Prior AWOL / failed placements").click();
    await expect(nextGuidance).toHaveAttribute("open", "");
    await expect(page.getByRole("button", { name: "Next field" })).toHaveCount(0);

    expect(clinicalRequests).toEqual([]);
  });

  test("uses canonical conditionals and field-specific narrative guidance", async ({ page }) => {
    await page.goto("/note-lab/practice");

    const sectionRail = page.getByRole("complementary", { name: "Assessment section navigation" });
    await sectionRail.getByRole("button", { name: /^Function\b/ }).click();
    await expect(sectionRail.getByRole("button", { name: /^Function\b/ })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("heading", { name: "Function" })).toBeVisible();
    const adlGuidance = page.locator("details").filter({ has: page.getByLabel("Answer help for ADL needs") });
    await page.getByLabel("Answer help for ADL needs").click();
    await expect(adlGuidance).toHaveAttribute("open", "");
    await expect(adlGuidance.getByText(/State exactly what the client can do/)).toBeVisible();
    await expect(adlGuidance.getByText(/Laundry; completes sorting and folding/)).toBeVisible();
    const peerGuidance = page.locator("details").filter({ has: page.getByLabel("Answer help for Peer interaction notes") });
    await page.getByLabel("Answer help for Peer interaction notes").click();
    await expect(peerGuidance).toHaveAttribute("open", "");
    await expect(peerGuidance.getByText(/Describe actual communication, interaction, and program participation patterns/)).toBeVisible();
    await expect(peerGuidance.getByText(/joins peers for meals daily/)).toBeVisible();
    await page.getByLabel("Ability to dress *", { exact: true }).selectOption("some_assistance");
    await expect(page.getByLabel("Dressing assistance needed *", { exact: true })).toBeVisible();
    await page.getByLabel("Dressing assistance needed *", { exact: true }).fill("Synthetic client needs one verbal cue for buttons each morning, per training staff.");
    await expect(page.getByRole("heading", { name: "Function" })).toBeVisible();

    await sectionRail.getByRole("button", { name: /^Physical health\b/ }).click();
    await expect(page.getByLabel("Support *", { exact: true })).toHaveCount(0);
    await page.getByRole("group", { name: "Incontinence issues", exact: true }).getByRole("button", { name: "Yes", exact: true }).click();
    const briefSupport = page.getByLabel("Support *", { exact: true });
    await expect(briefSupport).toBeVisible();
    await briefSupport.selectOption("needs_help_changing_briefs");
    await expect(briefSupport).toHaveValue("needs_help_changing_briefs");
  });

  test("autosaves, restores, resets locally, and remains usable on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/note-lab/practice");
    await expect(page.getByLabel("Assessment section", { exact: true })).toBeVisible();
    await page.getByLabel("Resident name *", { exact: true }).fill("Changed synthetic name");
    await expect(page.getByText("Saving...", { exact: true })).toBeVisible();
    await expect(page.getByText("Autosaved in this browser", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Resident name *", { exact: true })).toHaveValue("Changed synthetic name");
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByLabel("Resident name *", { exact: true })).toHaveValue("Jordan Practice");
    await expect(page.getByRole("button", { name: /Open guide for/ })).toHaveCount(0);
    await page.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
    const guidance = page.locator("details").filter({ has: page.getByLabel("Answer help for Prior placements") });
    await page.getByLabel("Answer help for Prior placements").click();
    await expect(guidance).toHaveAttribute("open", "");
    await expect(guidance.getByText("Example", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

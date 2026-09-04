import { expect, test } from "@playwright/test";

test.describe("Pipeline Demo Environment", () => {
  test("creates and opens a real synthetic assessment rehearsal", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const response = await page.goto("/training/demo");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Assessor walkthrough" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open guide launcher" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Practice cases" }).click();

    const scenario = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Assessment interview" }),
    });
    await scenario.getByRole("button", { name: /^(Start|New attempt)$/ }).click();

    await expect(page).toHaveURL(/screen=packet.*workspaceStage=assessment/);
    await expect(page.locator('[data-pipeline-demo-banner="true"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /02 Assessment/ })).toHaveAttribute("aria-current", "page");
    const interview = page.getByRole("dialog", { name: "Assessment interview" });
    await expect(interview).toBeVisible();
    await expect(interview.getByRole("textbox", { name: "Resident number" })).toBeEditable();
    await interview.getByRole("button", { name: /Clinical 0\/6/ }).click();
    await expect(interview.getByRole("heading", { name: "Current presentation" })).toBeVisible();
    await expect(interview.getByRole("textbox", { name: "Current symptoms" })).toBeEditable();
    await interview.getByText("Answer format", { exact: true }).first().click();
    await expect(interview.getByText("Use this order", { exact: true }).first()).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("opens the interview walkthrough on all real assessment sections", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await page.goto("/training/demo");
    await page.getByRole("navigation", { name: "Demo chapters" }).getByRole("button", { name: /Complete the interview/ }).click();
    await page.getByRole("button", { name: "Open guided practice" }).click();

    await expect(page).toHaveURL(/screen=packet.*workspaceStage=assessment/);
    const coach = page.getByRole("dialog", { name: "Finish an assessment guided tutorial" });
    await expect(coach).toBeVisible();
    await expect(coach.getByRole("heading", { name: "Client & referral" })).toBeVisible();
    const interview = page.getByRole("dialog", { name: "Assessment interview" });
    await expect(interview.getByRole("navigation", { name: "Assessment sections" })).toBeVisible();
    for (const section of ["Client & referral", "Placement", "History", "Clinical", "Function", "Medication", "Substance use", "Behavior & safety", "Physical health", "Legal", "Support & goals", "Review"]) {
      await expect(interview.getByRole("button", { name: new RegExp(`^${escapeRegExp(section)} \\d+/\\d+$`) })).toBeVisible();
    }
    await expect.poll(() => errors).toEqual([]);
  });

  test("keeps the presenter run usable on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/training/demo");
    await expect(page.getByRole("heading", { name: "Assessor walkthrough" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review the referral" })).toBeVisible();
    await expect(page.getByText("Open Intake and verify name, date of birth, community, source, and owner")).toBeVisible();
    const center = page.locator('[data-demo-center="true"]');
    expect(await center.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const tab of ["Walkthrough", "Practice cases", "Meet the Client"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("previews a Resident Care Director handoff without sending data", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`);
    });

    await page.goto("/training/demo");
    const meetClientTab = page.getByRole("tab", { name: "Meet the Client" });
    await expect(meetClientTab).toBeVisible();
    await page.waitForLoadState("networkidle");
    await meetClientTab.click();
    await expect(meetClientTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-meet-client-demo="true"]')).toBeVisible();
    const emailPreview = page.getByRole("article", { name: "Meet the Client email preview" });
    await expect(emailPreview.getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New message" })).toBeVisible();
    await expect(page.getByText("Referral Face Sheet.pdf")).toBeVisible();

    await expect(emailPreview).toBeVisible();
    await page.getByRole("button", { name: "Simulate delivery" }).click();
    await expect(page.getByText("Demo delivery complete")).toBeVisible();
    expect(requests).toEqual([]);
  });
});

function watchBrowserErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("/_next/webpack-hmr")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import { expect, test } from "@playwright/test";

// Old training bookmarks return to normal work without launching tutorials.
for (const path of ["/training", "/training/demo?journey=1", "/training/demo?view=tester", "/training/assessment-preview"]) {
  test(`retired presentation ${path} returns to the app without creating practice or clinical records`, async ({ page, baseURL }) => {
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && /^\/api\/(?:demo|referrals|assessments)(?:\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url());
    });
    await page.goto(path);
    await expect(page).toHaveURL(new URL("/", baseURL).toString());
    await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open guided tutorials" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Jump to slide" })).toHaveCount(0);
    await expect(page.locator('[data-pipeline-demo-banner="true"]')).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}

import { expect, test } from "@playwright/test";

// The retired workshop/gallery now redirect to the app. Help owns tutorials.
for (const path of ["/training", "/training/demo?journey=1", "/training/demo?view=tester", "/training/assessment-preview"]) {
  test(`retired presentation ${path} returns to Help without creating practice or clinical records`, async ({ page, baseURL }) => {
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && /^\/api\/(?:demo|referrals|assessments)(?:\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url());
    });
    await page.goto(path);
    await expect(page).toHaveURL(new URL("/", baseURL).toString());
    await expect(page.getByRole("button", { name: "Open guided tutorials", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Jump to slide" })).toHaveCount(0);
    await expect(page.locator('[data-pipeline-demo-banner="true"]')).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}

for (const width of [320, 834, 1440]) {
  test(`Help displays the real walkthrough library at ${width}px without a second presentation`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?screen=calendar");
    if (width < 640) await page.getByRole("button", { name: /^Open page menu/ }).click();
    await page.getByRole("button", { name: "Open guided tutorials", exact: true }).click();
    const library = page.getByRole("dialog", { name: "Guided tutorial library", exact: true });
    await expect(library).toBeVisible();
    for (const title of ["Check my work", "Schedule an assessment", "Finish an assessment", "Review a chart", "Create a referral", "Find a referral", "Run a report"]) {
      await expect(library.getByRole("button", { name: new RegExp("^" + title) })).toBeVisible();
    }
    const bounds = (await library.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: info.outputPath(`help-${width}.png`) });
    await library.getByRole("button", { name: /^Find a referral/ }).click();
    await expect(page.getByRole("dialog", { name: "Find a referral guided tutorial", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open Workspaces", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Jump to slide" })).toHaveCount(0);
  });
}

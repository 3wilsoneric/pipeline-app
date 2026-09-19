import { expect, test, type Page } from "@playwright/test";

async function openCalendar(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-18T18:00:00Z"));
  await page.route("**/api/calendar/events**", (route) => route.fulfill({ json: {
    events: Array.from({ length: 12 }, (_, index) => ({
      id: `layout-${index}`, assessmentId: `layout-${index}`, assessmentVersion: 1,
      referralId: 800 + index, clientName: `Sample Client ${index + 1}`, community: "San Pablo",
      ownerId: "assessor-a", owner: "Annette Everhart", date: "2026-09-18",
      startsAt: `2026-09-18T${String(15 + index % 7).padStart(2, "0")}:00:00Z`,
      durationMinutes: 60, method: "phone", location: "555-0100",
      scheduleStatus: "scheduled", kind: "assessment", status: "draft", title: "Assessment scheduled",
    })),
    continuing: [], unscheduled: [], unscheduledTotal: 0, unscheduledHasMore: false,
    assessors: [{ id: "assessor-a", name: "Annette Everhart" }],
    viewer: { id: "assessor-a", name: "Annette Everhart" }, scope: "team", timezone: "America/Los_Angeles",
  } }));
  await page.goto("/?screen=calendar");
  await expect(page.getByRole("button", { name: "Appointment details for Sample Client 1", exact: true })).toBeVisible();
}

test("compact calendar controls leave room for a single scrolling sheet at every size", async ({ page }, testInfo) => {
  await openCalendar(page);
  const workspace = page.locator('[data-guide-target="calendar-workspace"]');
  const controls = page.locator('header[aria-label="Calendar controls"]');
  const sheet = page.getByRole("region", { name: "Calendar entries", exact: true });
  for (const width of [1440, 834, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await sheet.evaluate((node) => { node.scrollTop = 0; });
    const before = (await controls.boundingBox())!;
    expect(before.height).toBeLessThan(width >= 1000 ? 150 : width >= 621 ? 220 : 255);
    expect((await sheet.boundingBox())!.height).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["Previous calendar range", "Next calendar range", "Today", "Refresh calendar", "Upcoming"]) {
      const bounds = (await controls.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath(`calendar-header-${width}.png`) });
    const bounds = (await sheet.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 550);
    await expect.poll(() => sheet.evaluate((node) => node.scrollTop)).toBeGreaterThan(200);
    expect((await controls.boundingBox())!.y).toBe(before.y);
    expect(await workspace.evaluate((node) => node.scrollTop)).toBe(0);
    await sheet.focus();
    await page.keyboard.press("End");
    await expect(sheet.getByRole("button", { name: "Appointment details for Sample Client 12", exact: true })).toBeInViewport();
    if (width < 621) {
      await controls.getByRole("button", { name: "Show calendar filters" }).click();
      await expect(controls.getByLabel("Filter calendar by community")).toBeVisible();
      await controls.getByLabel("Filter calendar by community").selectOption("San Pablo");
      await expect(controls.getByLabel("Filter calendar by community")).toHaveValue("San Pablo");
      await controls.getByRole("button", { name: "Show calendar filters" }).click();
    }
  }
});

test("week dates and hour ruler stay aligned through two-axis scrolling and return navigation", async ({ page }, testInfo) => {
  await openCalendar(page);
  await page.setViewportSize({ width: 834, height: 900 });
  await page.getByRole("button", { name: "week", exact: true }).click();
  const sheet = page.getByTestId("calendar-sheet");
  const week = page.getByRole("region", { name: "Timed assessment week" });
  const heading = week.locator("[data-calendar-week-heading]");
  await expect(heading).toBeVisible();
  await sheet.evaluate((node) => { node.scrollTop = 350; node.scrollLeft = 250; });
  const savedScroll = await sheet.evaluate((node) => node.scrollTop);
  expect(savedScroll).toBeGreaterThan(100);
  const sheetBounds = (await sheet.boundingBox())!;
  await expect.poll(async () => Math.abs((await heading.boundingBox())!.y - sheetBounds.y)).toBeLessThan(3);
  const ruler = week.getByText("7 AM", { exact: true }).locator("..");
  expect(Math.abs((await ruler.boundingBox())!.x - sheetBounds.x)).toBeLessThan(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("calendar-week-scrolled-ipad.png") });
  await page.getByRole("button", { name: "Open client profiles" }).click();
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
  await expect(page.getByRole("button", { name: "week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => sheet.evaluate((node) => node.scrollTop)).toBeCloseTo(savedScroll, 0);
  await page.getByRole("button", { name: "month", exact: true }).click();
  await sheet.evaluate((node) => { node.scrollTop = 250; });
  await expect(page.getByRole("heading", { level: 1, name: "September 2026" })).toBeInViewport();
});

test("Safari keeps phone calendar controls and scrolled week headings reachable", async ({ playwright, baseURL }, testInfo) => {
  const browser = await playwright.webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
    await openCalendar(page);
    await page.getByRole("button", { name: "Show calendar filters" }).click();
    await page.getByLabel("Filter calendar by community").selectOption("San Pablo");
    await page.getByRole("button", { name: "Show calendar filters" }).click();
    await page.getByRole("button", { name: "week", exact: true }).click();
    const sheet = page.getByTestId("calendar-sheet");
    const heading = page.locator("[data-calendar-week-heading]");
    await expect(heading).toBeVisible();
    await sheet.evaluate((node) => { node.scrollTop = 400; node.scrollLeft = 480; });
    const bounds = (await sheet.boundingBox())!;
    await expect.poll(async () => Math.abs((await heading.boundingBox())!.y - bounds.y)).toBeLessThan(3);
    await expect(page.getByRole("button", { name: "Today", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("calendar-safari-phone.png") });
  } finally {
    await browser.close();
  }
});

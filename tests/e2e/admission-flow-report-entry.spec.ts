import { expect, test } from "@playwright/test";

const definition = {
  id: "admission_flow", label: "Admission flow", description: "", cadence: "Current", audience: "Executives",
  filters: ["month", "community", "owner"],
};

test("Eric can open the admission flow report from the weekly briefing and return", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.user.id = "f73371d5-d2b4-48b4-a32b-1edc7c88869f";
    payload.user.email = "ericwilsonalamo@outlook.com";
    payload.user.roles = ["admin"];
    await route.fulfill({ response, json: payload });
  });
  let reportRequests = 0;
  await page.route("**/api/operations/reports?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("report_id")).toBe("admission_flow");
    reportRequests += 1;
    await route.fulfill({ json: {
      catalog: [definition],
      facets: { communities: [], owners: [], counties: [] },
      filters: { report_id: "admission_flow", month: "", community: "", owner: "", county: "", client_scope: "all", care_topic: "primary_diagnosis" },
      report: { definition, columns: [], metrics: [], rows: [], row_count: 0, truncated: false, generated_at: "2026-11-05T16:00:00Z" },
    } });
  });

  await page.goto("/?screen=operations");
  await page.getByRole("button", { name: "Admission flow", exact: true }).click();
  await expect(page).toHaveURL(/screen=operations&report=admission_flow/);
  await expect(page.getByRole("heading", { name: "Admission flow" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Weekly briefing" })).toBeVisible();
  await expect(page.getByLabel("Report", { exact: true })).toHaveCount(0);
  await expect.poll(() => reportRequests).toBe(1);
  await page.getByRole("button", { name: "Weekly briefing" }).click();
  await expect(page).toHaveURL(/\?screen=operations$/);
  await expect(page.getByRole("heading", { name: "Admissions & census" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Admission flow", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Admission flow" })).toBeVisible();
  expect(reportRequests).toBeGreaterThanOrEqual(1);
  expect(await page.getByRole("main", { name: "Reports" }).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("another Reports user cannot open the executive report", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.user.id = "b72c34f0-0ee8-4ab4-8359-81c8f7b0d3b2";
    payload.user.email = "sandeep@aaahealthservices.com";
    payload.user.roles = ["assessment_coordinator"];
    await route.fulfill({ response, json: payload });
  });
  let reportRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/operations/reports") reportRequests += 1;
  });
  await page.goto("/?screen=operations&report=admission_flow");
  await expect(page).toHaveURL(/\?screen=operations$/);
  await expect(page.getByRole("button", { name: "Admission flow", exact: true })).toHaveCount(0);
  expect(reportRequests).toBe(0);
});

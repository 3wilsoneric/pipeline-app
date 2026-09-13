import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { clinicalFixture } from "./support/pipeline-clinical-fixtures";

let clinicalServer: Server;
test.beforeAll(async () => {
  clinicalServer = createServer((request, response) => {
    const payload = request.url?.includes("/residents/") ? clinicalFixture.resident : clinicalFixture.roster;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => clinicalServer.listen(Number(process.env.PIPELINE_E2E_CLINICAL_PORT ?? "3299"), "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve) => clinicalServer.close(() => resolve())); });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/operations/reports**", (route) => route.continue({ headers: { ...route.request().headers(), authorization: "Bearer playwright-clinical-token" } }));
});

test("real reports show resident data, contextual controls, drilldown, client links and complete CSV", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?screen=operations");
  await expect(page.getByLabel("Report", { exact: true })).toHaveValue("clients_by_community");
  await expect(page.getByLabel("Report clients")).toHaveValue("current");
  await expect(page.getByLabel("Report period")).toHaveValue("all");
  await expect(page.getByLabel("Report month")).toHaveCount(0);
  const results = page.getByRole("region", { name: "Report results", exact: true });
  await expect(results.getByRole("columnheader", { name: "Community", exact: true })).toBeVisible();
  await expect(results.getByRole("button", { name: "Show clients: San Pablo" })).toBeVisible();
  await expect(results).not.toContainText("Not recorded");
  await expect(page.getByLabel("Report owner")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("reports-community-desktop.png"), fullPage: true });
  await results.getByRole("button", { name: "Show clients: San Pablo" }).click();
  await expect(results.getByRole("columnheader", { name: "Client", exact: true })).toBeVisible();
  const clientButton = results.getByRole("button", { name: /^Open / }).first();
  await expect(clientButton).toBeVisible();
  await clientButton.click();
  await expect(page).toHaveURL(/screen=profile/);
  await page.goto("/?screen=operations");
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("pipeline-clients_by_community-all-dates.csv");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain('"Client","Community","County","Status","Admission date","Referrals"');
  expect(csv).toContain("San Pablo");
  expect(csv).not.toContain("Not recorded");

  await page.getByLabel("Report period").selectOption("month");
  await expect(page.getByLabel("Report month")).toBeVisible();
  await page.getByLabel("Report month").fill("2026-09");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  let releaseReport!: () => void;
  let reportRequested!: () => void;
  const reportHeld = new Promise<void>((resolve) => { releaseReport = resolve; });
  const requested = new Promise<void>((resolve) => { reportRequested = resolve; });
  await page.route("**/api/operations/reports?report_id=client_care_needs&**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("care_topic") === "primary_diagnosis") {
      reportRequested();
      await reportHeld;
    }
    await route.continue({ headers: { ...route.request().headers(), authorization: "Bearer playwright-clinical-token" } });
  });
  await page.getByLabel("Report", { exact: true }).selectOption("client_care_needs");
  await requested;
  await expect(page.getByLabel("Report care topic")).toBeVisible();
  await expect(page.getByLabel("Report month")).toHaveCount(0);
  await page.getByLabel("Report care topic").selectOption("care_level");
  releaseReport();
  await expect(page.getByLabel("Report care topic")).toHaveValue("care_level");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(results.getByRole("columnheader", { name: "Care level", exact: true })).toBeVisible();
  await expect(results.getByRole("button", { name: /^Show clients:/ }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("reports-care-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.screenshot({ path: testInfo.outputPath("reports-care-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const controls = page.getByRole("region", { name: "Report controls" });
  for (const control of await controls.locator("select, input, button").all()) {
    const box = await control.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 320).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test("sources and chart completeness include existing workspaces without inventing activity", async ({ page }, testInfo) => {
  const created = await page.request.post("/api/referrals", { data: { client_mutation_id: randomUUID(), referral: {
    name: "Sample Report Client", date: "2026-09-10", createdAt: "2026-09-10T12:00:00Z", stage: "New", community: "San Pablo", county: "Contra Costa County", source: "Sample Referral Hospital", priority: "standard", documentName: "", documentStatus: "Missing", owner: "Unassigned", note: "", dob: "1980-04-12", phone: "", email: "", payer: "", requirements: [],
  } } });
  expect(created.status(), await created.text()).toBe(201);
  await page.goto("/?screen=operations");
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  await page.getByLabel("Report", { exact: true }).selectOption("referral_sources");
  const results = page.getByRole("region", { name: "Report results", exact: true });
  await expect(results.getByRole("button", { name: "Show clients: Sample Referral Hospital" })).toBeVisible();
  await results.getByRole("button", { name: "Show clients: Sample Referral Hospital" }).click();
  await expect(results).toContainText("Sample Client");
  await page.getByLabel("Report", { exact: true }).selectOption("chart_completeness");
  await expect(results.getByRole("columnheader", { name: "Chart gaps" })).toBeVisible();
  await expect(results).toContainText("Sample Client");
  await expect(results).toContainText("Primary diagnosis");
  await expect(results).toContainText("Configured");
  await expect(results).toContainText("Face sheet");
  await expect(page.getByLabel("Report period")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("reports-chart-desktop.png"), fullPage: true });
});

test("new filters reject invalid input and incompatible scopes", async ({ request }) => {
  for (const query of ["county=" + "x".repeat(121), "client_scope=bad", "care_topic=bad", "month=2026-13"]) {
    expect((await request.get(`/api/operations/reports?report_id=clients_by_community&${query}`)).status()).toBe(400);
  }
  expect((await request.get("/api/operations/reports?report_id=assessment_completion&month=")).status()).toBe(400);
  expect((await request.get("/api/operations/reports?report_id=chart_completeness&client_scope=current")).status()).toBe(400);
});

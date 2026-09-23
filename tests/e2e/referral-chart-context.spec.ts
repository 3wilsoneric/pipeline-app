import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";
import { unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

// The internal resident number stays out of the chart; see chart-field-editing.
const residentFields = ["Unit", "Admission date", "Length of stay", "Care level"];

test("intake referrer details appear on the chart and seed the assessment", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const created = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Referrer Handoff ${randomUUID()}`,
    source: "County services",
    owner: "Annette Everhart",
    referrerName: "County coordinator",
    phone: "555-0101",
    email: "coordinator@example.org",
  }, { assigneeId: "provisional:allo:annette" });
  await page.goto(`/?view=referrals&screen=packet&referralId=${created.id}&workspaceStage=chart`);
  const header = page.getByTestId("workspace-folder-header");
  await expect(header.getByRole("button", { name: "Move workspace to trash" })).toBeVisible();
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const chart = page.getByRole("article", { name: "Referral chart", exact: true });
  await expect(chart.locator('[data-chart-field="Referrer name"]')).toContainText("County coordinator");
  const assessment = await createOperationalAssessment(page.request, created.id);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.referrer_name).toBe("County coordinator");
  expect(saved.referrer_contact).toBe("555-0101 · coordinator@example.org");
  expect(saved.referring_facility).toBe("County services");
});

test("intake uses its own referral data, while the same connected Client chart keeps resident fields", async ({ page }) => {
  const created = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Avery Intake ${randomUUID()}`, owner: "Annette Everhart", county: "Alameda County", source: "Synthetic referral source",
    phone: "555-0101", email: "intake@example.invalid", responsiblePerson: "Case Manager", currentMedications: "Intake medication notes", conserved: "no",
  }, { assigneeId: "provisional:allo:annette" });
  const before = (await (await page.request.get(`/api/referrals/${created.id}`)).json()).referral;
  const fixture = structuredClone(unifiedProfileFixture);
  const profile = { ...fixture, resident: { ...(fixture.resident as Record<string, unknown>), unit: "Existing unit", length_of_stay_days: 42 },
    pipeline: { ...fixture.pipeline, referrals: [before] } };
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: profile }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${created.id}&workspaceStage=chart`);
  const intake = page.getByRole("article", { name: "Referral chart", exact: true });
  await expect(intake).toBeVisible();
  for (const [label, value] of Object.entries({ Client: "Avery Intake", "Assigned assessor": "Annette Everhart", County: "Alameda County", "Referral source": "Synthetic referral source", Phone: "555-0101", Email: "intake@example.invalid", "Responsible person": "Case Manager", "Medications on record": "Intake medication notes", "Conserved status": "No" })) {
    await expect(intake.locator(`[data-chart-field="${label}"] dd`)).toContainText(value);
  }
  for (const label of residentFields) await expect(intake.locator(`[data-chart-field="${label}"]`)).toHaveCount(0);
  await expect(page.getByText("Recorded stays", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Client files", exact: true })).toBeVisible();

  await page.goto(`/?screen=profile&clientId=pipeline:${before.clientId}`);
  const client = page.getByRole("article", { name: "Client medical chart", exact: true });
  await expect(client).toBeVisible();
  for (const label of residentFields) await expect(client.locator(`[data-chart-field="${label}"]`)).toBeVisible();
  await expect(client.locator('[data-chart-field="Length of stay"]')).toContainText("42 days");
  await expect(client.locator('[data-chart-field="Unit"]')).toContainText("Existing unit");
  const after = (await (await page.request.get(`/api/referrals/${created.id}`)).json()).referral;
  expect(after).toEqual(before);
});

test("imported chart-only workspaces retain the client chart and its actual stay data", async ({ page }) => {
  const created = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const saved = (await (await page.request.get(`/api/referrals/${created.id}`)).json()).referral;
  await page.route(`**/api/referrals/${created.id}`, (route) => route.fulfill({ json: { referral: { ...saved, workspaceOrigin: "allo", workspaceStatus: "historical" } } }));
  await page.route(`**/api/referrals/${created.id}/canvas`, (route) => route.fulfill({ json: { referral: { ...saved, workspaceOrigin: "allo", workspaceStatus: "historical" } } }));
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${created.id}&workspaceStage=chart`);
  const chart = page.getByRole("article", { name: "Client medical chart", exact: true });
  await expect(chart).toBeVisible();
  for (const label of residentFields) await expect(chart.locator(`[data-chart-field="${label}"]`)).toBeVisible();
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toHaveCount(0);
});

test("intake remains readable and editable when the supporting client profile is unavailable", async ({ page }) => {
  const created = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart", phone: "555-0101" }, { assigneeId: "provisional:allo:annette" });
  await page.route("**/api/profiles/**", (route) => route.fulfill({ status: 503, json: { error: "Synthetic supporting profile outage" } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${created.id}&workspaceStage=chart`);
  const intake = page.getByRole("article", { name: "Referral chart", exact: true });
  await expect(intake.locator('[data-chart-field="Phone"]')).toContainText("555-0101");
  await expect(page.getByText("Supporting records could not be loaded. Referral details remain available.", { exact: false })).toBeVisible();
  await intake.getByRole("button", { name: "Edit Phone", exact: true }).click();
  await expect(page.locator('[data-workspace-field="phone"] input')).toBeFocused();
});

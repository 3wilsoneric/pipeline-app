import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

async function openFolder(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Alexandra Montgomery Richardson ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing",
  }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Synthetic prepared diagnosis"] },
  } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  const started = await page.request.post(`/api/assessments/${assessment.assessment_id}/start`, { data: {
    if_match: assessment.version, client_mutation_id: randomUUID(),
  } });
  expect(started.status()).toBe(200);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
  const folder = page.getByTestId("assessment-client-folder");
  await expect(folder).toBeVisible();
  await expect(page.locator('[data-assessment-app-navigation="collapsed"]')).toBeAttached();
  return { referral, assessment, folder };
}

async function editDiagnosis(page: Page, width: number) {
  if (width < 640) {
    await page.getByRole("button", { name: "Client info", exact: true }).click();
    await page.getByRole("button", { name: "Review Secondary diagnosis", exact: true }).click();
  } else {
    if (width < 760) await page.getByRole("button", { name: /^Captured answers/ }).click();
    await page.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
  }
  return page.locator("#assessment-secondary_diagnoses");
}

for (const width of [1440, 1024, 768, 640, 390, 320]) {
  test(`folder keeps identity, navigation and one safe return usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { referral, assessment, folder } = await openFolder(page);
    const header = folder.locator("[data-assessment-folder-header]");
    const back = header.getByRole("button", { name: "Back to referral", exact: true });
    await expect(header.getByRole("heading", { name: referral.name, exact: true })).toBeVisible();
    await expect(back).toBeInViewport();
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await folder.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await folder.evaluate((el) => {
      const workspace = el.closest(".pipeline-surfaces")!;
      return getComputedStyle(el).backgroundImage === "none" && getComputedStyle(el).backgroundColor === getComputedStyle(workspace).backgroundColor;
    })).toBe(true);
    const titleBox = (await header.getByRole("heading").boundingBox())!;
    const backBox = (await back.boundingBox())!;
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(backBox.x);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    expect(backBox.x + backBox.width).toBeLessThanOrEqual(width);
    await expect(folder.getByRole("button", { name: /^(Workspace|Referral|Close assessment)$/ })).toHaveCount(0);
    expect(await page.getByTestId("packet-workspace").evaluate((el) => Boolean(el.closest("[inert]")))).toBe(true);

    if (width >= 640) {
      const pages = header.getByRole("navigation", { name: "Client file pages" });
      await expect(pages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(folder.getByRole("navigation", { name: "Assessment section navigation" }).getByRole("button", { name: "Next section", exact: true })).toBeInViewport();
      await pages.getByRole("button", { name: "Prepare", exact: true }).click();
      await expect(page.getByTestId("preparation-client-folder")).toBeVisible();
      await page.getByRole("button", { name: "Return to assessment", exact: true }).click();
      await expect(folder).toBeVisible();
      await expect(page.locator('[data-assessment-app-navigation="collapsed"]')).toBeAttached();
    } else {
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(82);
      const menu = (await page.getByRole("button", { name: "Show app navigation", exact: true }).boundingBox())!;
      expect(menu.x + menu.width).toBeLessThanOrEqual(titleBox.x);
    }
    await page.screenshot({ path: info.outputPath(`assessment-folder-${width}.png`) });
    const field = await editDiagnosis(page, width);
    await field.fill("Synthetic final answer before returning to referral");
    await back.click();
    await expect(folder).toHaveCount(0);
    await expect(page.locator("#packet-page-1")).toBeVisible();
    expect(await page.getByTestId("packet-workspace").evaluate((el) => Boolean(el.closest("[inert]")))).toBe(false);
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.secondary_diagnoses).toEqual(["Synthetic final answer before returning to referral"]);
  });
}

for (const width of [1440, 390]) {
  test(`return stays in the folder on save failure and safely retries at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { assessment, folder } = await openFolder(page);
    const field = await editDiagnosis(page, width);
    const endpoint = `**/api/assessments/${assessment.assessment_id}`;
    await page.route(endpoint, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } })
      : route.continue());
    await page.route(`**/api/me/assessment-drafts/${assessment.assessment_id}`, (route) => route.fulfill({ status: 503, json: { error: "Synthetic recovery unavailable" } }));
    // Refuse all three persistence paths, not just the canonical PATCH. A confirmed
    // encrypted or server recovery copy normally permits navigation by design.
    await page.evaluate(() => {
      IDBDatabase.prototype.transaction = () => { throw new DOMException("Synthetic storage unavailable", "QuotaExceededError"); };
    });
    await field.fill("Synthetic answer retained after failed save");
    const back = folder.getByRole("button", { name: "Back to referral", exact: true });
    await back.click();
    await expect(folder.getByRole("alert")).toBeVisible();
    await expect(folder).toBeVisible();
    await expect(field).toHaveValue("Synthetic answer retained after failed save");
    await expect(back).toBeEnabled();
    await page.unroute(endpoint);
    await back.click();
    await expect(folder).toHaveCount(0);
    await expect(page.locator("#packet-page-1")).toBeVisible();
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.secondary_diagnoses).toEqual(["Synthetic answer retained after failed save"]);
  });
}

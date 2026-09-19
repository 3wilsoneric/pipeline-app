import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

async function openFolder(page: Page, secondaryDiagnosis = "Synthetic prepared diagnosis") {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Alexandra Montgomery Richardson ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing",
  }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { secondary_diagnoses: [secondaryDiagnosis] },
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
  await expect(page.getByRole("complementary", { name: "App navigation", exact: true })).toBeVisible();
  return { referral, assessment, folder };
}

async function editDiagnosis(page: Page, width: number) {
  if (width < 640) {
    await page.getByRole("button", { name: "Current info", exact: true }).click();
    await page.getByRole("button", { name: "Review Secondary diagnosis", exact: true }).click();
  } else {
    if (width < 760) await page.getByRole("button", { name: /^Current information/ }).click();
    await page.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
  }
  return page.locator("#assessment-secondary_diagnoses");
}

for (const width of [1440, 834, 390]) {
  test(`folder does not resize or toggle full screen between stages at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { assessment } = await openFolder(page);
    const header = page.getByTestId("workspace-folder-header");
    const bounds = (await header.boundingBox())!;
    const navigation = page.locator("[data-assessment-app-navigation]");
    // Catch even a transient expand/collapse, not just the final settled layout.
    await navigation.evaluate((el) => {
      el.setAttribute("data-layout-transitions", "");
      new MutationObserver((records) => {
        el.setAttribute("data-layout-transitions", el.getAttribute("data-layout-transitions") + records.map((record) => record.oldValue).join(","));
      }).observe(el, { attributes: true, attributeFilter: ["data-assessment-app-navigation"], attributeOldValue: true });
    });
    const answer = "Synthetic answer saved before opening Decision";
    await (await editDiagnosis(page, width)).fill(answer);
    const pages = header.getByRole("navigation", { name: "Workspace stages" });
    for (const label of ["Decision", "Chart", "Assessment", "Chart", "Decision", "Chart", "Assessment"]) {
      await pages.getByRole("button", { name: new RegExp(`${label}$`) }).click();
      await expect(pages.getByRole("button", { name: new RegExp(`${label}$`) })).toHaveAttribute("aria-current", "page");
      if (label === "Decision") {
        await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
        await expect(page.getByTestId("workspace-chart-folder")).toBeVisible();
      }
      if (label === "Chart") await expect(page.getByRole("region", { name: "Assessment chart review", exact: true })).toBeVisible();
      if (label === "Assessment") await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
      await expect(navigation).toHaveAttribute("data-assessment-app-navigation", "standard");
      await expect(navigation).toHaveAttribute("data-layout-transitions", "");
      const current = (await header.boundingBox())!;
      for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(current[key] - bounds[key])).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (label === "Decision") await page.screenshot({ path: info.outputPath(`stable-decision-${width}.png`) });
    }
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.secondary_diagnoses).toEqual([answer]);
    await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Collapse navigation", exact: true })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Collapse navigation", exact: true }).press("Escape");
    await expect(page.getByRole("button", { name: "Expand navigation", exact: true })).toHaveAttribute("aria-expanded", "false");
    await header.getByRole("button", { name: "Workspaces", exact: true }).click();
    await expect(page.getByTestId("packet-workspace")).toHaveCount(0);
    await expect(navigation).toHaveAttribute("data-assessment-app-navigation", "standard");
  });
}

for (const width of [1440, 1024, 768, 640]) {
  test(`assessment uses one page scroll and keeps navigation reachable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const longNote = Array.from({ length: 6 }, (_, index) => `Synthetic source note ${index + 1}: the client describes their recent care, current support, and questions to discuss during the interview. Keep the full source wording available while completing the chart.`).join("\n\n");
    const { folder } = await openFolder(page, longNote);
    const canvas = page.locator('[data-guide-target="packet-workspace"]');
    const header = page.getByTestId("workspace-folder-header");
    const footer = folder.locator('footer[aria-label="Assessment actions"]');
    const questionPage = folder.locator("[data-assessment-question-page]");
    const reference = folder.getByRole("complementary", { name: "Current information" });
    if (width < 760) await reference.getByRole("button", { name: /^Current information/ }).click();
    const recorded = reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true });
    await expect(recorded).toContainText(longNote);
    expect(await recorded.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await expect.poll(() => canvas.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(300);
    await expect(footer).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`page-top-${width}.png`) });

    const left = (await reference.boundingBox())!;
    await page.mouse.move(left.x + left.width / 2, left.y + 90);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => canvas.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    if (width < 760) await reference.getByRole("button", { name: /^Current information/ }).click();
    const afterLeft = await canvas.evaluate((el) => el.scrollTop);
    const right = (await questionPage.boundingBox())!;
    await page.mouse.move(right.x + right.width / 2, Math.max(220, right.y + 40));
    await page.mouse.wheel(0, 350);
    await expect.poll(() => canvas.evaluate((el) => el.scrollTop)).toBeGreaterThan(afterLeft + 100);
    expect(await questionPage.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await folder.locator("[data-assessment-reference-page]").evaluate((el) => el.scrollTop)).toBe(0);
    await expect(header).toBeInViewport();
    await expect(footer).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`page-scrolled-${width}.png`) });

    await footer.getByRole("button", { name: "Next section", exact: true }).click();
    await expect(page).not.toHaveURL(/assessmentSection=diagnosis_clinical/);
    await expect.poll(() => canvas.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(questionPage.locator("[data-working-field]").first()).toBeInViewport();
    expect(await folder.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

for (const width of [1440, 1024, 768, 640, 390, 320]) {
  test(`folder keeps identity, navigation and one safe return usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { referral, assessment, folder } = await openFolder(page);
    const header = page.getByTestId("workspace-folder-header");
    const back = header.getByRole("button", { name: "Workspaces", exact: true });
    await expect(header.getByRole("heading", { name: referral.name, exact: true })).toBeVisible();
    await expect(back).toBeInViewport();
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await folder.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(folder).toHaveCSS("background-image", "none");
    const titleBox = (await header.getByRole("heading").boundingBox())!;
    const backBox = (await back.boundingBox())!;
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(backBox.x);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    expect(backBox.x + backBox.width).toBeLessThanOrEqual(width);
    await expect(folder.getByRole("button", { name: /^(Workspace|Referral|Close assessment)$/ })).toHaveCount(0);
    expect(await page.getByTestId("packet-workspace").evaluate((el) => Boolean(el.closest("[inert]")))).toBe(false);
    await expect(page.getByRole("navigation", { name: "Client file pages" })).toHaveCount(0);
    await expect(page.getByTestId("workspace-identity-title")).toHaveCount(1);
    const pages = header.getByRole("navigation", { name: "Workspace stages" });
    await expect(pages.getByRole("button")).toHaveText(["01Chart", "02Assessment", "03Decision"]);
    await expect(pages.getByRole("button", { name: /Assessment$/ })).toHaveAttribute("aria-current", "page");
    if (width < 640) {
      await folder.getByRole("navigation", { name: "Question steps" }).getByRole("button", { name: "Next", exact: true }).click();
      await expect(folder.getByRole("textbox", { name: "Current symptoms", exact: true })).toBeVisible();
    }
    await header.evaluate((el) => el.setAttribute("data-continuity-check", "same-folder"));
    await pages.getByRole("button", { name: /Chart$/ }).click();
    await expect(page.getByRole("region", { name: "Assessment chart review", exact: true })).toBeVisible();
    await expect(pages.getByRole("button", { name: /Chart$/ })).toHaveAttribute("aria-current", "page");
    await pages.getByRole("button", { name: /Assessment$/ }).click();
    await expect(header).toHaveAttribute("data-continuity-check", "same-folder");
    if (width < 640) await expect(folder.getByRole("textbox", { name: "Current symptoms", exact: true })).toBeVisible();

    if (width >= 640) {
      await expect(folder.locator('footer[aria-label="Assessment actions"]').getByRole("button", { name: "Next section", exact: true })).toBeInViewport();
    } else {
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(110);
      const menu = (await page.locator("#pipeline-app-navigation").boundingBox())!;
      expect(menu.x + menu.width).toBeLessThanOrEqual(titleBox.x);
    }
    await page.screenshot({ path: info.outputPath(`assessment-folder-${width}.png`) });
    const field = await editDiagnosis(page, width);
    await field.fill("Synthetic final answer before returning to referral");
    await back.click();
    await expect(folder).toHaveCount(0);
    await expect(page.getByTestId("packet-workspace")).toHaveCount(0);
    await expect(page).not.toHaveURL(/screen=packet/);
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
    const back = page.getByTestId("workspace-folder-header").getByRole("button", { name: "Workspaces", exact: true });
    await back.click();
    await expect(folder.getByRole("alert")).toBeVisible();
    await expect(folder).toBeVisible();
    await expect(field).toHaveValue("Synthetic answer retained after failed save");
    await expect(back).toBeEnabled();
    await page.unroute(endpoint);
    await back.click();
    await expect(folder).toHaveCount(0);
    await expect(page).not.toHaveURL(/screen=packet/);
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.secondary_diagnoses).toEqual(["Synthetic answer retained after failed save"]);
  });
}

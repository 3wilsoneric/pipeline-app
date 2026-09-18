import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createOperationalReferral } from "./support/operational-api";

const practice = "/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=diagnosis_clinical&demo=1";
const surface = (page: Page) => page.getByRole("dialog", { name: "Assessment interview", exact: true });

test.describe("mobile assessment", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

  test("phone app navigation shows destinations without guessing icons or horizontal scrolling", async ({ page }, info) => {
    await page.goto("/");
    const header = page.locator("[data-pipeline-header]");
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const label of ["Workspaces", "Calendar", "Clients", "Reports", "New"]) await expect(header.getByText(label, { exact: true })).toBeVisible();
      for (const control of await header.locator('[data-testid="primary-navigation"] button').all()) {
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await header.getByRole("button", { name: "Open referrals", exact: true }).tap();
    await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("phone-workspaces.png") });
    await header.getByRole("button", { name: /^Open profile menu for/ }).tap();
    await expect(page.getByRole("dialog", { name: "Profile settings", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath("phone-navigation.png") });
  });

  test("phone and tablet controls are readable, reachable and do not overflow", async ({ page }, info) => {
    await page.goto(practice);
    const assessment = surface(page);
    await expect(assessment).toBeVisible();
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await expect(assessment.getByRole("button", { name: "Close assessment" })).toBeInViewport();
      await expect(assessment.getByRole("button", { name: "Sign assessment", exact: true })).toBeInViewport();
      expect(await assessment.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const control of [page.getByRole("button", { name: "Show app navigation" }), assessment.getByRole("button", { name: "Close assessment" }), assessment.getByLabel("Assessment section", { exact: true }), assessment.locator('summary[aria-label="Find assessment question"]'), assessment.getByRole("button", { name: /^Captured answers/ })]) {
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      const field = assessment.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
      await expect(field).toHaveCSS("font-size", "16px");
      await page.screenshot({ path: info.outputPath(`assessment-${size.width}x${size.height}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const reference = assessment.getByRole("complementary", { name: "Captured assessment answers" });
    await reference.getByRole("button", { name: /^Captured answers/ }).tap();
    await reference.getByRole("button", { name: "Edit Current symptoms", exact: true }).tap();
    await expect(reference.getByRole("button", { name: /^Captured answers/ })).toHaveAttribute("aria-expanded", "false");
    const answer = assessment.getByRole("textbox", { name: "Current symptoms", exact: false });
    await expect(answer).toBeFocused();
    await expect(answer).toBeInViewport();
    await assessment.getByLabel("Assessment section", { exact: true }).selectOption("medication");
    await reference.getByRole("button", { name: /^Captured answers/ }).tap();
    await reference.getByRole("button", { name: "Edit IM injections", exact: true }).tap();
    const choice = assessment.getByRole("group", { name: "IM injections", exact: true });
    for (const button of await choice.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await choice.getByRole("button", { name: "Yes", exact: true }).tap();
    await expect(assessment.getByRole("textbox", { name: /Injection details/ })).toBeVisible();
    const next = assessment.getByRole("button", { name: "Next section", exact: true });
    await next.scrollIntoViewIfNeeded();
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.addScriptTag({ content: readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
      const result = await axe.run('[data-assessment-view="chart"]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
      return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")).map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target) }));
    });
    expect(violations).toEqual([]);
  });

  test("visual viewport contraction keeps editing above the keyboard without disabling zoom", async ({ page }) => {
    await page.goto(practice);
    const field = surface(page).getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await field.fill("Synthetic answer stays mounted across keyboard and orientation changes.");
    // Simulate browser viewport events, not a physical OS keyboard.
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperties(viewport, { height: { configurable: true, value: 430 }, offsetTop: { configurable: true, value: 12 } });
      viewport.dispatchEvent(new Event("resize"));
    });
    const shell = page.locator(".pipeline-surfaces");
    await expect(shell).toHaveCSS("height", "430px");
    await expect(shell).toHaveCSS("top", "12px");
    await expect(field).toBeFocused();
    const box = (await field.boundingBox())!;
    const navigation = (await surface(page).getByRole("navigation", { name: "Assessment sections" }).boundingBox())!;
    const footer = (await surface(page).locator('footer[aria-label="Assessment actions"]').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(navigation.y + navigation.height);
    expect(box.y + box.height).toBeLessThanOrEqual(footer.y + 1);
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperties(viewport, { height: { configurable: true, value: 215 }, scale: { configurable: true, value: 2 } });
      viewport.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(80);
    await expect(shell).toHaveCSS("height", "430px");
    expect(await page.locator('meta[name="viewport"]').getAttribute("content")).not.toMatch(/user-scalable=no|maximum-scale=1/);
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      for (const key of ["height", "scale", "offsetTop"]) Reflect.deleteProperty(viewport, key);
      viewport.dispatchEvent(new Event("resize"));
    });
    await expect(shell).toHaveCSS("height", "844px");
    await expect(field).toHaveValue("Synthetic answer stays mounted across keyboard and orientation changes.");
    // A landscape tablet is wider than the compact layout breakpoint but still
    // needs visual-viewport sizing when using its on-screen keyboard.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 450 });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(shell).toHaveCSS("height", "450px");
    await expect(field).toHaveValue("Synthetic answer stays mounted across keyboard and orientation changes.");
  });

  test("real mobile edits save on leaving a field, survive reload and do not duplicate the assessment", async ({ page }) => {
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Mobile ${randomUUID().replaceAll(/[^a-z]/g, "")}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing" }, { assigneeId: "provisional:allo:annette" });
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    const started = await page.request.post(`/api/assessments/${assessment.assessment_id}/start`, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } });
    expect(started.status()).toBe(200);
    const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
    const field = surface(page).getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    const answer = "Synthetic mobile assessment note";
    await field.fill(answer);
    await page.waitForTimeout(1200);
    expect((await read()).secondary_diagnoses ?? []).toEqual([]);
    await surface(page).getByRole("heading", { name: "To finish", exact: true }).tap();
    await expect.poll(async () => (await read()).secondary_diagnoses).toEqual([answer]);
    await surface(page).getByLabel("Assessment section", { exact: true }).selectOption("medication");
    await expect.poll(async () => (await read()).secondary_diagnoses).toEqual([answer]);
    await page.reload();
    const reference = surface(page).getByRole("complementary", { name: "Captured assessment answers" });
    await reference.getByRole("button", { name: /^Captured answers/ }).tap();
    await reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).tap();
    await expect(field).toHaveValue(answer);
    await expect(field).toBeFocused();
    const list = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
    expect(list.assessments).toHaveLength(1);
    expect(list.assessments[0].assessment_id).toBe(assessment.assessment_id);
    expect(list.assessments[0].signed_at).toBeNull();
  });

  test("appointment entry also fits the visible viewport when its keyboard opens", async ({ page }) => {
    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=schedule");
    const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
    await schedule.getByLabel("Assessment method").selectOption("phone");
    const phone = schedule.getByLabel("Phone number to call");
    await phone.fill("555-0101");
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperty(viewport, "height", { configurable: true, value: 500 });
      viewport.dispatchEvent(new Event("resize"));
    });
    await expect(schedule).toHaveCSS("height", "500px");
    const box = (await phone.boundingBox())!;
    const footer = (await schedule.locator("footer").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(footer.y + 1);
    expect(box.y).toBeGreaterThanOrEqual((await schedule.locator("header").boundingBox())!.height);
    expect(footer.y + footer.height).toBeLessThanOrEqual(500);
    await expect(phone).toHaveValue("555-0101");
    await schedule.getByRole("button", { name: "Close schedule", exact: true }).tap();
    await expect(schedule).toHaveCount(0);
  });
});

test("WebKit touch editing can find, edit and return to the same answer", async ({ baseURL }, info) => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(practice);
    const assessment = surface(page);
    await expect(assessment).toBeVisible();
    await assessment.locator('summary[aria-label="Find assessment question"]').tap();
    await assessment.getByRole("searchbox", { name: "Find assessment question" }).fill("medication refused");
    await assessment.locator('[aria-label="Matching assessment questions"]').getByRole("button", { name: /^Medication refused/ }).tap();
    const field = assessment.getByRole("textbox", { name: /Medication refused/ });
    await expect(field).toBeFocused();
    await field.fill("Synthetic medication A");
    await field.blur();
    await expect(assessment.getByText("Practice changes saved locally", { exact: true })).toBeVisible();
    await assessment.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
    await assessment.getByLabel("Assessment section", { exact: true }).selectOption("medication");
    await assessment.getByRole("button", { name: /^Captured answers/ }).tap();
    await assessment.getByRole("button", { name: "Edit Medication refused", exact: true }).tap();
    await expect(field).toHaveValue("Synthetic medication A");
    await page.screenshot({ path: info.outputPath("assessment-webkit-phone.png") });
    await context.close();
  } finally {
    await browser.close();
  }
});

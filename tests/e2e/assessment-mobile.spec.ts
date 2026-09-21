import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createOperationalReferral } from "./support/operational-api";

const practice = "/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=diagnosis_clinical&demo=1";
const surface = (page: Page) => page.locator("[data-assessment-view]");

test.describe("mobile assessment", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

  test("phone app navigation shows destinations without guessing icons or horizontal scrolling", async ({ page }, info) => {
    await page.goto("/");
    const header = page.locator("[data-pipeline-header]");
    const menu = page.getByRole("dialog", { name: "Pipeline pages", exact: true });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await header.getByRole("button", { name: /^Open page menu/ }).tap();
      for (const [name, label] of [["Open referrals", "Workspaces"], ["Open calendar", "Calendar"], ["Open client profiles", "Clients"], ["Open reports", "Reports"], ["Create new referral", "New"]]) {
        await expect(menu.getByRole("button", { name, exact: true }).getByText(label, { exact: true })).toBeVisible();
      }
      for (const control of await header.locator('[data-testid="primary-navigation"] button').all()) {
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await header.getByRole("button", { name: "Close page menu", exact: true }).tap();
    }
    await header.getByRole("button", { name: /^Open page menu/ }).tap();
    await header.getByRole("button", { name: "Open referrals", exact: true }).tap();
    await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("phone-workspaces.png") });
    await header.getByRole("button", { name: /^Open page menu/ }).tap();
    await header.getByRole("button", { name: /^Open profile menu for/ }).tap();
    await expect(page.getByRole("dialog", { name: "Profile settings", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath("phone-navigation.png") });
  });

  test("phone and tablet controls are readable, reachable and do not overflow", async ({ page }, info) => {
    await page.goto(practice);
    const assessment = surface(page);
    await expect(assessment).toBeVisible();
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1194, height: 834 }]) {
      await page.setViewportSize(size);
      const phone = size.width < 640 || size.height < 500 && size.width < 960;
      const back = page.getByRole("button", { name: phone ? "Back to previous page" : "Pipeline home", exact: true });
      await expect(back).toBeInViewport();
      if (phone) {
        await expect(assessment.getByRole("button", { name: "Sign assessment", exact: true })).toBeHidden();
        await expect(assessment.getByRole("navigation", { name: "Question steps" }).getByRole("button", { name: /^Next/ })).toBeInViewport();
      } else await expect(assessment.getByRole("button", { name: "Next section", exact: true })).toBeInViewport();
      expect(await assessment.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const controls = [page.getByRole("button", { name: phone ? /^Open page menu/ : "Expand navigation" }), back, ...(phone ? [assessment.getByRole("button", { name: "Choose questionnaire section" }), assessment.getByRole("button", { name: "Client info" })] : [assessment.getByLabel("Assessment section", { exact: true })])];
      if (!phone && size.width < 760) controls.push(assessment.getByRole("button", { name: /^Current information/ }));
      for (const control of controls) {
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      const field = assessment.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
      await expect(field).toHaveCSS("font-size", phone ? "16px" : "17px");
      if (size.width >= 760 && !phone) {
        const reference = assessment.getByRole("complementary", { name: "Current information" });
        await expect(reference).toBeVisible();
        expect((await reference.boundingBox())!.x).toBeLessThan((await field.boundingBox())!.x);
      }
      await page.screenshot({ path: info.outputPath(`assessment-${size.width}x${size.height}.png`) });
    }
    await page.setViewportSize({ width: 768, height: 844 });
    await page.getByRole("button", { name: "Expand navigation" }).tap();
    await expect(page.getByRole("button", { name: "Open referrals", exact: true })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Expand navigation" })).toHaveAttribute("aria-expanded", "false");
    const reference = assessment.getByRole("complementary", { name: "Current information" });
    await reference.getByRole("button", { name: "Edit Current symptoms", exact: true }).tap();
    await expect(reference.getByRole("button", { name: "Edit Current symptoms", exact: true })).toBeVisible();
    const answer = assessment.getByRole("textbox", { name: "Current symptoms", exact: false });
    await expect(answer).toBeFocused();
    await expect(answer).toBeInViewport();
    await assessment.getByLabel("Assessment section", { exact: true }).selectOption("medication");
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
      const result = await axe.run('[data-assessment-view]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
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
    const navigation = (await surface(page).getByRole("navigation", { name: "Question navigation" }).boundingBox())!;
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
    await surface(page).getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).tap();
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
    await findPhoneQuestion(page, "Secondary diagnosis");
    const field = surface(page).getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    const answer = "Synthetic mobile assessment note";
    await field.fill(answer);
    await page.waitForTimeout(1200);
    expect((await read()).secondary_diagnoses ?? []).toEqual([]);
    await surface(page).getByRole("button", { name: "Next", exact: true }).tap();
    await expect.poll(async () => (await read()).secondary_diagnoses).toEqual([answer]);
    await findPhoneQuestion(page, "IM injections");
    await expect.poll(async () => (await read()).secondary_diagnoses).toEqual([answer]);
    await page.reload();
    await surface(page).getByRole("button", { name: "Client info", exact: true }).tap();
    await page.getByRole("dialog", { name: "Client information", exact: true }).getByLabel("Reference information").selectOption("all");
    await page.getByRole("dialog", { name: "Client information", exact: true }).getByRole("button", { name: "Review Secondary diagnosis", exact: true }).tap();
    await expect(field).toHaveValue(answer);
    await expect(field).toBeInViewport();
    const list = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
    expect(list.assessments).toHaveLength(1);
    expect(list.assessments[0].assessment_id).toBe(assessment.assessment_id);
    expect(list.assessments[0].signed_at).toBeNull();
  });

  test("appointment entry also fits the visible viewport when its keyboard opens", async ({ page }) => {
    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=schedule");
    const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
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

test("WebKit iPad keeps the reading pane open while editing and rotating", async ({ baseURL }, info) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true });
    await page.goto(practice);
    const assessment = surface(page);
    const reference = assessment.getByRole("complementary", { name: "Current information" });
    const editor = assessment.locator("[data-assessment-question-editor]");
    await reference.getByRole("button", { name: "Edit Current symptoms", exact: true }).tap();
    const field = editor.getByRole("textbox", { name: "Current symptoms", exact: true });
    await expect(field).toBeFocused();
    await field.fill("Synthetic tablet note, retained when rotating.");
    await field.blur();
    await expect(reference).toContainText("Synthetic tablet note, retained when rotating.");
    for (const size of [{ width: 768, height: 1024 }, { width: 1194, height: 834 }]) {
      await page.setViewportSize(size);
      await expect(reference.getByRole("button", { name: "Edit Current symptoms", exact: true })).toBeInViewport();
      const left = (await reference.boundingBox())!;
      const right = (await editor.boundingBox())!;
      expect(left.x + left.width).toBeLessThan(right.x);
      expect(await reference.evaluate((element) => element.scrollTop)).toBe(0);
      expect(await editor.evaluate((element) => element.scrollTop)).toBe(0);
      await expect(field).toHaveValue("Synthetic tablet note, retained when rotating.");
      await expect(field).toHaveCSS("font-size", "17px");
      expect(await assessment.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`reading-webkit-${size.width}.png`) });
    }
  } finally {
    await browser.close();
  }
});

test("WebKit touch editing can find, edit and return to the same answer", async ({ baseURL }, info) => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(practice);
    const assessment = surface(page);
    await expect(assessment).toBeVisible();
    await findPhoneQuestion(page, "Medication refused");
    const field = assessment.getByRole("textbox", { name: /Medication refused/ });
    await expect(field).toBeInViewport();
    await field.fill("Synthetic medication A");
    await field.blur();
    await expect(assessment.getByText("Practice changes saved locally", { exact: true })).toBeVisible();
    await findPhoneQuestion(page, "Secondary diagnosis");
    await assessment.getByRole("button", { name: "Client info", exact: true }).tap();
    await page.getByRole("dialog", { name: "Client information", exact: true }).getByLabel("Reference information").selectOption("all");
    await page.getByRole("dialog", { name: "Client information", exact: true }).getByRole("button", { name: "Review Medication refused", exact: true }).tap();
    await expect(field).toHaveValue("Synthetic medication A");
    await page.screenshot({ path: info.outputPath("assessment-webkit-phone.png") });
    await context.close();
  } finally {
    await browser.close();
  }
});

async function findPhoneQuestion(page: Page, label: string) {
  await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).tap();
  const sheet = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
  await sheet.getByRole("searchbox", { name: "Find a question", exact: true }).fill(label);
  await sheet.getByRole("button", { name: new RegExp(`^${label}`) }).tap();
}

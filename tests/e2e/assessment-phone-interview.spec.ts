import { expect, test, chromium, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

test.use({ hasTouch: true });

for (const [engine, browserType] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  test(`${engine} phone questionnaire uses real answers, conditional steps and safe swipe navigation`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      const page = await context.newPage();
      const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Pocket ${randomUUID().replace(/[^a-z]/g, "")}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing" }, { assigneeId: "provisional:allo:annette" });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
      await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label: "Assessment" });
      const pocket = page.locator("[data-phone-interview]");
      await expect(pocket).toBeVisible();
      await expect(pocket.locator("[data-working-field]")).toHaveCount(1);
      await expect(page.locator("[data-phone-header]")).toBeInViewport();
      await expect(page.getByRole("button", { name: "Back to previous page", exact: true })).toBeInViewport();
      await expect(page.getByTestId("preparation-client-folder")).toHaveCount(0);
      expect(await pocket.evaluate((el) => Boolean(el.closest("[inert]")))).toBe(false);

      await findQuestion(page, "Ambulatory");
      const ambulatory = pocket.getByRole("group", { name: "Ambulatory", exact: true });
      for (const button of await ambulatory.getByRole("button").all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
        await expect(button).toHaveCSS("font-size", "16px");
      }
      await ambulatory.getByRole("button", { name: "No", exact: true }).tap();
      // Choosing an answer never advances the screen or silently answers its follow-up.
      await expect(ambulatory).toBeVisible();
      await pocket.getByRole("button", { name: "Next", exact: true }).tap();
      const device = pocket.getByPlaceholder("Type of device", { exact: true });
      await expect(device).toHaveValue("");
      await device.fill("Synthetic walker");
      const current = await pocket.locator("[data-working-field]").getAttribute("data-working-field");
      await swipe(page, "input", -140);
      await expect(pocket.locator("[data-working-field]")).toHaveAttribute("data-working-field", current!);
      await swipe(page, "background", -140, 180);
      await expect(pocket.locator("[data-working-field]")).toHaveAttribute("data-working-field", current!);
      await swipe(page, "background", -140);
      await expect(pocket.locator("[data-working-field]")).not.toHaveAttribute("data-working-field", current!);

      const read = async () => (await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
      await expect.poll(async () => (await read())[0]?.mobility).toBe("Synthetic walker");
      await pocket.getByRole("button", { name: "Previous question", exact: true }).tap();
      await expect(device).toHaveValue("Synthetic walker");
      await pocket.getByRole("button", { name: "Previous question", exact: true }).tap();
      await ambulatory.getByRole("button", { name: "Yes", exact: true }).tap();
      await pocket.getByRole("button", { name: "Next", exact: true }).tap();
      await expect(device).toHaveCount(0);

      await findQuestion(page, "Secondary diagnosis");
      const diagnosis = pocket.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
      await diagnosis.fill("Synthetic phone note");
      await page.context().setOffline(true);
      await pocket.getByRole("button", { name: "Next", exact: true }).tap();
      await expect(page.locator('[data-guide-target="assessment-save-status"]')).toContainText(/offline|device|queued/i);
      await page.context().setOffline(false);
      await expect.poll(async () => (await read())[0]?.secondary_diagnoses, { timeout: 15_000 }).toEqual(["Synthetic phone note"]);
      await page.reload();
      await expect(pocket).toBeVisible();
      await pocket.getByRole("button", { name: "Client info", exact: true }).tap();
      const reference = page.getByRole("dialog", { name: "Client information", exact: true });
      await reference.getByLabel("Reference information").selectOption("all");
      await expect(reference.getByText("Synthetic phone note", { exact: true })).toBeVisible();
      await reference.getByRole("button", { name: "Review Secondary diagnosis", exact: true }).tap();
      await expect(diagnosis).toHaveValue("Synthetic phone note");

      await diagnosis.fill("Synthetic rotation edit");
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(page.getByRole("complementary", { name: "Current information", exact: true })).toBeVisible();
      await expect.poll(async () => (await read())[0]?.secondary_diagnoses).toEqual(["Synthetic rotation edit"]);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(diagnosis).toHaveValue("Synthetic rotation edit");

      // Both sheets are dismissible without leaving the questionnaire.
      await pocket.getByRole("button", { name: "Client info", exact: true }).tap();
      await page.keyboard.press("Escape");
      await expect(reference).not.toBeVisible();
      await expect(pocket).toBeVisible();
      await expect(pocket.getByRole("button", { name: "Client info", exact: true })).toBeFocused();
      await page.screenshot({ path: info.outputPath(`phone-${engine}.png`) });
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
        const result = await axe.run('[data-assessment-view]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
        return result.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }));
      });
      expect(violations).toEqual([]);
      // The shared stage picker returns to this referral's chart without starting or signing.
      await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label: "Chart" });
      await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
      expect(await page.getByTestId("packet-workspace").evaluate((el) => Boolean(el.closest("[inert]")))).toBe(false);
      const assessments = await read();
      expect(assessments).toHaveLength(1);
      expect(assessments[0].signed_at).toBeNull();
      expect(assessments[0].started_at).toBeNull();

      await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label: "Assessment" });
      await page.locator('summary[aria-label="Assessment details"]').tap();
      await page.getByRole("button", { name: "Begin assessment", exact: true }).tap();
      const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
      await expect(begin).toBeInViewport();
      await begin.getByRole("button", { name: "Record start", exact: true }).tap();
      await expect(begin).toHaveCount(0);
      await expect(pocket).toBeVisible();
      await expect.poll(async () => Boolean((await read())[0]?.started_at)).toBe(true);
      await findQuestion(page, "Secondary diagnosis");
      await expect(diagnosis).toHaveValue("Synthetic rotation edit");
      expect((await read())[0].assessment_id).toBe(assessments[0].assessment_id);
    } finally { await context.close(); await browser.close(); }
  });
}

test("phone questions preserve source verification rather than counting suggestions as confirmed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic source review", owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing" }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  expect(created.status()).toBe(201);
  await page.route(`**/api/referrals/${referral.id}/assessments`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.assessments[0].secondary_diagnoses = ["Synthetic extracted diagnosis"];
    payload.assessments[0].field_provenance.secondary_diagnoses = [{ source_field_key: "secondary_diagnoses", source_file: "Synthetic referral.pdf", confidence: 0.8, review_status: "pending", source_page_no: 2, evidence_url: null }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
  await findQuestion(page, "Secondary diagnosis");
  const field = page.locator('[data-phone-interview] [data-working-field="secondary_diagnoses"]');
  await expect(field).toContainText("Synthetic referral.pdf");
  for (const label of ["Use", "Reject"]) {
    const control = field.getByRole("button", { name: label, exact: true });
    await expect(control).toBeVisible();
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Client info", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Review Secondary diagnosis", exact: true })).toContainText("Needs verification");
  await page.unrouteAll({ behavior: "wait" });
});

async function findQuestion(page: Page, label: string) {
  await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).tap();
  const sheet = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
  await sheet.getByRole("searchbox", { name: "Find a question", exact: true }).fill(label);
  await sheet.getByRole("button", { name: new RegExp(`^${label}`) }).tap();
}

async function swipe(page: Page, target: "input" | "background", dx: number, dy = 0) {
  await page.locator(target === "input" ? '[data-phone-question-scroll] input' : "[data-phone-question-scroll]").evaluate((element, { dx, dy }) => {
    // WebKit's desktop test runtime does not expose a constructible Touch.
    // These synthetic events exercise gesture guards; physical-device swipes remain a separate check.
    const event = (type: string, x: number, y: number) => {
      const touch = { identifier: 1, target: element, clientX: x, clientY: y };
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { touches: { value: type === "touchstart" ? [touch] : [] }, changedTouches: { value: [touch] } });
      element.dispatchEvent(event);
    };
    event("touchstart", 250, 300);
    event("touchend", 250 + dx, 300 + dy);
  }, { dx, dy });
}

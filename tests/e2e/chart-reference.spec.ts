import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";
import { createOperationalReferral, startOperationalAssessment } from "./support/operational-api";
import { waitForAssessmentReady } from "./support/assessment-navigation";

async function setup(page: Page, mode: "prepare" | "interview" = "prepare") {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Reference ${randomUUID().slice(0, 8)}`, owner: "", community: "San Pablo" });
  const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { current_symptoms: "Synthetic reference answer", secondary_diagnoses: ["Synthetic prepared diagnosis"] } } });
  expect(response.status()).toBe(201);
  const { assessment } = await response.json();
  if (mode === "interview") await startOperationalAssessment(page.request, assessment);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=${mode}&assessmentSection=diagnosis_clinical`;
  await page.goto(url);
  const trigger = page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Chart", exact: true });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-keyshortcuts", "Alt+C");
  const openReference = async () => { await trigger.focus(); await page.keyboard.press("Alt+c"); };
  return { referral, assessment, url, trigger, openReference, panel: page.getByRole("complementary", { name: "Chart reference", exact: true }) };
}

for (const width of [1440, 834]) test(`Chart reference stays usable with the assessment at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  const { referral, assessment, trigger, openReference, panel } = await setup(page);
  const before = await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json();
  await openReference();
  await expect(panel).toContainText(referral.name!);
  await expect(panel.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  expect(await panel.evaluate(element => [...element.querySelectorAll("[id]")].filter(node => document.querySelectorAll(`[id="${node.id}"]`).length !== 1).map(node => node.id))).toEqual([]);
  await expect(page.locator('dialog[open], [aria-modal="true"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Workspace stages" })).not.toHaveAttribute("inert");
  await panel.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(950);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  await page.evaluate(() => document.fonts.ready);
  await panel.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const violations = await panel.evaluate(async element => (await (window as unknown as { axe: { run: (element: Element, options: object) => Promise<AxeResults> } }).axe.run(element, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations);
  expect(violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`reference-${width}.png`), animations: "disabled" });
  await panel.getByRole("button", { name: "Close Chart reference", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect((await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.version).toBe(before.assessment.version);
  await page.keyboard.press("Alt+c");
  await expect(panel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const width of [390, 320]) test(`phone preparation references Chart through the stage picker at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Phone Chart ${randomUUID().slice(0, 8)}`, owner: "", community: "San Pablo" });
  const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { current_symptoms: "Synthetic prepared answer" } } });
  expect(response.status()).toBe(201);
  const { assessment } = await response.json();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=prepare&assessmentSection=diagnosis_clinical`);
  const answer = page.getByRole("textbox", { name: "Current symptoms", exact: true });
  await expect(answer).toHaveValue("Synthetic prepared answer");
  await expect(page.getByRole("button", { name: "Open Chart reference", exact: true })).toHaveCount(0);
  const picker = page.getByRole("combobox", { name: "Workspace view", exact: true });
  await picker.selectOption({ label: "Chart" });
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toContainText(referral.name!);
  await picker.selectOption({ label: "Assessment" });
  await expect(answer).toHaveValue("Synthetic prepared answer");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.current_symptoms).toBe("Synthetic prepared answer");
  expect(saved.version).toBe(assessment.version);
});

test("holding Chart lifts a chart, dropping opens a reference without navigating or losing an answer", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { panel, assessment } = await setup(page);
  const chart = page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Chart", exact: true });
  const url = Object.fromEntries(new URL(page.url()).searchParams);
  const rect = (await chart.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await expect(chart).toHaveAttribute("data-chart-lifted", "true");
  await page.mouse.move(900, 220, { steps: 8 });
  await page.screenshot({ path: info.outputPath("chart-lift.png") });
  await page.mouse.up();
  await expect(panel).toBeVisible();
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(url);
  const field = page.getByRole("textbox", { name: "Current symptoms", exact: true });
  await field.fill("Synthetic updated while the Chart is open");
  await field.press("Tab");
  await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_symptoms).toBe("Synthetic updated while the Chart is open");
  await panel.getByText("Assessment", { exact: true }).click();
  await expect(panel).toContainText("Synthetic updated while the Chart is open");
  // Move by pointer and keyboard without changing the assessment or page.
  const handle = panel.getByRole("button", { name: "Move Chart reference", exact: true });
  const initial = (await panel.boundingBox())!;
  await handle.focus(); await handle.press("ArrowLeft");
  await expect.poll(async () => (await panel.boundingBox())!.x).toBeLessThan(initial.x);
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + 20, h.y + 20); await page.mouse.down(); await page.mouse.move(420, 100, { steps: 5 }); await page.mouse.up();
  expect((await panel.boundingBox())!.x).toBeLessThan(initial.x);
  await page.setViewportSize({ width: 700, height: 700 });
  expect((await panel.boundingBox())!.x + (await panel.boundingBox())!.width).toBeLessThanOrEqual(700);
  await panel.getByRole("button", { name: "Close Chart reference" }).click();
  await page.reload();
  await expect(field).toHaveValue("Synthetic updated while the Chart is open");
});

for (const gesture of ["drift", "hold-release"] as const) test(`Chart reference opens during the interview with ${gesture}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { trigger: chart, panel, assessment } = await setup(page, "interview");
  await expect(page.locator("html")).toHaveAttribute("data-interview-focus", "true");
  const before = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  const url = page.url();
  const rect = (await chart.boundingBox())!;
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (gesture === "drift") {
    // Small natural motion before the hold threshold must not silently cancel it.
    await page.mouse.move(x + 12, y + 2, { steps: 3 });
  }
  await expect(chart).toHaveAttribute("data-chart-lifted", "true");
  if (gesture === "drift") await page.mouse.move(850, 220, { steps: 8 });
  await page.mouse.up();
  await expect(panel).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("textbox", { name: "Cognition / orientation", exact: true })).toBeEditable();
  await page.screenshot({ path: info.outputPath(`interview-reference-${gesture}.png`), animations: "disabled" });
  await panel.getByRole("button", { name: "Close Chart reference" }).click();
  await expect(chart).toBeFocused();
  expect((await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.version).toBe(before.version);
});

test("an explicitly tucked interview rail stays tucked and its Chart reference remains keyboard accessible", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pipeline:interview-rail", "tucked"));
  const { panel, assessment } = await setup(page);
  const before = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await startOperationalAssessment(page.request, before);
  const url = new URL(page.url());
  url.searchParams.set("assessmentMode", "interview");
  await page.goto(url.toString());
  await waitForAssessmentReady(page);
  const rail = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  await expect(rail).toBeHidden();
  await page.keyboard.press("Alt+c");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close Chart reference" }).click();
  const divider = page.getByRole("separator", { name: "Resize workspace rail", exact: true });
  await divider.focus();
  await divider.press("End");
  await expect(rail.getByRole("button", { name: "Chart", exact: true })).toBeVisible();
});

test("cancelled pulls do not navigate; a regular Chart click still opens Chart", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { panel } = await setup(page);
  const chart = page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Chart", exact: true });
  const url = Object.fromEntries(new URL(page.url()).searchParams);
  const r = (await chart.boundingBox())!;
  await page.mouse.move(r.x + 40, r.y + 30); await page.mouse.down();
  await expect(chart).toHaveAttribute("data-chart-lifted", "true");
  await page.mouse.move(900, 300); await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(panel).toHaveCount(0); expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(url);
  await chart.click();
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test("reference leaves with its workspace and reduced motion does not animate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { panel, trigger, openReference } = await setup(page);
  await openReference();
  expect(await panel.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Chart", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Assessment", exact: true }).click();
  await expect(trigger).toBeVisible(); await expect(panel).toHaveCount(0);
});

test("the existing Chart step supports touch hold and drag without an extra opener", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 834, height: 1000 }, hasTouch: true, baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  try {
    const { trigger: chart, panel } = await setup(page);
    await expect(page.getByRole("button", { name: "Open Chart reference", exact: true })).toHaveCount(0);
    const session = await context.newCDPSession(page);
    const r = (await chart.boundingBox())!;
    const url = Object.fromEntries(new URL(page.url()).searchParams);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
    await expect(chart).toHaveAttribute("data-chart-lifted", "true");
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 540, y: 220 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(panel).toBeVisible();
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(url);
    await panel.getByRole("button", { name: "Close Chart reference" }).tap();
    await expect(panel).toHaveCount(0);
  } finally { await context.close(); }
});

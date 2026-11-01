import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { activeOperationalAssessor, createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

const history = "## Earlier placements\n- First setting: supported housing\n- Second setting: hospital\n\n4. Follow up with referring team\n7. Confirm transport\n\nDose recorded as 2-4 mg.\n<img src=x onerror=alert(1)>";

for (const width of [1440, 390]) test(`chart and review retain formatted answers and edit access at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  const assessor = await activeOperationalAssessor(page.request);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Reading ${randomUUID()}`, owner: assessor.display_name }, { assigneeId: assessor.principal_id });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const started = await startOperationalAssessment(page.request, assessment);
  const patched = await page.request.patch(`/api/assessments/${assessment.assessment_id}`, { data: {
    if_match: started.version, client_mutation_id: randomUUID(), patch: { data: { prior_placements: history } },
  } });
  expect(patched.status(), await patched.text()).toBe(200);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
  const fact = review.locator('[data-chart-fact="Earlier care placements"]');
  await expect(fact).toContainText("Earlier placements");
  await expect(fact.locator("ul li")).toHaveText(["First setting: supported housing", "Second setting: hospital"]);
  await expect(fact.locator("ol li").first()).toHaveAttribute("value", "4");
  await expect(fact.locator("ol li").last()).toHaveAttribute("value", "7");
  await expect(fact).toContainText("Dose recorded as 2-4 mg.");
  await expect(fact).toContainText("<img src=x onerror=alert(1)>");
  await expect(fact.locator("img")).toHaveCount(0);
  await fact.scrollIntoViewIfNeeded();
  expect(await fact.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`review-reading-${width}.png`), animations: "disabled" });
  if (width < 1024) await page.getByLabel("Workspace view", { exact: true }).selectOption({ label: "Chart" });
  else await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true }).click();
  const chart = page.getByRole("article", { name: "Referral chart", exact: true });
  await expect(chart).toBeVisible();
  await expect(chart.getByRole("button", { name: "Edit Phone", exact: true })).toBeVisible();
  await expect(chart.locator("[data-chart-edit] svg")).toHaveCount(0);
  await page.addScriptTag({ content: readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: { include: string[] }) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> } }).axe;
    return (await axe.run({ include: ['[aria-label="Referral chart"]'] })).violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""));
  });
  expect(violations).toEqual([]);
  expect(await chart.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const record = page.locator('[data-chart-stage="Assessment"] [data-assessment-record]');
  await record.locator(":scope > details > summary").click();
  await expect(record.locator('[data-chart-fact="Earlier care placements"] ul li')).toHaveCount(2);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.prior_placements).toBe(history);
  expect(saved.signed_at).toBeNull();
});

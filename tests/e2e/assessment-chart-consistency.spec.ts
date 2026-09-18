import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral, createOperationalAssessment, completeOperationalAssessment, signOperationalAssessment, startOperationalAssessment } from "./support/operational-api";
import { openAssessmentChart } from "./support/assessment-navigation";
import { unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";
import { clientChartAssessments, clientReferralSections } from "../../lib/pipeline/client-chart-context";
import type { UnifiedClientProfileResponse } from "../../lib/pipeline/unified-profile-contracts";
import type { PipelineAssessmentRecord } from "../../lib/assessment/assessment-records";

const narrative = "Synthetic chart reading example. The client describes the sequence of prior placements and the support that made daily routines easier. Staff should have the full narrative available without clipped text or tiny columns.\nA second paragraph preserves the original account and its detail.";

test("the living chart distinguishes a recommendation from a recorded decision without mutating the profile", () => {
  const referral = { id: 71, name: "Synthetic chart", community: "San Pablo", createdAt: "2026-09-18T12:00:00Z",
    assessmentRecommendation: { outcome: "needs_more_information", reasonNote: "Waiting for documents" },
  };
  const profile = { ...structuredClone(unifiedProfileFixture), pipeline: { ...structuredClone(unifiedProfileFixture.pipeline), referrals: [referral] } } as unknown as UnifiedClientProfileResponse;
  const before = JSON.stringify(profile);
  expect(clientReferralSections(profile)[0].facts).toEqual(expect.arrayContaining([
    { label: "Placement recommendation", value: "Under review" },
    { label: "Recommendation reason", value: "Waiting for documents" },
  ]));
  for (const [outcome, label] of [["accepted", "Accept"], ["declined", "Deny"]]) {
    const decided = { ...profile, pipeline: { ...profile.pipeline, referrals: [{ ...referral,
      admissionDecision: { outcome, reasonNote: "Recorded reason", decidedByName: "Assessor A", decidedAt: "2026-09-18T13:00:00Z" },
    }] } } as unknown as UnifiedClientProfileResponse;
    const facts = clientReferralSections(decided)[0].facts;
    expect(facts).toEqual(expect.arrayContaining([
      { label: "Decision", value: label }, { label: "Decision reason", value: "Recorded reason" },
      { label: "Decision recorded by", value: "Assessor A" },
    ]));
    expect(facts.some((fact) => fact.label === "Placement recommendation")).toBe(false);
  }
  expect(JSON.stringify(profile)).toBe(before);
});

async function readingStyle(fact: Locator) {
  return fact.evaluate((el) => {
    const label = getComputedStyle(el.querySelector("dt")!);
    const answer = getComputedStyle(el.querySelector("dd")!);
    return { label: label.fontSize, answer: answer.fontSize, lineHeight: answer.lineHeight, weight: answer.fontWeight };
  });
}

for (const width of [1440, 834, 390]) {
  test(`assessment and workspace use the same readable client chart at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const source = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Example Chart ${randomUUID()}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
    const created = await createOperationalAssessment(page.request, source.id);
    const completed = await completeOperationalAssessment(page.request, created);
    const updated = await page.request.patch(`/api/assessments/${created.assessment_id}`, { data: {
      if_match: completed.version, client_mutation_id: randomUUID(), patch: { data: { prior_placements: narrative, primary_diagnosis: "Synthetic assessed diagnosis" } },
    } });
    expect(updated.status()).toBe(200);
    const signed = await signOperationalAssessment(page.request, (await updated.json()).assessment);
    const assessment = (await (await page.request.get(`/api/assessments/${signed.assessment_id}`)).json()).assessment;
    const referral = (await (await page.request.get(`/api/referrals/${source.id}`)).json()).referral;
    const profile = { ...structuredClone(unifiedProfileFixture), pipeline: { ...structuredClone(unifiedProfileFixture.pipeline), referrals: [referral], assessments: [assessment] } };
    await page.route("**/api/profiles/**", (route) => route.fulfill({ json: profile }));
    await page.goto(`/?view=referrals&screen=packet&referralId=${source.id}&workspaceStage=assessment&assessmentSection=prior_history`);
    await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
    await openAssessmentChart(page);
    const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
    const clientChart = review.getByRole("article", { name: "Client medical chart", exact: true });
    await expect(clientChart).toContainText("Synthetic assessed diagnosis");
    const record = review.getByRole("article", { name: "Assessment record", exact: true });
    await expect(record).toContainText(narrative);
    const body = await record.innerText();
    const fact = record.locator('[data-chart-fact="Prior placements"]');
    const style = await readingStyle(fact);
    expect(style.answer).toBe("16px");
    expect(style.label).toBe("13px");
    expect(parseFloat(style.lineHeight)).toBeGreaterThanOrEqual(25);
    await fact.scrollIntoViewIfNeeded();
    expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`assessment-chart-${width}.png`) });

    await page.goto(`/?view=referrals&screen=packet&referralId=${source.id}&workspaceStage=chart`);
    const workspace = page.getByTestId("profile-workspace");
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("article", { name: "Client medical chart", exact: true })).toContainText("Synthetic assessed diagnosis");
    const workspaceRecord = workspace.getByRole("article", { name: "Assessment record", exact: true });
    await expect(workspaceRecord).toHaveCount(1);
    expect(await workspaceRecord.innerText()).toBe(body);
    expect(await readingStyle(workspaceRecord.locator('[data-chart-fact="Prior placements"]'))).toEqual(style);
    await expect(workspace.getByText("Signed assessment record", { exact: true })).toHaveCount(0);
    await workspaceRecord.locator('[data-chart-fact="Prior placements"]').scrollIntoViewIfNeeded();
    expect(await workspace.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`workspace-chart-${width}.png`) });
  });
}

test("current unsigned answers appear without replacing established clinical facts or the shared cache", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const created = await createOperationalAssessment(page.request, referral.id);
  const started = await startOperationalAssessment(page.request, created);
  const staleAssessment = (await (await page.request.get(`/api/assessments/${started.assessment_id}`)).json()).assessment as PipelineAssessmentRecord;
  const fullReferral = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  const profile = { ...structuredClone(unifiedProfileFixture), pipeline: { ...structuredClone(unifiedProfileFixture.pipeline), referrals: [fullReferral], assessments: [staleAssessment] } } as unknown as UnifiedClientProfileResponse;
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: profile }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await page.locator("#assessment-prior_placements").fill(narrative);
  await openAssessmentChart(page);
  const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
  await expect(review.getByRole("article", { name: "Assessment record", exact: true })).toContainText(narrative);
  await expect(review).toContainText("In progress, not signed");
  await expect(review.getByRole("article", { name: "Client medical chart", exact: true })).toContainText("Sanitized diagnosis");
  const draft = { ...staleAssessment, prior_placements: narrative, primary_diagnosis: "Unsigned diagnosis" };
  const projected = clientChartAssessments(profile, referral.id, draft);
  expect(projected[0].prior_placements).toBe(narrative);
  expect(profile.pipeline.assessments[0].prior_placements).toBe(staleAssessment.prior_placements);
  expect(clientChartAssessments(profile, referral.id + 1, draft)).toBe(profile.pipeline.assessments);
  expect(clientChartAssessments({ ...profile, pipeline: { ...profile.pipeline, referrals: [] } }, referral.id, draft)[0]).toBe(staleAssessment);
  const newer = { ...profile, pipeline: { ...profile.pipeline, assessments: [{ ...staleAssessment, version: staleAssessment.version + 1 }] } };
  expect(clientChartAssessments(newer, referral.id, draft)).toBe(newer.pipeline.assessments);
  const sealed = { ...profile, pipeline: { ...profile.pipeline, assessments: [{ ...staleAssessment, signed_at: "2026-09-18T12:00:00Z" }] } };
  expect(clientChartAssessments(sealed, referral.id, draft)[0]).toBe(draft);
  expect(sealed.pipeline.assessments[0].signed_at).toBe("2026-09-18T12:00:00Z");
});

test("chart load failure retains working answers and can retry the full chart", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const created = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, created);
  await page.route("**/api/profiles/**", (route) => route.fulfill({ status: 503, json: { error: "Synthetic outage" } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await page.locator("#assessment-prior_placements").fill(narrative);
  await openAssessmentChart(page);
  const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
  await expect(review.getByRole("alert")).toContainText("could not be loaded");
  await expect(review.getByRole("article", { name: "Assessment record", exact: true })).toContainText(narrative);
  await page.unroute("**/api/profiles/**");
  await review.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(review.getByRole("article", { name: "Client medical chart", exact: true })).toBeVisible();
  await expect(review.getByRole("article", { name: "Assessment record", exact: true })).toContainText(narrative);
});

test("recovered edits to signed answers are not presented as signed clinical information", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const created = await createOperationalAssessment(page.request, referral.id);
  const completed = await completeOperationalAssessment(page.request, created);
  const updated = await page.request.patch(`/api/assessments/${created.assessment_id}`, { data: {
    if_match: completed.version, client_mutation_id: randomUUID(), patch: { data: { prior_placements: "Original signed history", primary_diagnosis: "Original signed diagnosis" } },
  } });
  expect(updated.status()).toBe(200);
  await signOperationalAssessment(page.request, (await updated.json()).assessment);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await page.getByRole("button", { name: "Edit Prior placements", exact: true }).click();
  await page.route(`**/api/assessments/${created.assessment_id}`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } }) : route.continue());
  await page.locator("#assessment-prior_placements").fill(narrative);
  await openAssessmentChart(page);
  const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
  const record = review.getByRole("article", { name: "Assessment record", exact: true });
  await expect(record).toContainText(narrative);
  await expect(record).toContainText("In progress, not signed");
  await expect(review.getByRole("article", { name: "Client medical chart", exact: true })).toContainText("Original signed diagnosis");
  const saved = (await (await page.request.get(`/api/assessments/${created.assessment_id}`)).json()).assessment;
  expect(saved.prior_placements).toBe("Original signed history");
  expect(saved.signed_at).toBeTruthy();
});

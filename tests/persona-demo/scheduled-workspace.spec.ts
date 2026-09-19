import { expect, test } from "@playwright/test";
import {
  createOperationalAssessment,
  createOperationalReferral,
  markOperationalPacketReviewed,
  scheduleOperationalAssessment,
} from "../e2e/support/operational-api";

test("scheduled work opens the same interview without manual intake or stage advances", async ({ page }) => {
  const supervisor = { id: "practice-supervisor", name: "Alex Morgan", email: "supervisor@pipeline.example", expectedRoles: ["admin"] };
  let referral = await createOperationalReferral(page.request, supervisor, {
    name: "Scheduled Handoff Fixture", owner: "Jordan Lee", phone: "555-010-0200", email: "case@example.invalid",
  }, { assigneeId: "practice-assessor" });
  referral = await markOperationalPacketReviewed(page.request, referral);
  let assessment = await createOperationalAssessment(page.request, referral.id);
  assessment = await scheduleOperationalAssessment(page.request, assessment);
  const scheduled = await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json();
  await page.clock.setFixedTime(new Date(Date.parse(scheduled.assessment.scheduled_start_at) - 60 * 60 * 1000));
  expect(scheduled.assessment.started_at).toBeFalsy();

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
  await page.getByRole("button", { name: "Admission workflow", exact: true }).click();
  await expect(page.getByText("Clinical recommendation", { exact: true })).toBeVisible();
  await expect(page.getByText("Chart-only exception", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Advance to/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Open assessment", exact: true }).click();
  const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
  await expect(begin).toBeVisible();
  await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
  const interview = page.locator('[data-guided-assessment="true"]');
  await expect(interview).toBeVisible();
  await interview.getByRole("button", { name: "Switch to Assessor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
  await page.locator('button[title]').filter({ hasText: referral.name }).first().click();
  await page.getByRole("dialog", { name: "Calendar item", exact: true }).getByRole("button", { name: "Open assessment", exact: true }).click();
  await expect(interview).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}(?:&|$)`));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await expect(interview).toBeVisible();
  await interview.getByRole("button", { name: "Full assessment" }).click();
  const chart = page.locator('[data-assessment-view="chart"]');
  await chart.getByRole("textbox", { name: /Prior 5150/ }).fill("Synthetic handoff answer retained on the same assessment.");
  await chart.getByRole("button", { name: "Switch to Supervisor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Assessor", exact: true })).toBeVisible();
  const listing = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
  expect(listing.assessments).toHaveLength(1);
  expect(listing.assessments[0].assessment_id).toBe(assessment.assessment_id);
  expect(listing.assessments[0].prior_5150_5250_holds).toBe("Synthetic handoff answer retained on the same assessment.");
});

test("schedule practice begins the real guided questionnaire", async ({ page }) => {
  await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=schedule&demo=1");
  const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
  await expect(schedule).toBeVisible();
  await schedule.getByLabel("Assessment date and time").fill("2027-09-14T09:30");
  await schedule.getByLabel("Assessment method").selectOption("record_review");
  await schedule.getByRole("button", { name: "Schedule assessment", exact: true }).click();
  const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
  await expect(begin).toBeVisible();
  await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
  await expect(page.locator('[data-guided-assessment="true"]')).toBeVisible();
});

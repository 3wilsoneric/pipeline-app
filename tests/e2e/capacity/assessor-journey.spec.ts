import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { completeOperationalAssessment } from '../support/operational-api';
import { operationalHeadersForActor } from '../support/pipeline-actors';
import { openAssessmentChart } from '../support/assessment-navigation';

for (const width of [1440, 834, 390]) test(`intake through signed assessment and unsent handoff at ${width}px`, async ({ browser, baseURL }, info) => {
  test.skip(info.config.metadata.pipelineCapacityRehearsal !== true, 'Isolated capacity configuration only');
  if (baseURL !== 'http://127.0.0.1:4177') throw Error('Loopback rehearsal only');
  const context = await browser.newContext({ baseURL, viewport: { width, height: 950 }, extraHTTPHeaders: operationalHeadersForActor({
    id: `journey-${randomUUID()}`, name: 'Synthetic Journey Assessor', email: 'capacity-70@pipeline.local', roleClaim: 'Pipeline.AssessmentCoordinator', expectedRoles: ['assessment_coordinator', 'reviewer', 'viewer'],
  }, baseURL) });
  const page = await context.newPage();
  try {
    await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
    const intake = page.getByTestId('intake-client-folder');
    const name = `Synthetic Journey ${randomUUID().replace(/[^a-z]/g, '')}`;
    await intake.locator('[data-workspace-field="name"] input').fill(name);
    await intake.locator('[data-workspace-field="email"] input').fill('journey@example.invalid');
    await page.getByLabel('Requested community', { exact: true }).selectOption('San Pablo');
    await page.getByRole('button', { name: 'Create referral', exact: true }).click();
    await expect(page).toHaveURL(/referralId=\d+/);
    const id = new URL(page.url()).searchParams.get('referralId')!;
    expect((await (await context.request.get(`/api/referrals/${id}/assessments`)).json()).assessments).toHaveLength(0);
    const stages = page.getByRole('navigation', { name: 'Workspace stages' });
    if (width < 640) await stages.getByRole('combobox', { name: 'Workspace view', exact: true }).selectOption({ label: 'Assessment' });
    else await stages.getByRole('button', { name: /Assessment$/ }).click();
    await expect(page.locator('[data-assessment-view]')).toBeVisible();
    await expect.poll(async () => (await (await context.request.get(`/api/referrals/${id}/assessments`)).json()).assessments.length).toBe(1);
    const list = (await (await context.request.get(`/api/referrals/${id}/assessments`)).json()).assessments;
    expect(list).toHaveLength(1);
    const assessment = await completeOperationalAssessment(context.request, list[0]);
    expect((await context.request.patch(`/api/assessments/${assessment.assessment_id}`, { data: { if_match: assessment.version, client_mutation_id: randomUUID(), patch: { data: { resident_name: name, community: 'San Pablo' } } } })).ok()).toBe(true);
    await page.reload();
    if (width >= 640) {
      await page.goto(`/?view=referrals&screen=packet&referralId=${id}&workspaceStage=assessment&assessmentSection=provenance_qc`);
      await page.getByRole('button', { name: 'Review & sign', exact: true }).click();
    } else await openAssessmentChart(page);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Sign & continue to decision', exact: true }).click();
    const decision = page.getByRole('region', { name: 'Admission decision', exact: true });
    await decision.getByRole('radio', { name: 'Accept', exact: true }).check();
    page.once('dialog', dialog => dialog.accept());
    await decision.getByRole('button', { name: 'Record decision', exact: true }).click();
    await decision.getByLabel('Admission date', { exact: true }).fill('2026-10-01');
    await decision.getByRole('button', { name: 'Continue to finish & send', exact: true }).click();
    await expect(page.frameLocator('iframe[title="Meet the Client email preview"]').getByRole('heading', { name: 'Meet the Client', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Preview only · email delivery is not connected.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send email & packet', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`handoff-${width}.png`), fullPage: true });
    const summary = (await (await context.request.get(`/api/referrals/${id}/admission-summary`)).json());
    expect(summary.email.configured).toBe(false);
    expect(summary.email.ready).toBe(false);
    // can_send describes the operator's permission, not provider readiness.
    const blockedSend = await context.request.post(`/api/referrals/${id}/meet-client-email`, { data: {
      confirmed: true, if_match: summary.referral.version, recipients: ['journey@example.invalid'], client_mutation_id: randomUUID(),
    } });
    expect(blockedSend.status()).toBe(503);
    expect(await blockedSend.text()).toContain('not configured');
    await page.locator('footer[aria-label="Handoff actions"]').getByRole('button', { name: 'Close workspace', exact: true }).click();
    await expect(page).not.toHaveURL(/screen=packet/);
    const saved = (await (await context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeTruthy();
    expect(saved.meet_client_sent_at).toBeFalsy();
    const workflow = (await (await context.request.get(`/api/referrals/${id}/workflow`)).json());
    expect(workflow.decision.outcome).toBe('accepted');
    expect(workflow.referral.admissionDate).toBe('2026-10-01');
  } finally { await context.close(); }
});

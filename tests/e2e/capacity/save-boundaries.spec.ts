import { confirmReferralFileLabels } from "../support/referral-upload";
import { test, expect, type Browser, type Page, type Route } from '@playwright/test';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createOperationalReferral, createOperationalAssessment } from '../support/operational-api';
import { operationalHeadersForActor, type PipelineActor } from '../support/pipeline-actors';
import { clientDirectoryFixture } from '../support/pipeline-clinical-fixtures';
import { pickAssessmentToolData } from '../../../lib/assessment/assessment-tool-schema';

test.beforeEach(async ({ baseURL }, testInfo) => {
  test.skip(testInfo.config.metadata.pipelineCapacityRehearsal !== true, 'Dedicated synthetic capacity configuration only');
  if (baseURL !== 'http://127.0.0.1:4177') throw Error('Isolated target required');
});

async function session(browser: Browser, baseURL: string, index: number, viewport?: { width: number; height: number }) {
  const actor: PipelineActor = { id: `boundary-${randomUUID()}`, name: `Synthetic Assessor ${index}`, email: `capacity-${index}@pipeline.local`, roleClaim: 'Pipeline.Reviewer', expectedRoles: ['reviewer', 'viewer'] };
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: operationalHeadersForActor(actor, baseURL), serviceWorkers: 'block', viewport });
  await context.route('**/api/profiles/directory**', route => route.fulfill({ json: { ...clientDirectoryFixture, clients: [], total: 0, next_cursor: null } }));
  const page = await context.newPage();
  return { context, page, actor };
}

async function seed(s: Awaited<ReturnType<typeof session>>) {
  return createOperationalReferral(s.context.request, s.actor, { name: `Synthetic ${randomUUID().replace(/[0-9]/g, n => String.fromCharCode(65 + Number(n)))}`, phone: '', email: '', documentName: '', documentStatus: 'Missing' });
}

async function editPhone(page: Page, id: number) {
  await page.goto(`/?view=referrals&screen=packet&referralId=${id}`);
  await page.locator('article[aria-label="Referral chart"]:not([data-testid="profile-workspace"] article)').getByRole('button', { name: 'Edit Phone', exact: true }).click();
  return page.getByRole('textbox', { name: 'Client phone:', exact: true });
}

async function openAssessment(page: Page, referralId: number) {
  await page.goto(`/?view=referrals&screen=packet&referralId=${referralId}&workspaceStage=assessment`);
  // Programmatic fill/focus can target an inert input underneath the recovery
  // overlay. A real click cannot; begin only when the workspace is interactive.
  await expect(page.getByTestId('packet-workspace')).toHaveAttribute('aria-busy', 'false');
}

test('same-field conflict keeps the losing answer and still permits a different field to save', async ({ browser, baseURL }) => {
  const a = await session(browser, baseURL!, 0);
  const b = await session(browser, baseURL!, 1);
  try {
    const referral = await seed(a);
    const phoneA = await editPhone(a.page, referral.id);
    const phoneB = await editPhone(b.page, referral.id);
    const held: Route[] = [];
    for (const s of [a, b]) await s.page.route(`**/api/referrals/${referral.id}`, async route => {
      if (route.request().method() === 'PATCH') held.push(route);
      else await route.continue();
    });
    await phoneA.fill('555-0111'); await phoneB.fill('555-0222');
    await phoneA.blur(); await phoneB.blur();
    await expect.poll(() => held.length).toBe(2);
    const saved = a.page.waitForResponse(r => r.request().method() === 'PATCH' && r.ok());
    await held[0].continue(); await saved;
    const conflict = b.page.waitForResponse(r => r.request().method() === 'PATCH' && r.status() === 409);
    await held[1].continue(); await conflict;
    await expect(phoneB).toHaveValue('555-0222');
    await expect(b.page.getByRole('button', { name: 'Keep mine', exact: true })).toBeVisible();
    expect((await (await b.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.phone).toBe('555-0111');
    await b.page.unroute(`**/api/referrals/${referral.id}`);
    const email = b.page.getByRole('textbox', { name: 'Client email:', exact: true });
    await email.fill('other-field@example.invalid'); await email.blur();
    await expect.poll(async () => (await (await b.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.email).toBe('other-field@example.invalid');
    await expect(phoneB).toHaveValue('555-0222');
    await expect(b.page.getByRole('button', { name: 'Keep mine', exact: true })).toBeVisible();
    const latest = (await (await a.context.request.get(`/api/referrals/${referral.id}`)).json()).referral;
    expect((await a.context.request.patch(`/api/referrals/${referral.id}`, { data: { if_match: latest.version, if_match_sections: { intake: latest.sectionVersions.intake }, patch: { note: 'Synthetic unrelated later edit' } } })).ok()).toBe(true);
    const refreshed = b.page.waitForResponse(r => new URL(r.url()).pathname === `/api/referrals/${referral.id}` && r.request().method() === 'GET');
    await b.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
    await expect(b.page.getByRole('button', { name: 'Keep mine', exact: true })).toBeVisible();
    await b.page.waitForTimeout(700); // Allow the private recovery draft's existing debounce.
    await b.page.reload();
    await expect(phoneB).toHaveValue('555-0222');
    await expect(b.page.getByRole('button', { name: 'Keep mine', exact: true })).toBeVisible();
    await b.page.getByRole('button', { name: 'Keep mine', exact: true }).click();
    await expect.poll(async () => (await (await b.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.phone).toBe('555-0222');
  } finally { await Promise.all([a.context.close(), b.context.close()]); }
});

test('lost save acknowledgement retries without duplicate audit and keeps typing in the next cell local', async ({ browser, baseURL }) => {
  const s = await session(browser, baseURL!, 2);
  const db = new URL(process.env.PIPELINE_TEST_DATABASE_URL ?? '');
  if (db.hostname !== '127.0.0.1' || !db.pathname.startsWith('/pipeline_capacity_')) throw Error('Isolated database required');
  const sql = postgres(db.href, { ssl: false, max: 1 });
  try {
    const referral = await seed(s);
    const phone = await editPhone(s.page, referral.id);
    const email = s.page.getByRole('textbox', { name: 'Client email:', exact: true });
    const mutations: string[] = [];
    let first = true;
    await s.page.route(`**/api/referrals/${referral.id}`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      mutations.push(route.request().postDataJSON().client_mutation_id);
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.fulfill({ status: 503, json: { error: 'Synthetic lost acknowledgement' } });
    });
    await phone.fill('555-0333');
    await s.page.waitForTimeout(600);
    expect(mutations).toHaveLength(0);
    await phone.blur();
    await expect(s.page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
    // A background refresh must not turn the uncertain request into a new write.
    const refreshed = s.page.waitForResponse(r => new URL(r.url()).pathname === `/api/referrals/${referral.id}/changes` && r.request().method() === 'GET');
    await s.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
    await s.page.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await expect.poll(() => mutations.length).toBe(2);
    expect(mutations[1]).toBe(mutations[0]);
    await expect(s.page.getByRole('button', { name: 'Retry saving', exact: true })).toHaveCount(0);
    const [audit] = await sql`select count(*)::int as count from pipeline.audit_events where entity_type='referral' and entity_id=${String(referral.id)} and actor_id=${s.actor.id} and after_values->>'phone'='555-0333'`;
    expect(audit.count).toBe(1);
    await email.fill('not-blurred@example.invalid');
    await s.page.waitForTimeout(600);
    expect((await (await s.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.email).toBe('');
    await email.blur();
    await expect.poll(async () => (await (await s.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.email).toBe('not-blurred@example.invalid');
    await s.page.reload();
    await expect(s.page.getByRole('textbox', { name: 'Client email:', exact: true })).toHaveValue('not-blurred@example.invalid');
  } finally { await s.context.close(); await sql.end(); }
});

test('assessment permits partial unscheduled answers on a phone and retains them after reopening on a tablet', async ({ browser, baseURL }) => {
  const s = await session(browser, baseURL!, 3, { width: 390, height: 844 });
  try {
    const referral = await seed(s);
    const assessment = await createOperationalAssessment(s.context.request, referral.id);
    await openAssessment(s.page, referral.id);
    await s.page.getByRole('navigation', { name: 'Question steps' }).getByRole('button', { name: 'Next', exact: true }).click();
    const location = s.page.getByRole('textbox', { name: 'Referrer contact', exact: true });
    await expect(location).toBeVisible();
    await location.fill('Synthetic interview location'); await location.blur();
    await expect.poll(async () => (await (await s.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.referrer_contact).toBe('Synthetic interview location');
    await s.page.setViewportSize({ width: 820, height: 1180 });
    await s.page.reload();
    await expect(s.page.getByRole('button', { name: 'Edit Referrer contact', exact: true })).toContainText('Synthetic interview location');
    const saved = (await (await s.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeNull();
    expect(saved.schedule_status).toBe('unscheduled');
  } finally { await s.context.close(); }
});

test('assessment disjoint answers in one section do not interrupt either assessor', async ({ browser, baseURL }) => {
  const a = await session(browser, baseURL!, 4, { width: 1365, height: 900 });
  const b = await session(browser, baseURL!, 5, { width: 1365, height: 900 });
  try {
    const referral = await seed(a);
    const assessment = await createOperationalAssessment(a.context.request, referral.id);
    for (const s of [a, b]) await openAssessment(s.page, referral.id);
    const location = a.page.getByRole('textbox', { name: 'Referrer contact', exact: true });
    const time = b.page.getByLabel('Assessment date', { exact: true });
    await location.fill('Synthetic changed location');
    await time.fill('2026-09-19');
    await location.blur();
    await expect.poll(async () => (await (await a.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.referrer_contact).toBe('Synthetic changed location');
    await time.blur();
    await expect.poll(async () => (await (await b.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.assessment_date).toBe('2026-09-19');
  } finally { await Promise.all([a.context.close(), b.context.close()]); }
});

test('assessment same-answer conflict survives a different answer save and reopening', async ({ browser, baseURL }) => {
  const a = await session(browser, baseURL!, 8, { width: 1365, height: 900 });
  const b = await session(browser, baseURL!, 9, { width: 1365, height: 900 });
  try {
    const referral = await seed(a);
    const assessment = await createOperationalAssessment(a.context.request, referral.id);
    for (const s of [a, b]) await openAssessment(s.page, referral.id);
    const contactA = a.page.getByRole('textbox', { name: 'Referrer contact', exact: true });
    const contactB = b.page.getByRole('textbox', { name: 'Referrer contact', exact: true });
    await contactA.fill('Synthetic first answer');
    await contactB.fill('Synthetic second answer');
    await contactA.blur();
    await expect.poll(async () => (await (await a.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.referrer_contact).toBe('Synthetic first answer');
    await contactB.blur();
    await expect(b.page.getByRole('button', { name: 'Keep mine', exact: true })).toBeVisible();
    const date = b.page.getByLabel('Assessment date', { exact: true });
    await date.focus();
    await expect(date).toBeFocused();
    await date.fill('2026-09-19'); await date.blur();
    await expect.poll(async () => (await (await b.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.assessment_date).toBe('2026-09-19');
    await expect(b.page.getByRole('button', { name: 'Keep mine', exact: true })).toBeVisible();
    await b.page.waitForTimeout(1200); // Existing encrypted draft persistence debounce.
    await b.page.reload();
    await expect(b.page.getByRole('button', { name: 'Keep mine', exact: true })).toBeVisible();
    await b.page.getByRole('button', { name: 'Keep mine', exact: true }).click();
    await expect.poll(async () => (await (await b.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.referrer_contact).toBe('Synthetic second answer');
  } finally { await Promise.all([a.context.close(), b.context.close()]); }
});

test('late assessment recovery restores untouched answers without replacing newly typed input', async ({ browser, baseURL }) => {
  const s = await session(browser, baseURL!, 12, { width: 1365, height: 900 });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const referral = await seed(s);
    const created = await createOperationalAssessment(s.context.request, referral.id);
    const assessment = (await (await s.context.request.get(`/api/assessments/${created.assessment_id}`)).json()).assessment;
    const base = pickAssessmentToolData(assessment);
    const path = `/api/me/assessment-drafts/${created.assessment_id}`;
    expect((await s.context.request.put(path, { data: { if_match: 0, draft: {
      schema: 1, assessmentId: created.assessment_id, referralId: referral.id,
      savedAt: new Date().toISOString(), baseVersion: assessment.version,
      sectionVersions: assessment.section_versions, dirtySections: ['identity'], activeSection: 'identity',
      data: { ...base, referrer_contact: 'Older unsaved contact', assessment_date: '2026-09-18' }, baseData: base,
    } } })).ok()).toBe(true);
    let captured = 0;
    await s.page.route(`**${path}`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch(); captured++;
      await gate; await route.fulfill({ response });
    });
    await openAssessment(s.page, referral.id);
    await expect.poll(() => captured).toBeGreaterThan(0);
    const contact = s.page.getByRole('textbox', { name: 'Referrer contact', exact: true });
    await contact.fill('Newer input during recovery');
    release();
    await expect(s.page.getByRole('button', { name: 'Edit Assessment date', exact: true })).toContainText('2026-09-18');
    await expect(contact).toHaveValue('Newer input during recovery');
    expect((await (await s.context.request.get(`/api/assessments/${created.assessment_id}`)).json()).assessment.referrer_contact).toBeNull();
    await contact.blur();
    await expect.poll(async () => (await (await s.context.request.get(`/api/assessments/${created.assessment_id}`)).json()).assessment.referrer_contact).toBe('Newer input during recovery');
  } finally { release(); await s.context.close(); }
});

test('uploaded document survives a lost completion reply, previews and remains a single file', async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_CAPACITY_DURABLE_UPLOAD !== 'true', 'Requires the isolated Azure Blob rehearsal; local mock uploads are not a multi-instance storage backend');
  const s = await session(browser, baseURL!, 6);
  try {
    const referral = await seed(s);
    await editPhone(s.page, referral.id);
    const canvas = createCanvas(240, 100);
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = 'white'; drawing.fillRect(0, 0, 240, 100);
    drawing.fillStyle = 'black'; drawing.font = '18px sans-serif'; drawing.fillText('Synthetic file only', 10, 50);
    const file = { name: 'synthetic-recovery.png', mimeType: 'image/png', buffer: canvas.toBuffer('image/png') };
    let completions = 0;
    let transfers = 0;
    s.page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).hostname.endsWith('.blob.core.windows.net') && !new URL(request.url()).pathname.endsWith('/control/upload-complete')) transfers++; });
    await s.page.route('**/api/uploads/complete', async route => {
      completions++;
      if (completions !== 1) return route.continue();
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.fulfill({ status: 503, json: { error: 'Synthetic lost upload acknowledgement' } });
    });
    await s.page.getByTestId('document-checklist-toggle').click();
    await s.page.getByLabel('Choose referral documents').setInputFiles(file);
    await confirmReferralFileLabels(s.page);
    const files = async () => (await (await s.context.request.get(`/api/files?referral_id=${referral.id}`)).json()).files.filter((item: { name: string }) => item.name === file.name);
    await expect.poll(async () => (await files()).length).toBe(1);
    await expect(s.page.getByTestId('workspace-save-status')).toContainText('Files uploaded');
    expect(completions).toBe(2);
    expect(transfers).toBe(1);
    const stored = (await files())[0];
    const preview = await s.context.request.get(`/api/files/${stored.id}/preview`);
    expect(preview.ok()).toBe(true);
    expect((await preview.body()).length).toBeGreaterThan(0);
    expect(await (await s.context.request.get(`/api/files/${stored.id}/download`)).body()).toEqual(file.buffer);
    await s.page.reload();
    expect(await files()).toHaveLength(1);
  } finally { await s.context.close(); }
});

test('assessment answers recover from offline saving and a lost acknowledgement without duplicating audit', async ({ browser, baseURL }) => {
  const s = await session(browser, baseURL!, 7, { width: 390, height: 844 });
  try {
    const referral = await seed(s);
    const assessment = await createOperationalAssessment(s.context.request, referral.id);
    await openAssessment(s.page, referral.id);
    await expect(s.page.locator('[data-phone-interview]')).toBeVisible();
    const date = s.page.getByLabel('Assessment date', { exact: true });
    await expect(date).toBeVisible();
    const mutations: string[] = [];
    let interrupted = false;
    await s.page.route(`**/api/assessments/${assessment.assessment_id}`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      mutations.push(route.request().postDataJSON().client_mutation_id);
      if (interrupted) return route.continue();
      interrupted = true;
      expect((await route.fetch()).ok()).toBe(true);
      await route.fulfill({ status: 503, json: { error: 'Synthetic lost assessment reply' } });
    });
    await date.click({ position: { x: 20, y: 20 } });
    await expect(date).toBeFocused();
    await date.fill('2026-09-19'); await date.blur();
    await expect.poll(() => mutations.length, { timeout: 20_000 }).toBe(2);
    expect(mutations[1]).toBe(mutations[0]);
    await expect(s.page.getByText('Offline changes synced', { exact: true })).toBeVisible();
    const saved = (await (await s.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.assessment_date).toBe('2026-09-19');
    expect(saved.audit_events.filter((e: { action: string }) => e.action === 'assessment_updated')).toHaveLength(1);
    await s.context.setOffline(true);
    await date.click({ position: { x: 20, y: 20 } });
    await expect(date).toBeFocused();
    await date.fill('2026-09-18'); await date.blur();
    await expect(s.page.getByText('Offline · 1 queued', { exact: true })).toBeVisible();
    await expect(date).toHaveValue('2026-09-18');
    await s.context.setOffline(false);
    await expect.poll(async () => (await (await s.context.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.assessment_date).toBe('2026-09-18');
    await s.page.reload();
    await expect(date).toHaveValue('2026-09-18');
  } finally { await s.context.close(); }
});

test('expired save authorization preserves the typed intake answer until an authorized retry', async ({ browser, baseURL }) => {
  const s = await session(browser, baseURL!, 10);
  try {
    const referral = await seed(s);
    const phone = await editPhone(s.page, referral.id);
    await s.page.route(`**/api/referrals/${referral.id}`, route => route.request().method() === 'PATCH'
      ? route.fulfill({ status: 401, json: { error: 'Synthetic session expiry' } }) : route.continue());
    await phone.fill('555-0444'); await phone.blur();
    await expect(s.page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
    await expect(phone).toHaveValue('555-0444');
    expect((await (await s.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.phone).toBe('');
    await s.page.unroute(`**/api/referrals/${referral.id}`);
    await s.page.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await expect.poll(async () => (await (await s.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.phone).toBe('555-0444');
  } finally { await s.context.close(); }
});

test('a temporary pre-handler capacity rejection retries the same field without another click', async ({ browser, baseURL }) => {
  const s = await session(browser, baseURL!, 12);
  try {
    const referral = await seed(s);
    const phone = await editPhone(s.page, referral.id);
    const bodies: string[] = [];
    await s.page.route(`**/api/referrals/${referral.id}`, route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      bodies.push(route.request().postData()!);
      if (bodies.length === 1) return route.fulfill({ status: 429, headers: { 'X-Pipeline-Capacity-Class': 'mutation', 'Retry-After': '1' }, json: { error: 'Synthetic capacity rejection before handler' } });
      return route.continue();
    });
    await phone.fill('555-0666'); await phone.blur();
    await expect.poll(async () => (await (await s.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.phone).toBe('555-0666');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    await expect(s.page.getByRole('button', { name: 'Retry saving', exact: true })).toHaveCount(0);
  } finally { await s.context.close(); }
});

test('a real disposable database outage retains the field and recovers without a false saved state', async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_CAPACITY_FAULTS !== 'true', 'Explicit isolated outage rehearsal only');
  const run = promisify(execFile);
  const data = process.env.PIPELINE_CAPACITY_PG_DATA;
  // This exact directory belongs to this disposable runner, not the operator's
  // normal database or any Azure PostgreSQL server.
  if (data !== '/home/rehearsal/artifacts/postgres' || process.platform !== 'linux') throw Error('Disposable Linux PostgreSQL directory required');
  const s = await session(browser, baseURL!, 11);
  let stopped = false;
  const restart = () => run('/usr/lib/postgresql/16/bin/pg_ctl', ['-D', data, '-l', '/home/rehearsal/artifacts/postgres.log', '-o', '-h 127.0.0.1 -p 55479 -k /home/rehearsal/artifacts -c max_connections=100 -c shared_buffers=512MB', 'start']);
  try {
    const referral = await seed(s);
    const phone = await editPhone(s.page, referral.id);
    await run('/usr/lib/postgresql/16/bin/pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
    stopped = true;
    await phone.fill('555-0555'); await phone.blur();
    await expect(s.page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
    await expect(phone).toHaveValue('555-0555');
    await restart(); stopped = false;
    await s.page.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await expect.poll(async () => (await (await s.context.request.get(`/api/referrals/${referral.id}`)).json()).referral.phone).toBe('555-0555');
    await s.page.reload();
    await expect(s.page.getByRole('textbox', { name: 'Client phone:', exact: true })).toHaveValue('555-0555');
  } finally {
    if (stopped) await restart();
    await s.context.close();
  }
});

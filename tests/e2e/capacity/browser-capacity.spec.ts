import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { totalmem, freemem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { createOperationalReferral } from '../support/operational-api';
import { operationalHeadersForActor, type PipelineActor } from '../support/pipeline-actors';
import { clientDirectoryFixture } from '../support/pipeline-clinical-fixtures';

test('sustained browser saves survive alternating application instances', async ({ baseURL }, testInfo) => {
  test.skip(testInfo.config.metadata.pipelineCapacityRehearsal !== true, 'Opt in with playwright.capacity.config.ts; never run as part of the ordinary browser suite');
  const users = Number(process.env.PIPELINE_CAPACITY_USERS ?? 100);
  const candidate = process.env.PIPELINE_CAPACITY_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(candidate)) throw Error('Exact candidate commit required');
  const seconds = Number(process.env.PIPELINE_CAPACITY_SECONDS ?? 1200);
  if (!Number.isInteger(users) || users < 2 || users > 100 || !Number.isInteger(seconds) || seconds < 10 || seconds > 7200) throw Error('Invalid bounded capacity profile');
  test.setTimeout((seconds + 180 + users * 3) * 1000);
  if (users > 10 && totalmem() < 32 * 1024 ** 3) throw Error('Use a dedicated 32+ GiB runner for >10 browsers; do not saturate the operator laptop');
  const dbUrl = new URL(process.env.PIPELINE_TEST_DATABASE_URL ?? '');
  if (baseURL !== 'http://127.0.0.1:4177' || dbUrl.hostname !== '127.0.0.1' || !dbUrl.pathname.startsWith('/pipeline_capacity_')) throw Error('Synthetic-only loopback guard failed');
  const sql = postgres(dbUrl.href, { ssl: false, max: 2, onnotice: () => {} });
  const browsers: Browser[] = [];
  const sessions: Array<{ context: BrowserContext; page: Page; actor: PipelineActor; id: number; field: string }> = [];
  const runId = `capacity-${Date.now()}`;
  const ledger: Array<{ actor: string; id: number; field: string; value: string; ms: number; backend: string; at: number }> = [];
  const errors: string[] = [];
  const backendCounts: Record<string, number> = {};
  const heartbeats = new Map<string, number>();
  const overlap: Array<{ at: number; actors_progressing_last_30s: number; free_memory_bytes: number }> = [];
  const navigationMs: number[] = [];
  const processMemory: Array<{ at: number; app_rss_kib: number; browser_rss_kib: number }> = [];
  const delay = monitorEventLoopDelay({ resolution: 20 });
  let sampler: ReturnType<typeof setInterval> | undefined;
  let measuredStart = 0;
  let measuredEnd = 0;
  try {
    for (let i = 0; i < Math.ceil(users / 10); i++) browsers.push(await chromium.launch({ headless: true }));
    // Bounded preparation only. The measured actor loops below are NOT batched.
    for (let start = 0; start < users; start += 5) await Promise.all(Array.from({ length: Math.min(5, users - start) }, async (_, offset) => {
      const i = start + offset;
      const actor: PipelineActor = { id: `${runId}-${i}`, name: `Synthetic Assessor ${i}`, email: `capacity-${i}@pipeline.local`, roleClaim: 'Pipeline.Reviewer', expectedRoles: ['reviewer', 'viewer'] };
      const context = await browsers[Math.floor(i / 10)].newContext({ baseURL, extraHTTPHeaders: operationalHeadersForActor(actor, baseURL!), viewport: { width: 1365, height: 900 } });
      context.setDefaultTimeout(30_000);
      context.setDefaultNavigationTimeout(30_000);
      // Only the disconnected external census is stubbed; Pipeline reads/writes use PostgreSQL.
      await context.route('**/api/profiles/directory**', route => route.fulfill({ json: { ...clientDirectoryFixture, clients: [], total: 0, next_cursor: null } }));
      const uniqueName = `${runId}-${i}`.replace(/[0-9]/g, digit => String.fromCharCode(65 + Number(digit)));
      const referral = await createOperationalReferral(context.request, actor, { name: `Synthetic ${uniqueName}`, source: runId, phone: '', email: '', documentName: '', documentStatus: 'Missing' });
      await createOperationalReferral(context.request, actor, { name: `Spare ${uniqueName}`, source: runId, documentName: '', documentStatus: 'Missing' });
      const page = await context.newPage();
      page.on('pageerror', () => errors.push(`browser_exception:${i}`));
      page.on('response', response => { if (response.url().startsWith(baseURL!) && response.status() >= 500) errors.push(`http_${response.status()}:${new URL(response.url()).pathname}:${i}`); });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
      await intakeChart(page).getByRole('button', { name: 'Edit Phone', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Client phone:', exact: true })).toBeVisible();
      sessions.push({ context, page, actor, id: referral.id, field: 'phone' });
    }));
    expect(sessions).toHaveLength(users);
    // Thirty percent share records; even the two-user rehearsal exercises a collision.
    const sharedActors = Math.max(2, Math.floor(users * 0.3 / 2) * 2);
    for (let i = 0; i < sharedActors; i += 2) {
      sessions[i + 1].id = sessions[i].id;
      sessions[i + 1].field = 'email';
      await sessions[i + 1].page.goto(`/?view=referrals&screen=packet&referralId=${sessions[i].id}`);
      await intakeChart(sessions[i + 1].page).getByRole('button', { name: 'Edit Email', exact: true }).click();
      await expect(sessions[i + 1].page.getByRole('textbox', { name: 'Client email:', exact: true })).toBeVisible();
    }
    measuredStart = Date.now();
    const deadline = measuredStart + seconds * 1000;
    delay.enable();
    sampler = setInterval(() => {
      overlap.push({ at: Date.now(), actors_progressing_last_30s: [...heartbeats.values()].filter(at => Date.now() - at < 30_000).length, free_memory_bytes: freemem() });
      const rows = execFileSync('ps', ['-eo', 'rss,comm'], { encoding: 'utf8' }).split('\n');
      const rss = (pattern: RegExp) => rows.reduce((sum, row) => pattern.test(row) ? sum + Number(row.trim().split(/\s+/)[0]) : sum, 0);
      processMemory.push({ at: Date.now(), app_rss_kib: rss(/next-server/), browser_rss_kib: rss(/chrome|chromium/i) });
    }, 5000);
    await Promise.all(sessions.map(async session => {
      let cycle = 0;
      do {
        const { page, context, id, actor, field } = session;
        const value = field === 'email' ? `${runId}-${actor.id.split('-').at(-1)}-${cycle}@example.invalid` : `555-${actor.id.split('-').at(-1)}-${cycle}`;
        const input = page.getByRole('textbox', { name: field === 'phone' ? 'Client phone:' : 'Client email:', exact: true });
        await input.fill(value);
        const started = Date.now();
        const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/referrals/${id}` && response.request().method() === 'PATCH' && response.ok(), { timeout: 30_000 });
        await input.blur();
        const response = await saved;
        const backend = response.headers()['x-capacity-backend'];
        backendCounts[backend] = (backendCounts[backend] ?? 0) + 1;
        ledger.push({ actor: actor.id, id, field, value, ms: Date.now() - started, backend, at: Date.now() });
        const oppositePort = backend === '4178' ? 4179 : 4178;
        await expect.poll(async () => {
          const read = await context.request.get(`http://127.0.0.1:${oppositePort}/api/referrals/${id}`);
          if (!read.ok()) return null;
          return (await read.json()).referral[field];
        }).toBe(value);
        heartbeats.set(actor.id, Date.now());
        cycle++;
        if (cycle % 3 === 0) {
          const navigationStarted = Date.now();
          await page.goto('/?screen=calendar');
          await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
          await page.goto(`/?view=referrals&screen=packet&referralId=${id}`);
          await intakeChart(page).getByRole('button', { name: field === 'phone' ? 'Edit Phone' : 'Edit Email', exact: true }).click();
          await expect(input).toHaveValue(value);
          navigationMs.push(Date.now() - navigationStarted);
        }
        await page.waitForTimeout(1000 + (Number(actor.id.split('-').at(-1)) % 5) * 200);
      } while (Date.now() < deadline);
    }));
    measuredEnd = Date.now();
    const latest = new Map(ledger.map(entry => [`${entry.id}:${entry.field}`, entry]));
    for (const entry of latest.values()) {
      const [row] = await sql`select data from pipeline.referrals where referral_id=${entry.id}`;
      expect(row.data[entry.field]).toBe(entry.value);
    }
    for (let offset = 0; offset < ledger.length; offset += 500) {
      const expected = ledger.slice(offset, offset + 500).map(({ actor, id, field, value }) => ({ actor, id: String(id), field, value }));
      const audit = await sql`select e.actor, e.id, e.field, e.value, count(a.audit_event_id)::int as count
        from jsonb_to_recordset(${sql.json(expected)}::jsonb) as e(actor text, id text, field text, value text)
        left join pipeline.audit_events a on a.entity_type='referral' and a.entity_id=e.id and a.actor_id=e.actor and a.after_values->>e.field=e.value
        group by e.actor, e.id, e.field, e.value`;
      expect(audit).toHaveLength(expected.length);
      expect(audit.every(row => row.count === 1), 'Each acknowledged write must have exactly one independent audit entry').toBe(true);
    }
    expect(Object.keys(backendCounts).sort()).toEqual(['4178', '4179']);
    expect(new Set(ledger.map(entry => entry.actor)).size).toBe(users);
    if (seconds >= 60) {
      const steady = overlap.filter(sample => sample.at >= measuredStart + 30_000);
      expect(steady.length).toBeGreaterThan(0);
      expect(steady.every(sample => sample.actors_progressing_last_30s === users)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    if (sampler) clearInterval(sampler);
    delay.disable();
    const sorted = ledger.map(entry => entry.ms).sort((a, b) => a - b);
    await testInfo.attach('capacity-evidence', { body: Buffer.from(JSON.stringify({ runId, candidate_commit: candidate, application_baseline: 'ccd474433c05001ed621c30643bde3f1b3e8a201', environment: 'loopback-postgres-two-process-synthetic-auth', requested_users: users, created_sessions: sessions.length, actors_with_confirmed_saves: new Set(ledger.map(entry => entry.actor)).size, measuredStart, measuredEnd, browser_processes: browsers.length, backendCounts, overlap, processMemory, calendar_and_return_navigation_ms: navigationMs, saves: ledger.length, p95_save_ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, p99_save_ms: sorted[Math.ceil(sorted.length * .99) - 1] ?? null, generator_event_loop_p99_ms: delay.percentile(99) / 1e6, errors, ledger, limits: ['Not Entra sign-in or Azure production performance certification', 'Current workload: intake save/cross-replica reads/calendar navigation; assessment/upload/fault waves remain separate'] }, null, 2)), contentType: 'application/json' });
    await Promise.allSettled(sessions.map(session => session.context.close()));
    await Promise.allSettled(browsers.map(browser => browser.close()));
    await sql.end({ timeout: 5 });
  }
});

function intakeChart(page: Page) {
  return page.locator('article[aria-label="Referral chart"]:not([data-testid="profile-workspace"] article)');
}

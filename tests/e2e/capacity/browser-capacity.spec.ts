import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { totalmem, freemem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import type { ClientRequest } from 'node:http';
import type { Socket } from 'node:net';
import postgres from 'postgres';
import { createOperationalReferral } from '../support/operational-api';
import { operationalHeadersForActor, type PipelineActor } from '../support/pipeline-actors';
import { clientDirectoryFixture } from '../support/pipeline-clinical-fixtures';

test('sustained browser saves survive alternating application instances', async ({ baseURL }, testInfo) => {
  test.skip(testInfo.config.metadata.pipelineCapacityRehearsal !== true, 'Opt in with playwright.capacity.config.ts; never run as part of the ordinary browser suite');
  const users = Number(process.env.PIPELINE_CAPACITY_USERS ?? 100);
  const actorOffset = Number(process.env.PIPELINE_CAPACITY_ACTOR_OFFSET ?? 0);
  const navigationMode = process.env.PIPELINE_CAPACITY_NAVIGATION ?? 'reload';
  const probeConnection = process.env.PIPELINE_CAPACITY_PROBE_CONNECTION ?? 'keepalive';
  if (!['keepalive', 'close'].includes(probeConnection)) throw Error('Unknown diagnostic probe connection policy');
  const replicas = Number(process.env.PIPELINE_CAPACITY_REPLICAS ?? 2);
  if (![2, 3].includes(replicas)) throw Error('Only the two- or three-replica rehearsal is supported');
  const backendPorts = Array.from({ length: replicas }, (_, index) => 4178 + index);
  if (!['reload', 'in-app'].includes(navigationMode)) throw Error('Unknown capacity navigation mode');
  if (!Number.isInteger(actorOffset) || actorOffset < 0 || actorOffset + users > 100) throw Error('Distinct distributed actors must remain inside the synthetic allowlist');
  const candidate = process.env.PIPELINE_CAPACITY_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(candidate)) throw Error('Exact candidate commit required');
  const applicationCommit = process.env.PIPELINE_CAPACITY_APPLICATION_COMMIT ?? candidate;
  if (!/^[a-f0-9]{40}$/.test(applicationCommit)) throw Error('Exact application build commit required');
  const seconds = Number(process.env.PIPELINE_CAPACITY_SECONDS ?? 1200);
  if (!Number.isInteger(users) || users < 2 || users > 100 || !Number.isInteger(seconds) || seconds < 10 || seconds > 7200) throw Error('Invalid bounded capacity profile');
  test.setTimeout((seconds + 180 + users * 3) * 1000);
  if (users > 10 && totalmem() < 32 * 1024 ** 3) throw Error('Use a dedicated 32+ GiB runner for >10 browsers; do not saturate the operator laptop');
  const dbUrl = new URL(process.env.PIPELINE_TEST_DATABASE_URL ?? '');
  if (baseURL !== 'http://127.0.0.1:4177' || dbUrl.hostname !== '127.0.0.1' || !dbUrl.pathname.startsWith('/pipeline_capacity_')) throw Error('Synthetic-only loopback guard failed');
  const sql = postgres(dbUrl.href, { ssl: false, max: 2, onnotice: () => {} });
  const browsers: Browser[] = [];
  const sessions: Array<{ context: BrowserContext; page: Page; actor: PipelineActor; id: number; field: string }> = [];
  const runId = `capacity-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const ledger: Array<{ actor: string; id: number; field: string; value: string; ms: number; http_ms: number; server_ms: number | null; backend: string; at: number }> = [];
  const errors: string[] = [];
  const backendCounts: Record<string, number> = {};
  const heartbeats = new Map<string, number>();
  const overlap: Array<{ at: number; actors_progressing_last_30s: number; free_memory_bytes: number }> = [];
  const navigationMs: number[] = [];
  const processMemory: Array<{ at: number; app_rss_kib: number; browser_rss_kib: number; runner_rss_bytes: number; runner_heap_bytes: number; event_loop_p99_ms: number }> = [];
  const actorFailures: Array<{ actor: string; at: number; message: string }> = [];
  const probeTimings: Array<{ at: number; actor: string; port: number; ms: number; status?: number; error?: string }> = [];
  const pageMetrics: Array<Record<string, unknown>> = [];
  const transportFailures: Array<Record<string, unknown>> = [];
  const socketLastResponse = new WeakMap<Socket, number>();
  const observeHttp = (message: unknown) => {
    const request = (message as { request: ClientRequest }).request;
    const endpoint = new URL(`http://${request.getHeader('host')}`);
    if (endpoint.hostname !== '127.0.0.1' || !backendPorts.includes(Number(endpoint.port))) return;
    const started = Date.now();
    let socket: Socket | null = null;
    let idleMs: number | null = null;
    let localPort: number | undefined;
    const observeSocket = (current: Socket) => {
      socket = current;
      const last = socketLastResponse.get(current);
      idleMs = last === undefined ? null : started - last;
      localPort = current.localPort;
      if (current.connecting) current.once('connect', () => { localPort = current.localPort; });
    };
    if (request.socket) observeSocket(request.socket);
    else request.once('socket', observeSocket);
    request.once('response', response => response.once('end', () => {
      if (socket) socketLastResponse.set(socket, Date.now());
    }));
    request.once('error', (error: NodeJS.ErrnoException) => {
      transportFailures.push({ at: started, port: Number(endpoint.port), reusedSocket: request.reusedSocket, idleMs, localPort, code: error.code, message: error.message, elapsedMs: Date.now() - started });
    });
  };
  channel('http.client.request.start').subscribe(observeHttp);
  const requestMinutes = new Map<string, { count: number; total_ms: number; max_ms: number }>();
  const delay = monitorEventLoopDelay({ resolution: 20 });
  let sampler: ReturnType<typeof setInterval> | undefined;
  let pageSampler: ReturnType<typeof setInterval> | undefined;
  let pageSampleRunning = false;
  let measuredStart = 0;
  let measuredEnd = 0;
  try {
    for (let i = 0; i < Math.ceil(users / 10); i++) browsers.push(await chromium.launch({ headless: true }));
    // Bounded preparation only. The measured actor loops below are NOT batched.
    for (let start = 0; start < users; start += 5) await Promise.all(Array.from({ length: Math.min(5, users - start) }, async (_, offset) => {
      const i = start + offset;
      const actorIndex = actorOffset + i;
      // Rehearsals reuse real-world stable staff identities. Run-scoped records
      // and values still isolate the audit ledger; reruns must not invent staff.
      const actor: PipelineActor = { id: `capacity-assessor-${actorIndex}`, name: `Synthetic Assessor ${actorIndex}`, email: `capacity-${actorIndex}@pipeline.local`, roleClaim: 'Pipeline.Reviewer', expectedRoles: ['reviewer', 'viewer'] };
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
      page.on('response', response => { if (response.url().startsWith(baseURL!) && (response.status() >= 500 || response.status() === 429)) errors.push(`http_${response.status()}:${new URL(response.url()).pathname}:${i}`); });
      page.on('requestfinished', request => {
        if (!measuredStart || !request.url().startsWith(`${baseURL}/api/`)) return;
        const timing = request.timing();
        const path = new URL(request.url()).pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
        const key = `${Math.floor((Date.now() - measuredStart) / 60_000)}:${request.method()}:${path}`;
        const previous = requestMinutes.get(key) ?? { count: 0, total_ms: 0, max_ms: 0 };
        previous.count++;
        previous.total_ms += Math.max(0, timing.responseEnd);
        previous.max_ms = Math.max(previous.max_ms, timing.responseEnd);
        requestMinutes.set(key, previous);
      });
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
    const startAt = Number(process.env.PIPELINE_CAPACITY_START_AT ?? 0);
    if (startAt && (!Number.isSafeInteger(startAt) || startAt <= Date.now() || startAt > Date.now() + 10 * 60_000)) throw Error('Distributed start must be a shared future time within ten minutes');
    if (startAt) await new Promise(resolve => setTimeout(resolve, startAt - Date.now()));
    measuredStart = Date.now();
    const deadline = measuredStart + seconds * 1000;
    delay.enable();
    // Sample only two pages per generator; do not profile every actor and turn
    // the diagnostic itself into the browser bottleneck.
    const sampledSessions = [sessions[0], sessions.at(-1)!];
    const metricSessions = await Promise.all(sampledSessions.map(async ({ context, page, actor }) => {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      return { cdp, actor };
    }));
    const samplePages = async () => {
      if (pageSampleRunning) return;
      pageSampleRunning = true;
      try {
        for (const { cdp, actor } of metricSessions) {
          const { metrics } = await cdp.send('Performance.getMetrics');
          pageMetrics.push({ at: Date.now(), actor: actor.id, ...Object.fromEntries(metrics.filter(({ name }) => ['Documents', 'Nodes', 'JSEventListeners', 'JSHeapUsedSize', 'JSHeapTotalSize', 'TaskDuration', 'ScriptDuration', 'LayoutDuration'].includes(name)).map(({ name, value }) => [name, value])) });
        }
      } catch (error) {
        pageMetrics.push({ at: Date.now(), error: String(error).split('\n')[0] });
      } finally { pageSampleRunning = false; }
    };
    await samplePages();
    pageSampler = setInterval(() => void samplePages(), 30_000);
    sampler = setInterval(() => {
      overlap.push({ at: Date.now(), actors_progressing_last_30s: [...heartbeats.values()].filter(at => Date.now() - at < 30_000).length, free_memory_bytes: freemem() });
      const rows = execFileSync('ps', ['-eo', 'rss,comm'], { encoding: 'utf8' }).split('\n');
      const rss = (pattern: RegExp) => rows.reduce((sum, row) => pattern.test(row) ? sum + Number(row.trim().split(/\s+/)[0]) : sum, 0);
      const runner = process.memoryUsage();
      processMemory.push({ at: Date.now(), app_rss_kib: rss(/next-server/), browser_rss_kib: rss(/chrome|chromium/i), runner_rss_bytes: runner.rss, runner_heap_bytes: runner.heapUsed, event_loop_p99_ms: delay.percentile(99) / 1e6 });
    }, 5000);
    // A named actor step gives Playwright a stable parent for its action log.
    // Without it, every API call searches the entire growing test-step tree,
    // making the load generator itself progressively slower during a soak.
    const outcomes = await Promise.allSettled(sessions.map(session => test.step(session.actor.id, async () => {
      let cycle = 0;
      try {
      do {
        const { page, context, id, actor, field } = session;
        const value = field === 'email' ? `${runId}-${actor.id.split('-').at(-1)}-${cycle}@example.invalid` : `555-${actor.id.split('-').at(-1)}-${cycle}`;
        const input = page.getByRole('textbox', { name: field === 'phone' ? 'Client phone:' : 'Client email:', exact: true });
        // A person cannot type through the recovery overlay. fill() can alter an
        // inert input without focus/blur events, producing a false missing-save.
        await expect(page.getByTestId('packet-workspace')).toHaveAttribute('aria-busy', 'false');
        await input.click();
        await expect(input).toBeFocused();
        await input.fill(value);
        const started = Date.now();
        const [response] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === `/api/referrals/${id}` && response.request().method() === 'PATCH' && response.ok(), { timeout: 30_000 }),
          input.blur(),
        ]);
        const backend = response.headers()['x-capacity-backend'];
        backendCounts[backend] = (backendCounts[backend] ?? 0) + 1;
        const serverDuration = /app;dur=([\d.]+)/.exec(response.headers()['server-timing'] ?? '');
        ledger.push({ actor: actor.id, id, field, value, ms: Date.now() - started, http_ms: response.request().timing().responseStart, server_ms: serverDuration ? Number(serverDuration[1]) : null, backend, at: Date.now() });
        expect(backendPorts.map(String)).toContain(backend);
        const oppositePort = backendPorts[(backendPorts.indexOf(Number(backend)) + 1) % replicas];
        await expect.poll(async () => {
          const probeStart = Date.now();
          try {
            const read = await context.request.get(`http://127.0.0.1:${oppositePort}/api/referrals/${id}`, { maxRetries: 0, ...(probeConnection === 'close' ? { headers: { Connection: 'close' } } : {}) });
            try {
              probeTimings.push({ at: probeStart, actor: actor.id, port: oppositePort, ms: Date.now() - probeStart, status: read.status() });
              if (!read.ok()) return null;
              return (await read.json()).referral[field];
            } finally {
              // API responses otherwise retain their body and log until the
              // context closes. This rehearsal lasts up to two hours.
              await read.dispose();
            }
          } catch (error) {
            probeTimings.push({ at: probeStart, actor: actor.id, port: oppositePort, ms: Date.now() - probeStart, error: String(error).split('\n')[0] });
            throw error;
          }
        }).toBe(value);
        heartbeats.set(actor.id, Date.now());
        cycle++;
        if (cycle % 3 === 0) {
          const navigationStarted = Date.now();
          const documentStarted = await page.evaluate(() => performance.timeOrigin);
          if (navigationMode === 'reload') await page.goto('/?screen=calendar');
          else await page.getByRole('button', { name: 'Open calendar', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
          if (navigationMode === 'reload') await page.goto(`/?view=referrals&screen=packet&referralId=${id}`);
          else await page.goBack();
          const edit = intakeChart(page).getByRole('button', { name: field === 'phone' ? 'Edit Phone' : 'Edit Email', exact: true });
          await expect(input.or(edit).first()).toBeVisible();
          if (await edit.isVisible()) await edit.click();
          await expect(input).toHaveValue(value);
          if (navigationMode === 'in-app') expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStarted);
          navigationMs.push(Date.now() - navigationStarted);
        }
        await page.waitForTimeout(1000 + (Number(actor.id.split('-').at(-1)) % 5) * 200);
      } while (Date.now() < deadline);
      } catch (error) {
        actorFailures.push({ actor: session.actor.id, at: Date.now(), message: String(error).split('\n')[0] });
        throw error;
      }
    })));
    measuredEnd = Date.now();
    // Actors have stopped. SQL reconciliation is evidence collection, not a
    // period in which those actors should still be making progress.
    if (sampler) clearInterval(sampler);
    if (pageSampler) clearInterval(pageSampler);
    delay.disable();
    await samplePages();
    const latest = new Map(ledger.map(entry => [`${entry.id}:${entry.field}`, entry]));
    for (const entry of latest.values()) {
      const [row] = await sql`select data from pipeline.referrals where referral_id=${entry.id}`;
      expect(row.data[entry.field]).toBe(entry.value);
    }
    await reconcileCapacityAuditLedger(sql, ledger);
    // Reconcile acknowledged writes even on a failed actor, without turning
    // that failure into a pass or abandoning the other actors' evidence.
    const failures = outcomes.filter(outcome => outcome.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(outcome => outcome.reason), `${failures.length} capacity actors failed`);
    expect(Object.keys(backendCounts).sort()).toEqual(backendPorts.map(String));
    expect(new Set(ledger.map(entry => entry.actor)).size).toBe(users);
    if (seconds >= 60) {
      const steady = measuredCapacityProgress(overlap, measuredStart, measuredEnd);
      expect(steady.length).toBeGreaterThan(0);
      expect(steady.every(sample => sample.actors_progressing_last_30s === users)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    channel('http.client.request.start').unsubscribe(observeHttp);
    if (sampler) clearInterval(sampler);
    if (pageSampler) clearInterval(pageSampler);
    delay.disable();
    await testInfo.attach('workload-profile', { body: JSON.stringify({ navigationMode, actorOffset, users, replicas, application_build_commit: applicationCommit, harness_commit: candidate }), contentType: 'application/json' });
    await testInfo.attach('capacity-diagnostics', { body: JSON.stringify({ probeConnection, actorFailures, transportFailures, probeTimings, pageMetrics, requestMinutes: Object.fromEntries(requestMinutes) }), contentType: 'application/json' });
    const sorted = ledger.map(entry => entry.ms).sort((a, b) => a - b);
    await testInfo.attach('capacity-evidence', { body: Buffer.from(JSON.stringify({ runId, candidate_commit: candidate, application_baseline: 'ccd474433c05001ed621c30643bde3f1b3e8a201', environment: `loopback-postgres-${replicas}-process-synthetic-auth`, requested_users: users, created_sessions: sessions.length, actors_with_confirmed_saves: new Set(ledger.map(entry => entry.actor)).size, measuredStart, measuredEnd, browser_processes: browsers.length, backendCounts, overlap, processMemory, calendar_and_return_navigation_ms: navigationMs, saves: ledger.length, p95_save_ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, p99_save_ms: sorted[Math.ceil(sorted.length * .99) - 1] ?? null, generator_event_loop_p99_ms: delay.percentile(99) / 1e6, errors, ledger, limits: ['Not Entra sign-in or Azure production performance certification', 'Current workload: intake save/cross-replica reads/calendar navigation; assessment/upload/fault waves remain separate'] }, null, 2)), contentType: 'application/json' });
    await Promise.allSettled(sessions.map(session => session.context.close()));
    await Promise.allSettled(browsers.map(browser => browser.close()));
    await sql.end({ timeout: 5 });
  }
});

function intakeChart(page: Page) {
  return page.locator('article[aria-label="Referral chart"]:not([data-testid="profile-workspace"] article)');
}

export function measuredCapacityProgress(samples: Array<{ at: number; actors_progressing_last_30s: number }>, started: number, ended: number) {
  return samples.filter(sample => sample.at >= started + 30_000 && sample.at <= ended);
}

export async function reconcileCapacityAuditLedger(sql: ReturnType<typeof postgres>, ledger: Array<{ actor: string; id: number; field: string; value: string }>) {
  const pairKey = (entry: { actor: string; id: string | number; field: string }) => JSON.stringify([entry.actor, String(entry.id), entry.field]);
  const valueKey = (entry: { actor: string; id: string | number; field: string; value: unknown }) => JSON.stringify([entry.actor, String(entry.id), entry.field, entry.value]);
  const pairs = [...new Map(ledger.map(entry => [pairKey(entry), { actor: entry.actor, id: String(entry.id), field: entry.field }])).values()];
  // Read each actor/record/field's audit history once, instead of rescanning
  // that growing history once per acknowledged value. Counts remain exact.
  for (let offset = 0; offset < pairs.length; offset += 25) {
    const batch = pairs.slice(offset, offset + 25);
    const selected = new Set(batch.map(pairKey));
    const rows = await sql`select e.actor, e.id, e.field, a.after_values->>e.field as value, count(a.audit_event_id)::int as count
      from jsonb_to_recordset(${sql.json(batch)}::jsonb) as e(actor text, id text, field text)
      join pipeline.audit_events a on a.entity_type='referral' and a.entity_id=e.id and a.actor_id=e.actor
      group by e.actor, e.id, e.field, a.after_values->>e.field`;
    const counts = new Map(rows.map(row => [valueKey(row as { actor: string; id: string; field: string; value: unknown }), row.count]));
    for (const entry of ledger) if (selected.has(pairKey(entry))) {
      expect(counts.get(valueKey(entry)), 'Each acknowledged write must have exactly one independent audit entry').toBe(1);
    }
  }
}

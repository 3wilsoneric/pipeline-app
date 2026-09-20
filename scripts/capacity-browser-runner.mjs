// Execute the canonical browser workload without Playwright Test's unbounded
// per-action history. Browser APIs, web-first assertions and SQL are all real.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTypeScriptModule } from './ts-module-loader.mjs';

if (process.env.PIPELINE_CAPACITY_REMOTE !== 'true') throw Error('Dedicated remote capacity environment required');
const require = createRequire(import.meta.url);
const playwright = require('@playwright/test');
const assertions = playwright.expect.configure({ timeout: 30_000 });
const root = resolve('.data/capacity-20260919');
mkdirSync(root, { recursive: true });
let workload;
let deadline;
const attachments = [];
const startedAt = Date.now();
const register = (_title, callback) => {
  if (workload) throw Error('Exactly one canonical workload is allowed');
  workload = callback;
};
register.skip = (condition, message) => { if (condition) throw Error(message); };
register.step = (_title, callback) => callback();
register.setTimeout = milliseconds => {
  if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 8_000_000) throw Error('Invalid workload deadline');
  clearTimeout(deadline);
  deadline = setTimeout(() => {
    report(Error('Canonical capacity workload exceeded its deadline'));
    process.exit(1);
  }, milliseconds);
};
function report(error) {
  writeFileSync(`${root}/playwright.json`, JSON.stringify({
    runner: 'standalone-canonical-browser-workload',
    stats: { startTime: new Date(startedAt).toISOString(), duration: Date.now() - startedAt, expected: error ? 0 : 1, unexpected: error ? 1 : 0, skipped: 0, flaky: 0 },
    ...(error ? { error: { message: String(error), stack: error.stack } } : {}),
    attachments,
  }));
}
loadTypeScriptModule(process.cwd(), 'tests/e2e/capacity/browser-capacity.spec.ts', {
  require: specifier => specifier === '@playwright/test' ? { ...playwright, test: register, expect: assertions } : require(specifier),
  setTimeout, clearTimeout, setInterval, clearInterval, performance,
});
if (!workload) throw Error('Canonical capacity workload was not registered');
try {
  await workload({ baseURL: 'http://127.0.0.1:4177' }, {
    config: { metadata: { pipelineCapacityRehearsal: true } },
    attach: async (name, { body, contentType }) => attachments.push({ name, contentType, body: Buffer.from(body).toString('base64') }),
  });
  report();
  console.log('Canonical browser workload passed, including SQL/audit reconciliation.');
} catch (error) {
  report(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}

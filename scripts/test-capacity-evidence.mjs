import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTypeScriptModule } from './ts-module-loader.mjs';
const require = createRequire(import.meta.url);
const helpers = loadTypeScriptModule(process.cwd(), 'tests/e2e/capacity/browser-capacity.spec.ts', {
  require: name => name === '@playwright/test' ? { ...require(name), test: () => {} } : require(name),
});
const sample = (at, users) => ({ at, actors_progressing_last_30s: users });
const history = [sample(29_999, 0), sample(30_000, 25), sample(60_000, 25), sample(60_001, 0), sample(90_000, 0)];
const measured = helpers.measuredCapacityProgress(history, 0, 60_000);
assert.equal(measured.length, 2);
assert.equal(measured.every(x => x.actors_progressing_last_30s === 25), true);
assert.equal(helpers.measuredCapacityProgress([...history, sample(40_000, 24)], 0, 60_000).every(x => x.actors_progressing_last_30s === 25), false);
assert.equal(helpers.measuredCapacityProgress([sample(90_000, 25)], 0, 60_000).length, 0);
const ledger = [{ actor: 'a', id: 1, field: 'phone', value: '555-one' }, { actor: 'a', id: 1, field: 'phone', value: '555-two' }];
const rows = ledger.map(x => ({ ...x, id: String(x.id), count: 1 }));
const sql = result => Object.assign(async () => result, { json: value => value });
await helpers.reconcileCapacityAuditLedger(sql(rows), ledger);
await assert.rejects(helpers.reconcileCapacityAuditLedger(sql(rows.slice(0, 1)), ledger));
await assert.rejects(helpers.reconcileCapacityAuditLedger(sql([{ ...rows[0], count: 2 }, rows[1]]), ledger));
await assert.rejects(helpers.reconcileCapacityAuditLedger(sql(rows.map(x => ({ ...x, actor: 'wrong-actor' }))), ledger));
console.log('7 capacity evidence controls passed: measured boundaries, in-window stall, empty window, exact audit, missing audit, duplicate audit, wrong actor.');

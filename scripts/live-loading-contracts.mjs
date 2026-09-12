#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const checks = [];
let now = Date.now();
class Clock extends Date { static now() { return now; } }

function load(file, stubs, extra = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(output, {
    module: loaded, exports: loaded.exports,
    require: (id) => id === "server-only" ? {} : stubs[id] ?? require(id),
    Headers, Request, Response, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, DOMException, Date: Clock, setTimeout, clearTimeout, console,
    ...extra,
  }, { filename: file });
  return loaded.exports;
}

let calls = 0;
let respond = async () => Response.json({ version: ++calls });
const browser = load("lib/auth/authenticated-fetch.ts", {
  "@/lib/auth/entra-client": { pipelineAuthRequired: false },
  "@/lib/auth/browser-session": { clearPipelineBrowserSessionCache() {} },
  "@/lib/auth/post-login-path": {},
  "@/lib/pipeline/base-path": { toPipelinePath: (path) => path },
}, { fetch: (...args) => respond(...args), window: { setTimeout, clearTimeout } });
const path = "/api/profiles/synthetic-client";
await browser.fetchPipelineJson(path, {}, { cacheTtlMs: 60_000 });
const cached = browser.readPipelineJsonCache(path);
assert.equal(cached.version, 1);
for (const endpoint of ["/api/me/recents", "/api/me/work-continuity", "/api/referrals/42/presence"]) {
  await browser.fetchPipelineJson(endpoint, { method: "POST" });
  assert.equal(browser.readPipelineJsonCache(path).version, 1);
}
checks.push("recents, resume locations and presence preserve loaded chart data");
await browser.fetchPipelineJson("/api/referrals/42", { method: "PATCH" });
assert.equal(browser.readPipelineJsonCache(path), undefined);
checks.push("real data edits still invalidate cached projections");

let finish;
respond = () => new Promise((resolve) => { calls += 1; finish = resolve; });
const before = calls;
const firstController = new AbortController();
const first = browser.fetchPipelineJson(path, { signal: firstController.signal }, { cacheTtlMs: 60_000 });
const firstCancelled = assert.rejects(first, (error) => error.status === 499);
const second = browser.fetchPipelineJson(path, {}, { cacheTtlMs: 60_000 });
firstController.abort();
finish(Response.json({ version: 7 }));
await firstCancelled;
assert.equal((await second).version, 7);
assert.equal(calls - before, 1);
checks.push("prefetch and navigation share one request; cancelling one reader preserves the other");

browser.clearPipelineClientSessionCache();
const oldRequest = browser.fetchPipelineJson(path, {}, { cacheTtlMs: 60_000 });
browser.clearPipelineClientSessionCache();
finish(Response.json({ version: 8 }));
await oldRequest;
assert.equal(browser.readPipelineJsonCache(path), undefined);
checks.push("an old-session response cannot repopulate a cleared cache");
respond = async () => Response.json({ version: ++calls });
await browser.fetchPipelineJson(path, {}, { cacheTtlMs: 10 });
now += 11;
assert.equal(browser.readPipelineJsonCache(path), undefined);
checks.push("synchronous page restoration never returns expired entries");

const fixture = JSON.parse(readFileSync("scripts/fixtures/alamo-pipeline-clinical.sanitized.json", "utf8"));
const contracts = loadTypeScriptModule(root, "lib/clinical/clinical-contracts.ts");
let clinicalCalls = 0;
let payload = fixture.clients;
const clinicalEnv = { NODE_ENV: "test", PIPELINE_CLINICAL_DATA_MODE: "alamo_api", PIPELINE_ALAMO_API_BASE_URL: "https://alamo.invalid", PIPELINE_ALAMO_AUTH_MODE: "bearer", PIPELINE_ALAMO_API_TOKEN: "synthetic-token" };
const clinical = load("lib/clinical/clinical-data.ts", {
  "./clinical-contracts": contracts,
  "./demo-clinical-data": { demoClinicalSnapshotExists: () => false },
}, {
  process: { env: clinicalEnv },
  fetch: async () => { clinicalCalls += 1; return Response.json(payload); },
});
const operator = new Request("https://pipeline.invalid", { headers: { cookie: "session=operator-a" } });
await Promise.all([clinical.getClinicalClients(operator, { limit: 200 }), clinical.getClinicalClients(operator, { limit: 200 })]);
assert.equal(clinicalCalls, 1);
await clinical.getClinicalClients(operator, { limit: 200 });
assert.equal(clinicalCalls, 1);
checks.push("concurrent and repeated clinical pages reuse one validated upstream read");
await clinical.getClinicalClients(new Request("https://pipeline.invalid", { headers: { cookie: "session=operator-b" } }), { limit: 200 });
assert.equal(clinicalCalls, 2);
await clinical.getClinicalClients(new Request("https://pipeline.invalid", { headers: { cookie: "session=operator-a; delegation=assessor" } }), { limit: 200 });
assert.equal(clinicalCalls, 3);
checks.push("operator and God-mode sessions never share clinical entries");
now += 60_001;
await clinical.getClinicalClients(operator, { limit: 200 });
assert.equal(clinicalCalls, 4);
await clinical.getClinicalClients(new Request(operator, { headers: { cookie: "session=operator-a", "x-pipeline-refresh": "1" } }), { limit: 200 });
assert.equal(clinicalCalls, 5);
checks.push("clinical cache expiry and explicit refresh perform real upstream reads");
payload = { invalid: true };
const broken = new Request("https://pipeline.invalid", { headers: { cookie: "session=broken" } });
await assert.rejects(clinical.getClinicalClients(broken, { limit: 200 }));
payload = fixture.clients;
await clinical.getClinicalClients(broken, { limit: 200 });
assert.equal(clinicalCalls, 7);
checks.push("invalid upstream payloads are rejected and never cached");
clinicalEnv.PIPELINE_ALAMO_API_TOKEN = "synthetic-rotated-token";
await clinical.getClinicalClients(broken, { limit: 200 });
assert.equal(clinicalCalls, 8);
checks.push("rotating upstream authority invalidates prior clinical projections");

let warmed = 0;
const identity = load("lib/pipeline/referral-clinical-identity.ts", {
  "@/lib/clinical/clinical-client-directory-index": {
    getCachedClinicalClientDirectoryIndex: () => null,
    getClinicalClientDirectoryIndex: () => { warmed += 1; return new Promise(() => {}); },
  },
  "./client-workspace-store": { getConfirmedReferralClinicalIdentities: async () => new Map([[42, {}]]) },
});
const rows = [{ id: 42, name: "Synthetic Person" }];
assert.equal(await identity.applyReviewedClinicalIdentity(operator, "operator-a", rows), rows);
assert.equal(warmed, 1);
checks.push("workspace lists return recorded identity without waiting for the full upstream roster");

console.log(JSON.stringify({ ok: true, checks }, null, 2));

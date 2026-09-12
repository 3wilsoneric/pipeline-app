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
for (const method of ["PUT", "DELETE"]) {
  respond = async () => Response.json({ version: 1 });
  await browser.fetchPipelineJson("/api/me/referral-drafts", {}, { cacheTtlMs: 60_000 });
  await browser.fetchPipelineJson("/api/me/referral-drafts/42", {}, { cacheTtlMs: 60_000 });
  await browser.fetchPipelineJson("/api/me/referral-drafts/42", { method });
  assert.equal(browser.readPipelineJsonCache(path).version, 1);
  assert.equal(browser.readPipelineJsonCache("/api/me/referral-drafts"), undefined);
  assert.equal(browser.readPipelineJsonCache("/api/me/referral-drafts/42"), undefined);
}
checks.push("private recovery saves and deletes evict draft reads, not saved charts or directories");
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
respond = async () => Response.json({ version: 20 });
await browser.fetchPipelineJson(path, {}, { cacheTtlMs: 60_000, bypassCache: true });
assert.equal(browser.readPipelineJsonCache(path).version, 20);
checks.push("explicit refresh replaces the cached copy used on the next visit");
browser.clearPipelineClientSessionCache();
respond = () => new Promise((resolve) => { finish = resolve; });
const staleRead = browser.fetchPipelineJson(path, {}, { cacheTtlMs: 60_000 });
const finishStale = finish;
const freshRead = browser.fetchPipelineJson(path, {}, { cacheTtlMs: 60_000, bypassCache: true });
finish(Response.json({ version: 22 }));
await freshRead;
finishStale(Response.json({ version: 21 }));
await staleRead;
assert.equal(browser.readPipelineJsonCache(path).version, 22);
checks.push("an earlier pending read cannot overwrite a completed explicit refresh");

let timerId = 0;
const timers = new Map();
const warmedPaths = [];
const finishWarmups = [];
const navigation = load("lib/pipeline/client-navigation.ts", {
  react: {},
  "@/lib/pipeline/base-path": {},
  "@/lib/pipeline/workspace-presentation": { isImportedWorkspace: (referral) => referral.workspaceOrigin === "allo" },
  "@/lib/auth/authenticated-fetch": {
    fetchPipelineJson: (url, init, options) => {
      assert.equal(init.method ?? "GET", "GET");
      assert.ok(options.cacheTtlMs > 0 && options.cacheTtlMs <= 60_000);
      warmedPaths.push(url);
      return new Promise((resolve) => finishWarmups.push(resolve));
    },
  },
}, {
  setTimeout: (fn, delay) => { assert.equal(delay, 120); timers.set(++timerId, fn); return timerId; },
  clearTimeout: (id) => timers.delete(id),
});
const runWarmup = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); };
navigation.prefetchPipelineWorkspace({ id: 41, clientId: "ignored" });
navigation.prefetchPipelineWorkspace({ id: 42, clientId: "fixture", workspaceOrigin: "allo" });
assert.equal(timers.size, 1);
runWarmup();
assert.deepEqual(warmedPaths, ["/api/referrals/42/canvas", "/api/profiles/pipeline%3Afixture", "/api/referrals/42/historical-profile"]);
navigation.prefetchPipelineWorkspace({ id: 42 }); runWarmup();
assert.equal(warmedPaths.length, 3);
navigation.prefetchPipelineWorkspace({ id: 43 }); runWarmup();
navigation.prefetchPipelineWorkspace({ id: 44 }); runWarmup();
assert.equal(warmedPaths.length, 4);
finishWarmups.forEach((resolve) => resolve({}));
await new Promise((resolve) => setTimeout(resolve, 0));
navigation.prefetchPipelineWorkspace({ id: 44 }); runWarmup();
assert.equal(warmedPaths.at(-1), "/api/referrals/44/canvas");
finishWarmups.at(-1)({});
checks.push("workspace intent ignores drive-bys, deduplicates and caps concurrent warmups, without writes or file downloads");

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

payload = fixture.roster;
const beforeRoster = clinicalCalls;
await Promise.all([clinical.getClinicalRoster(operator, { limit: 200 }), clinical.getClinicalRoster(operator, { limit: 200 })]);
await clinical.getClinicalRoster(operator, { limit: 200 });
assert.equal(clinicalCalls, beforeRoster + 1);
await clinical.getClinicalRoster(new Request(operator, { headers: { cookie: "session=operator-a", "x-pipeline-refresh": "1" } }), { limit: 200 });
assert.equal(clinicalCalls, beforeRoster + 2);
await clinical.getClinicalRoster(new Request("https://pipeline.invalid", { headers: { cookie: "session=operator-b" } }), { limit: 200 });
await clinical.getClinicalRoster(new Request("https://pipeline.invalid", { headers: { cookie: "session=operator-a; delegation=assessor" } }), { limit: 200 });
assert.equal(clinicalCalls, beforeRoster + 4);
now += 60_001;
await clinical.getClinicalRoster(operator, { limit: 200 });
assert.equal(clinicalCalls, beforeRoster + 5);
payload = { invalid: true };
await assert.rejects(clinical.getClinicalRoster(new Request(operator, { headers: { cookie: "session=operator-a", "x-pipeline-refresh": "1" } }), { limit: 200 }));
await assert.rejects(clinical.getClinicalRoster(operator, { limit: 200 }));
assert.equal(clinicalCalls, beforeRoster + 7);
checks.push("current census pages deduplicate, expire, refresh, isolate God mode and never reuse invalid source data");

payload = fixture.resident;
await clinical.getClinicalResident(operator, "337:R-100");
payload = structuredClone(fixture.resident);
payload.resident.date_of_birth = "1999-12-31";
for (const method of ["POST", "PATCH"]) {
  const resident = await clinical.getClinicalResident(new Request(operator, { method }), "337:R-100");
  assert.equal(resident.resident.date_of_birth, "1999-12-31");
}
payload = { invalid: true };
await assert.rejects(clinical.getClinicalResident(new Request(operator, { method: "PATCH" }), "337:R-100"));
checks.push("mutation identity validation stays fresh and rejects bad evidence despite warmed display caches");

let releaseReferrals, releaseDocuments;
let referralsStarted = false, documentsStarted = false;
let visible = true;
const unified = load("lib/pipeline/unified-profile.ts", {
  "@/lib/assessment/assessment-store": { getAssessmentStoreReadiness: () => ({ ready: false }) },
  "@/lib/assessment/assessment-tool-schema": {},
  "@/lib/clinical/clinical-data": {},
  "@/lib/observability/api-logging": {},
  "@/lib/observability/pipeline-metrics": {},
  "./client-history-store": {},
  "./community-config": {},
  "./referral-clinical-reconciliation": {},
  "./resident-link-store": {},
  "./client-identity-presentation.mjs": { normalizeClientName: (name) => name, resolveClientGender: () => null },
  "./referral-access": { isAssessorUser: () => true, canAccessReferral: () => visible },
  "./referral-store": {
    getReferralStoreReadiness: () => ({ ready: true }),
    listReferralsByClient: () => { referralsStarted = true; return new Promise((resolve) => { releaseReferrals = resolve; }); },
    listReferralFilesByClient: () => { documentsStarted = true; return new Promise((resolve) => { releaseDocuments = resolve; }); },
  },
});
const profileRead = unified.getUnifiedClientProfile(operator, "pipeline:fixture", undefined, { id: "fixture-owner" });
assert.ok(referralsStarted && documentsStarted);
const referral = { id: 42, name: "Fixture Person", community: "Fixture", createdAt: "2026-09-12T00:00:00Z", stage: "Intake", workspaceStatus: "historical", requirements: [] };
releaseReferrals([referral]);
releaseDocuments([{ id: "allowed", referralId: 42 }, { id: "hidden", referralId: 43 }]);
const profile = await profileRead;
assert.equal(profile.pipeline.documents.length, 1);
assert.equal(profile.pipeline.documents[0].id, "allowed");
visible = false;
const rejectedProfile = unified.getUnifiedClientProfile(operator, "pipeline:fixture", undefined, { id: "different-owner" });
releaseReferrals([referral]); releaseDocuments([{ id: "allowed", referralId: 42 }]);
await assert.rejects(rejectedProfile, (error) => error.status === 404);
checks.push("parallel chart reads start together while assessor ownership and document visibility remain enforced");

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

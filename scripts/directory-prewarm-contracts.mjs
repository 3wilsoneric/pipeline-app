import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let generation = 1;
let clock = Date.now();
let user = { id: "fixture-assessor" };
let calls = 0;
let fail = false;
let cycle = false;
let invalidate = false;
let refresh = false;
const pages = {
  first: { clients: [{ profile_key: "resident:1", canonical_client_id: "fixture-1" }], total: 2, data_as_of: "2026-09-12", freshness: { status: "fresh" }, next_cursor: "second" },
  second: { clients: [{ profile_key: "resident:2", canonical_client_id: "fixture-2" }], total: 2, data_as_of: "2026-09-12", freshness: { status: "fresh" }, next_cursor: null },
};
class Clock extends Date { static now() { return clock; } }
const auth = {
  getPipelineClientCacheGeneration: () => generation,
  fetchCurrentPipelineUser: async () => ({ user }),
  readPipelineJsonCache: () => undefined,
  fetchPipelineJson: async (path) => {
    calls += 1;
    if (fail) throw new Error("Fixture upstream unavailable");
    if (invalidate) generation += 1;
    if (refresh) loaded.exports.simulateExplicitRefresh();
    const cursor = new URL(path, "https://localhost").searchParams.get("cursor");
    return { ...pages[cursor ?? "first"], ...(cycle ? { next_cursor: "second" } : {}) };
  },
};
const output = ts.transpileModule(readFileSync("components/pipeline/ClientProfileDirectory.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(`${output}\nmodule.exports.simulateExplicitRefresh = () => { directoryRefreshVersion += 1; };`, {
  module: loaded, exports: loaded.exports, Date: Clock, URL, URLSearchParams, AbortController, AbortSignal, DOMException,
  require: (id) => id === "@/lib/auth/authenticated-fetch" ? auth : {},
});
const preload = () => loaded.exports.preloadCurrentClientDirectory(new AbortController().signal);
await preload();
assert.equal(calls, 2, "login must preload the complete roster, not just page one");
await preload();
assert.equal(calls, 2, "visible-directory cache must reuse completed login preload");
user = { id: "fixture-viewer" };
await preload();
assert.equal(calls, 4, "another operator must never reuse private directory entries");
generation += 1;
await preload();
assert.equal(calls, 6, "God mode/context changes invalidate completed directory entries");
clock += 120_001;
await preload();
assert.equal(calls, 8, "expired directories must refresh");
generation += 1;
invalidate = true;
await assert.rejects(preload(), { name: "AbortError" });
invalidate = false;
await preload();
assert.equal(calls, 11, "late old-session preload must not populate the new context");
generation += 1;
refresh = true;
await assert.rejects(preload(), { name: "AbortError" });
refresh = false;
await preload();
generation += 1;
fail = true;
await assert.rejects(preload(), /unavailable/);
fail = false;
await preload();
generation += 1;
cycle = true;
await assert.rejects(preload(), /safe pagination limit/);
cycle = false;
pages.second.total = 3;
await assert.rejects(preload(), /census changed/);
pages.second.total = 2;
pages.second.clients = [];
await assert.rejects(preload(), /stopped before every client/);
const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(loaded.exports.preloadCurrentClientDirectory(cancelled.signal), { name: "AbortError" });

const startupOutput = ts.transpileModule(readFileSync("lib/clinical/clinical-startup-warmup.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const startup = { exports: {} };
const env = { NODE_ENV: "production" };
let reads = 0;
let authMode = "client_credentials";
const logs = [];
vm.runInNewContext(startupOutput, {
  module: startup, exports: startup.exports, process: { env }, Date,
  console: { log: (entry) => logs.push(entry), warn: (entry) => logs.push(entry) },
  require: (id) => id === "server-only" ? {} : {
    getClinicalAuthMode: () => authMode, getClinicalDataMode: () => "alamo_api", getClinicalDataReadiness: () => ({ ready: true }),
    getClinicalRoster: async (request, options) => { assert.equal(request, undefined); assert.equal(options.limit, 200); reads += 1; if (fail) throw new Error("secret-fixture-must-not-be-logged"); },
  },
});
await startup.exports.warmClinicalSourceAtStartup();
assert.equal(reads, 1);
authMode = "delegated";
await startup.exports.warmClinicalSourceAtStartup();
assert.equal(reads, 1, "startup must never impersonate a delegated operator");
authMode = "client_credentials";
env.NEXT_PHASE = "phase-production-build";
await startup.exports.warmClinicalSourceAtStartup();
assert.equal(reads, 1, "builds must never call production clinical sources");
delete env.NEXT_PHASE;
fail = true;
await startup.exports.warmClinicalSourceAtStartup();
assert.equal(logs.some((entry) => entry.includes("secret-fixture")), false);
console.log(JSON.stringify({ ok: true, scope: "complete preload, identity/generation/TTL isolation, cancellation, bounded pagination, source replacement, startup authorization and outage safety" }));

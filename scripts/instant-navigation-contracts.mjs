import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(file, stubs = {}, extra = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  const expose = (extra.expose ?? []).map((name) => `exports[${JSON.stringify(name)}] = ${name};`).join("\n");
  vm.runInNewContext(`${output}\n${expose}`, {
    module: loadedModule, exports: loadedModule.exports, require: (id) => id === "server-only" ? {} : stubs[id] ?? require(id),
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal,
    DOMException, setTimeout, clearTimeout, console, process, ...extra,
  }, { filename: file });
  return loadedModule.exports;
}

const schema = load("lib/observability/browser-performance-contract.ts");
const sample = { metric: "surface_ready", surface: "home", value: 123, result: "ready" };
assert.ok(schema.parseBrowserPerformanceSamples([sample]));
for (const bad of [null, {}, [], Array(21).fill(sample), [{ ...sample, name: "must-not-log" }],
  [{ ...sample, url: "/?clientId=must-not-log" }], [{ ...sample, value: Infinity }],
  [{ ...sample, value: "10" }], [{ ...sample, value: -1 }], [{ ...sample, value: 60_001 }],
  [{ ...sample, metric: { toString: 3 } }], [{ ...sample, surface: "patient-name" }],
  [{ ...sample, result: "unknown" }], [{ ...sample, metric: "cache_hit", value: 0.5 }]]) {
  assert.equal(schema.parseBrowserPerformanceSamples(bad), null);
}
assert.equal(schema.pipelineSurfaceReady("home", true, ""), undefined);
assert.equal(schema.pipelineSurfaceReady("home", false, "failure"), undefined);
assert.equal(schema.pipelineSurfaceReady("home", false, ""), "home");

let auth = { ok: true, user: { id: "effective-assessor", delegation: { actor: { id: "owner" } } } };
let originFailure = null;
const emitted = [];
const metricRoute = load("app/api/me/performance/route.ts", {
  "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => auth },
  "@/lib/auth/request-security": { requireSameOriginMutation: () => originFailure },
  "@/lib/extraction/contracts": { readJsonBody: async (request) => ({ ok: true, value: await request.json() }), jsonError: () => new Response(null, { status: 400 }) },
  "@/lib/observability/api-logging": { withApiLogging: async (_request, _route, run) => run() },
  "@/lib/observability/browser-performance-contract": schema,
  "@/lib/observability/pipeline-metrics": { recordPipelineMetric: (...args) => emitted.push(args) },
});
const metricRequest = (body = [sample]) => new Request("https://pipeline.invalid/api/me/performance", { method: "POST", body: JSON.stringify(body) });
auth = { ok: false, response: new Response(null, { status: 401 }) };
assert.equal((await metricRoute.POST(metricRequest())).status, 401);
assert.equal(emitted.length, 0);
auth = { ok: true, user: { id: "effective-assessor" } };
originFailure = new Response(null, { status: 403 });
assert.equal((await metricRoute.POST(metricRequest())).status, 403);
originFailure = null;
assert.equal((await metricRoute.POST(metricRequest([{ ...sample, name: "forbidden" }]))).status, 400);
assert.equal((await metricRoute.POST(metricRequest())).status, 204);
assert.equal(JSON.stringify(emitted), JSON.stringify([["pipeline.browser.surface_ready", 123, "milliseconds", { route: "home", result: "ready" }]]));

let mode = "entra_jwt";
let marker = "1";
let authorizations = 0;
const env = { NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "true" };
const entry = load("lib/auth/server-entry.ts", {
  react: { cache: (run) => run },
  "@/lib/auth/pipeline-auth": { getPipelineAuthMode: () => mode, requirePipelineUser: async (request) => {
    authorizations += 1; assert.equal(request.headers.get("cookie"), "synthetic-session"); return auth;
  } },
  "@/lib/auth/server-component-request": { getServerComponentRequestHeaders: async () => new Headers({ "x-pipeline-server-entry": marker, cookie: "synthetic-session" }) },
}, { process: { env } });
assert.equal((await entry.getPipelineServerEntryUser()).id, "effective-assessor");
auth = { ok: false, response: new Response(null, { status: 401 }) };
assert.equal(await entry.getPipelineServerEntryUser(), null);
for (const skipped of ["mock", "headers", "disabled"]) { mode = skipped; assert.equal(await entry.getPipelineServerEntryUser(), null); }
mode = "entra_jwt"; marker = "spoofed";
assert.equal(await entry.getPipelineServerEntryUser(), null);
marker = "1"; env.NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED = "false";
assert.equal(await entry.getPipelineServerEntryUser(), null);
assert.equal(authorizations, 2, "every eligible render revalidates the canonical identity; no process-global user cache");

auth = { ok: true, user: { id: "owner", pipeline: true, noteLab: true } };
let forwarded;
const NextResponse = {
  next: ({ request }) => { forwarded = request.headers; return new Response(null); },
  redirect: (_url, status = 307) => new Response(null, { status }),
  json: Response.json,
};
const proxy = load("proxy.ts", {
  "next/server": { NextResponse },
  "@/lib/auth/pipeline-auth": {
    requireAuthenticatedUser: async () => auth, canAccessPipeline: (user) => user.pipeline,
    canAccessNoteLab: (user) => user.noteLab, isProtectedPath: (path) => path !== "/sign-in",
  },
  "@/lib/auth/canonical-origin": { getCanonicalPageRedirect: () => null },
  "@/lib/pipeline/base-path": { fromPipelinePath: (path) => path, toPipelinePath: (path) => path },
  "@/shared/pipeline-security-headers.mjs": { PIPELINE_PERMISSIONS_POLICY: "fixture" },
});
function proxyRequest(path) {
  const url = new URL(path, "https://pipeline.invalid");
  url.clone = () => new URL(url);
  return { nextUrl: url, headers: new Headers({ "x-pipeline-server-entry": "spoofed", cookie: "synthetic-session" }) };
}
const pageResponse = await proxy.proxy(proxyRequest("/"));
assert.equal(forwarded.get("x-pipeline-server-entry"), "1");
assert.equal(pageResponse.headers.get("cache-control"), "private, no-store, max-age=0");
for (const path of ["/sign-in", "/api/auth/me", "/api/profiles/fixture", "/note-lab/practice", "/?state=s&code=c", "/?state=s&error_description=e"]) {
  await proxy.proxy(proxyRequest(path));
  assert.equal(forwarded.has("x-pipeline-server-entry"), false, `SSR seed must not bypass the existing ${path} flow`);
}
auth = { ok: true, user: { pipeline: false } };
assert.equal((await proxy.proxy(proxyRequest("/"))).status, 307);
auth = { ok: false, response: new Response(null, { status: 401 }) };
assert.equal((await proxy.proxy(proxyRequest("/"))).status, 307);

const providerModule = load("components/auth/PipelineAuthProvider.tsx", {
  "@azure/msal-react": { MsalProvider: ({ children }) => children, useMsal: () => ({ accounts: [], instance: {} }) },
  "@/components/auth/AuthenticationProgress": () => React.createElement("p", null, "Authenticating"),
  "@/lib/auth/entra-client": { pipelineAuthRequired: true, isEntraClientConfigured: true },
  "@/lib/auth/post-login-path": {}, "@/lib/auth/authenticated-fetch": {}, "@/lib/auth/browser-session": {},
  "@/lib/pipeline/base-path": {}, "@/lib/desktop/desktop-config": {}, "@/lib/offline/offline-assessment-store": {},
});
const Provider = providerModule.default;
const visible = React.createElement("main", null, "Useful work before JavaScript");
assert.match(renderToStaticMarkup(React.createElement(Provider, { initialUser: { id: "validated" } }, visible)), /Useful work before JavaScript/);
assert.equal(renderToStaticMarkup(React.createElement(Provider, {}, visible)), "<p>Authenticating</p>");

const Header = load("components/pipeline/PipelineHeader.tsx", {
  "next/link": ({ children, ...props }) => { delete props.prefetch; return React.createElement("a", props, children); },
  "next/navigation": { usePathname: () => "/", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ prefetch() {} }) },
  "@/components/pipeline/AssessorSessionControl": { ActiveAssessorSessionPill: () => null, AssessorSessionMenuAction: () => null },
  "@/components/pipeline/PipelineActionNav": ({ showReports }) => React.createElement("span", { "data-report-access": String(showReports) }),
  "@/components/pipeline/PipelineLogoMark": () => null,
  "@/components/pipeline/pipeline-shell-context": { usePipelineShell: () => ({ homeMode: "welcome", searchOpen: false }) },
  "@/lib/auth/authenticated-fetch": {}, "@/lib/auth/entra-client": {},
  "@/components/auth/PipelineAuthProvider": { usePipelineAuth: providerModule.usePipelineAuth },
  "@/lib/pipeline/client-navigation": { usePipelineLocationSearch: () => "" },
  "@/lib/pipeline/base-path": {},
  "@/lib/pipeline/report-access": { canAccessOperationsReports: (roles) => roles.includes("admin") },
  "@/lib/training/operator-guided-tour-state": {},
}).default;
for (const roles of [["viewer"], ["admin"]]) {
  const initialUser = { id: "effective-fixture", email: "fixture@pipeline.invalid", name: "Assessor Fixture", roles, accessScope: "pipeline" };
  const markup = renderToStaticMarkup(React.createElement(Provider, { initialUser }, React.createElement(Header)));
  assert.match(markup, /Open profile menu for Assessor Fixture/, "server-first entry must render the effective operator, never the owner's fallback name");
  assert.ok(markup.includes(`data-report-access="${roles.includes("admin")}"`), "seeded navigation must retain effective-role restrictions");
}

let briefingReads = 0;
let eligibleUser = { id: "effective-assessor" };
let briefingFails = false;
const HomePage = load("app/(pipeline)/page.tsx", {
  "@/lib/auth/server-entry": { getPipelineServerEntryUser: async () => eligibleUser },
  "@/lib/pipeline/home-briefing": { getHomeBriefing: async (user) => { assert.equal(user.id, "effective-assessor"); briefingReads += 1; if (briefingFails) throw new Error("unavailable"); return { fixture: true }; } },
  "@/components/pipeline/PipelineOverviewRoute": { default: () => null },
}).default;
const homeSeed = async (params) => (await HomePage({ searchParams: Promise.resolve(params) })).props.children.props.initialBriefing;
assert.equal((await homeSeed({})).fixture, true);
for (const params of [{ screen: "packet" }, { screen: "profiles" }, { view: "referrals" }]) assert.equal(await homeSeed(params), null);
assert.equal(briefingReads, 1);
eligibleUser = null; assert.equal(await homeSeed({}), null);
eligibleUser = { id: "effective-assessor" }; briefingFails = true;
assert.equal(await homeSeed({}), null, "source outages retain the normal client retry path");

const entrySeed = { fixture: "private-entry-only", viewer: { id: "effective-fixture", name: "Assessor Fixture" } };
const effectCalls = [];
const seededStates = [];
const seededSetters = [];
const updates = [];
const rootNavigationEvents = new Map();
let startupUser = null;
let finishUserRead;
const startupReads = [];
const rootStubs = {
  react: { useState: (initial) => {
    const value = typeof initial === "function" ? initial() : initial;
    const index = seededStates.push(value) - 1;
    const setter = (next) => updates.push({ index, next });
    seededSetters.push(setter);
    return [value, setter];
  }, useRef: (initial) => ({ current: initial }), useMemo: (read) => read(), useEffect: (run, deps) => effectCalls.push({ run, deps }) },
  "next/dynamic": () => () => null,
  "next/navigation": { useSearchParams: () => new URLSearchParams("view=referrals") },
  "@/components/pipeline/pipeline-shell-context": { usePipelineShell: () => ({ searchTerm: "", setSearchTerm() {}, setSearchOpen() {} }) },
  "@/lib/pipeline/client-navigation": { usePipelineLocationSearch: () => "view=referrals" },
  "@/components/auth/PipelineAuthProvider": { usePipelineAuth: () => ({ initialUser: startupUser }) },
  "@/lib/auth/authenticated-fetch": {
    fetchCurrentPipelineUser: () => new Promise((resolve) => { finishUserRead = resolve; }),
    fetchPipelineJson: async (path) => { startupReads.push(path); },
  },
  "@/components/pipeline/ClientProfileDirectory": { default: () => null, preloadCurrentClientDirectory: async () => { startupReads.push("current-clients"); } },
  "@/components/pipeline/referral-home-directory-model": { buildReferralParams: () => "kind=all" },
  "@/lib/pipeline/report-access": { canAccessOperationsReports: (roles) => roles.includes("admin") },
};
const Overview = load("components/pipeline/PipelineOverviewRoute.tsx", {}, {
  require: (id) => rootStubs[id] ?? (id.startsWith("@/") ? {} : require(id)),
  window: { addEventListener: (name, run) => rootNavigationEvents.set(name, run), removeEventListener: (name) => rootNavigationEvents.delete(name) },
}).default;
Overview({ initialBriefing: entrySeed });
const entrySetter = seededSetters[seededStates.indexOf(entrySeed)];
const entrySubscription = effectCalls.find(({ deps }) => deps?.length === 1 && deps[0] === entrySetter);
const stopEntrySubscription = entrySubscription.run();
rootNavigationEvents.get("pipeline:navigation")();
assert.ok(updates.some(({ index, next }) => seededStates[index] === entrySeed && next === null), "header/history departures must discard the SSR seed, not briefly restore old assignments or drafts on return");
updates.length = 0;
rootNavigationEvents.get("popstate")();
assert.ok(updates.some(({ index, next }) => seededStates[index] === entrySeed && next === null));
stopEntrySubscription();
assert.equal(rootNavigationEvents.size, 0);

for (const seeded of [true, false]) {
  effectCalls.length = 0; startupReads.length = 0;
  startupUser = seeded ? { id: "effective-fixture", roles: ["admin"] } : null;
  Overview({ initialBriefing: entrySeed });
  const startupEffect = effectCalls.find(({ deps }) => deps?.length === 1 && deps[0] === startupUser);
  const stopStartup = startupEffect.run();
  assert.equal(startupReads.length, seeded ? 2 : 0, "only a server-validated user may begin directory GETs before the live user read finishes");
  finishUserRead({ user: { id: "effective-fixture", roles: ["viewer"] } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(startupReads.length, 2, "live user refresh must not duplicate already-started seed warmups");
  stopStartup();
}
const completedSurfaces = { ClientProfileView: () => null, ReferralPacketCanvas: () => null };
const surfaceEffects = [];
const preparedHook = load("components/pipeline/PipelineOverviewRoute.tsx", {}, {
  expose: ["useDeferredWorkSurfaces"],
  require: (id) => id === "react" ? { useState: () => [completedSurfaces, () => assert.fail("completed chart preparation must not rerender every navigation")], useEffect: (run, deps) => surfaceEffects.push({ run, deps }) } : id.startsWith("@/") ? {} : require(id),
  window: {},
}).useDeferredWorkSurfaces;
for (const screen of ["home", "referrals", "calendar", "profiles"]) {
  assert.equal(preparedHook(screen), completedSurfaces);
  assert.equal(surfaceEffects.at(-1).run(), undefined, "prepared surfaces must schedule no imports, timers or state publication on subsequent navigation");
}

let respond = async () => Response.json({ fixture: true });
const browserCache = load("lib/auth/authenticated-fetch.ts", {
  "@/lib/auth/entra-client": { pipelineAuthRequired: false },
  "@/lib/auth/browser-session": { clearPipelineBrowserSessionCache() {} },
  "@/lib/auth/post-login-path": {}, "@/lib/pipeline/base-path": { toPipelinePath: (path) => path },
}, { fetch: (...args) => respond(...args), window: { setTimeout, clearTimeout } });
for (const endpoint of ["/api/assessments/fixture", "/api/assessments/fixture/sign", "/api/referrals/42", "/api/identity/candidates/fixture"]) {
  await browserCache.fetchPipelineJson("/api/profiles/old-identity", {}, { cacheTtlMs: 60_000 });
  await browserCache.fetchPipelineJson(endpoint, { method: "PATCH" });
  assert.equal(browserCache.readPipelineJsonCache("/api/profiles/old-identity"), undefined, "assessment identity repairs and real mutations must invalidate old projections");
}
await browserCache.fetchPipelineJson("/api/profiles/fixture", {}, { cacheTtlMs: 60_000 });
await browserCache.fetchPipelineJson("/api/profiles/fixture", {}, { cacheTtlMs: 60_000 });
assert.ok(browserCache.getPipelineReadCacheCounts().hit > 0);

let historyFinish;
let linksStarted = false;
let linksFail = false;
const clinical = { client: { canonical_client_id: "fixture", resident_numbers: ["1"], current_resident: true, resident_profile: { facility_id: "F", res_number: "1" } } };
const unified = load("lib/pipeline/unified-profile.ts", {
  "./workspace-presentation": { isImportedWorkspace: () => false },
  "./historical-profile-store": {},
  "@/lib/assessment/assessment-store": { getAssessmentStoreReadiness: () => ({ ready: false }) },
  "@/lib/assessment/assessment-tool-schema": {},
  "@/lib/clinical/clinical-data": { getClinicalClient: async () => clinical, getClinicalResident: async () => ({ resident: { canonical_client_id: "fixture", resident_key: "F:1", resident_number: "1", date_of_birth: null } }) },
  "@/lib/observability/api-logging": { logApi() {} }, "@/lib/observability/pipeline-metrics": { recordPipelineMetric() {} },
  "./client-history-store": { getClientHistoryForResident: () => new Promise((resolve) => { historyFinish = resolve; }) },
  "./client-identity-presentation.mjs": {}, "./community-config": {}, "./referral-clinical-reconciliation": {},
  "./referral-store": { getReferralStoreReadiness: () => ({ ready: false }) },
  "./resident-link-store": { getResidentLinkStoreReadiness: () => ({ ready: true }), listResidentLinks: async () => { linksStarted = true; if (linksFail) throw new Error("fixture-failure"); return { links: [] }; } },
  "./referral-access": { isAssessorUser: () => false },
}, { crypto: { randomUUID: () => "fixture-request" } });
for (const fail of [false, true]) {
  linksStarted = false; linksFail = fail;
  const pending = unified.getUnifiedClientProfile(new Request("https://pipeline.invalid"), "fixture", {}, { id: "supervisor" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(linksStarted, true, "links must start while history is still pending");
  historyFinish({ fixture: "same-history" });
  const profile = await pending;
  assert.equal(profile.client.canonical_client_id, "fixture");
  assert.equal(profile.history.fixture, "same-history");
  if (fail) assert.equal(profile.pipeline.connection.status, "unavailable", "link failure must remain a partial operational failure, not lose the chart");
}

const timers = new Map();
const warmed = [];
let nextTimer = 0;
const connection = { saveData: false, effectiveType: "4g" };
const documentState = { visibilityState: "visible" };
const navigation = load("lib/pipeline/client-navigation.ts", {
  "@/lib/observability/browser-performance": { beginPipelineNavigation() {} }, react: {},
  "@/lib/pipeline/base-path": {}, "@/lib/pipeline/workspace-presentation": {},
  "@/lib/auth/authenticated-fetch": { fetchPipelineJson: async (path) => { warmed.push(path); return {}; } },
}, { navigator: { connection }, document: documentState,
  setTimeout: (run) => { timers.set(++nextTimer, run); return nextTimer; }, clearTimeout: (id) => timers.delete(id) });
const flushTimers = async () => { const runs = [...timers.values()]; timers.clear(); runs.forEach((run) => run()); await Promise.resolve(); };
connection.saveData = true; navigation.prefetchPipelineWorkspace(42); await flushTimers(); assert.equal(warmed.length, 0);
connection.saveData = false; connection.effectiveType = "2g"; navigation.prefetchPipelineProfile("fixture"); await flushTimers(); assert.equal(warmed.length, 0);
connection.effectiveType = "4g"; documentState.visibilityState = "hidden"; navigation.prefetchPipelineWorkspace(42); await flushTimers(); assert.equal(warmed.length, 0);
documentState.visibilityState = "visible"; navigation.prefetchPipelineWorkspace(42); await flushTimers();
assert.deepEqual(warmed, ["/api/referrals/42/canvas"], "Home's numeric next-workspace intent must not invent a profile identity, download documents or write clinical data");

const events = new Map();
const sent = [];
let now = 200;
let readySurface = "home";
let interval;
let nextFrame = 0;
const frames = new Map();
const cacheCounts = { hit: 0, join: 0, miss: 0 };
const telemetryWindow = {
  location: { origin: "https://pipeline.invalid", href: "https://pipeline.invalid/?clientId=must-not-log" },
  addEventListener: (name, run) => events.set(name, run), removeEventListener: (name) => events.delete(name),
  setInterval: (run) => { interval = run; return 1; }, clearInterval() {},
};
const timingCallbacks = [];
class TimingObserver { constructor(run) { timingCallbacks.push(run); } observe() {} disconnect() {} }
class DomObserver { observe() {} disconnect() {} }
const createTelemetry = () => load("lib/observability/browser-performance.ts", {
  "@/lib/auth/authenticated-fetch": { getPipelineReadCacheCounts: () => ({ ...cacheCounts }) },
  "@/lib/pipeline/base-path": { fromPipelinePath: (path) => path, toPipelinePath: (path) => path },
  "./browser-performance-contract": schema,
}, {
  process: { env: { NODE_ENV: "production" } }, Math: Object.assign(Object.create(Math), { random: () => 0 }),
  window: telemetryWindow, document: { body: {}, querySelector: (selector) => selector === `[data-performance-ready="${readySurface}"]` ? {} : null },
  performance: { now: () => now }, PerformanceObserver: TimingObserver, MutationObserver: DomObserver,
  requestAnimationFrame: (run) => { frames.set(++nextFrame, run); return nextFrame; }, cancelAnimationFrame: (id) => frames.delete(id),
  fetch: async (_path, options) => { sent.push(JSON.parse(options.body)); throw new Error("analytics-network-failure"); },
});
const telemetry = createTelemetry();
const paint = () => { const runs = [...frames.values()]; frames.clear(); runs.forEach((run) => run()); };
const stopTelemetry = telemetry.observePipelineBrowserPerformance();
paint(); cacheCounts.hit = 2; cacheCounts.miss = 1; interval();
await Promise.resolve();
assert.equal(sent[0][0].metric, "surface_ready");
assert.equal(sent[0][0].value, 200);
assert.equal(sent[0].find((entry) => entry.metric === "cache_hit").surface, "other", "interval counters must not pretend to be per-surface hit rates");
assert.equal(JSON.stringify(sent).includes("must-not-log"), false);
for (let i = 0; i < 8; i += 1) {
  now += 100; telemetry.beginPipelineNavigation("/?screen=calendar&referralId=must-not-log");
  readySurface = "calendar"; events.get("pipeline:navigation")(); paint(); interval();
}
assert.equal(sent.length, 5, "telemetry must be capped per document, even after more navigations");
stopTelemetry();
assert.equal(events.size, 0);
for (const path of ["/training/demo?view=tester", "/?screen=packet&demo=1", "/?screen=packet&trainingAssessment=guided", "/?screen=packet&trainingIntake=1"]) {
  telemetryWindow.location.href = new URL(path, telemetryWindow.location.origin).href;
  readySurface = "packet";
  const quietTelemetry = createTelemetry();
  const stop = quietTelemetry.observePipelineBrowserPerformance();
  timingCallbacks.slice(-2).forEach((run) => run({ getEntries: () => [{ startTime: 200, duration: 60, name: "must-not-log" }] }));
  paint(); cacheCounts.hit += 1; interval(); events.get("pagehide")();
  assert.equal(sent.length, 5, "unsupported and read-only practice surfaces must make zero analytics writes");
  stop();
}

console.log(JSON.stringify({ ok: true, scope: "private SSR/proxy isolation, effective identity, pre-JS auth gate, shared Home projection/outages, strict PHI-free telemetry, mutation freshness, parallel profile failure parity and constrained prefetch" }));

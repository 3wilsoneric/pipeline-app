import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { authenticatedPrincipal, childEnvironment, createSessionManager, createWorkshopGateway, startStandaloneSession, workshopConfig } from "./workshop-gateway.mjs";

const tenant = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const alice = "11111111-2222-3333-4444-555555555555";
const bob = "99999999-2222-3333-4444-555555555555";
const config = { origin: "https://workshop.example", host: "workshop.example", tenant, maxSessions: 6, idleMs: 60_000 };
const identity = (id = alice, tid = tenant) => ({
  "x-ms-client-principal-id": id, "x-ms-client-principal-idp": "aad",
  "x-ms-client-principal": Buffer.from(JSON.stringify({ auth_typ: "aad", claims: [{ typ: "tid", val: tid }, { typ: "oid", val: id }, { typ: "roles", val: "Pipeline.Reviewer" }] })).toString("base64"),
});
const context = (principal = "alice", run = null, overrides = {}) => ({ principal, cookies: new Map(run ? [["__Host-workshop-run", run]] : []), navigation: !run, reset: false, mutating: false, pageRun: run, ...overrides });
async function listen(server) {
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((accept) => server.close(accept));
}
async function send(port, path = "/", { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((accept, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers: { host: config.host, accept: "text/html", ...identity(), ...headers } }, (res) => {
      let content = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { content += chunk; });
      res.on("end", () => accept({ status: res.statusCode, headers: res.headers, body: content }));
    });
    req.setTimeout(5000, () => req.destroy(new Error(`Timed out ${method} ${path}`)));
    req.on("error", reject);
    req.end(body);
  });
}
function jar(response) { return (response.headers["set-cookie"] || []).map((item) => item.split(";")[0]).join("; "); }
function pageRun(cookie) { return cookie.split("; ").find((item) => item.startsWith("__Host-workshop-page-run="))?.split("=")[1]; }

test("gateway configuration requires HTTPS, dedicated root, tenant, bounded resource settings", () => {
  const env = { WORKSHOP_PUBLIC_ORIGIN: config.origin, WORKSHOP_TENANT_ID: tenant };
  assert.equal(workshopConfig(env).maxSessions, 6);
  for (const invalid of [
    { WORKSHOP_PUBLIC_ORIGIN: "http://workshop.example" }, { WORKSHOP_PUBLIC_ORIGIN: `${config.origin}/` },
    { WORKSHOP_TENANT_ID: "bad" }, { WORKSHOP_DATA_ROOT: "/app/.data/live" },
    { WORKSHOP_DATA_ROOT: "/app/.data/persona-demo/../live" }, { WORKSHOP_MAX_SESSIONS: "100" },
  ]) assert.throws(() => workshopConfig({ ...env, ...invalid }));
});

test("EasyAuth identity is fail-closed for missing, malformed, mismatched and wrong-tenant claims", () => {
  const principal = authenticatedPrincipal(identity(), tenant);
  assert.match(principal, /^[a-f0-9]{64}$/);
  assert.notEqual(principal, authenticatedPrincipal(identity(bob), tenant));
  for (const headers of [
    {}, { ...identity(), "x-ms-client-principal-idp": "google" },
    { ...identity(), "x-ms-client-principal": "not-json" },
    { ...identity(), "x-ms-client-principal-id": bob }, identity(alice, bob),
    { ...identity(), "x-ms-client-principal": "x".repeat(32_769) },
  ]) assert.throws(() => authenticatedPrincipal(headers, tenant));
});

test("workshop accepts canonical Pipeline role claims, never note-lab-only or unassigned accounts", async () => {
  const source = await readFile(new URL("../lib/auth/pipeline-auth.ts", import.meta.url), "utf8");
  const roleMapping = source.slice(source.indexOf("function mapClaimRoles("), source.indexOf("function normalizeClaimRole("));
  const canonicalRoles = [...roleMapping.matchAll(/normalized === "([a-z]+)"/g)].map((match) => match[1]);
  assert.ok(canonicalRoles.length >= 4);
  for (const role of [...canonicalRoles, "Pipeline.Admin", "Pipeline.AssessmentCoordinator", "Pipeline.Reviewer", "Pipeline.Viewer", "Pipeline.NoteLabReviewer", "authenticated", "", "pipeline!admin"]) {
    const headers = identity();
    const principal = JSON.parse(Buffer.from(headers["x-ms-client-principal"], "base64").toString());
    principal.claims[2] = { typ: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role", val: role };
    headers["x-ms-client-principal"] = Buffer.from(JSON.stringify(principal)).toString("base64");
    if (["Pipeline.NoteLabReviewer", "authenticated", "", "pipeline!admin"].includes(role)) assert.throws(() => authenticatedPrincipal(headers, tenant), { status: 403 });
    else assert.match(authenticatedPrincipal(headers, tenant), /^[a-f0-9]{64}$/);
  }
});

test("page marker stays bound to original document after another tab updates shared cookies", async () => {
  const { default: ts } = await import("typescript");
  const source = await readFile(new URL("../lib/auth/browser-session.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const document = { cookie: "__Host-workshop-page-run=first-run" };
  const exports = {};
  runInNewContext(compiled, { exports, require: () => ({}), document });
  assert.equal(exports.readPageWorkshopRun(), "first-run");
  document.cookie = "__Host-workshop-page-run=another-person-or-new-run";
  exports.clearPipelineBrowserSessionCache();
  assert.equal(exports.readPageWorkshopRun(), "first-run");
  exports.acceptWorkshopResetResponse(new Response(null, { headers: { "x-workshop-page-run": "caller-reset-run", "x-workshop-replaced-run": "first-run" } }));
  assert.equal(exports.readPageWorkshopRun(), "caller-reset-run");
  exports.acceptWorkshopResetResponse(new Response(null, { headers: { "x-workshop-page-run": "stale-response", "x-workshop-replaced-run": "first-run" } }));
  assert.equal(exports.readPageWorkshopRun(), "caller-reset-run");
});

test("child env uses existing loopback safeguards and strips secrets, identity and live integrations", () => {
  const root = "/app/.data/persona-demo-workshop/test";
  const env = childEnvironment(root, 3210, {
    PATH: "/usr/bin", AZURE_CLIENT_SECRET: "secret", DATABASE_URL: "postgres://live", IDENTITY_ENDPOINT: "secret",
    ENTRA_CLIENT_SECRET: "secret", PIPELINE_GRAPH_TOKEN: "secret", NODE_OPTIONS: "--require bad.cjs", HOME: "/live", TMPDIR: "/live",
  });
  assert.equal(env.PIPELINE_PERSONA_DEMO_ORIGIN, "http://127.0.0.1:3210");
  assert.equal(env.PIPELINE_PERSONA_DEMO_ROOT, root);
  assert.equal(env.PIPELINE_REFERRAL_STORE_PATH, `${root}/referrals.json`);
  assert.equal(env.PIPELINE_LOCAL_DOCUMENT_ROOT, `${root}/documents`);
  assert.equal(env.PIPELINE_CLINICAL_DATA_MODE, "disconnected");
  assert.equal(env.PIPELINE_CLIENT_HISTORY_MODE, "disconnected");
  assert.equal(env.HOME, root);
  assert.equal(env.TMPDIR, `${root}/tmp`);
  for (const key of ["AZURE_CLIENT_SECRET", "DATABASE_URL", "IDENTITY_ENDPOINT", "ENTRA_CLIENT_SECRET", "PIPELINE_GRAPH_TOKEN"]) assert.equal(env[key], undefined);
  assert.equal(env.NODE_OPTIONS, "--max-old-space-size=384");
});

test("one process per principal; simultaneous initial navigation shares startup; capacity does not evict", async () => {
  let starts = 0;
  const manager = createSessionManager({ ...config, maxSessions: 1 }, async () => { starts++; return { port: 3210, alive: () => true, stop: async () => {} }; });
  try {
    const firstPromise = manager.acquire(context());
    const secondPromise = manager.acquire(context());
    const first = await firstPromise;
    const second = await secondPromise;
    assert.equal(starts, 1);
    assert.equal(first.run, second.run);
    await assert.rejects(manager.acquire(context("bob")), { status: 503 });
    first.release(); second.release();
    const resumed = await manager.acquire(context("alice", first.run));
    assert.equal(resumed.fresh, false);
    resumed.release();
  } finally { await manager.close(); }
});

test("reset only locks its owner's idle session and cannot overlap in-flight writes", async () => {
  const manager = createSessionManager(config, async () => ({ port: 3210, alive: () => true, stop: async () => {} }));
  try {
    const first = await manager.acquire(context()); first.release();
    const a = await manager.acquire(context("alice", first.run, { mutating: true }));
    const b = await manager.acquire(context("bob"));
    b.release();
    await assert.rejects(manager.acquire(context("alice", a.run, { reset: true, mutating: true })), { status: 409 });
    a.release();
    const reading = await manager.acquire(context("alice", a.run));
    const reset = await manager.acquire(context("alice", a.run, { reset: true, mutating: true }));
    await assert.rejects(manager.acquire(context("alice", a.run, { mutating: true })), { status: 409 });
    const other = await manager.acquire(context("bob", b.run));
    assert.notEqual(other.run, reset.run);
    other.release(); reset.release(); reading.release();
  } finally { await manager.close(); }
});

test("idle expiry waits for active requests; old browser mutations cannot restart or hit a fresh run", async () => {
  let clock = 0;
  let stopped = 0;
  const manager = createSessionManager(config, async () => ({ port: 3210, alive: () => true, stop: async () => { stopped++; } }), () => clock);
  try {
    const first = await manager.acquire(context());
    clock = config.idleMs + 1;
    await manager.sweep();
    assert.equal(stopped, 0);
    first.release();
    clock += config.idleMs + 1;
    await manager.sweep();
    assert.equal(stopped, 1);
    await assert.rejects(manager.acquire(context("alice", first.run)), { status: 409 });
    const fresh = await manager.acquire(context());
    assert.notEqual(fresh.run, first.run);
    fresh.release();
    await assert.rejects(manager.acquire(context("alice", first.run)), { status: 409 });
    // Cookies update in all tabs; the page header from the old tab does not.
    await assert.rejects(manager.acquire(context("alice", fresh.run, { mutating: true, pageRun: first.run })), { status: 409 });
    await assert.rejects(manager.acquire(context("alice", fresh.run, { mutating: true, pageRun: undefined })), { status: 409 });
  } finally { await manager.close(); }
});

test("failed or crashed child gives recoverable error instead of routing to another user's runtime", async () => {
  const broken = createSessionManager(config, async () => { throw new Error("startup failure"); });
  await assert.rejects(broken.acquire(context()), { status: 503 });
  await broken.close();
  let alive = true;
  const manager = createSessionManager(config, async () => ({ port: 3210, alive: () => alive, stop: async () => {} }));
  const session = await manager.acquire(context()); session.release(); alive = false;
  await assert.rejects(manager.acquire(context("alice", session.run)), { status: 409 });
  await manager.close();
});

test("HTTP gate validates auth/host/origin before starting a child; external entry links still work", async () => {
  let starts = 0;
  const upstream = createServer((_req, res) => res.end("ok"));
  const upstreamPort = await listen(upstream);
  const manager = createSessionManager(config, async () => { starts++; return { port: upstreamPort, alive: () => true, stop: async () => {} }; });
  const { server } = createWorkshopGateway(config, manager);
  const port = await listen(server);
  try {
    const attempts = [
      [{ headers: { "x-ms-client-principal-id": "" } }, 401],
      [{ headers: { host: "live.example" } }, 421],
      [{ method: "POST", headers: { origin: "https://evil.example" } }, 403],
      [{ method: "POST" }, 403],
      [{ method: "POST", headers: { origin: config.origin, "sec-fetch-site": "cross-site" } }, 403],
      [{ headers: { cookie: "x=1; x=2" } }, 400],
      [{ method: "POST", headers: { origin: config.origin, "content-length": String(102 * 1024 * 1024) } }, 413],
    ];
    for (const [options, status] of attempts) assert.equal((await send(port, "/", options)).status, status, JSON.stringify(options));
    assert.equal(starts, 0);
    const opened = await send(port, "/", { headers: { "sec-fetch-site": "cross-site" } });
    assert.equal(opened.status, 200);
    assert.equal(starts, 1);
    assert.equal(opened.headers["clear-site-data"], '"storage"');
    assert.ok(opened.headers["set-cookie"].filter((value) => !value.startsWith("__Host-workshop-page-run=")).every((value) => value.includes("Secure; HttpOnly; SameSite=Strict")));
  } finally { await close(server); await manager.close(); await close(upstream); }
});

test("proxy strips identity/token/live cookies, preserves application headers, streams upload, and rewrites persona/redirect", async () => {
  let observed;
  let upstreamPort;
  const upstream = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      observed = { headers: req.headers, body };
      if (req.url === "/switch") res.setHeader("set-cookie", [`pipeline_practice_persona_${upstreamPort}=assessor; Path=/; HttpOnly`, "unrelated=secret"]);
      if (req.url === "/redirect") { res.statusCode = 307; res.setHeader("location", `http://127.0.0.1:${upstreamPort}/training/demo`); }
      if (req.url === "/external") { res.statusCode = 307; res.setHeader("location", "https://evil.example"); }
      res.end("ok");
    });
  });
  upstreamPort = await listen(upstream);
  const manager = createSessionManager(config, async () => ({ port: upstreamPort, alive: () => true, stop: async () => {} }));
  const { server } = createWorkshopGateway(config, manager);
  const port = await listen(server);
  try {
    const opened = await send(port);
    let cookie = jar(opened);
    const body = "--boundary\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nsynthetic packet\r\n--boundary--";
    const response = await send(port, "/api/uploads/local", { method: "POST", body, headers: {
      origin: config.origin, cookie: `${cookie}; AppServiceAuthSession=secret; pipeline_session=live-secret`, authorization: "Bearer secret", "x-workshop-page-run": pageRun(cookie),
      "x-ms-token-aad-access-token": "secret", "x-forwarded-host": "evil.example", "x-forwarded-for": "1.2.3.4",
      "content-type": "multipart/form-data; boundary=boundary", "x-pipeline-persona": "supervisor", "idempotency-key": "mutation-one", rsc: "1",
    } });
    assert.equal(response.status, 200);
    assert.equal(observed.body, body);
    assert.equal(observed.headers.host, `127.0.0.1:${upstreamPort}`);
    assert.equal(observed.headers.origin, `http://127.0.0.1:${upstreamPort}`);
    assert.equal(observed.headers.cookie, `pipeline_practice_persona_${upstreamPort}=supervisor`);
    assert.equal(observed.headers["idempotency-key"], "mutation-one");
    assert.equal(observed.headers.rsc, "1");
    for (const name of ["authorization", "x-ms-client-principal", "x-ms-client-principal-id", "x-ms-token-aad-access-token", "x-forwarded-host", "x-forwarded-for"]) assert.equal(observed.headers[name], undefined);
    const switched = await send(port, "/switch", { method: "POST", headers: { origin: config.origin, cookie, "x-workshop-page-run": pageRun(cookie) } });
    assert.equal(switched.headers["set-cookie"].length, 1);
    cookie = `${cookie.split("; ")[0]}; ${jar(switched)}`;
    await send(port, "/", { headers: { cookie } });
    assert.equal(observed.headers.cookie, `pipeline_practice_persona_${upstreamPort}=assessor`);
    const redirected = await send(port, "/redirect", { headers: { cookie } });
    assert.equal(redirected.status, 307);
    assert.equal(redirected.headers.location, `${config.origin}/training/demo`);
    assert.equal((await send(port, "/external", { headers: { cookie } })).status, 502);
  } finally { await close(server); await manager.close(); await close(upstream); }
});

test("two real subprocesses use separate cwd/data; one user's reset leaves the other intact", async () => {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), "workshop-gateway-")));
  const build = resolve(directory, "build");
  const root = resolve(directory, ".data/persona-demo-workshop");
  await mkdir(resolve(build, ".next"), { recursive: true });
  // A tiny standalone-shaped server exercises process/cwd/proxy boundaries;
  // the deployment owner additionally smoke-tests the actual Next build.
  await writeFile(resolve(build, "server.js"), `
    const { createServer } = require('node:http');
    const { writeFileSync, readFileSync, rmSync } = require('node:fs');
    process.chdir(__dirname);
    createServer((req, res) => {
      if (req.url === '/api/health/live') return res.end('ok');
      if (req.url === '/write') writeFileSync('answer.txt', 'saved ' + process.pid);
      if (req.url === '/api/demo/journey?reset=1') rmSync('answer.txt', {force:true});
      let value = ''; try { value = readFileSync('answer.txt', 'utf8'); } catch {}
      res.end(JSON.stringify({value, cwd:process.cwd(), pid:process.pid, root:process.env.PIPELINE_PERSONA_DEMO_ROOT}));
    }).listen(Number(process.env.PORT), process.env.HOSTNAME);
  `);
  const manager = createSessionManager({ ...config, root, serverEntry: resolve(build, "server.js") }, startStandaloneSession);
  const { server } = createWorkshopGateway(config, manager);
  const port = await listen(server);
  try {
    const first = await send(port);
    const second = await send(port, "/", { headers: identity(bob) });
    assert.equal(first.status, 200, first.body);
    assert.equal(second.status, 200, second.body);
    const a = { cookie: jar(first), origin: config.origin, "x-workshop-page-run": pageRun(jar(first)) };
    const b = { ...identity(bob), cookie: jar(second), origin: config.origin, "x-workshop-page-run": pageRun(jar(second)) };
    const aState = JSON.parse(first.body);
    const bState = JSON.parse(second.body);
    assert.notEqual(aState.pid, bState.pid);
    assert.notEqual(aState.cwd, bState.cwd);
    assert.equal(aState.cwd, aState.root);
    assert.equal(bState.cwd, bState.root);
    await send(port, "/write", { method: "POST", headers: a });
    await send(port, "/write", { method: "POST", headers: b });
    assert.match(await readFile(resolve(aState.cwd, "answer.txt"), "utf8"), /^saved /);
    const reset = await send(port, "/api/demo/journey?reset=1", { method: "POST", headers: a });
    const renewed = { ...a, cookie: jar(reset), "x-workshop-page-run": reset.headers["x-workshop-page-run"] };
    assert.notEqual(renewed["x-workshop-page-run"], a["x-workshop-page-run"]);
    assert.equal(reset.headers["x-workshop-replaced-run"], a["x-workshop-page-run"]);
    assert.equal(JSON.parse((await send(port, "/", { headers: renewed })).body).value, "");
    assert.equal((await send(port, "/write", { method: "POST", headers: { ...renewed, "x-workshop-page-run": a["x-workshop-page-run"] } })).status, 409);
    assert.match(JSON.parse((await send(port, "/", { headers: b })).body).value, /^saved /);
    // A copied cookie cannot select a different authenticated person's process.
    assert.equal((await send(port, "/write", { method: "POST", headers: { ...b, cookie: a.cookie } })).status, 409);
    assert.equal((await send(port, "/write", { method: "POST", headers: { ...b, "x-workshop-page-run": a["x-workshop-page-run"] } })).status, 409);
  } finally {
    await close(server); await manager.close();
    assert.deepEqual(await readdir(root), []);
    await rm(directory, { recursive: true, force: true });
  }
});

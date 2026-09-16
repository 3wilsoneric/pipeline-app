import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, realpath, rm, symlink } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { assertPersonaDemoIsolation, personaDemoRequiredEnvironment, personaDemoStoreFiles } from "../shared/persona-demo-config.mjs";

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const runCookie = "__Host-workshop-run";
const roleCookie = "__Host-workshop-persona";
const pageCookie = "__Host-workshop-page-run";
const fullAccessRoles = new Set([
  "admin", "pipelineadmin", "alamoadmissionsadmin", "assessmentcoordinator", "pipelineassessmentcoordinator",
  "alamoadmissionssupervisor", "reviewer", "pipelinereviewer", "assessor", "pipelineassessor", "alamoadmissionsassessor", "viewer", "pipelineviewer",
]);
const maximumBodyBytes = 101 * 1024 * 1024;
const forwardedHeaders = new Set([
  "accept", "accept-language", "content-type", "content-length", "range", "if-range",
  "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch",
  "next-url", "next-action", "x-nextjs-data", "x-deployment-id", "x-pipeline-persona", "x-request-id", "idempotency-key",
]);
// Header names come from these constants, never from a peer-controlled object.
// Cookies, redirects, cache policy and generation markers are owned below.
const forwardedResponseHeaders = new Set([
  "content-type", "content-length", "content-encoding", "content-disposition", "content-range", "accept-ranges",
  "etag", "last-modified", "vary", "link", "content-security-policy", "x-frame-options", "referrer-policy",
  "permissions-policy", "strict-transport-security", "x-request-id", "server-timing", "pragma", "retry-after",
  "x-nextjs-cache", "x-nextjs-prerender", "x-nextjs-stale-time", "x-nextjs-postponed", "x-deployment-id",
  "x-action-revalidated", "x-action-redirect",
]);

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function publicOrigin(value) {
  const origin = new URL(value || "https://invalid.example");
  if (origin.protocol !== "https:" || origin.origin !== value || origin.hostname === "invalid.example") {
    throw new Error("WORKSHOP_PUBLIC_ORIGIN must be the exact HTTPS origin of the authenticated workshop.");
  }
  return origin;
}

function validatePaths(root, serverEntry) {
  if (!isAbsolute(root) || !root.includes("/.data/persona-demo") || resolve(root) !== root || !isAbsolute(serverEntry)) {
    throw new Error("Workshop storage and standalone entry must be dedicated absolute paths.");
  }
}

export function workshopConfig(env = process.env) {
  const origin = publicOrigin(env.WORKSHOP_PUBLIC_ORIGIN);
  if (!guid.test(env.WORKSHOP_TENANT_ID || "")) throw new Error("WORKSHOP_TENANT_ID is required.");
  const root = env.WORKSHOP_DATA_ROOT || "/app/.data/persona-demo-workshop";
  const serverEntry = env.WORKSHOP_SERVER_ENTRY || "/app/server.js";
  validatePaths(root, serverEntry);
  const integer = (name, fallback, minimum, maximum) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}.`);
    return value;
  };
  return {
    origin: origin.origin, host: origin.host, tenant: env.WORKSHOP_TENANT_ID.toLowerCase(), root, serverEntry,
    port: integer("PORT", 3000, 1024, 65535), healthPort: integer("WORKSHOP_HEALTH_PORT", 3001, 1024, 65535),
    maxSessions: integer("WORKSHOP_MAX_SESSIONS", 6, 1, 12),
    idleMs: integer("WORKSHOP_IDLE_MINUTES", 120, 5, 480) * 60_000,
  };
}

// Only deploy behind required Azure EasyAuth, which removes client-supplied
// identity headers. This validation is not a replacement for that public edge.
function decodePrincipal(headers) {
  const id = headers["x-ms-client-principal-id"];
  const encoded = headers["x-ms-client-principal"];
  if (headers["x-ms-client-principal-idp"] !== "aad" || !guid.test(id || "") || typeof encoded !== "string" || encoded.length > 32_768) {
    throw failure(401, "Sign in with your work account.");
  }
  let principal;
  try { principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch {
    throw failure(401, "The signed-in identity could not be verified.");
  }
  return { principal, id };
}

export function authenticatedPrincipal(headers, tenant) {
  const { principal, id } = decodePrincipal(headers);
  const claim = (names) => (Array.isArray(principal?.claims) ? principal.claims : [])
    .filter((item) => names.includes(item?.typ)).map((item) => String(item.val).toLowerCase());
  const tenants = claim(["tid", "http://schemas.microsoft.com/identity/claims/tenantid"]);
  const objects = claim(["oid", "http://schemas.microsoft.com/identity/claims/objectidentifier"]);
  if (principal?.auth_typ !== "aad" || !tenants.length || tenants.some((value) => value !== tenant)
    || !objects.length || objects.some((value) => value !== id.toLowerCase())) {
    throw failure(403, "This account is not authorized for this workshop.");
  }
  const roles = claim(["roles", "role", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"]);
  if (!roles.some((role) => fullAccessRoles.has(role.trim().replace(/[._\s-]/g, "")))) {
    throw failure(403, "This account does not have Pipeline access.");
  }
  return createHash("sha256").update(`${tenant}:${id.toLowerCase()}`).digest("hex");
}

function cookies(headers) {
  const result = new Map();
  for (const item of (headers.cookie || "").split(";")) {
    const index = item.indexOf("=");
    if (index > 0) {
      const name = item.slice(0, index).trim();
      if (result.has(name)) throw failure(400, "Duplicate session cookie.");
      result.set(name, item.slice(index + 1).trim());
    }
  }
  return result;
}

function secureCookie(name, value) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

function validatedRequestUrl(req, config) {
  if (req.headers.host !== config.host) throw failure(421, "Use the workshop address.");
  if (!req.url?.startsWith("/") || req.url.startsWith("//") || /[\\\r\n]/.test(req.url)) throw failure(400, "Invalid request path.");
  const url = new URL(req.url, config.origin);
  if (/%(?:2f|5c|2e|00)/i.test(url.pathname)) throw failure(400, "Invalid request path.");
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(req.method)) throw failure(405, "Method not allowed.");
  return url;
}

function validateMutationOrigin(req, config, mutating) {
  if ((mutating && req.headers["sec-fetch-site"] === "cross-site") || (req.headers.origin && req.headers.origin !== config.origin)
    || (mutating && req.headers.origin !== config.origin)) {
    throw failure(403, "Make changes from the workshop page.");
  }
}

function validateDeclaredBody(req) {
  if (req.headers["content-length"] && (!/^\d+$/.test(req.headers["content-length"]) || Number(req.headers["content-length"]) > maximumBodyBytes)) {
    throw failure(413, "The upload is too large.");
  }
}

function requestContext(req, config) {
  const url = validatedRequestUrl(req, config);
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  validateMutationOrigin(req, config, mutating);
  validateDeclaredBody(req);
  return {
    principal: authenticatedPrincipal(req.headers, config.tenant), cookies: cookies(req.headers),
    mutating, pageRun: req.headers["x-workshop-page-run"],
    navigation: req.method === "GET" && String(req.headers.accept || "").includes("text/html") && !req.headers.rsc && !url.pathname.startsWith("/api/"),
    reset: mutating && url.pathname === "/api/demo/journey" && url.searchParams.get("reset") === "1",
  };
}

export function childEnvironment(root, port, parent = process.env) {
  const origin = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(["PATH", "LANG"].flatMap((key) => parent[key] ? [[key, parent[key]]] : []));
  Object.assign(env, personaDemoRequiredEnvironment, {
    NODE_ENV: "production", NODE_OPTIONS: "--max-old-space-size=384", NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1", PORT: String(port), HOME: root, TMPDIR: resolve(root, "tmp"),
    PIPELINE_PERSONA_DEMO: "true", PIPELINE_PERSONA_DEMO_ROOT: root, PIPELINE_PERSONA_DEMO_ORIGIN: origin,
    PIPELINE_ALLOW_PRODUCTION_MOCK_AUTH: "true", PIPELINE_ALLOWED_MUTATION_ORIGINS: origin,
    PIPELINE_ALLOWED_EMAILS: "supervisor@pipeline.example,assessor@pipeline.example",
    PIPELINE_ALLOW_LOCAL_REFERRAL_STORE: "true", PIPELINE_ALLOW_LOCAL_RESIDENT_LINK_STORE: "true",
    PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE: "true", PIPELINE_DESKTOP_STATE_ENABLED: "true",
    NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED: "false", PIPELINE_ALLOW_LOCAL_NOTE_LAB_STORE: "true",
    PIPELINE_NOTE_LAB_ENABLED: "true", PIPELINE_ENABLE_SYNTHETIC_PROFILES: "false", PIPELINE_CLINICAL_DATA_REQUIRED: "false",
  });
  for (const [key, filename] of Object.entries(personaDemoStoreFiles)) env[key] = resolve(root, filename);
  assertPersonaDemoIsolation(env);
  return env;
}

async function privateRunDirectory(config, run) {
  await mkdir(config.root, { recursive: true, mode: 0o700 });
  if ((await lstat(config.root)).isSymbolicLink() || await realpath(config.root) !== config.root) throw new Error("Workshop root must not be a symlink.");
  const root = resolve(config.root, run);
  await mkdir(root, { mode: 0o700 });
  await mkdir(resolve(root, "tmp"), { mode: 0o700 });
  await copyFile(config.serverEntry, resolve(root, "server.js"));
  const build = dirname(config.serverEntry);
  for (const name of ["node_modules", "public", "database"]) {
    const source = resolve(build, name);
    if (await lstat(source).catch((error) => { if (error.code !== "ENOENT") throw error; return null; })) {
      await symlink(source, resolve(root, name), "dir");
    }
  }
  await mkdir(resolve(root, ".next"));
  await mkdir(resolve(root, ".next/cache"));
  for (const name of await readdir(resolve(build, ".next"))) {
    if (name !== "cache") await symlink(resolve(build, ".next", name), resolve(root, ".next", name));
  }
  return root;
}

async function availablePort() {
  const probe = createPortProbe();
  await new Promise((accept, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", accept); });
  const port = probe.address().port;
  await new Promise((accept) => probe.close(accept));
  return port;
}

export async function startStandaloneSession(config, run) {
  const root = await privateRunDirectory(config, run);
  const port = await availablePort();
  const child = spawn(process.execPath, [resolve(root, "server.js")], { cwd: root, env: childEnvironment(root, port), stdio: "ignore" });
  let exited = false;
  child.once("error", () => { exited = true; });
  const closed = new Promise((accept) => child.once("close", () => { exited = true; accept(); }));
  let stopping;
  const stop = () => stopping ??= (async () => {
    if (!exited) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      await closed;
      clearTimeout(timer);
    }
    await rm(root, { recursive: true, force: true });
  })();
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health/live`, { signal: AbortSignal.timeout(1_000), redirect: "error" });
        await response.body?.cancel();
        if (response.ok) return { port, stop, alive: () => !exited };
      } catch { /* A new standalone process takes a moment to bind its port. */ }
      await delay(100);
    }
    throw new Error("Workshop process did not become ready.");
  } catch (error) { await stop(); throw error; }
}

export function createSessionManager(config, launch = startStandaloneSession, now = Date.now) {
  const sessions = new Map();
  let shuttingDown = false;
  async function remove(key, session) {
    session.closing = true;
    const runtime = await session.ready.catch(() => null);
    await runtime?.stop();
    if (sessions.get(key) === session) sessions.delete(key);
  }
  async function findSession(context) {
      if (shuttingDown) throw failure(503, "The workshop is restarting. Reload shortly.");
      let session = sessions.get(context.principal);
      if (session?.closing) throw failure(503, "Your practice session is restarting. Reload shortly.");
      if (session && sessionExpired(session, config, now)) {
        await remove(context.principal, session);
        session = sessions.get(context.principal);
      }
      if (session?.closing) throw failure(503, "Your practice session is restarting. Reload shortly.");
      if (!session) {
        if (!context.navigation) throw failure(409, "Your practice session ended. Reload to start a fresh one.");
        if (sessions.size >= config.maxSessions) throw failure(503, "The workshop is full. Please try again shortly.");
        session = { run: randomUUID(), active: 0, activeWrites: 0, resetting: false, lastUsed: now(), runtime: null };
        sessions.set(context.principal, session);
        session.ready = Promise.resolve().then(() => launch(config, session.run)).then((runtime) => { session.runtime = runtime; return runtime; });
      }
      return session;
  }
  return {
    async acquire(context) {
      const session = await findSession(context);
      validateSessionRequest(session, context);
      const release = retainSession(session, context, now);
      try {
        const runtime = await session.ready;
        return {
          ...runtime, run: session.run, fresh: context.cookies.get(runCookie) !== session.run, release,
          rotateRun: () => { session.run = randomUUID(); return session.run; },
        };
      } catch {
        release();
        await remove(context.principal, session);
        throw failure(503, "Your practice session could not start. Please reload.");
      }
    },
    async sweep() {
      for (const [key, session] of sessions) {
        if (!session.active && !session.closing && now() - session.lastUsed >= config.idleMs) await remove(key, session);
      }
    },
    async close() {
      shuttingDown = true;
      for (const [key, session] of sessions) await remove(key, session);
    },
  };
}

function sessionExpired(session, config, now) {
  return !session.active && (now() - session.lastUsed >= config.idleMs || session.runtime?.alive() === false);
}

function validateSessionRequest(session, context) {
  if (!context.navigation && context.cookies.get(runCookie) !== session.run) throw failure(409, "Reload this tab before continuing your practice session.");
  if ((context.mutating || context.pageRun) && context.pageRun !== session.run) throw failure(409, "This tab belongs to a different practice session. Reload before continuing.");
  if ((context.mutating && session.resetting) || (context.reset && session.activeWrites)) throw failure(409, "A practice action is still running. Try again when it finishes.");
}

function retainSession(session, context, now) {
  session.active += 1;
  if (context.mutating) session.activeWrites += 1;
  if (context.reset) session.resetting = true;
  session.lastUsed = now();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    session.active -= 1;
    if (context.mutating) session.activeWrites -= 1;
    if (context.reset) session.resetting = false;
    session.lastUsed = now();
  };
}

function proxyHeaders(req, session, context) {
  const origin = `http://127.0.0.1:${session.port}`;
  const headers = {};
  for (const key of forwardedHeaders) if (req.headers[key] !== undefined) headers[key] = req.headers[key];
  const choice = context.cookies.get(roleCookie);
  const persona = choice === `${session.run}.assessor` ? "assessor" : "supervisor";
  headers.host = `127.0.0.1:${session.port}`;
  headers.origin = origin;
  headers.cookie = `pipeline_practice_persona_${session.port}=${persona}`;
  return headers;
}

function responseCookies(upstream, session) {
  const outgoingCookies = [];
  if (session.fresh) {
    outgoingCookies.push(secureCookie(runCookie, session.run), secureCookie(roleCookie, `${session.run}.${session.persona || "supervisor"}`));
    // Readable only as a page-generation marker, never an authentication token.
    outgoingCookies.push(`${pageCookie}=${session.run}; Path=/; Secure; SameSite=Strict`);
  }
  for (const cookie of upstream.headers["set-cookie"] || []) {
    const match = cookie.match(new RegExp(`^pipeline_practice_persona_${session.port}=(supervisor|assessor);`));
    if (match) outgoingCookies.push(secureCookie(roleCookie, `${session.run}.${match[1]}`));
  }
  return outgoingCookies;
}

function responseHeaders(upstream, session, config) {
  const headers = {};
  for (const key of forwardedResponseHeaders) if (upstream.headers[key] !== undefined) headers[key] = upstream.headers[key];
  headers["cache-control"] = "private, no-store, max-age=0";
  headers["x-content-type-options"] = "nosniff";
  if (session.replacedRun) {
    headers["x-workshop-replaced-run"] = session.replacedRun;
    headers["x-workshop-page-run"] = session.run;
  }
  const location = upstream.headers.location;
  if (location) {
    const url = new URL(location, `http://127.0.0.1:${session.port}`);
    if (url.origin !== `http://127.0.0.1:${session.port}`) throw failure(502, "The practice page returned an invalid redirect.");
    headers.location = `${config.origin}${url.pathname}${url.search}${url.hash}`;
  }
  if (session.fresh) headers["clear-site-data"] = '"storage"';
  headers["set-cookie"] = responseCookies(upstream, session);
  return headers;
}

function sendFailure(res, error) {
  if (res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? Number(error.status) : 502;
  res.writeHead(status, { "content-type": "application/json", "connection": "close", "cache-control": "private, no-store", "x-content-type-options": "nosniff", ...(status === 503 ? { "retry-after": "10" } : {}) });
  res.end(JSON.stringify({ error: error.status ? error.message : "The practice session is unavailable. Please reload." }));
}

export function createWorkshopGateway(config, manager = createSessionManager(config)) {
  const server = createServer(async (req, res) => {
    let session;
    try {
      const context = requestContext(req, config);
      session = await manager.acquire(context);
      if (res.destroyed || req.aborted) { session.release(); return; }
      session.persona = context.cookies.get(roleCookie) === `${session.run}.assessor` ? "assessor" : "supervisor";
      const upstream = httpRequest({ hostname: "127.0.0.1", port: session.port, path: req.url, method: req.method, headers: proxyHeaders(req, session, context) });
      res.once("close", () => { upstream.destroy(); session.release(); });
      res.once("finish", session.release);
      upstream.setTimeout(120_000, () => upstream.destroy(failure(504, "The practice action timed out. Please try again.")));
      upstream.once("error", (error) => { sendFailure(res, error); session.release(); });
      upstream.once("response", (response) => {
        // Even a failed reset may have cleared part of its data. Retire the old
        // page generation; only this response's caller can adopt the new one.
        if (context.reset) {
          session.replacedRun = session.run;
          session.run = session.rotateRun();
          session.fresh = true;
        }
        try { res.writeHead(Number(response.statusCode), responseHeaders(response, session, config)); }
        catch (error) { response.destroy(); sendFailure(res, error); return; }
        response.once("error", () => res.destroy());
        response.pipe(res);
      });
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maximumBodyBytes) {
          req.unpipe(upstream);
          upstream.destroy(failure(413, "The upload is too large."));
          req.resume();
        }
      });
      req.once("aborted", () => { upstream.destroy(); session.release(); });
      req.pipe(upstream);
    } catch (error) { session?.release(); sendFailure(res, error); }
  });
  server.requestTimeout = 180_000;
  server.headersTimeout = 30_000;
  server.on("upgrade", (_req, socket) => socket.destroy());
  return { server, manager };
}

async function main() {
  const config = workshopConfig();
  if (config.port === config.healthPort) throw new Error("Health and public ports must differ.");
  const { server, manager } = createWorkshopGateway(config);
  const health = createServer((req, res) => {
    res.writeHead(req.url === "/healthz" ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  server.listen(config.port, "0.0.0.0");
  health.listen(config.healthPort, "0.0.0.0");
  const sweeper = setInterval(() => { manager.sweep().catch(() => console.error("Workshop session cleanup failed.")); }, 60_000);
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(sweeper);
    server.close();
    health.close();
    await manager.close();
    server.closeAllConnections();
  });
  console.log("Authenticated workshop gateway started.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

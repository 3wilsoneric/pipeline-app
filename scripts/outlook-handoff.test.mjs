import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
const require = createRequire(import.meta.url);
class FixtureInteractionRequiredAuthError extends Error {}
class PipelineApiError extends Error { constructor(status, message = "Fixture API failure") { super(message); this.status = status; } }
const outlookClientDependencies = { "@/lib/auth/authenticated-fetch": { PipelineApiError } };
function load(file, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Buffer, Request, Response, Headers, URL, URLSearchParams, AbortSignal, structuredClone, process,
    require: (name) => name === "server-only" ? {} : dependencies[name] ?? require(name), ...globals });
  return exports;
}
class PacketAccessError extends Error { constructor(message, status) { super(message); this.status = status; } }
const contract = load("lib/notifications/outlook-draft-contract.ts");
const graphFixture = (fetch, live = true) => load("lib/notifications/outlook-mail.ts", {
  "./admission-packet-store": { PacketAccessError }, "./outlook-draft-contract": contract,
  "./microsoft-graph-mail": { isMeetClientLive: () => live },
}, { fetch });

test("production hold is default-off even with credentials; demos override an enabled switch", async () => {
  for (const overrides of [{}, { PIPELINE_MEET_CLIENT_LIVE_ENABLED: "false" }, { PIPELINE_MEET_CLIENT_LIVE_ENABLED: "TRUE" },
    { PIPELINE_MEET_CLIENT_LIVE_ENABLED: "true", PIPELINE_DEMO_MODE: "true" },
    { PIPELINE_MEET_CLIENT_LIVE_ENABLED: "true", PIPELINE_PERSONA_DEMO: "true" },
    { PIPELINE_MEET_CLIENT_LIVE_ENABLED: "true", NODE_ENV: "development" }]) {
    let calls = 0;
    const mail = loadTypeScriptModule(process.cwd(), "lib/notifications/microsoft-graph-mail.ts", { process: { env: {
      NODE_ENV: "production", PIPELINE_GRAPH_TENANT_ID: "fixture", PIPELINE_GRAPH_CLIENT_ID: "fixture", PIPELINE_GRAPH_CLIENT_SECRET: "fixture",
      PIPELINE_MEET_CLIENT_SENDER: "staff@example.invalid", PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS: "example.invalid", ...overrides,
    } }, fetch: async () => { calls++; throw new Error("Unexpected external request"); } });
    assert.equal(mail.isMeetClientLive(), false);
    assert.equal(mail.getGraphMailReadiness().configured, false);
    await assert.rejects(mail.sendPacketVerificationCode("recipient@example.invalid", "12345678"));
    await assert.rejects(mail.sendMeetClientMail({}));
    await assert.rejects(graphFixture(async () => { calls++; }, false).createOutlookMessage("synthetic", {}), { status: 403 });
    assert.equal(calls, 0);
  }
});

test("Outlook connection enforces the same account and rejects delegated sessions without leaking tokens", async () => {
  let calls = 0;
  const graph = graphFixture(async () => { calls++; return Response.json({ id: "staff", mail: "Staff@example.invalid" }); });
  const request = new Request("https://pipeline.invalid", { headers: { "x-pipeline-outlook-token": "synthetic-token" } });
  assert.equal((await graph.connectedOutlookMailbox(request, { id: "STAFF" })).email, "staff@example.invalid");
  await assert.rejects(graph.connectedOutlookMailbox(request, { id: "someone-else" }), { status: 403 });
  await assert.rejects(graph.connectedOutlookMailbox(request, { id: "staff", delegation: {} }), { status: 403 });
  await assert.rejects(graph.connectedOutlookMailbox(new Request(request.url), { id: "staff" }), { status: 428 });
  assert.equal(calls, 2);
});

test("home tenant and personal mailboxes bind to authenticated Pipeline email, never a chosen contact", async () => {
  const request = new Request("https://pipeline.invalid", { headers: { "x-pipeline-outlook-token": "synthetic-token" } });
  for (const email of ["staff@example.invalid", "synthetic-person@outlook.com"]) {
    const graph = graphFixture(async () => Response.json({ id: "home-id", mail: email }));
    const connected = await graph.connectedOutlookMailbox(request, { id: "guest-id", email: email.toUpperCase() });
    assert.equal(connected.id, "guest-id"); assert.equal(connected.graphId, "home-id"); assert.equal(connected.email, email);
    await assert.rejects(graph.connectedOutlookMailbox(request, { id: "guest-id", email: "different@example.invalid" }), { status: 403 });
  }
  const guest = graphFixture(async () => Response.json({ id: "guest-id", userPrincipalName: "staff_example.invalid#EXT#@tenant.onmicrosoft.com" }));
  await assert.rejects(guest.connectedOutlookMailbox(request, { id: "guest-id", email: "staff@example.invalid" }), { status: 403 });
});

test("Outlook OAuth uses its own public client and callback without acquiring send permission", async () => {
  let configuration, active, popupCalls = 0, silentCalls = 0;
  const client = load("lib/auth/outlook-client.ts", {
    ...outlookClientDependencies,
    "@azure/msal-browser": { InteractionRequiredAuthError: FixtureInteractionRequiredAuthError, BrowserCacheLocation: { LocalStorage: "localStorage" }, PublicClientApplication: class {
      constructor(config) { configuration = config; }
      async initialize() {}
      getActiveAccount() { return active; }
      setActiveAccount(account) { active = account; }
      async acquireTokenPopup(request) { popupCalls++; assert.equal(request.prompt, "select_account"); assert.deepEqual(Array.from(request.scopes), ["https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/User.Read"]); return { account: { homeAccountId: "personal" }, accessToken: "synthetic-token" }; }
      async acquireTokenSilent(request) { silentCalls++; assert.equal(request.account, active); return { accessToken: "synthetic-token" }; }
    } },
    "@/lib/pipeline/base-path": { toPipelinePath: path => `/pipeline${path}` },
  }, { window: { location: { origin: "https://pipeline.invalid" } } });
  assert.equal(await client.acquireOutlookToken(undefined), null);
  await assert.rejects(client.acquireOutlookToken(undefined, true), /not set up/);
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(await client.acquireOutlookToken(id), null);
  assert.equal(await client.acquireOutlookToken(id, true), "synthetic-token");
  assert.equal(configuration.auth.authority, "https://login.microsoftonline.com/common");
  assert.equal(configuration.auth.redirectUri, "https://pipeline.invalid/pipeline/outlook-auth.html");
  assert.equal(configuration.cache.cacheLocation, "localStorage");
  assert.equal(await client.acquireOutlookToken(id), "synthetic-token");
  assert.equal(popupCalls, 1); assert.equal(silentCalls, 1);
});

test("Outlook restores the matching mailbox across visits and retains its cache after renewal fails", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const email = "assessor@example.invalid";
  let cachedAccount, silent = 0, sso = 0, popup = 0, cleared = 0, requireInteraction = false;
  const dependencies = {
    ...outlookClientDependencies,
    "@azure/msal-browser": { InteractionRequiredAuthError: FixtureInteractionRequiredAuthError, BrowserCacheLocation: { LocalStorage: "localStorage" }, PublicClientApplication: class {
      constructor(config) { assert.equal(config.cache.cacheLocation, "localStorage"); }
      async initialize() {}
      getActiveAccount() { return { username: "someone-else@example.invalid" }; }
      getAccount(filter) { assert.equal(filter.loginHint, email); return cachedAccount; }
      setActiveAccount(account) { cachedAccount = account; }
      async acquireTokenPopup(request) { popup++; assert.equal(request.loginHint, email); return { account: { username: email }, accessToken: "fixture-token" }; }
      async acquireTokenSilent(request) { silent++; assert.equal(request.account.username, email); if (requireInteraction) throw new FixtureInteractionRequiredAuthError("interaction_required"); return { accessToken: "fixture-token" }; }
      async ssoSilent(request) { sso++; assert.equal(request.loginHint, email); if (requireInteraction) throw new FixtureInteractionRequiredAuthError("interaction_required"); return { account: { username: email }, accessToken: "fixture-token" }; }
      async clearCache() { cleared++; cachedAccount = null; }
    } },
    "@/lib/pipeline/base-path": { toPipelinePath: path => path },
  };
  const globals = { window: { location: { origin: "https://pipeline.invalid" } } };
  const client = load("lib/auth/outlook-client.ts", dependencies, globals);
  assert.equal(await client.acquireOutlookToken(id, true, email), "fixture-token");
  const reopened = load("lib/auth/outlook-client.ts", dependencies, globals);
  assert.equal(await reopened.acquireOutlookToken(id, false, email), "fixture-token");
  assert.equal(popup, 1); assert.equal(silent, 1);
  cachedAccount = null;
  assert.equal(await reopened.acquireOutlookToken(id, false, email), "fixture-token");
  assert.equal(sso, 1); assert.equal(popup, 1);
  requireInteraction = true;
  assert.equal(await reopened.acquireOutlookToken(id, false, email), null);
  assert.equal(cachedAccount.username, email);
  const nextVisit = load("lib/auth/outlook-client.ts", dependencies, globals);
  assert.equal(await nextVisit.acquireOutlookToken(id, false, email), null);
  assert.equal(sso, 1); assert.equal(cleared, 0);
  requireInteraction = false;
  assert.equal(await nextVisit.acquireOutlookToken(id, false, email), "fixture-token");
  assert.equal(popup, 1); assert.equal(cleared, 0);
});

test("Outlook connection checks preserve renewal failures and refresh rejected tokens without a popup", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  let failure, popups = 0;
  const renewals = [];
  const client = load("lib/auth/outlook-client.ts", {
    ...outlookClientDependencies,
    "@azure/msal-browser": { InteractionRequiredAuthError: FixtureInteractionRequiredAuthError, BrowserCacheLocation: { LocalStorage: "localStorage" }, PublicClientApplication: class {
      async initialize() {}
      getAccount(filter) { assert.equal(filter.loginHint, "alias@example.invalid"); return { username: "primary@example.invalid" }; }
      async acquireTokenSilent(request) { renewals.push(request.forceRefresh); if (failure) throw failure; return { accessToken: request.forceRefresh ? "renewed-token" : "cached-token" }; }
      async acquireTokenPopup() { popups++; throw new Error("Unexpected popup"); }
    } },
    "@/lib/pipeline/base-path": { toPipelinePath: path => path },
  }, { window: { location: { origin: "https://pipeline.invalid" } } });
  for (const error of [new Error("network failure with sensitive detail"), new Error("monitor_window_timeout")]) {
    failure = error;
    await assert.rejects(client.acquireOutlookToken(id, false, "alias@example.invalid"), /Retry the connection check; your saved connection has been kept/);
  }
  failure = new FixtureInteractionRequiredAuthError("login_required");
  assert.equal(await client.acquireOutlookToken(id, false, "alias@example.invalid"), null);
  failure = null;
  renewals.length = 0;
  const tokens = [];
  const mailbox = await client.checkWithOutlookToken(id, "alias@example.invalid", async token => {
    tokens.push(token);
    if (token === "cached-token") throw new PipelineApiError(428);
    return { mailbox: "alias@example.invalid" };
  });
  assert.equal(mailbox.mailbox, "alias@example.invalid");
  assert.deepEqual(tokens, ["cached-token", "renewed-token"]);
  assert.deepEqual(renewals, [false, true]);
  for (const status of [403, 429, 503]) {
    let attempts = 0;
    await assert.rejects(client.checkWithOutlookToken(id, "alias@example.invalid", async () => { attempts++; throw new PipelineApiError(status); }), { status });
    assert.equal(attempts, 1);
  }
  let rejected = 0;
  await assert.rejects(client.checkWithOutlookToken(id, "alias@example.invalid", async () => { rejected++; throw new PipelineApiError(428); }), { status: 428 });
  assert.equal(rejected, 2);
  assert.equal(popups, 0);
});

test("early Outlook connection is identity-bound, origin-protected and disabled during the production hold", async () => {
  let user = null, live = false, calls = 0, mailboxEmail = "staff@example.invalid";
  const graph = graphFixture(async () => { calls++; return Response.json({ id: "home-mailbox-id", mail: mailboxEmail }); });
  const route = load("app/api/me/outlook/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles) => !user ? { ok: false, response: new Response(null, { status: 401 }) }
      : roles && !roles.some(role => user.roles.includes(role)) ? { ok: false, response: new Response(null, { status: 403 }) } : { ok: true, user } },
    "@/lib/auth/request-security": load("lib/auth/request-security.ts"),
    "@/lib/notifications/microsoft-graph-mail": { isMeetClientLive: () => live },
    "@/lib/notifications/admission-packet-store": { PacketAccessError },
    "@/lib/notifications/outlook-mail": { ...graph, getOutlookClientId: () => "fixture-client" },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _path, run) => run() },
  });
  const url = "https://pipeline.invalid/api/me/outlook";
  const get = () => route.GET(new Request(url));
  const post = (origin = "https://pipeline.invalid") => route.POST(new Request(url, { method: "POST", headers: { Origin: origin, "x-pipeline-outlook-token": "fixture-token" } }));
  assert.equal((await get()).status, 401); assert.equal((await post()).status, 401);
  user = { id: "pipeline-id", email: "staff@example.invalid", roles: ["reviewer"] };
  const setup = await get(); assert.match(setup.headers.get("cache-control"), /no-store/);
  assert.equal((await setup.json()).demo, true);
  assert.equal((await post()).status, 403); assert.equal(calls, 0);
  live = true;
  assert.equal((await post("https://other.invalid")).status, 403); assert.equal(calls, 0);
  user.roles = ["viewer"];
  assert.equal((await (await get()).json()).can_connect, false);
  assert.equal((await post()).status, 403); assert.equal(calls, 0);
  user.roles = ["reviewer"]; user.delegation = {};
  assert.equal((await (await get()).json()).can_connect, false);
  assert.equal((await post()).status, 403); assert.equal(calls, 0);
  delete user.delegation;
  mailboxEmail = "someone-else@example.invalid";
  assert.equal((await post()).status, 403);
  mailboxEmail = user.email;
  const connected = await post(); assert.equal(connected.status, 200);
  assert.deepEqual(JSON.parse(await connected.text()), { mailbox: user.email });
  assert.equal(calls, 2);
  // Retained Outlook credentials never replace current Pipeline authorization.
  user.roles = ["viewer"];
  assert.equal((await post()).status, 403);
  user = null;
  assert.equal((await get()).status, 401); assert.equal((await post()).status, 401);
  assert.equal(calls, 2);
});

test("draft creation uses delegated Drafts and immutable correlation, never the send endpoint", async () => {
  const requests = [];
  const graph = graphFixture(async (url, init) => { requests.push({ url, init }); return Response.json({ id: "draft", isDraft: true }); });
  await graph.createOutlookMessage("synthetic", { deliveryId: "packet", subject: "Fixture", html: "Fixture", recipients: ["r@example.invalid"], ccRecipients: [] });
  assert.match(requests[0].url, /\/me\/messages$/);
  assert.equal(requests[0].init.method, "POST");
  assert.match(requests[0].init.headers.Prefer, /ImmutableId/);
  assert.equal(JSON.parse(requests[0].init.body).singleValueExtendedProperties[0].value, "packet");
  assert.equal(requests.length, 1);
  for (const link of ["https://outlook.office.com/mail/draft/1", "https://outlook.office365.com/mail/1", "https://outlook.live.com/mail/0/drafts/id/1"]) assert.equal(contract.safeOutlookWebLink(link), link);
  for (const link of ["javascript:alert(1)", "https://outlook.office.com.evil.invalid", "https://outlook.live.com.evil.invalid", "https://staff@outlook.office.com", "http://outlook.office.com"]) assert.equal(contract.safeOutlookWebLink(link), undefined);
});

test("missing immutable id recovers the existing message by private correlation without creating another", async () => {
  const requests = [];
  const graph = graphFixture(async (url) => { requests.push(url); return requests.length === 1 ? new Response(null, { status: 404 }) : Response.json({ value: [{ id: "same-draft", isDraft: true }] }); });
  assert.equal((await graph.findOutlookMessage("synthetic", "packet", "old-id")).id, "same-draft");
  assert.equal(requests.length, 2);
  assert.match(decodeURIComponent(requests[1]), /PipelineDeliveryId/);
  const duplicates = graphFixture(async () => Response.json({ value: [{ id: "a" }, { id: "b" }] }));
  await assert.rejects(duplicates.findOutlookMessage("synthetic", "packet"), { status: 409 });
});

function handoffFixture() {
  let packet, message, changed = "", finalized = 0, creations = 0, deleted = 0, failure, attachmentFailure, uploadGate;
  const audits = [];
  const mailbox = { id: "staff", email: "staff@example.invalid", token: "synthetic-token" };
  const audit = { deliveryId: "packet", referralId: 1, assessmentId: "assessment", assessmentVersion: 2, decisionId: "decision", actorId: "staff" };
  const assessment = { version: 2, signed_at: "2026-09-21T00:00:00Z" };
  const inventory = { files: [{ id: "chart", name: "Chart.html" }], revision: "revision", ready: true };
  const url = "https://pipeline.invalid/admission-packets/packet";
  const graph = graphFixture(async () => { throw new Error("No network in fixture"); });
  const owner = load("lib/notifications/outlook-handoff.ts", {
    "@/lib/assessment/assessment-store": { getAssessment: async () => ({ ...assessment, version: changed === "assessment" ? 3 : 2 }),
      deliverAssessmentPacket: async (_id, version, send) => { const result = await send(); finalized++; assessment.meet_client_sent_version = version; assessment.meet_client_sent_at = result.acceptedAt; } },
    "@/lib/pipeline/meet-client-delivery-audit": { completeMeetClientDelivery: async (_audit, status) => audits.push(status) },
    "@/lib/pipeline/workflow-store": { getReferralWorkflowSnapshot: async () => ({ referral: { version: changed === "referral" ? 2 : 1 }, decision: { decisionId: "decision", outcome: "accepted" }, work_items: [] }) },
    "@/lib/assessment/assessment-summary": { buildAssessmentSummaryReport: () => ({}) },
    "./meet-client-attachments": { getMeetClientAttachmentInventory: async () => ({ ...inventory, revision: changed === "files" ? "new" : "revision" }) },
    "./admission-packet-files": { admissionPacketUrl: () => url, prepareAdmissionPacketRecord: async (input) => {
      packet = { ...input, createdAt: "2026-09-21T00:00:00Z", files: inventory.files, recipients: input.recipients.map(email => ({ email, sessions: [] })), events: [] }; return packet;
    } },
    "./admission-packet-store": { PacketAccessError, findWorkspaceOutlookDraft: async () => packet,
      withAdmissionPacket: async (_id, operation) => operation(packet) },
    "./outlook-attachments": { ensureOutlookAttachments: async (_token, _id, _packet, progress) => {
      await progress("chart", "hash"); if (uploadGate) await uploadGate; if (attachmentFailure) throw attachmentFailure;
    }, outlookAttachmentsMatch: async () => changed !== "attachments" },
    "./outlook-mail": { ...graph, updateOutlookMessage: async (_token, _id, _subject, _html, recipients) => {
      message.toRecipients = recipients.map(address => ({ emailAddress: { address } })); return message;
    }, createOutlookMessage: async (_token, input) => {
      assert.equal(input.recipients.length, 0, "do not address an incomplete email");
      assert.match(input.subject, /Preparing attachments/);
      assert.equal(packet.outlook.status, "preparing", "persist recovery before calling provider"); creations++;
      message = { id: "draft", isDraft: true, webLink: "https://outlook.office.com/mail/1" }; if (failure) throw failure; return message;
    }, findOutlookMessage: async () => message, deleteOutlookDraft: async () => { assert.ok(packet.revokedAt); deleted++; } },
    "./meet-client-email-template": { renderMeetClientEmail: () => ({ subject: "Fixture", text: "Fixture", html: "Fixture" }) },
  });
  const prepare = () => owner.prepareOutlookHandoff({ mailbox, audit, referralVersion: 1, packetRevision: "revision", recipients: ["r@example.invalid"], ccRecipients: [], inventory, summary: {}, preparedBy: "Staff", message: {}, requestUrl: url });
  return { owner, prepare, mailbox, graph, audits, get packet() { return packet; }, get finalized() { return finalized; }, get creations() { return creations; }, get deleted() { return deleted; },
    check: () => owner.checkOutlookHandoff("packet", 1, mailbox, url), discard: () => owner.discardOutlookHandoff("packet", 1, mailbox, url),
    fail: (value) => { failure = value; }, failAttachment: (value) => { attachmentFailure = value; }, pauseUpload: value => { uploadGate = value; }, change: (value) => { changed = value; }, missing: () => { message = null; },
    sent: (overrides = {}) => { message = { ...message, isDraft: false, sentDateTime: "2026-09-21T01:00:00Z", body: { content: url }, toRecipients: [{ emailAddress: { address: "r@example.invalid" } }], ...overrides }; } };
}

test("preparation and reload keep one draft; only confirmed sending finalizes the assessment", async () => {
  const f = handoffFixture();
  assert.equal((await f.prepare()).status, "draft");
  assert.equal(f.finalized, 0);
  assert.equal((await f.check()).status, "draft");
  assert.equal((await f.owner.workspaceOutlookState(1, "staff")).draft.packet_id, "packet");
  const other = await f.owner.workspaceOutlookState(1, "other"); assert.equal(other.occupied, true); assert.equal(other.draft, null);
  await assert.rejects(f.owner.checkOutlookHandoff("packet", 1, { ...f.mailbox, id: "other" }, ""), { status: 404 });
  assert.equal(JSON.stringify(f.packet).includes("synthetic-token"), false);
  f.sent(); assert.equal((await f.check()).status, "sent");
  assert.equal(f.finalized, 1); assert.deepEqual(f.audits, ["sent"]);
  assert.equal((await f.check()).status, "sent"); assert.equal(f.finalized, 1); assert.equal(f.creations, 1);
});

test("draft recovery pins the exact home mailbox and preserves the reviewed To and Cc", async () => {
  const f = handoffFixture(); f.mailbox.graphId = "home-mailbox";
  const view = await f.prepare();
  assert.equal(f.packet.outlook.mailboxId, "home-mailbox");
  assert.deepEqual(Array.from(view.to_recipients), ["r@example.invalid"]);
  assert.deepEqual(Array.from(view.cc_recipients), []);
  await assert.rejects(f.owner.checkOutlookHandoff("packet", 1, { ...f.mailbox, graphId: "other-mailbox" }, ""), { status: 403 });
  await assert.rejects(f.owner.discardOutlookHandoff("packet", 1, { ...f.mailbox, graphId: "other-mailbox" }, ""), { status: 403 });
  assert.equal(f.deleted, 0); assert.equal(f.finalized, 0);
  assert.equal((await f.check()).status, "draft");
  const legacy = handoffFixture(); await legacy.prepare(); delete legacy.packet.outlook.mailboxId;
  assert.equal((await legacy.check()).status, "draft");
});

test("ambiguous creation recovers one existing draft; definite rejection releases safely", async () => {
  const unknown = handoffFixture(); unknown.fail(new Error("Transport lost"));
  await assert.rejects(unknown.prepare()); assert.equal(unknown.packet.outlook.status, "unconfirmed"); assert.equal(unknown.audits.length, 0);
  assert.equal((await unknown.check()).status, "draft"); assert.equal(unknown.creations, 1);
  const rejected = handoffFixture(); rejected.fail(new rejected.graph.OutlookMailError(403, true));
  await assert.rejects(rejected.prepare()); assert.equal(rejected.packet.outlook.status, "discarded"); assert.ok(rejected.packet.revokedAt); assert.deepEqual(rejected.audits, ["failed"]);
});

test("sent changes require review; explicit replacement does not falsely certify the assessment", async () => {
  for (const change of ["assessment", "referral", "files", "recipients", "attachments"]) {
    const f = handoffFixture(); await f.prepare(); f.change(change);
    f.sent(change === "recipients" ? { toRecipients: [{ emailAddress: { address: "new@example.invalid" } }] } : change === "link" ? { body: { content: "Link removed" } } : {});
    assert.equal((await f.check()).status, "needs_review", change); assert.equal(f.finalized, 0);
    if (change === "recipients") assert.ok(f.packet.revokedAt);
    assert.equal((await f.discard()).status, "discarded"); assert.ok(f.packet.revokedAt);
    assert.deepEqual(f.audits, ["sent_needs_review"]); assert.equal(f.deleted, 0); assert.equal(f.finalized, 0);
  }
});

test("explicit removal revokes before deleting; a missing draft permits recovery without claiming it was sent", async () => {
  const f = handoffFixture(); await f.prepare(); assert.equal((await f.discard()).status, "discarded"); assert.equal(f.deleted, 1);
  const missing = handoffFixture(); await missing.prepare(); missing.missing(); assert.equal((await missing.check()).status, "unconfirmed");
  assert.equal((await missing.discard()).status, "discarded"); assert.equal(missing.deleted, 0); assert.equal(missing.finalized, 0);
});

test("Outlook API enforces authentication, workspace access, origin, explicit removal and nonproduction hold", async () => {
  let authenticated = false, allowed = false, mutable = false, live = true, connectionCalls = 0, checks = 0, removals = 0;
  const route = load("app/api/referrals/[referralId]/outlook-draft/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => authenticated ? { ok: true, user: { id: "staff", roles: [] } } : { ok: false, response: new Response(null, { status: 401 }) } },
    "@/lib/auth/request-security": load("lib/auth/request-security.ts"),
    "@/lib/pipeline/referral-access": { requireMutableReferralAccess: async () => mutable ? { ok: true } : { ok: false, response: new Response(null, { status: 403 }) }, requireReferralAccess: async () => allowed ? { ok: true } : { ok: false, response: new Response(null, { status: 404 }) } },
    "@/lib/extraction/contracts": { readJsonBody: async (request) => ({ ok: true, value: await request.json() }) },
    "@/lib/notifications/microsoft-graph-mail": { isMeetClientLive: () => live },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _name, handler) => handler() },
    "@/lib/notifications/admission-packet-files": { packetPrivateHeaders: { "Cache-Control": "private, no-store" } },
    "@/lib/notifications/admission-packet-store": { PacketAccessError },
    "@/lib/notifications/outlook-mail": { OutlookMailError: class extends Error {}, getOutlookClientId: () => "configured-client", connectedOutlookMailbox: async () => { connectionCalls++; return { id: "staff", email: "staff@example.invalid", token: "synthetic" }; } },
    "@/lib/notifications/outlook-handoff": { workspaceOutlookState: async () => ({ draft: null, occupied: false }),
      checkOutlookHandoff: async () => { checks++; return { status: "draft" }; }, discardOutlookHandoff: async () => { removals++; return { status: "discarded" }; } },
  });
  const url = "https://pipeline.invalid/api/referrals/1/outlook-draft";
  const context = { params: Promise.resolve({ referralId: "1" }) };
  const post = (body = { action: "connect" }, origin = "https://pipeline.invalid") => route.POST(new Request(url, { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) }), context);
  assert.equal((await post()).status, 401); authenticated = true; assert.equal((await post()).status, 404); allowed = true;
  assert.equal((await post(undefined, "https://other.invalid")).status, 403); assert.equal(connectionCalls, 0);
  live = false;
  const preview = await route.GET(new Request(url), context);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).outlook_client_id, "configured-client");
  const blocked = await post(); assert.equal(blocked.status, 403); assert.match(await blocked.text(), /Not production yet/); assert.equal(connectionCalls, 0);
  live = true;
  assert.equal((await (await route.GET(new Request(url), context)).json()).outlook_client_id, "configured-client");
  assert.equal((await post()).status, 403); assert.equal(connectionCalls, 0);
  assert.equal((await post({ action: "check", packet_id: "packet" })).status, 403); assert.equal(checks, 0);
  assert.equal((await post({ action: "discard", packet_id: "packet", confirmed: true })).status, 403); assert.equal(removals, 0);
  mutable = true; const connected = await (await post()).json(); assert.equal(connected.mailbox, "staff@example.invalid"); assert.equal(JSON.stringify(connected).includes("synthetic"), false);
  assert.equal((await post({ action: "discard", packet_id: "packet", confirmed: "true" })).status, 400); assert.equal(removals, 0);
  assert.equal((await post({ action: "check", packet_id: "packet" })).status, 200); assert.equal(checks, 1);
  assert.equal((await post({ action: "discard", packet_id: "packet", confirmed: true })).status, 200); assert.equal(removals, 1);

});


test("attachment failures retain the same draft and reservation even after a definite provider rejection", async () => {
  const f = handoffFixture(); f.failAttachment(new f.graph.OutlookMailError(413, true));
  await assert.rejects(f.prepare(), { status: 413 });
  assert.equal(f.packet.outlook.messageId, "draft"); assert.equal(f.packet.outlook.status, "unconfirmed");
  assert.equal(f.packet.outlook.attachmentsReady, undefined); assert.equal(f.packet.revokedAt, undefined);
  assert.equal(f.audits.length, 0); assert.equal(f.creations, 1);
  const view = (await f.owner.workspaceOutlookState(1, "staff")).draft;
  assert.equal(view.web_link, undefined);
  f.failAttachment(undefined); assert.equal((await f.check()).status, "draft");
  assert.equal(f.packet.outlook.attachmentsReady, true); assert.equal(f.creations, 1);
  f.sent({ body: { content: "Ordinary email, no download link." } });
  assert.equal((await f.check()).status, "sent"); assert.equal(f.finalized, 1);
});

test("concurrent checks and removal cannot interrupt attachments; a stale operation can resume", async () => {
  const f = handoffFixture(); let release;
  f.pauseUpload(new Promise(resolve => { release = resolve; }));
  const preparing = f.prepare();
  while (!f.packet?.outlook?.attachmentHashes) await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(f.check(), { status: 409 }); await assert.rejects(f.discard(), { status: 409 });
  assert.equal(f.deleted, 0); release(); await preparing;
  assert.equal(f.packet.outlook.operation, undefined);
  f.packet.outlook.operation = { id: "expired", expiresAt: Date.now() - 1 };
  assert.equal((await f.check()).status, "draft"); assert.equal(f.packet.outlook.operation, undefined);
});

test("a prematurely sent partial draft is flagged without completing the assessment", async () => {
  const f = handoffFixture(); f.failAttachment(new Error("Lost upload response"));
  await assert.rejects(f.prepare()); f.sent();
  assert.equal((await f.check()).status, "needs_review"); assert.equal(f.finalized, 0);
});

test("legacy linked drafts still require their original link before finalization", async () => {
  const f = handoffFixture(); await f.prepare(); delete f.packet.outlook.deliveryMode;
  f.sent({ body: { content: "Removed link" } });
  assert.equal((await f.check()).status, "needs_review"); assert.equal(f.finalized, 0);
});

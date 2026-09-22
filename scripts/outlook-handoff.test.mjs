import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
const require = createRequire(import.meta.url);
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

test("draft creation uses delegated Drafts and immutable correlation, never the send endpoint", async () => {
  const requests = [];
  const graph = graphFixture(async (url, init) => { requests.push({ url, init }); return Response.json({ id: "draft", isDraft: true }); });
  await graph.createOutlookMessage("synthetic", { deliveryId: "packet", subject: "Fixture", html: "Fixture", recipients: ["r@example.invalid"], ccRecipients: [] });
  assert.match(requests[0].url, /\/me\/messages$/);
  assert.equal(requests[0].init.method, "POST");
  assert.match(requests[0].init.headers.Prefer, /ImmutableId/);
  assert.equal(JSON.parse(requests[0].init.body).singleValueExtendedProperties[0].value, "packet");
  assert.equal(requests.length, 1);
  for (const link of ["https://outlook.office.com/mail/draft/1", "https://outlook.office365.com/mail/1"]) assert.equal(contract.safeOutlookWebLink(link), link);
  for (const link of ["javascript:alert(1)", "https://outlook.office.com.evil.invalid", "https://staff@outlook.office.com", "http://outlook.office.com"]) assert.equal(contract.safeOutlookWebLink(link), undefined);
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
  let packet, message, changed = "", finalized = 0, creations = 0, deleted = 0, failure;
  const audits = [];
  const mailbox = { id: "staff", email: "staff@example.invalid", token: "synthetic-token" };
  const audit = { deliveryId: "packet", referralId: 1, assessmentId: "assessment", assessmentVersion: 2, decisionId: "decision", actorId: "staff" };
  const assessment = { version: 2, signed_at: "2026-09-21T00:00:00Z" };
  const inventory = { files: [{ name: "Chart.html" }], revision: "revision", ready: true };
  const url = "https://pipeline.invalid/admission-packets/packet";
  const graph = graphFixture(async () => { throw new Error("No network in fixture"); });
  const owner = load("lib/notifications/outlook-handoff.ts", {
    "@/lib/assessment/assessment-store": { getAssessment: async () => ({ ...assessment, version: changed === "assessment" ? 3 : 2 }),
      deliverAssessmentPacket: async (_id, version, send) => { const result = await send(); finalized++; assessment.meet_client_sent_version = version; assessment.meet_client_sent_at = result.acceptedAt; } },
    "@/lib/pipeline/meet-client-delivery-audit": { completeMeetClientDelivery: async (_audit, status) => audits.push(status) },
    "@/lib/pipeline/workflow-store": { getReferralWorkflowSnapshot: async () => ({ referral: { version: changed === "referral" ? 2 : 1 }, decision: { decisionId: "decision", outcome: "accepted" }, work_items: [] }) },
    "@/lib/assessment/assessment-summary": { buildAssessmentSummaryReport: () => ({}) },
    "./meet-client-attachments": { getMeetClientAttachmentInventory: async () => ({ ...inventory, revision: changed === "files" ? "new" : "revision" }) },
    "./admission-packet-files": { admissionPacketUrl: () => url, prepareAdmissionPacketLink: async (input) => {
      packet = { ...input, createdAt: "2026-09-21T00:00:00Z", files: inventory.files, recipients: input.recipients.map(email => ({ email, sessions: [] })), events: [] }; return url;
    } },
    "./admission-packet-store": { PacketAccessError, findWorkspaceOutlookDraft: async () => packet,
      withAdmissionPacket: async (_id, operation) => operation(packet) },
    "./outlook-mail": { ...graph, createOutlookMessage: async () => {
      assert.equal(packet.outlook.status, "preparing", "persist recovery before calling provider"); creations++;
      message = { id: "draft", isDraft: true, webLink: "https://outlook.office.com/mail/1" }; if (failure) throw failure; return message;
    }, findOutlookMessage: async () => message, deleteOutlookDraft: async () => { assert.ok(packet.revokedAt); deleted++; } },
    "./meet-client-email-template": { renderMeetClientEmail: () => ({ subject: "Fixture", text: "Fixture", html: "Fixture" }) },
  });
  const prepare = () => owner.prepareOutlookHandoff({ mailbox, audit, referralVersion: 1, packetRevision: "revision", recipients: ["r@example.invalid"], ccRecipients: [], inventory, summary: {}, preparedBy: "Staff", message: {}, requestUrl: url });
  return { owner, prepare, mailbox, graph, audits, get packet() { return packet; }, get finalized() { return finalized; }, get creations() { return creations; }, get deleted() { return deleted; },
    check: () => owner.checkOutlookHandoff("packet", 1, mailbox, url), discard: () => owner.discardOutlookHandoff("packet", 1, mailbox, url),
    fail: (value) => { failure = value; }, change: (value) => { changed = value; }, missing: () => { message = null; },
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

test("ambiguous creation recovers one existing draft; definite rejection releases safely", async () => {
  const unknown = handoffFixture(); unknown.fail(new Error("Transport lost"));
  await assert.rejects(unknown.prepare()); assert.equal(unknown.packet.outlook.status, "unconfirmed"); assert.equal(unknown.audits.length, 0);
  assert.equal((await unknown.check()).status, "draft"); assert.equal(unknown.creations, 1);
  const rejected = handoffFixture(); rejected.fail(new rejected.graph.OutlookMailError(403, true));
  await assert.rejects(rejected.prepare()); assert.equal(rejected.packet.outlook.status, "discarded"); assert.ok(rejected.packet.revokedAt); assert.deepEqual(rejected.audits, ["failed"]);
});

test("sent changes require review; explicit replacement revokes files without falsely certifying the assessment", async () => {
  for (const change of ["assessment", "referral", "files", "recipients", "link"]) {
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
  let authenticated = false, allowed = false, live = true, connectionCalls = 0, checks = 0, removals = 0, confirmations = 0;
  const route = load("app/api/referrals/[referralId]/outlook-draft/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => authenticated ? { ok: true, user: { id: "staff", roles: [] } } : { ok: false, response: new Response(null, { status: 401 }) } },
    "@/lib/auth/request-security": load("lib/auth/request-security.ts"),
    "@/lib/pipeline/referral-access": { requireMutableReferralAccess: async () => ({ ok: true }), requireReferralAccess: async () => allowed ? { ok: true } : { ok: false, response: new Response(null, { status: 404 }) } },
    "@/lib/extraction/contracts": { readJsonBody: async (request) => ({ ok: true, value: await request.json() }) },
    "@/lib/notifications/microsoft-graph-mail": { isMeetClientLive: () => live },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _name, handler) => handler() },
    "@/lib/notifications/admission-packet-files": { packetPrivateHeaders: { "Cache-Control": "private, no-store" } },
    "@/lib/notifications/admission-packet-store": { PacketAccessError },
    "@/lib/notifications/assessor-email-draft": { confirmAssessorEmailDraft: async () => { confirmations++; return { delivery: "email", status: "sent" }; } },
    "@/lib/notifications/outlook-mail": { OutlookMailError: class extends Error {}, connectedOutlookMailbox: async () => { connectionCalls++; return { id: "staff", email: "staff@example.invalid", token: "synthetic" }; } },
    "@/lib/notifications/outlook-handoff": { workspaceOutlookState: async () => ({ draft: null, occupied: false }),
      checkOutlookHandoff: async () => { checks++; return { status: "draft" }; }, discardOutlookHandoff: async () => { removals++; return { status: "discarded" }; } },
  });
  const url = "https://pipeline.invalid/api/referrals/1/outlook-draft";
  const context = { params: Promise.resolve({ referralId: "1" }) };
  const post = (body = { action: "connect" }, origin = "https://pipeline.invalid") => route.POST(new Request(url, { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) }), context);
  assert.equal((await post()).status, 401); authenticated = true; assert.equal((await post()).status, 404); allowed = true;
  assert.equal((await post(undefined, "https://other.invalid")).status, 403); assert.equal(connectionCalls, 0);
  live = false;
  assert.equal((await route.GET(new Request(url), context)).status, 200);
  const blocked = await post(); assert.equal(blocked.status, 403); assert.match(await blocked.text(), /Not production yet/); assert.equal(connectionCalls, 0);
  live = true; const connected = await (await post()).json(); assert.equal(connected.mailbox, "staff@example.invalid"); assert.equal(JSON.stringify(connected).includes("synthetic"), false);
  assert.equal((await post({ action: "discard", packet_id: "packet", confirmed: "true" })).status, 400); assert.equal(removals, 0);
  assert.equal((await post({ action: "check", packet_id: "packet" })).status, 200); assert.equal(checks, 1);
  assert.equal((await post({ action: "discard", packet_id: "packet", confirmed: true })).status, 200); assert.equal(removals, 1);
  const connectionsBeforeConfirmation = connectionCalls;
  assert.equal((await post({ action: "confirm_forward", packet_id: "packet", confirmed: "true" })).status, 400);
  assert.equal(confirmations, 0);
  assert.equal((await post({ action: "confirm_forward", packet_id: "packet", confirmed: true })).status, 200);
  assert.equal(confirmations, 1); assert.equal(connectionCalls, connectionsBeforeConfirmation, "manual completion never connects to an assessor mailbox");
});

test("an emailed draft exposes its saved onward audience across staff without granting confirmation or legacy Graph access", async () => {
  const f = handoffFixture(); await f.prepare();
  Object.assign(f.packet.outlook, { delivery: "email", forwardTo: ["reviewed@example.invalid"], forwardCc: ["staff@example.invalid"] });
  const other = await f.owner.workspaceOutlookState(1, "other");
  assert.equal(other.occupied, false); assert.equal(other.draft.can_confirm, false); assert.equal(other.draft.can_replace, false);
  assert.deepEqual(Array.from(other.draft.forward_to), ["reviewed@example.invalid"]);
  assert.equal((await f.owner.workspaceOutlookState(1, "admin", true)).draft.can_replace, true);
  await assert.rejects(f.check(), { status: 404 });
});

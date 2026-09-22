import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
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
function fixture() {
  const directory = mkdtempSync("/tmp/pipeline-assessor-draft-");
  const store = load("lib/notifications/admission-packet-store.ts", {
    "@/lib/database/pipeline-database": { getPipelineDatabaseMode: () => "local_file" },
  }, { process: { env: { PIPELINE_PACKET_LINK_STORE_PATH: directory, PIPELINE_AUTH_MODE: "mock" } } });
  let issue = null, failure, auditFailure = false, finalizations = 0;
  let member = { principal_id: "assessor", display_name: "Synthetic Assessor", active: true, identity_status: "entra_linked", email: "assessor@example.invalid" };
  const sent = [], audits = [];
  const assessor = { id: "assessor", name: "Synthetic Assessor", email: "assessor@example.invalid" };
  const user = { id: "assessor", name: "Synthetic Assessor", roles: ["assessor"] };
  const assessment = { version: 2, signed_at: new Date().toISOString() };
  const audit = { deliveryId: randomUUID(), referralId: 1, assessmentId: "assessment", assessmentVersion: 2, decisionId: "decision", actorId: "assessor", actorName: "Synthetic Assessor" };
  const inventory = { files: [{ id: "chart", name: "Chart.html" }], revision: "revision", ready: true };
  class GraphMailDeliveryError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }
  const view = packet => ({ packet_id: packet.id, delivery: packet.outlook.delivery, status: packet.outlook.status, mailbox: packet.outlook.mailbox });
  const owner = load("lib/notifications/assessor-email-draft.ts", {
    "@/lib/assessment/assessment-store": { getAssessment: async () => assessment,
      deliverAssessmentPacket: async (_id, version, send) => { const result = await send(); finalizations++; assessment.meet_client_sent_version = version; assessment.meet_client_sent_at = result.acceptedAt; } },
    "@/lib/pipeline/workspace-members": { getActiveWorkspaceMember: async () => member },
    "@/lib/pipeline/meet-client-delivery-audit": { completeMeetClientDelivery: async (audit, status) => { if (auditFailure) throw new Error("Store unavailable"); audits.push({ provider: audit.provider, status }); } },
    "./admission-packet-store": store,
    "./outlook-handoff": { currentSource: async () => ({ assessment, issue }), outlookDraftView: view },
    "./admission-packet-files": { admissionPacketUrl: id => `https://pipeline.invalid/admission-packet/${id}`, prepareAdmissionPacketLink: async input => {
      await store.createAdmissionPacket({ schema: 1, ...input, files: inventory.files, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(), recipients: input.recipients.map(email => ({ email, sessions: [], requestedAt: [] })), events: [] });
      return `https://pipeline.invalid/admission-packet/${input.id}`;
    } },
    "./microsoft-graph-mail": { GraphMailDeliveryError, validateMeetClientRecipients: recipients => ({ ok: true, recipients }),
      sendAssessorDraftMail: async input => { sent.push(input); if (failure) throw failure; } },
    "./meet-client-email-template": { renderMeetClientEmail: (_s, _p, _d, _f, _m, options) => ({ subject: "Synthetic handoff", text: "Clinical summary", html: `<html><body><p>Clinical summary</p>${options?.packetUrl || ""}</body></html>` }) },
  });
  return { owner, store, assessor, user, sent, audits, audit, GraphMailDeliveryError,
    prepare: () => owner.prepareAssessorEmailDraft({ assessor, audit, referralVersion: 1, packetRevision: "revision", recipients: ["community@example.invalid"], ccRecipients: [], inventory, summary: {}, preparedBy: user.name, message: {}, requestUrl: "https://pipeline.invalid" }),
    read: () => owner.readEmailDraft(audit.deliveryId, 1),
    confirm: (actor = user) => owner.confirmAssessorEmailDraft(audit.deliveryId, 1, actor),
    discard: (actor = user) => owner.discardAssessorEmailDraft(audit.deliveryId, 1, actor),
    change: value => { issue = value; }, fail: value => { failure = value; }, auditFail: value => { auditFailure = value; }, setMember: value => { member = value; },
    get finalizations() { return finalizations; }, close: () => rmSync(directory, { recursive: true, force: true }) };
}

test("draft resolves an active confirmed identity; guest identifiers and provisional emails are rejected", async () => {
  const f = fixture();
  try {
    assert.equal((await f.owner.assessorDraftRecipient({ signed_by: { id: "assessor" } })).email, f.assessor.email);
    for (const patch of [{ active: false }, { identity_status: "provisional" }, { email: "staff_example.com#EXT#@tenant.invalid" }, { email: "" }]) {
      f.setMember({ principal_id: "assessor", active: true, identity_status: "entra_linked", email: f.assessor.email, ...patch });
      assert.equal(await f.owner.assessorDraftRecipient({ signed_by: { id: "assessor" } }), null);
    }
  } finally { f.close(); }
});
test("preparation goes only to the assessor and carries the full packet and reviewed onward audience without finalizing", async () => {
  const f = fixture();
  try {
    assert.equal((await f.prepare()).status, "draft");
    assert.equal(f.finalizations, 0); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].email, f.assessor.email);
    const packet = await f.read();
    assert.deepEqual(Array.from(packet.outlook.forwardTo), ["community@example.invalid"]);
    assert.deepEqual(Array.from(packet.outlook.forwardCc), [f.assessor.email]);
    assert.equal(packet.recipients.length, 2);
    assert.match(f.sent[0].html, /community@example.invalid/); assert.match(f.sent[0].html, /admission-packet\//);
    assert.match(f.sent[0].html, /return to Pipeline/);
    assert.equal(f.audits.length, 0);
  } finally { f.close(); }
});
test("only the actual assessor can attest; concurrent confirmations finalize once and preserve an explicit manual audit", async () => {
  const f = fixture();
  try {
    await f.prepare();
    await assert.rejects(f.confirm({ id: "admin", roles: ["admin"] }), { status: 403 });
    await assert.rejects(f.confirm({ ...f.user, delegation: {} }), { status: 403 });
    const results = await Promise.all([f.confirm(), f.confirm()]);
    assert.ok(results.every(result => result.status === "sent")); assert.equal(f.finalizations, 1);
    assert.deepEqual(f.audits, [{ status: "sent", provider: "assessor_confirmed_forward" }]);
    await assert.rejects(f.discard(), { status: 409 }); assert.equal((await f.read()).revokedAt, undefined);
  } finally { f.close(); }
});
test("stale drafts revoke access and require replacement; confirmation cannot race past replacement", async () => {
  const f = fixture();
  try {
    await f.prepare(); f.change("Files changed");
    await assert.rejects(f.confirm(), { status: 409 });
    assert.ok((await f.read()).revokedAt); assert.equal((await f.read()).outlook.status, "needs_review"); assert.equal(f.finalizations, 0);
    await f.discard(); await assert.rejects(f.confirm(), { status: 409 });
  } finally { f.close(); }
  const race = fixture();
  try {
    await race.prepare();
    const results = await Promise.allSettled([race.discard(), race.confirm()]);
    assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].status, "rejected"); assert.equal(race.finalizations, 0);
  } finally { race.close(); }
});
test("ambiguous email acceptance is retained without resend; definite rejection safely releases the reservation", async () => {
  for (const definitive of [false, true]) {
    const f = fixture();
    try {
      f.fail(definitive ? new f.GraphMailDeliveryError("denied", 403) : new Error("Connection lost"));
      await assert.rejects(f.prepare(), { status: 503 });
      assert.equal((await f.read()).outlook.status, definitive ? "discarded" : "unconfirmed");
      assert.equal(Boolean((await f.read()).revokedAt), definitive); assert.equal(f.sent.length, 1);
      assert.equal(f.audits.length, definitive ? 1 : 0); assert.equal(f.finalizations, 0);
    } finally { f.close(); }
  }
});
test("an audit failure after finalization recovers on retry without another send or another finalization", async () => {
  const f = fixture();
  try {
    await f.prepare(); f.auditFail(true); await assert.rejects(f.confirm());
    assert.equal((await f.read()).outlook.status, "draft"); assert.equal(f.finalizations, 1);
    await assert.rejects(f.discard(), { status: 409 });
    f.auditFail(false); assert.equal((await f.confirm()).status, "sent"); assert.equal(f.finalizations, 1); assert.equal(f.sent.length, 1);
  } finally { f.close(); }
});
test("instruction HTML escapes names and recipients", () => {
  const f = fixture();
  try {
    const html = f.owner.renderAssessorDraftInstructions('<body class="email">Body</body>', { assessor: { name: '<img src=x>$&' }, to: ['<svg>@example.invalid'], cc: [], workspaceUrl: 'https://pipeline.invalid/?a=1&b=2' });
    assert.doesNotMatch(html, /<img|<svg/); assert.match(html, /&lt;img/); assert.match(html, /\$&amp;/);
  } finally { f.close(); }
});
test("Graph preparation sends only one assessor recipient, and the production hold prevents all network calls", async () => {
  for (const live of [false, true]) {
    const requests = [];
    const mail = loadTypeScriptModule(process.cwd(), 'lib/notifications/microsoft-graph-mail.ts', {
      process: { env: { NODE_ENV: 'production', PIPELINE_MEET_CLIENT_LIVE_ENABLED: String(live), PIPELINE_GRAPH_TENANT_ID: 'fixture', PIPELINE_GRAPH_CLIENT_ID: 'fixture', PIPELINE_GRAPH_CLIENT_SECRET: 'fixture', PIPELINE_MEET_CLIENT_SENDER: 'admissions@example.invalid', PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS: 'example.invalid' } },
      fetch: async (url, init) => { requests.push({ url, init }); return url.includes('/oauth2/') ? Response.json({ access_token: 'synthetic' }) : new Response(null, { status: 202 }); },
    });
    const send = () => mail.sendAssessorDraftMail({ email: 'assessor@example.invalid', html: '<p>Fixture</p>', subject: 'Fixture', deliveryId: 'fixture' });
    if (!live) { await assert.rejects(send()); assert.equal(requests.length, 0); }
    else {
      await send(); const body = JSON.parse(requests.at(-1).init.body);
      assert.match(requests.at(-1).url, /admissions%40example.invalid\/sendMail$/);
      assert.deepEqual(body.message.toRecipients, [{ emailAddress: { address: 'assessor@example.invalid' } }]);
      assert.equal(body.message.ccRecipients, undefined); assert.equal(body.message.bccRecipients, undefined);
    }
  }
});

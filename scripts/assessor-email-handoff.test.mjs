import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import test from "node:test";
import { loadEntry, clean } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const policy = loadEntry("lib/notifications/meet-client-attachment-policy.ts");
const template = loadEntry("lib/notifications/meet-client-email-template.ts");
const realMail = loadTypeScriptModule(process.cwd(), "lib/notifications/microsoft-graph-mail.ts");
const user = { id: "synthetic-assessor", email: "assessor@outlook.com", name: "Synthetic Assessor" };
function fixture(t, options = {}) {
  const dir = mkdtempSync("/tmp/assessor-email-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const globals = { process: { ...process, env: { ...process.env, PIPELINE_AUTH_MODE: "mock", PIPELINE_PACKET_LINK_STORE_PATH: dir, PIPELINE_MEET_CLIENT_DELIVERY_AUDIT_PATH: `${dir}/audit.json` } } };
  const database = { getPipelineDatabaseMode: () => "local_file", getPipelineDatabaseReadiness: () => ({ ready: false }) };
  const store = loadEntry("lib/notifications/admission-packet-store.ts", { "@/lib/database/pipeline-database": database }, globals);
  const audit = loadEntry("lib/pipeline/meet-client-delivery-audit.ts", { "@/lib/database/pipeline-database": database }, globals);
  let finalized = 0, sent = 0, issue = null, sendInput;
  let assessment = { assessment_id: "assessment", version: 7, signed_at: "2026-09-23T12:00:00Z" };
  const assessmentStore = { getAssessment: async () => assessment, deliverAssessmentPacket: async (_id, _version, accept) => {
    const result = await accept(); finalized++; assessment = { ...assessment, version: 8, meet_client_sent_at: result.acceptedAt, meet_client_sent_version: 7 }; return result;
  } };
  const inventory = { ready: true, revision: "1".repeat(64), totalBytes: 7, files: [{ documentId: "sheet", name: "Client data sheet.pdf", byteSize: 7, contentType: "application/pdf", generatedContent: Buffer.from("%PDF-qa"), ready: true }] };
  const files = loadEntry("lib/notifications/admission-packet-files.ts", {
    "./admission-packet-store": store, "@/lib/extraction/document-assets": {}, "@/lib/extraction/azure-blob": {},
    "@/lib/extraction/http-byte-range": {}, "@/lib/pipeline/base-path": {},
  }, globals);
  const handoff = loadEntry("lib/notifications/outlook-handoff.ts", {
    "./admission-packet-store": store, "@/lib/assessment/assessment-store": assessmentStore,
    "@/lib/pipeline/meet-client-delivery-audit": audit, "@/lib/pipeline/workflow-store": {}, "@/lib/assessment/assessment-summary": {},
    "./meet-client-attachments": {}, "./admission-packet-files": files, "./outlook-mail": {}, "./meet-client-email-template": template, "./outlook-attachments": {},
  }, globals);
  const owner = loadEntry("lib/notifications/assessor-email-handoff.ts", {
    "./admission-packet-store": store, "@/lib/assessment/assessment-store": assessmentStore,
    "@/lib/pipeline/meet-client-delivery-audit": audit, "./admission-packet-files": files,
    "./outlook-handoff": { ...handoff, currentSource: async () => ({ assessment, issue }) },
    "./meet-client-email-template": template, "./meet-client-attachment-policy": policy,
    "./microsoft-graph-mail": { GraphMailDeliveryError: realMail.GraphMailDeliveryError, validateMeetClientRecipients: realMail.validateMeetClientRecipients,
      getGraphMailReadiness: () => ({ configured: true, largeAttachmentDeliveryConfigured: options.large ?? true }),
      sendMeetClientMail: async input => { sent++; sendInput = input; await options.wait?.(); if (options.failure) throw options.failure; return { acceptedAt: "2026-09-23T12:00:00Z" }; } },
  }, globals);
  const delivery = { mutationId: randomUUID(), deliveryId: randomUUID(), referralId: 1, assessmentId: "assessment", assessmentVersion: 7, decisionId: "decision", status: "reserved", actorId: user.id, actorName: user.name, recipientCount: 2, recipientDomains: ["example.invalid"], attachmentCount: 1, attachmentBytes: 7, provider: "assessor_email", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const input = { user, destination: user.email, audit: delivery, referralVersion: 2, packetRevision: inventory.revision, recipients: ["care@example.invalid"], ccRecipients: ["team@outlook.com"], inventory, summary: { name: "Synthetic Client", community: "San Pablo", admissionDate: "Sep 24, 2026", bio: [], medications: [], medicationNotes: [], supportSnapshot: [] }, preparedBy: user.name, message: { subject: "Synthetic handoff", body: "Reviewed message <no markup>" } };
  return { owner, store, handoff, audit, input, delivery, inventory, records: () => JSON.parse(readFileSync(`${dir}/audit.json`, "utf8")), sourceIssue: value => { issue = value; }, get sent() { return sent; }, get finalized() { return finalized; }, get sendInput() { return sendInput; },
    prepare: async () => { assert.equal(await audit.reserveMeetClientDelivery(delivery), true); return owner.prepareAssessorEmail(input); },
    action: (action, as = user) => owner.updateAssessorEmail(delivery.deliveryId, 1, as, action) };
}

test("inbox delivery preserves selected recipients and PDF bytes, survives reload, and does not complete the handoff", async t => {
  const f = fixture(t); const draft = await f.prepare();
  assert.equal(draft.delivery_method, "assessor_email"); assert.equal(draft.status, "draft");
  assert.deepEqual(clean(f.sendInput.recipients), [user.email]); assert.deepEqual(clean(f.sendInput.ccRecipients), []);
  assert.deepEqual(clean(f.sendInput.forwarding), { to: ["care@example.invalid"], cc: ["team@outlook.com"] });
  assert.equal(f.sendInput.attachments[0].contentBytes.toString(), "%PDF-qa");
  assert.equal(f.finalized, 0); assert.equal(f.records()[0].status, "assessor_emailed");
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...f.delivery, deliveryId: randomUUID() }), false);
  assert.equal((await f.handoff.workspaceOutlookState(1, user.id)).draft.packet_id, draft.packet_id);
  assert.deepEqual(clean(await f.handoff.workspaceOutlookState(1, "other")), { draft: null, occupied: true });
  assert.equal((await f.store.listAdmissionPacketLinks(1)).length, 0);
  assert.equal((await f.action("forwarded")).status, "sent"); assert.equal(f.finalized, 1);
  assert.equal((await f.action("forwarded")).status, "sent"); assert.equal(f.finalized, 1); assert.equal(f.sent, 1);
});

test("account address is canonical; delegation, missing identity and other owners are rejected", async t => {
  const f = fixture(t);
  assert.equal(f.owner.assessorEmailDestination({ ...user, email: "  ASSESSOR@outlook.com " }), user.email);
  for (const bad of [{ ...user, delegation: {} }, { ...user, email: "" }, { ...user, email: "guest#ext#@tenant.example" }]) assert.throws(() => f.owner.assessorEmailDestination(bad));
  await f.prepare(); await assert.rejects(f.action("forwarded", { ...user, id: "other" }), { status: 404 });
  assert.equal(f.finalized, 0);
});

test("ambiguous sends stay reserved; explicit receipt recovers without a second email", async t => {
  const f = fixture(t, { failure: new Error("network timeout") });
  await assert.rejects(f.prepare(), /outcome is uncertain/);
  assert.equal((await f.handoff.workspaceOutlookState(1, user.id)).draft.status, "unconfirmed");
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...f.delivery, deliveryId: randomUUID() }), false);
  await assert.rejects(f.action("forwarded"), { status: 409 });
  await f.action("received"); await f.action("forwarded"); assert.equal(f.sent, 1); assert.equal(f.finalized, 1);
});

test("a definite refusal releases the reservation and never completes the assessment", async t => {
  const f = fixture(t, { failure: new realMail.GraphMailDeliveryError("denied", "Synthetic refusal", 403) });
  await assert.rejects(f.prepare(), /No email was sent/);
  assert.equal(f.finalized, 0); assert.equal(f.records()[0].status, "failed");
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...f.delivery, deliveryId: randomUUID() }), true);
});

test("changed source cannot be certified as the current handoff; replacement preserves history", async t => {
  const f = fixture(t); await f.prepare(); f.sourceIssue("The admission date changed.");
  assert.equal((await f.action("forwarded")).status, "needs_review"); assert.equal(f.finalized, 0);
  assert.equal((await f.action("replace")).status, "discarded");
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...f.delivery, deliveryId: randomUUID() }), true);
  assert.equal(f.records()[0].errorCode, "assessor_closed_inbox_copy");
});

test("concurrent receipt or replacement cannot interrupt an active send", async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { wait: () => wait }); const sending = f.prepare();
  while (!f.sent) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.action("replace"), { status: 409 }); await assert.rejects(f.action("received"), { status: 409 });
  release(); await sending; assert.equal(f.sent, 1);
});

test("large packets have no Pipeline count or size cap and still require a configured sender", t => {
  const f = fixture(t, { large: false });
  assert.throws(() => f.owner.requireAssessorEmailCapacity({ ...f.inventory, totalBytes: 3e6, files: [{ byteSize: 3e6 }] }), /large-file/);
  const configured = fixture(t);
  const packet = { ...configured.inventory, totalBytes: 51 * 512 * 1024, files: Array.from({ length: 51 }, () => ({ byteSize: 512 * 1024 })) };
  assert.doesNotThrow(() => configured.owner.requireAssessorEmailCapacity(packet));
  assert.equal(packet.files.length, 51);
  assert.equal(f.sent, 0);
});

test("forwarding instructions retain the Alamo HTML, admission data and literal edited message", t => {
  const f = fixture(t);
  const result = template.renderMeetClientEmail(f.input.summary, user.name, "id", ["Client data sheet.pdf"], f.input.message, { forwarding: { to: f.input.recipients, cc: f.input.ccRecipients } });
  for (const text of ["alamo-health-management.png", "Sep 24, 2026", "care@example.invalid", "team@outlook.com", "&lt;no markup&gt;", "Client data sheet.pdf", "Choose Forward"]) assert.ok(result.html.includes(text), text);
  assert.equal(result.subject, "Synthetic handoff"); assert.doesNotMatch(result.html, />[^<]*Pipeline/);
});

test("actual service mail composition sends the original bytes and populated HTML to the assessor only", async () => {
  const requests = [];
  const mail = loadTypeScriptModule(process.cwd(), "lib/notifications/microsoft-graph-mail.ts", { process: { env: {
    NODE_ENV: "production", PIPELINE_MEET_CLIENT_LIVE_ENABLED: "true", PIPELINE_GRAPH_TENANT_ID: "fixture", PIPELINE_GRAPH_CLIENT_ID: "fixture", PIPELINE_GRAPH_CLIENT_SECRET: "synthetic", PIPELINE_MEET_CLIENT_SENDER: "admissions@example.invalid",
  } }, fetch: async (url, init) => {
    requests.push({ url, init });
    if (url.includes("oauth2")) return Response.json({ access_token: "synthetic", expires_in: 3600 });
    return new Response(null, { status: 202 });
  } });
  const originals = [{ name: "Client data sheet.pdf", contentType: "application/pdf", contentBytes: Buffer.from("%PDF-synthetic") }, { name: "Original.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", contentBytes: Buffer.from([80, 75, 3, 4, 0, 255, 128]) }];
  await mail.sendMeetClientMail({ recipients: [user.email], ccRecipients: [], deliveryId: randomUUID(), preparedBy: user.name,
    summary: { name: "Synthetic Client", community: "San Pablo", admissionDate: "2026-10-01" }, message: { subject: "Synthetic subject", body: "Reviewed handoff" },
    forwarding: { to: ["community@example.invalid"], cc: ["care@outlook.com"] }, attachments: originals.map((file, index) => ({ ...file, documentId: String(index), byteSize: file.contentBytes.length })) });
  assert.equal(requests.length, 2);
  assert.ok(requests[1].url.endsWith("/users/admissions%40example.invalid/sendMail"));
  const { message } = JSON.parse(requests[1].init.body);
  assert.deepEqual(message.toRecipients, [{ emailAddress: { address: user.email } }]); assert.deepEqual(message.ccRecipients, []);
  assert.equal(message.subject, "Synthetic subject");
  for (const text of ["alamo-health-management.png", "2026-10-01", "Synthetic Client", "Reviewed handoff", "community@example.invalid"]) assert.ok(message.body.content.includes(text));
  message.attachments.forEach((attachment, index) => { assert.equal(attachment.name, originals[index].name); assert.equal(attachment.contentType, originals[index].contentType); assert.deepEqual(Buffer.from(attachment.contentBytes, "base64"), originals[index].contentBytes); });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { loadEntry, clean } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const template = loadEntry("lib/notifications/meet-client-email-template.ts");
const realMail = loadTypeScriptModule(process.cwd(), "lib/notifications/microsoft-graph-mail.ts");
const schema = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
const summary = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-summary.ts");

function fixture(t, options = {}) {
  const dir = mkdtempSync("/tmp/direct-handoff-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const globals = { process: { ...process, env: { ...process.env, PIPELINE_AUTH_MODE: "mock", PIPELINE_PACKET_LINK_STORE_PATH: dir, PIPELINE_MEET_CLIENT_DELIVERY_AUDIT_PATH: `${dir}/audit.json` } } };
  const db = { getPipelineDatabaseMode: () => "local_file", getPipelineDatabaseReadiness: () => ({ ready: false }) };
  const store = loadEntry("lib/notifications/admission-packet-store.ts", { "@/lib/database/pipeline-database": db }, globals);
  const audit = loadEntry("lib/pipeline/meet-client-delivery-audit.ts", { "@/lib/database/pipeline-database": db }, globals);
  const user = { id: "admin", name: "Synthetic Coordinator", email: "admin@example.invalid", roles: ["admin"] };
  let authUser = user, access = true, originalAvailable = true, originalEtag = "original-1", savedInput;
  let assessment = { ...schema.createEmptyAssessmentToolData(), assessment_id: "assessment", assessor_id: "assessor", version: 7, signed_at: "2026-09-23T10:00:00Z", updated_by: user, signed_by: { id: "assessor", name: "Synthetic Assessor" } };
  let referral = { id: 6, version: 4, name: "Synthetic Client", community: "San Pablo", plannedAdmissionDate: "2026-10-01", requirements: [] };
  const bytes = Buffer.from([80, 75, 3, 4, 0, 255, 128]);
  const blobs = new Map([["raw/original", { bytes, etag: originalEtag }]]);
  const signer = {
    getBlobProperties: async (container, key) => { const b = blobs.get(`${container}/${key}`); return b ? { exists: true, etag: key === "original" ? originalEtag : b.etag, byteSize: b.bytes.length } : { exists: false }; },
    createReadUrl: async (container, key) => `https://storage.invalid/${container}/${key}`,
    archiveBlob: async (source, destination) => { assert.equal(source.etag, originalEtag); const b = blobs.get(`${source.container}/${source.key}`); blobs.set(`${destination.container}/${destination.key}`, { bytes: Buffer.from(b.bytes), etag: "archive-1" }); return { etag: "archive-1", byteSize: b.bytes.length }; },
  };
  let scanStatus = "clean";
  const assets = { getDocumentReferralId: async () => originalAvailable ? 6 : null, getDocumentOriginalAsset: async () => originalAvailable ? { container: "raw", blobKey: "original", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: bytes.length } : null, getDocumentFileMetadata: async () => ({ malware_scan_status: scanStatus }) };
  const files = loadEntry("lib/notifications/admission-packet-files.ts", { "./admission-packet-store": store, "@/lib/extraction/document-assets": assets, "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => signer }, "@/lib/extraction/http-byte-range": {}, "@/lib/pipeline/base-path": {} }, globals);
  const inventory = { ready: true, revision: "1".repeat(64), totalBytes: bytes.length + 7, blockers: [], deliveryMode: "direct", files: [
    { documentId: "sheet", name: "Client data sheet.pdf", byteSize: 7, contentType: "application/pdf", generatedContent: Buffer.from("%PDF-qa"), ready: true },
    { documentId: "original", name: "Original.docx", byteSize: bytes.length, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ready: true },
  ] };
  let sent = 0;
  const assessmentStore = { requireAssessmentStore: () => ({ ok: true }), listAssessments: async () => ({ assessments: [assessment] }), deliverAssessmentPacket: async (id, version, send) => {
    assert.equal(id, assessment.assessment_id); assert.equal(version, assessment.version);
    const result = await send(); if (options.finalizationFailure) throw new Error("synthetic finalization failure");
    assessment = { ...assessment, version: assessment.version + 1, meet_client_sent_at: result.acceptedAt }; return result;
  } };
  const mail = { ...realMail, getGraphMailReadiness: () => ({ configured: true, sender: "admissions@example.invalid", largeAttachmentDeliveryConfigured: true }), isMeetClientLive: () => true,
    sendMeetClientMail: async input => { sent++; savedInput = input; await options.wait?.(); if (options.failure) throw options.failure; return { acceptedAt: "2026-09-23T12:00:00.000Z" }; } };
  const direct = loadEntry("lib/notifications/direct-handoff.ts", {
    "./admission-packet-store": store, "./admission-packet-files": files, "./microsoft-graph-mail": mail,
    "./meet-client-email-template": template, "./assessor-email-handoff": { requireAssessorEmailCapacity: () => {} },
    "@/lib/assessment/assessment-store": assessmentStore, "@/lib/pipeline/workspace-members": { getActiveWorkspaceMember: async id => id === "assessor" ? { email: "assessor@outlook.com", display_name: "Synthetic Assessor" } : null },
    "@/lib/pipeline/meet-client-delivery-audit": audit, "@/lib/extraction/document-assets": assets,
    "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => signer },
  }, globals);
  const auth = { requirePipelineUser: async () => ({ ok: true, user: authUser }) };
  const referralAccess = { requireMutableReferralAccess: async () => access ? { ok: true, referral } : { ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) }, requireReferralAccess: async (_u, id) => access && id === 6 ? { ok: true, referral } : { ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) }, canViewTeamReferralBoard: u => u.roles.includes("admin") };
  const dependencies = {
    "@/lib/auth/pipeline-auth": auth, "@/lib/auth/request-security": { requireSameOriginMutation: req => req.headers.get("origin") === "https://evil.invalid" ? Response.json({ error: "Origin denied" }, { status: 403 }) : null },
    "@/lib/auth/assessor-session-policy": { pipelineAccountableActor: u => u }, "@/lib/pipeline/referral-access": referralAccess,
    "@/lib/pipeline/referral-store": { requireReferralStore: () => ({ ok: true }) }, "@/lib/assessment/assessment-store": assessmentStore,
    "@/lib/assessment/assessment-summary": summary, "@/lib/notifications/direct-handoff": direct,
    "@/lib/notifications/admission-packet-store": store, "@/lib/notifications/admission-packet-files": files,
    "@/lib/notifications/microsoft-graph-mail": mail, "@/lib/notifications/meet-client-email-template": template,
    "@/lib/notifications/outlook-mail": {}, "@/lib/notifications/outlook-handoff": {}, "@/lib/notifications/assessor-email-handoff": {},
    "@/lib/notifications/meet-client-attachments": { getMeetClientAttachmentInventory: async () => inventory },
    "@/lib/pipeline/meet-client-delivery-audit": audit, "@/lib/pipeline/workflow-store": { getReferralWorkflowSnapshot: async () => ({ referral, work_items: [], decision: { outcome: "accepted", decisionId: "decision", assessmentId: "assessment" } }) },
    "@/lib/observability/api-logging": { withApiLogging: (_r, _n, action) => action() }, "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => {} },
  };
  const route = loadEntry("app/api/referrals/[referralId]/meet-client-email/route.ts", dependencies, globals);
  const history = loadEntry("app/api/communications/route.ts", dependencies, { ...globals, fetch: async url => { const b = blobs.get(url.replace("https://storage.invalid/", "")); return b ? new Response(new Uint8Array(b.bytes)) : new Response(null, { status: 404 }); } });
  const body = { recipients: ["care@outlook.com"], cc_recipients: ["team@example.invalid"], confirmed: true,
    if_match: 4, assessment_id: "assessment", if_match_assessment: 7, client_mutation_id: randomUUID(), packet_revision: inventory.revision,
    message: { subject: "Reviewed subject", body: "Exact reviewed text <literal>" } };
  const post = (patch = {}, origin) => route.POST(new Request("http://localhost/api/referrals/6/meet-client-email?delivery=direct", { method: "POST", headers: origin ? { origin } : {}, body: JSON.stringify({ ...body, ...patch }) }), { params: Promise.resolve({ referralId: "6" }) });
  return { store, direct, inventory, body, blobs, bytes, post, get: query => history.GET(new Request(`http://localhost/api/communications?${query}`)),
    prepare: async () => { const response = await post(); assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return (await response.json()).communication; },
    get sent() { return sent; }, get sendInput() { return savedInput; }, deny: () => { access = false; }, as: u => { authUser = u; },
    markUnsafe: () => { scanStatus = "infected"; },
    changeFile: () => { originalEtag = "changed-same-size"; }, withdrawOriginal: () => { originalAvailable = false; blobs.delete("raw/original"); },
    changeDate: () => { referral = { ...referral, version: 5, plannedAdmissionDate: "2026-10-02" }; },
  };
}

test("exact prepared snapshot supplies the actual email, assigned assessor Cc/Reply-To, files and reopenable history", async t => {
  const f = fixture(t); const preview = await f.prepare();
  assert.equal(f.sent, 0); assert.equal(preview.replyTo, "assessor@outlook.com");
  assert.deepEqual(clean(preview.cc), ["team@example.invalid", "assessor@outlook.com"]);
  assert.doesNotMatch(preview.cc.join(), /admin/); assert.match(preview.html, /&lt;literal&gt;/);
  assert.equal((await f.prepare()).id, preview.id, "reopening resumes the same preview");
  const sent = await f.post({ snapshot_id: preview.id }); assert.equal(sent.status, 200);
  assert.equal((await sent.json()).communication.status, "submitted"); assert.equal(f.sent, 1);
  assert.equal(f.sendInput.preparedContent.html, preview.html);
  assert.equal(f.sendInput.preparedContent.subject, preview.subject);
  assert.deepEqual(clean(f.sendInput.recipients), clean(preview.to)); assert.deepEqual(clean(f.sendInput.ccRecipients), clean(preview.cc));
  assert.deepEqual(clean(f.sendInput.replyTo), [preview.replyTo]);
  assert.equal(f.sendInput.attachments[0].contentBytes.toString(), "%PDF-qa");
  assert.match(f.sendInput.attachments[1].sourceUrl, /communications/);
  assert.equal((await f.post({ snapshot_id: preview.id })).status, 200); assert.equal(f.sent, 1);
  f.withdrawOriginal();
  const archived = await f.get(`referral_id=6&packet_id=${preview.id}&file_id=original`);
  assert.equal(archived.status, 200); assert.deepEqual(Buffer.from(await archived.arrayBuffer()), f.bytes);
  const restored = (await (await f.get(`referral_id=6&packet_id=${preview.id}`)).json()).communication;
  assert.equal(restored.html, preview.html); assert.equal(restored.status, "submitted");
  const list = await (await f.get("scope=mine")).json(); assert.equal(list.items.length, 1); assert.equal(list.items[0].html, undefined);
  assert.equal((await f.store.listAdmissionPacketLinks(6)).length, 0);
});

test("unseen changes to message, recipients, date, same-size original bytes or ownership never send", async t => {
  for (const change of ["message", "recipients", "date", "file", "owner"]) {
    const f = fixture(t); const preview = await f.prepare();
    const patch = { snapshot_id: preview.id };
    if (change === "message") patch.message = { subject: "Unseen", body: "Unseen" };
    if (change === "recipients") patch.recipients = ["different@example.invalid"];
    if (change === "date") f.changeDate();
    if (change === "file") f.changeFile();
    if (change === "owner") f.as({ id: "other", name: "Other", email: "other@example.invalid", roles: ["reviewer"] });
    assert.ok((await f.post(patch)).status >= 400, change); assert.equal(f.sent, 0, change);
  }
});

test("record and file access, team history, and cross-origin send enforce real boundaries", async t => {
  const f = fixture(t); const preview = await f.prepare();
  assert.equal((await f.post({ snapshot_id: preview.id }, "https://evil.invalid")).status, 403);
  f.as({ id: "other", name: "Other", roles: ["reviewer"] });
  assert.equal((await f.get("scope=team")).status, 403); assert.equal((await (await f.get("scope=mine")).json()).items.length, 0);
  f.deny();
  assert.equal((await f.get(`referral_id=6&packet_id=${preview.id}`)).status, 404);
  assert.equal((await f.get(`referral_id=6&packet_id=${preview.id}&file_id=original`)).status, 404);
  assert.equal(f.sent, 0);
});

test("ambiguous outcomes retain history and prevent duplicate sends; definite refusal never switches to links", async t => {
  for (const failure of [new Error("lost response"), new realMail.GraphMailDeliveryError("too_large", "Rejected", 413)]) {
    const f = fixture(t, { failure }); const preview = await f.prepare();
    assert.equal((await f.post({ snapshot_id: preview.id })).status, 503);
    const current = (await (await f.get(`referral_id=6&packet_id=${preview.id}`)).json()).communication;
    assert.equal(current.status, failure.status ? "not_sent" : "unconfirmed");
    assert.equal(f.sent, 1); assert.equal(f.sendInput.packetUrl, undefined);
    assert.equal((await f.post({ snapshot_id: preview.id })).status, 409); assert.equal(f.sent, 1);
  }
});

test("provider acceptance survives assessment finalization failure and concurrent clicks send once", async t => {
  const failedFinalization = fixture(t, { finalizationFailure: true }); const preview = await failedFinalization.prepare();
  assert.equal((await failedFinalization.post({ snapshot_id: preview.id })).status, 200);
  assert.equal((await (await failedFinalization.get(`referral_id=6&packet_id=${preview.id}`)).json()).communication.status, "submitted");
  let release; const wait = new Promise(resolve => { release = resolve; }); const f = fixture(t, { wait: () => wait }); const prepared = await f.prepare();
  const sending = f.post({ snapshot_id: prepared.id }); while (!f.sent) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.post({ snapshot_id: prepared.id })).status, 409); release(); assert.equal((await sending).status, 200); assert.equal(f.sent, 1);
});

test("actual Graph envelope and attachment bytes match the prepared content without rendering it again", async () => {
  const requests = [];
  const mail = loadTypeScriptModule(process.cwd(), "lib/notifications/microsoft-graph-mail.ts", { process: { env: {
    NODE_ENV: "production", PIPELINE_MEET_CLIENT_LIVE_ENABLED: "true", PIPELINE_GRAPH_TENANT_ID: "fixture", PIPELINE_GRAPH_CLIENT_ID: "fixture", PIPELINE_GRAPH_CLIENT_SECRET: "synthetic", PIPELINE_MEET_CLIENT_SENDER: "admissions@example.invalid",
  } }, fetch: async (url, init) => { requests.push({ url, init }); return url.includes("oauth2") ? Response.json({ access_token: "synthetic", expires_in: 3600 }) : new Response(null, { status: 202 }); } });
  const content = { subject: "Stored subject", html: "<h1>Stored exact HTML</h1>", text: "Stored text" };
  const bytes = Buffer.from([0, 255, 70]);
  await mail.sendMeetClientMail({ recipients: ["recipient@outlook.com"], ccRecipients: ["assessor@outlook.com"], replyTo: ["assessor@outlook.com"],
    summary: null, preparedBy: "Assessor", deliveryId: randomUUID(), preparedContent: content,
    attachments: [{ name: "Original.docx", contentType: "application/octet-stream", byteSize: bytes.length, contentBytes: bytes }] });
  const { message } = JSON.parse(requests[1].init.body);
  assert.equal(message.body.content, content.html); assert.equal(message.subject, content.subject);
  assert.equal(message.from.emailAddress.address, "admissions@example.invalid");
  assert.equal(message.replyTo[0].emailAddress.address, "assessor@outlook.com");
  assert.equal(message.ccRecipients[0].emailAddress.address, "assessor@outlook.com");
  assert.deepEqual(Buffer.from(message.attachments[0].contentBytes, "base64"), bytes);
});


test("assessor is not duplicated in To/Cc, and a missing assessor email never substitutes the coordinator", async t => {
  const f = fixture(t);
  const response = await f.post({ recipients: ["assessor@outlook.com"] });
  assert.equal(response.status, 200);
  const record = (await response.json()).communication;
  assert.deepEqual(clean(record.to), ["assessor@outlook.com"]);
  assert.deepEqual(clean(record.cc), ["team@example.invalid"]);
  assert.equal(record.replyTo, "assessor@outlook.com");
  await assert.rejects(f.direct.directHandoffAssessor({ assessor_id: "missing" }, { id: "admin", email: "admin@example.invalid" }), { status: 422 });
});

test("a later unsafe verdict denies the archived file even after original withdrawal", async t => {
  const f = fixture(t); const preview = await f.prepare(); f.withdrawOriginal(); f.markUnsafe();
  assert.equal((await f.get(`referral_id=6&packet_id=${preview.id}&file_id=original`)).status, 409);
  assert.equal(f.sent, 0);
});

test("archive copies pin the reviewed ETag and cannot overwrite a saved destination", async () => {
  let copied;
  class BlobServiceClient {
    async getUserDelegationKey() { return {}; }
    getContainerClient(container) { assert.equal(container, "artifacts"); return { getBlockBlobClient: key => {
      assert.equal(key, "communications/6/packet/original");
      return { syncUploadFromURL: async (source, options) => { copied = { source, options }; }, getProperties: async () => ({ etag: "saved", contentLength: 42, contentType: "application/pdf" }) };
    } }; }
  }
  const azure = loadEntry("lib/extraction/azure-blob.ts", {
    "@azure/identity": { DefaultAzureCredential: class {} },
    "@azure/storage-blob": { BlobServiceClient, BlobSASPermissions: { parse: value => value }, SASProtocol: { Https: "https" }, generateBlobSASQueryParameters: () => ({ toString: () => "synthetic" }) },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => {} },
  }, { process: { env: { AZURE_STORAGE_ACCOUNT: "synthetic" } } });
  const result = await azure.getAzureBlobUploadSigner().archiveBlob({ container: "raw", key: "reviewed.pdf", etag: "reviewed-version" }, { container: "artifacts", key: "communications/6/packet/original" });
  assert.equal(result.etag, "saved"); assert.equal(result.byteSize, 42);
  assert.equal(copied.options.sourceConditions.ifMatch, "reviewed-version");
  assert.equal(copied.options.conditions.ifNoneMatch, "*");
  assert.match(copied.source, /^https:\/\/synthetic\.blob\.core\.windows\.net\/raw\/reviewed.pdf\?/);
});

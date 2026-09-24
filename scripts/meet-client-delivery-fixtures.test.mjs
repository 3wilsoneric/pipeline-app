import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { resolve } from "node:path";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const summaryOwner = loadTypeScriptModule(resolve(import.meta.dirname, ".."), "lib/assessment/assessment-summary.ts");
const schemaOwner = loadTypeScriptModule(resolve(import.meta.dirname, ".."), "lib/assessment/assessment-tool-schema.ts");
const recipientOwner = loadTypeScriptModule(resolve(import.meta.dirname, ".."), "lib/notifications/microsoft-graph-mail.ts");

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync("app/api/referrals/[referralId]/meet-client-email/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

test("corrected identity replaces placeholders in the Meet the Client summary", () => {
  const assessment = { ...schemaOwner.createEmptyAssessmentToolData(), resident_name: "Pending Review", community: "Unassigned" };
  const referral = { name: "Casey Rivera", community: "San Pablo", dob: "", currentMedications: "", source: "" };
  const summary = summaryOwner.buildMeetClientSummary(assessment, referral);
  assert.equal(summary.name, "Casey Rivera");
  assert.equal(summary.community, "San Pablo");
  const fromAssessment = summaryOwner.buildMeetClientSummary({ ...assessment, resident_name: "Jordan Lee", community: "Santa Clarita" }, { ...referral, name: "Pending Review", community: "Unassigned" });
  assert.equal(fromAssessment.name, "Jordan Lee");
  assert.equal(fromAssessment.community, "Santa Clarita");
});

test("provider acceptance survives audit failure without recording a false failed send", async () => {
  const fixture = deliveryFixture({ auditFailure: true });
  const response = await fixture.send();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.accepted_at, "2026-09-11T12:00:00.000Z");
  assert.equal(body.audit_pending, true);
  assert.equal(body.delivery_id.length, 36);
  assert.deepEqual(fixture.auditStates, ["sent"]);
  assert.equal(fixture.providerCalls(), 1);
  assert.ok(fixture.metrics.includes("acceptance_audit_pending"));
  assert.equal((await fixture.send()).status, 409);
  assert.equal(fixture.providerCalls(), 1);
});

test("an unconfirmed provider outcome remains unconfirmed even if the failure audit also fails", async () => {
  const fixture = deliveryFixture({ auditFailure: true, providerFailure: true });
  const response = await fixture.send();
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /did not confirm acceptance/);
  assert.doesNotMatch(body.error, /No email was sent/);
  assert.deepEqual(fixture.auditStates, ["unconfirmed"]);
  assert.equal(fixture.providerCalls(), 1);
  assert.ok(fixture.metrics.includes("failure_audit_pending"));
});

test("confirmed acceptance reports the packet counts and blocks a replay", async () => {
  const fixture = deliveryFixture();
  const response = await fixture.send();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.attachment_count, 2);
  assert.equal(body.attachment_bytes, 800);
  assert.equal(body.recipient_count, 1);
  assert.equal(body.audit_pending, undefined);
  assert.deepEqual(fixture.auditStates, ["sent"]);
  assert.equal((await fixture.send()).status, 409);
  assert.equal(fixture.providerCalls(), 1);
});

test("an edit while preparing the packet stops the stale send before the provider", async () => {
  const fixture = deliveryFixture({ assessmentChanged: true });
  assert.equal((await fixture.send()).status, 409);
  assert.equal(fixture.providerCalls(), 0);
});

test("an assessment edited after preview cannot send unseen changes", async () => {
  const fixture = deliveryFixture({ previewAssessmentVersion: 6 });
  assert.equal((await fixture.send()).status, 409);
  assert.equal(fixture.providerCalls(), 0);
  assert.equal(fixture.reservationCalls(), 0);
});

test("an unnamed or unassigned handoff cannot reserve or email a packet", async () => {
  for (const identity of [{ name: "Pending Review", community: "San Pablo" }, { name: "Synthetic Client", community: "Unassigned" }]) {
    const fixture = deliveryFixture(identity);
    const response = await fixture.send();
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /chart before preparing Meet the Client/);
    assert.equal(fixture.reservationCalls(), 0);
    assert.equal(fixture.providerCalls(), 0);
  }
});

test("the preview must identify a valid assessment and its exact version", async () => {
  for (const body of [
    { assessment_id: undefined }, { assessment_id: "different-assessment" },
    { assessment_id: "../invalid" }, { if_match_assessment: undefined },
    { if_match_assessment: 0 }, { if_match_assessment: -1 },
    { if_match_assessment: 1.5 }, { if_match_assessment: "7" },
  ]) {
    const fixture = deliveryFixture();
    assert.equal((await fixture.send("6", body)).status, 409);
    assert.equal(fixture.providerCalls(), 0);
    assert.equal(fixture.reservationCalls(), 0);
  }
});

test("accepted mail is never reported as failed when finalization storage fails", async () => {
  const fixture = deliveryFixture({ finalizationFailure: true });
  const response = await fixture.send();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).audit_pending, true);
  assert.deepEqual(fixture.auditStates, ["sent"]);
  assert.equal((await fixture.send()).status, 409);
  assert.equal(fixture.providerCalls(), 1);
});

test("invalid route identities and denied roles cannot reserve or send an email", async () => {
  for (const id of ["6junk", "-6", "0", "1.5", "9007199254740992"]) {
    const fixture = deliveryFixture();
    assert.equal((await fixture.send(id)).status, 400);
    assert.equal(fixture.providerCalls(), 0);
    assert.equal(fixture.reservationCalls(), 0);
  }
  const denied = deliveryFixture({ denied: true });
  assert.equal((await denied.send()).status, 403);
  assert.equal(denied.providerCalls(), 0);
  assert.equal(denied.reservationCalls(), 0);
});

test("acceptance at a draft version allows an explicit send after signing with a planned admission date", async () => {
  const fixture = deliveryFixture({ decisionVersion: 1 });
  assert.equal((await fixture.send()).status, 200);
  assert.equal(fixture.providerCalls(), 1);
  assert.equal(fixture.audits[0].assessmentVersion, 7);
});

test("missing or invalid planned dates cannot reserve a delivery or contact the provider", async () => {
  for (const admissionDate of ["", "not-a-date", "2026-02-30"]) {
    const fixture = deliveryFixture({ admissionDate });
    const response = await fixture.send();
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /planned admit date/);
    assert.equal(fixture.providerCalls(), 0);
    assert.equal(fixture.reservationCalls(), 0);
  }
});

test("stale previews and unsigned or unrelated assessments cannot reserve or send", async () => {
  for (const [options, status] of [
    [{ previewVersion: 3 }, 409],
    [{ signed: false }, 422],
    [{ decisionAssessmentId: "different-assessment" }, 422],
  ]) {
    const fixture = deliveryFixture(options);
    assert.equal((await fixture.send()).status, status);
    assert.equal(fixture.providerCalls(), 0);
    assert.equal(fixture.reservationCalls(), 0);
  }
});

test("an isolated demo cannot reserve or send even with a configured mail provider", async () => {
  const fixture = deliveryFixture({ exampleOnly: true });
  const response = await fixture.send();
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Not production yet/);
  assert.equal(fixture.providerCalls(), 0);
  assert.equal(fixture.reservationCalls(), 0);
  assert.deepEqual(fixture.auditStates, []);
});

test("delivery and its generated chart use fresh agreement work items and the canonical clinical handoff", async () => {
  const fixture = deliveryFixture();
  assert.equal((await fixture.send()).status, 200);
  const summary = fixture.messages[0].summary;
  assert.match(summary.admissionNotes.find(({ label }) => label === "Signed admission agreement").value, /signatures still need review/);
  assert.equal(summary.medicationNotes.find(({ label }) => label === "Last injection given").value, "Synthetic injection - date unknown");
  assert.equal(summary.safetyNotes.find(({ label }) => label === "Last reported assault \/ context").value, "Synthetic historical incident");
  assert.deepEqual(fixture.packetReports[0].meetClient, summary);
});

test("edited message reaches the provider unchanged, and malformed edits never reserve a send", async () => {
  const message = { subject: "Meet the Client — arrival", body: "Hello team,\nPlease call before arrival. <script>text only</script>" };
  const fixture = deliveryFixture();
  assert.equal((await fixture.send("6", { message })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.messages[0].message)), message);
  for (const invalid of [{ subject: "Bad\r\nBcc: x@example.invalid", body: "Hello" }, { subject: "Okay", body: "x".repeat(20_001) }, { subject: [], body: "Hello" }]) {
    const rejected = deliveryFixture();
    assert.equal((await rejected.send("6", { message: invalid })).status, 400);
    assert.equal(rejected.providerCalls(), 0);
    assert.equal(rejected.reservationCalls(), 0);
  }
});

function deliveryFixture({ secureLink = false, rejectedSize = false, exampleOnly = false, auditFailure = false, providerFailure = false, finalizationFailure = false, assessmentChanged = false, denied = false, admissionDate = "2026-09-20", previewVersion = 4, previewAssessmentVersion = 7, decisionVersion = 7, signed = true, decisionAssessmentId = "synthetic-assessment", name = "Synthetic Client", community = "San Pablo" } = {}) {
  let calls = 0;
  let reservations = 0;
  const mutationIds = new Set();
  const auditStates = [];
  const metrics = [];
  const audits = [];
  const messages = [];
  const packetReports = [];
  const assessment = { ...schemaOwner.createEmptyAssessmentToolData(), assessment_id: "synthetic-assessment", version: 7, updated_by: { name: "Synthetic Assessor" }, signed_at: signed ? "2026-09-11T10:00:00Z" : null, im_injections: "yes", last_injection: "Synthetic injection - date unknown", assault_history: "yes", last_assault_details: "Synthetic historical incident" };
  const referral = { id: 6, version: 4, name, dob: "1970-01-01", source: "Synthetic Clinic", community, admissionDate, requirements: [{ type: "signed_admission_agreement", status: "needed" }] };
  const jsonError = (error, status = 400) => Response.json({ error }, { status });
  class GraphMailDeliveryError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
  const dependencies = {
    "@/lib/notifications/direct-handoff": {},
    "@/lib/notifications/assessor-email-handoff": {
      assessorEmailDestination: user => user.email, requireAssessorEmailCapacity: () => {},
      prepareAssessorEmail: async input => { messages.push(input); return { status: "draft", mailbox: input.destination, delivery_method: "assessor_email" }; },
    },
    "@/lib/notifications/outlook-mail": { getOutlookMailReadiness: () => ({ configured: true, largeAttachmentDeliveryConfigured: true }), connectedOutlookMailbox: async () => ({ id: "synthetic-coordinator", graphId: "synthetic-home-mailbox", email: "coordinator@example.invalid", token: "synthetic-token" }) },
    "@/lib/notifications/outlook-handoff": { prepareOutlookHandoff: async input => { messages.push(input); return { status: "draft", mailbox: input.mailbox.email }; } },
    "@/lib/notifications/admission-packet-files": { prepareAdmissionPacketLink: async (input) => { assert.equal(input.inventory.files.length, 2); return "https://pipeline.invalid/admission-packet/synthetic"; } },
    "@/lib/notifications/admission-packet-store": { PacketAccessError: class extends Error {}, findWorkspaceOutlookDraft: async () => null },
    "@/lib/notifications/meet-client-email-template": loadTypeScriptModule(process.cwd(), "lib/notifications/meet-client-email-template.ts"),
    "@/lib/notifications/meet-client-message": loadTypeScriptModule(process.cwd(), "lib/notifications/meet-client-message.ts"),
    "@/lib/notifications/meet-client-identity": loadTypeScriptModule(process.cwd(), "lib/notifications/meet-client-identity.ts"),
    "@/lib/pipeline/admission-lifecycle": loadTypeScriptModule(process.cwd(), "lib/pipeline/admission-lifecycle.ts"),
    "@/lib/demo/demo-environment": { getPipelineDemoEnvironment: () => ({ enabled: exampleOnly, writable: exampleOnly }) },
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles) => {
      assert.equal(roles, undefined);
      return denied ? { ok: false, response: jsonError("Forbidden", 403) } : { ok: true, user: { id: "synthetic-coordinator", email: "coordinator@example.invalid" } };
    } },
    "@/lib/auth/assessor-session-policy": { pipelineAccountableActor: () => ({ id: "synthetic-coordinator", name: "Synthetic Coordinator" }) },
    "@/lib/auth/request-security": { requireSameOriginMutation: () => null },
    "@/lib/assessment/assessment-store": {
      requireAssessmentStore: () => ({ ok: true }), listAssessments: async () => ({ assessments: [assessment] }),
      deliverAssessmentPacket: async (id, version, send) => {
        assert.equal(id, assessment.assessment_id);
        assert.equal(version, assessment.version);
        if (assessmentChanged) throw new Error("The assessment changed. Refresh Meet the Client before sending.");
        const result = await send();
        if (finalizationFailure) throw new Error("Synthetic finalization failure");
        return result;
      },
    },
    "@/lib/assessment/assessment-summary": summaryOwner,
    "@/lib/extraction/contracts": { jsonError, readJsonBody: async (request) => ({ ok: true, value: await request.json() }) },
    "@/lib/notifications/meet-client-attachments": {
      getMeetClientAttachmentInventory: async (_referral, { report }) => { packetReports.push(report); return { ready: true, revision: "1".repeat(64), totalBytes: 800, blockers: [], deliveryMode: secureLink ? "secure_link" : "direct", files: [{ name: "one.pdf", byteSize: 300 }, { name: "two.pdf", byteSize: 500 }] }; },
      prepareMeetClientMailAttachments: async () => [{ byteSize: 300 }, { byteSize: 500 }],
    },
    "@/lib/notifications/microsoft-graph-mail": {
      GraphMailDeliveryError,
      isMeetClientLive: () => !exampleOnly,
      getGraphMailReadiness: () => ({ configured: true }),
      validateMeetClientRecipients: recipientOwner.validateMeetClientRecipients,
      sendMeetClientMail: async (message) => {
        calls += 1;
        messages.push(message);
        if (rejectedSize && calls === 1) throw new GraphMailDeliveryError("graph_send_message_rejected", "Too large", 413);
        if (providerFailure) throw new Error("Synthetic transport outcome unknown");
        return { acceptedAt: "2026-09-11T12:00:00.000Z", attachmentCount: 2, attachmentBytes: 800 };
      },
    },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, action) => action() },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: (_name, _value, _unit, dimensions) => metrics.push(dimensions.result) },
    "@/lib/pipeline/meet-client-delivery-audit": {
      reserveMeetClientDelivery: async (audit) => {
        reservations += 1;
        audits.push(audit);
        if (mutationIds.has(audit.mutationId)) return false;
        mutationIds.add(audit.mutationId);
        return true;
      },
      completeMeetClientDelivery: async (_audit, status) => {
        auditStates.push(status);
        if (auditFailure) throw new Error("Synthetic audit storage unavailable");
      },
    },
    "@/lib/pipeline/referral-access": { requireMutableReferralAccess: async () => ({ ok: true }) },
    "@/lib/pipeline/referral-store": { requireReferralStore: () => ({ ok: true }) },
    "@/lib/pipeline/workflow-store": { getReferralWorkflowSnapshot: async () => ({ referral, work_items: [{ type: "signed_admission_agreement", status: "received", evidenceDocumentName: "Synthetic agreement.pdf" }], decision: { outcome: "accepted", decisionId: "synthetic-decision", assessmentId: decisionAssessmentId, assessmentVersion: decisionVersion } }) },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, Request, Response, DOMException, Error, URL,
    require: (name) => {
      if (name === "node:crypto") return require(name);
      if (dependencies[name]) return dependencies[name];
      throw new Error(`Unexpected mail route dependency: ${name}`);
    },
  });
  return {
    auditStates, metrics, audits, messages, packetReports, providerCalls: () => calls, reservationCalls: () => reservations,
    send: (referralId = "6", body = {}, delivery = "") => exports.POST(new Request(`http://localhost/api/referrals/6/meet-client-email${delivery ? `?delivery=${delivery}` : ""}`, {
      method: "POST", body: JSON.stringify({ confirmed: true, if_match: previewVersion, assessment_id: "synthetic-assessment", if_match_assessment: previewAssessmentVersion, recipients: ["synthetic@example.invalid"], client_mutation_id: "synthetic-delivery-fixture", packet_revision: "1".repeat(64), ...body }),
    }), { params: Promise.resolve({ referralId }) }),
  };
}


test("oversized packets send one verified-recipient link containing all files", async () => {
  const fixture = deliveryFixture({ secureLink: true });
  assert.equal((await fixture.send()).status, 200);
  assert.equal(fixture.providerCalls(), 1);
  assert.equal(fixture.messages[0].attachments.length, 0);
  assert.equal(fixture.messages[0].packetFiles.length, 2);
  assert.match(fixture.messages[0].packetUrl, /^https:/);
});
test("a definite size refusal switches to a complete linked packet exactly once", async () => {
  const fixture = deliveryFixture({ rejectedSize: true });
  assert.equal((await fixture.send()).status, 200);
  assert.equal(fixture.providerCalls(), 2);
  assert.equal(fixture.messages[1].attachments.length, 0);
  assert.equal(fixture.messages[1].packetFiles.length, 2);
  assert.equal((await fixture.send()).status, 409);
  assert.equal(fixture.providerCalls(), 2);
});


test("files changed after preview require fresh review without reserving a send", async () => {
  const fixture = deliveryFixture();
  assert.equal((await fixture.send("6", { packet_revision: "2".repeat(64) })).status, 409);
  assert.equal(fixture.reservationCalls(), 0);
  assert.equal(fixture.providerCalls(), 0);
});


test("unconfirmed recipients never reserve or send, including truthy non-boolean values", async () => {
  for (const confirmed of [false, undefined, 1, "true", null]) {
    const fixture = deliveryFixture();
    assert.equal((await fixture.send("6", { confirmed })).status, 400);
    assert.equal(fixture.reservationCalls(), 0);
    assert.equal(fixture.providerCalls(), 0);
  }
});

test("the Outlook route prepares the reviewed draft without invoking automatic mail delivery", async () => {
  const fixture = deliveryFixture();
  const response = await fixture.send("6", { recipients: ["synthetic@outlook.com"], cc_recipients: ["copy@gmail.com", "community@new-domain.invalid"] }, "outlook");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).draft.status, "draft");
  assert.equal(fixture.providerCalls(), 0);
  assert.equal(fixture.messages.length, 1);
  assert.deepEqual(Array.from(fixture.messages[0].recipients), ["synthetic@outlook.com"]);
  assert.deepEqual(Array.from(fixture.messages[0].ccRecipients), ["copy@gmail.com", "community@new-domain.invalid"]);
  assert.equal(fixture.messages[0].audit.assessmentVersion, 7);
  assert.equal(fixture.messages[0].audit.provider, "outlook_draft");
  assert.equal(fixture.messages[0].inventory.files.length, 2);
  assert.deepEqual(fixture.auditStates, []);
  assert.equal((await fixture.send("6", {}, "outlook")).status, 409);
  for (const options of [{ previewAssessmentVersion: 6 }, { previewVersion: 3 }]) {
    const stale = deliveryFixture(options);
    assert.equal((await stale.send("6", {}, "outlook")).status, 409);
    assert.equal(stale.messages.length, 0); assert.equal(stale.reservationCalls(), 0);
  }
});

test("unsupported draft transports cannot fall back to sending mail", async () => {
  for (const delivery of ["email_draft", "unknown"]) {
    const fixture = deliveryFixture();
    assert.equal((await fixture.send("6", {}, delivery)).status, 400);
    assert.equal(fixture.providerCalls(), 0); assert.equal(fixture.reservationCalls(), 0);
  }
});

test("email-to-assessor route ignores caller destination, skips mailbox consent and retains reviewed audience", async () => {
  const f = deliveryFixture();
  const response = await f.send("6", { destination: "outsider@example.invalid", email: "outsider@example.invalid", recipients: ["community@example.invalid"], cc_recipients: ["care@outlook.com"] }, "assessor");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).draft.mailbox, "coordinator@example.invalid");
  assert.equal(f.messages[0].destination, "coordinator@example.invalid");
  assert.deepEqual(Array.from(f.messages[0].recipients), ["community@example.invalid"]);
  assert.deepEqual(Array.from(f.messages[0].ccRecipients), ["care@outlook.com"]);
  assert.equal(f.audits[0].provider, "assessor_email");
  assert.equal(f.providerCalls(), 0); assert.deepEqual(f.auditStates, []);
});

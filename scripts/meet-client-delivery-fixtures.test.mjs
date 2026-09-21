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

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync("app/api/referrals/[referralId]/meet-client-email/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

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
  assert.deepEqual(fixture.auditStates, ["failed"]);
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
    assert.match((await response.json()).error, /planned admission date/);
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
  assert.match((await response.json()).error, /example only/);
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
  assert.equal((await fixture.send("6", message)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.messages[0].message)), message);
  for (const invalid of [{ subject: "Bad\r\nBcc: x@example.invalid", body: "Hello" }, { subject: "Okay", body: "x".repeat(20_001) }, { subject: [], body: "Hello" }]) {
    const rejected = deliveryFixture();
    assert.equal((await rejected.send("6", invalid)).status, 400);
    assert.equal(rejected.providerCalls(), 0);
    assert.equal(rejected.reservationCalls(), 0);
  }
});

function deliveryFixture({ exampleOnly = false, auditFailure = false, providerFailure = false, finalizationFailure = false, assessmentChanged = false, denied = false, admissionDate = "2026-09-20", previewVersion = 4, decisionVersion = 7, signed = true, decisionAssessmentId = "synthetic-assessment" } = {}) {
  let calls = 0;
  let reservations = 0;
  const mutationIds = new Set();
  const auditStates = [];
  const metrics = [];
  const audits = [];
  const messages = [];
  const packetReports = [];
  const assessment = { ...schemaOwner.createEmptyAssessmentToolData(), assessment_id: "synthetic-assessment", version: 7, updated_by: { name: "Synthetic Assessor" }, signed_at: signed ? "2026-09-11T10:00:00Z" : null, im_injections: "yes", last_injection: "Synthetic injection - date unknown", assault_history: "yes", last_assault_details: "Synthetic historical incident" };
  const referral = { id: 6, version: 4, name: "Synthetic Client", dob: "1970-01-01", source: "Synthetic Clinic", community: "San Pablo", admissionDate, requirements: [{ type: "signed_admission_agreement", status: "needed" }] };
  const jsonError = (error, status = 400) => Response.json({ error }, { status });
  class GraphMailDeliveryError extends Error {}
  const dependencies = {
    "@/lib/notifications/meet-client-message": loadTypeScriptModule(process.cwd(), "lib/notifications/meet-client-message.ts"),
    "@/lib/pipeline/admission-lifecycle": loadTypeScriptModule(process.cwd(), "lib/pipeline/admission-lifecycle.ts"),
    "@/lib/demo/demo-environment": { getPipelineDemoEnvironment: () => ({ writable: exampleOnly }) },
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles) => {
      assert.equal(roles, undefined);
      return denied ? { ok: false, response: jsonError("Forbidden", 403) } : { ok: true, user: { id: "synthetic-coordinator" } };
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
      getMeetClientAttachmentInventory: async (_referral, { report }) => { packetReports.push(report); return { ready: true, totalBytes: 800, blockers: [] }; },
      prepareMeetClientMailAttachments: async () => [{ byteSize: 300 }, { byteSize: 500 }],
    },
    "@/lib/notifications/microsoft-graph-mail": {
      GraphMailDeliveryError,
      getGraphMailReadiness: () => ({ configured: true }),
      validateMeetClientRecipients: (recipients) => ({ ok: true, recipients }),
      sendMeetClientMail: async (message) => {
        calls += 1;
        messages.push(message);
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
    exports, Request, Response, DOMException, Error,
    require: (name) => {
      if (name === "node:crypto") return require(name);
      if (dependencies[name]) return dependencies[name];
      throw new Error(`Unexpected mail route dependency: ${name}`);
    },
  });
  return {
    auditStates, metrics, audits, messages, packetReports, providerCalls: () => calls, reservationCalls: () => reservations,
    send: (referralId = "6", message) => exports.POST(new Request("http://localhost/api/referrals/6/meet-client-email", {
      method: "POST", body: JSON.stringify({ confirmed: true, if_match: previewVersion, recipients: ["synthetic@example.invalid"], client_mutation_id: "synthetic-delivery-fixture", message }),
    }), { params: Promise.resolve({ referralId }) }),
  };
}

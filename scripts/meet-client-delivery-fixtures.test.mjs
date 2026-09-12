import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

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

function deliveryFixture({ auditFailure = false, providerFailure = false, denied = false } = {}) {
  let calls = 0;
  let reservations = 0;
  const mutationIds = new Set();
  const auditStates = [];
  const metrics = [];
  const assessment = { assessment_id: "synthetic-assessment", version: 7, signed_at: "2026-09-11T10:00:00Z" };
  const referral = { id: 6, community: "San Pablo" };
  const jsonError = (error, status = 400) => Response.json({ error }, { status });
  class GraphMailDeliveryError extends Error {}
  const dependencies = {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles) => {
      assert.deepEqual(Array.from(roles), ["admin", "assessment_coordinator"]);
      return denied ? { ok: false, response: jsonError("Forbidden", 403) } : { ok: true, user: { id: "synthetic-coordinator" } };
    } },
    "@/lib/auth/assessor-session-policy": { pipelineAccountableActor: () => ({ id: "synthetic-coordinator", name: "Synthetic Coordinator" }) },
    "@/lib/auth/request-security": { requireSameOriginMutation: () => null },
    "@/lib/assessment/assessment-store": { requireAssessmentStore: () => ({ ok: true }), listAssessments: async () => ({ assessments: [assessment] }) },
    "@/lib/assessment/assessment-summary": { buildMeetClientSummary: () => ({ preparedFromAssessmentId: assessment.assessment_id }) },
    "@/lib/extraction/contracts": { jsonError, readJsonBody: async (request) => ({ ok: true, value: await request.json() }) },
    "@/lib/notifications/meet-client-attachments": {
      getMeetClientAttachmentInventory: async () => ({ ready: true, totalBytes: 800, blockers: [] }),
      prepareMeetClientMailAttachments: async () => [{ byteSize: 300 }, { byteSize: 500 }],
    },
    "@/lib/notifications/microsoft-graph-mail": {
      GraphMailDeliveryError,
      getGraphMailReadiness: () => ({ configured: true }),
      validateMeetClientRecipients: (recipients) => ({ ok: true, recipients }),
      sendMeetClientMail: async () => {
        calls += 1;
        if (providerFailure) throw new Error("Synthetic transport outcome unknown");
        return { acceptedAt: "2026-09-11T12:00:00.000Z", attachmentCount: 2, attachmentBytes: 800 };
      },
    },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, action) => action() },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: (_name, _value, _unit, dimensions) => metrics.push(dimensions.result) },
    "@/lib/pipeline/meet-client-delivery-audit": {
      reserveMeetClientDelivery: async (audit) => {
        reservations += 1;
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
    "@/lib/pipeline/workflow-store": { getReferralWorkflowSnapshot: async () => ({ referral, decision: { outcome: "accepted", decisionId: "synthetic-decision", assessmentId: assessment.assessment_id, assessmentVersion: 7 } }) },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, Request, Response, DOMException,
    require: (name) => {
      if (name === "node:crypto") return require(name);
      if (dependencies[name]) return dependencies[name];
      throw new Error(`Unexpected mail route dependency: ${name}`);
    },
  });
  return {
    auditStates, metrics, providerCalls: () => calls, reservationCalls: () => reservations,
    send: (referralId = "6") => exports.POST(new Request("http://localhost/api/referrals/6/meet-client-email", {
      method: "POST", body: JSON.stringify({ confirmed: true, recipients: ["synthetic@example.invalid"], client_mutation_id: "synthetic-delivery-fixture" }),
    }), { params: Promise.resolve({ referralId }) }),
  };
}

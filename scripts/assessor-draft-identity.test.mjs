import assert from "node:assert/strict";
import test from "node:test";
import { clean, loadEntry } from "./contact-import-fixtures.mjs";

function identityFixture({ ready = true, links = [{ status: "confirmed", resident_key: "synthetic:resident" }], status, canonical = "verified-client" } = {}) {
  class ClinicalDataError extends Error {
    constructor(status) { super("Synthetic census failure"); this.status = status; }
  }
  return loadEntry("lib/assessment/assessment-client-identity.ts", {
    "@/lib/pipeline/resident-link-store": {
      getResidentLinkStoreReadiness: () => ({ ready }),
      listResidentLinks: async () => ({ links }),
    },
    "@/lib/clinical/clinical-data": {
      ClinicalDataError,
      clinicalDataErrorResponse: (error) => Response.json({ error: error.message }, { status: error.status }),
      getClinicalResident: async () => {
        if (status) throw new ClinicalDataError(status);
        return { resident: { canonical_client_id: canonical } };
      },
    },
  });
}

test("draft creation tolerates unavailable or unresolved census identity without inventing a link", async () => {
  for (const options of [
    { ready: false }, { status: 503 }, { canonical: "" },
    { links: [{ status: "confirmed" }, { status: "confirmed" }] },
  ]) {
    const identity = identityFixture(options);
    const created = [];
    const actor = { id: "assessor", name: "Synthetic Assessor", roles: ["reviewer"] };
    const route = loadEntry("app/api/referrals/[referralId]/assessments/route.ts", {
      "@/lib/assessment/assessment-client-identity": identity,
      "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => ({ ok: true, user: actor }) },
      "@/lib/auth/assessor-session-policy": { pipelineAuditActor: () => actor },
      "@/lib/observability/api-logging": { withApiLogging: (_request, _path, handler) => handler() },
      "@/lib/pipeline/referral-store": { requireReferralStore: () => ({ ok: true }) },
      "@/lib/pipeline/referral-access": { requireMutableReferralAccess: async () => ({ ok: true, referral: { id: 42, ownerId: actor.id, owner: actor.name, name: "", dob: "", source: "", community: "San Pablo" } }) },
      "@/lib/assessment/assessment-store": {
        requireAssessmentStore: () => ({ ok: true }),
        createAssessment: async (input) => { created.push(clean(input)); return { ok: true, assessment: input }; },
      },
    });
    const response = await route.POST(new Request("http://localhost/api/referrals/42/assessments", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ client_mutation_id: "synthetic-draft" }),
    }), { params: Promise.resolve({ referralId: "42" }) });
    assert.equal(response.status, 201, await response.text());
    assert.equal(created.length, 1);
    assert.equal(created[0].referral_id, 42);
    assert.equal(created[0].canonical_client_id, null);
    assert.equal(created[0].resident_key, null);
    await assert.rejects(identity.resolveAssessmentClientIdentity(new Request("http://localhost"), 42));
  }
});

test("verified identities are retained and census authorization failures are not bypassed", async () => {
  const request = new Request("http://localhost");
  assert.deepEqual(clean(await identityFixture().resolveDraftAssessmentClientIdentity(request, 42)), {
    canonicalClientId: "verified-client", residentKey: "synthetic:resident",
  });
  for (const status of [401, 403]) await assert.rejects(identityFixture({ status }).resolveDraftAssessmentClientIdentity(request, 42));
});

import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

for (const scenario of ["committed", "missing", "inaccessible"]) {
  test(`delete replay access race: ${scenario}`, async () => {
    const user = { id: "synthetic-assessor", name: "Synthetic Assessor", roles: ["reviewer"] };
    const referral = { id: 42, version: 8, deletedAt: "2026-11-07T00:00:00Z" };
    let committed = false;
    let reads = 0;
    let writes = 0;
    const route = loadEntry("app/api/referrals/[referralId]/route.ts", {
      "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => ({ ok: true, user }) },
      "@/lib/auth/assessor-session-policy": { pipelineAuditActor: () => user },
      "@/lib/observability/api-logging": { withApiLogging: (_request, _route, handler) => handler() },
      "@/lib/pipeline/referral-store": {
        requireReferralStore: () => ({ ok: true }),
        getReferralStoreRevision: async () => 9,
        getReferralMutationReplay: async (id, scope, mutationId, actor, request) => {
          reads++;
          assert.equal(id, 42);
          assert.equal(scope, "referral_delete");
          assert.equal(mutationId, "synthetic-delete-retry");
          assert.equal(actor.id, user.id);
          assert.ok(request);
          if (!committed || scenario === "missing") return null;
          return referral;
        },
        softDeleteReferral: async () => { writes++; throw new Error("Must not delete again"); },
      },
      "@/lib/pipeline/referral-access": {
        requireMutableReferralAccess: async () => {
          // The first identical request commits after this request's initial lookup.
          committed = true;
          return { ok: false, response: Response.json({ error: "Referral not found." }, { status: 404 }) };
        },
        canAccessReferral: () => scenario !== "inaccessible",
      },
    });
    const response = await route.DELETE(new Request("http://localhost/api/referrals/42", {
      method: "DELETE", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ if_match: 7, client_mutation_id: "synthetic-delete-retry" }),
    }), { params: Promise.resolve({ referralId: "42" }) });
    assert.equal(response.status, scenario === "committed" ? 200 : 404);
    assert.equal(reads, 2);
    assert.equal(writes, 0);
    if (scenario === "committed") {
      const payload = await response.json();
      assert.deepEqual(payload.referral, referral);
      assert.equal(payload.idempotentReplay, true);
    }
  });
}

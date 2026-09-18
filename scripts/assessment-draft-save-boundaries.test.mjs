import assert from "node:assert/strict";
import test from "node:test";
import { clean, loadEntry } from "./contact-import-fixtures.mjs";

const assessor = { id: "synthetic-assessor", name: "Synthetic Assessor", roles: ["reviewer"] };
const error = (message, status = 400) => Response.json({ error: message }, { status });
const command = { if_match: 7, client_mutation_id: "synthetic-answer-save", patch: { data: { assessment_notes: "Partial interview notes" } } };

function fixture(options = {}) {
  const user = options.user ?? assessor;
  const assessment = {
    assessment_id: "synthetic-assessment", referral_id: 42, version: 7,
    assessor_id: assessor.id, status: "draft", started_at: null,
    schedule_status: "unscheduled", signed_at: null,
    canonical_client_id: "synthetic-client", resident_key: "site:synthetic-client",
    ...options.assessment,
  };
  const calls = { patches: [], identities: [], access: [] };
  const dependencies = {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles) => {
      assert.equal(roles, undefined);
      return user.roles.length > 0 ? { ok: true, user } : { ok: false, response: error("Forbidden", 403) };
    } },
    "@/lib/auth/assessor-session-policy": { pipelineAuditActor: () => ({ id: user.id, name: user.name }) },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, handler) => handler() },
    "@/lib/pipeline/referral-access": { requireMutableReferralAccess: async (_user, id) => {
      calls.access.push(id);
      return options.inaccessible ? { ok: false, response: error("Referral not found.", 404) } : { ok: true };
    } },
    "@/lib/assessment/assessment-client-identity": {
      resolveAssessmentClientIdentity: async (_request, id) => {
        calls.identities.push(id);
        if (!options.identityAvailable) throw new Error("Census unavailable");
        return { canonicalClientId: "verified-client", residentKey: "site:verified-client" };
      },
      assessmentClientIdentityErrorResponse: (failure) => failure.message === "Census unavailable" ? error(failure.message, 503) : null,
    },
    "@/lib/assessment/assessment-store": {
      requireAssessmentStore: () => ({ ok: true }),
      getAssessment: async () => assessment,
      patchAssessment: async (...args) => {
        calls.patches.push(clean(args));
        if (options.conflict) return { ok: false, conflict: true, assessment };
        if (options.storeFailure) throw new Error(options.storeFailure);
        const { data, ...metadata } = args[1];
        return { ok: true, assessment: { ...assessment, ...data, ...metadata, version: 8 } };
      },
    },
  };
  const route = loadEntry("app/api/assessments/[assessmentId]/route.ts", dependencies, { Error });
  const patch = (body = command, origin = "http://localhost") => route.PATCH(new Request("http://localhost/api/assessments/synthetic-assessment", {
    method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ assessmentId: "synthetic-assessment" }) });
  return { patch, calls };
}

test("partial answers save before scheduling or starting, without any census lookup or identity rewrite", async () => {
  for (const identityAvailable of [false, true]) {
    for (const identity of [
      { canonical_client_id: "synthetic-client", resident_key: "site:synthetic-client" },
      { canonical_client_id: null, resident_key: null },
    ]) {
      const current = fixture({ identityAvailable, assessment: identity });
      const response = await current.patch();
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.assessment.assessment_notes, command.patch.data.assessment_notes);
      assert.equal(result.assessment.canonical_client_id, identity.canonical_client_id);
      assert.equal(result.assessment.resident_key, identity.resident_key);
      assert.equal(result.assessment.started_at, null);
      assert.equal(result.assessment.schedule_status, "unscheduled");
      assert.equal(result.assessment.signed_at, null);
      assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
      assert.deepEqual(current.calls.identities, []);
      assert.deepEqual(current.calls.patches, [["synthetic-assessment", command.patch, { id: assessor.id, name: assessor.name }, {
        expectedVersion: 7, mutationId: command.client_mutation_id,
      }]]);
    }
  }
});

test("section versions and conflict responses still reach the save boundary unchanged", async () => {
  const current = fixture({ conflict: true });
  const response = await current.patch({ ...command, section: "provenance_qc", if_match_section: 3 });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).conflict, true);
  assert.deepEqual(current.calls.patches[0][3], {
    expectedVersion: 7, expectedSectionVersion: 3, section: "provenance_qc", mutationId: command.client_mutation_id,
  });
  assert.deepEqual(current.calls.identities, []);
});

test("explicit identity updates retain governed lookup and fail closed when it is unavailable", async () => {
  for (const identityAvailable of [false, true]) {
    const current = fixture({ identityAvailable });
    const response = await current.patch({ ...command, patch: { resident_key: "unverified-client" } });
    assert.equal(response.status, identityAvailable ? 200 : 503);
    assert.deepEqual(current.calls.identities, [42]);
    assert.equal(current.calls.patches.length, identityAvailable ? 1 : 0);
    if (identityAvailable) assert.deepEqual(current.calls.patches[0][1], {
      resident_key: "site:verified-client", canonical_client_id: "verified-client",
    });
  }
});

test("save independence does not bypass account, visibility, or same-origin checks", async () => {
  for (const [options, status] of [
    [{ user: { ...assessor, roles: [] } }, 403],
    [{ inaccessible: true }, 404],
  ]) {
    const current = fixture(options);
    assert.equal((await current.patch()).status, status);
    assert.equal(current.calls.patches.length, 0);
    assert.equal(current.calls.identities.length, 0);
  }
  const current = fixture();
  assert.equal((await current.patch(command, "https://other.invalid")).status, 403);
  assert.equal(current.calls.access.length, 0);
});

test("invalid data and completion commands are still rejected; storage failures are not reported as saved", async () => {
  for (const [body, status] of [
    [{ ...command, if_match: 0 }, 400],
    [{ ...command, patch: { data: { assessment_date: "not-a-date" } } }, 400],
    [{ ...command, patch: { canonical_client_id: "forged-client" } }, 400],
    [{ ...command, patch: { status: "complete" } }, 422],
  ]) {
    const current = fixture();
    assert.equal((await current.patch(body)).status, status);
    assert.equal(current.calls.patches.length, 0);
  }
  for (const storeFailure of ["This assessment is signed. Record later clinical information as an addendum.", "Storage unavailable"]) {
    const current = fixture({ storeFailure });
    const response = await current.patch();
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, storeFailure);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry, clean } from "./contact-import-fixtures.mjs";

const filesPath = "app/api/files/route.ts";
const referralPath = "app/api/referrals/[referralId]/route.ts";
const user = { id: "fixture-assessor", name: "Synthetic Assessor", roles: ["reviewer"] };
const error = (message, status = 400) => Response.json({ error: message }, { status });

function boundary({ outcome, denied = false, missing = false, conflict = false } = {}) {
  const calls = { lists: [], patches: [], access: [], logs: [] };
  const referral = { id: 42, owner: user.name, ownerId: user.id, version: 7, requirements: [], admissionDecision: outcome ? { outcome } : undefined };
  const access = async (_user, id) => {
    calls.access.push(id);
    return missing ? { ok: false, response: error("Referral not found.", 404) } : { ok: true, referral };
  };
  const logging = loadEntry("lib/observability/api-logging.ts", {
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => undefined },
    "@/lib/reliability/request-governor": { acquireRequestCapacity: () => ({ ok: true, release: () => undefined }) },
  }, { console: Object.fromEntries(["log", "warn", "error"].map((method) => [method, (line) => calls.logs.push(line)])) });
  const dependencies = {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles) => {
      if (roles) assert.deepEqual(Array.from(roles), ["admin", "assessment_coordinator", "reviewer"]);
      return denied ? { ok: false, response: error("Forbidden", 403) } : { ok: true, user };
    } },
    "@/lib/auth/assessor-session-policy": { pipelineAuditActor: () => user },
    "@/lib/observability/api-logging": logging,
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => undefined },
    "@/lib/pipeline/referral-access": {
      requireReferralAccess: access, requireMutableReferralAccess: access,
      scopeReferralListOptions: (_user, options) => ({ ...options, scope: "mine", ownerId: user.id }),
      assignedOwnerForPatch: () => ({ ok: true, owner: user.name, ownerId: user.id }),
      isAssessorUser: () => true,
    },
    "@/lib/pipeline/workspace-members": { touchWorkspaceMember: async () => undefined },
    "@/lib/pipeline/known-users": { resolveKnownPipelineUser: async () => null },
    "@/lib/pipeline/referral-store": {
      requireReferralStore: () => ({ ok: true }),
      listReferralFiles: async (options) => { calls.lists.push(clean(options)); return { files: [{ id: "local-fixture-file" }], total: 1 }; },
      patchReferral: async (...args) => {
        calls.patches.push(clean(args));
        return conflict ? { ok: false, conflict: true, referral } : { ok: true, referral: { ...referral, ...args[1] } };
      },
      DuplicateReferralPacketError: class extends Error {},
    },
  };
  return {
    calls,
    files: (query = "") => loadEntry(filesPath, dependencies).GET(new Request(`http://localhost/api/files${query}`)),
    patch: (body, origin = "http://localhost") => loadEntry(referralPath, dependencies).PATCH(new Request("http://localhost/api/referrals/42", {
      method: "PATCH", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ referralId: "42" }) }),
  };
}

test("file date bounds retain defaults, trimming, inclusive dates and scoped inventory options", async () => {
  for (const [query, after, before] of [["", undefined, undefined], ["&uploaded_after=+2026-09-01+", "2026-09-01", undefined], ["&uploaded_before=2026-09-02", undefined, "2026-09-02"], ["&uploaded_after=2026-09-01&uploaded_before=2026-09-01", "2026-09-01", "2026-09-01"]]) {
    const fixture = boundary();
    const response = await fixture.files(`?referral_id=42&source_system=pipeline${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.deepEqual(await response.json(), { files: [{ id: "local-fixture-file" }], total: 1 });
    assert.deepEqual(fixture.calls.access, [42]);
    assert.deepEqual(fixture.calls.lists, [{ scope: "mine", query: "", limit: 100, sourceSystem: "pipeline", referralId: 42, ownerId: user.id, ...(after ? { uploadedAfter: after } : {}), ...(before ? { uploadedBefore: before } : {}) }]);
  }
});

test("invalid file dates stop before listing, preserving error precedence and text", async () => {
  for (const [query, message] of [
    ["uploaded_after=nope&uploaded_before=nope", "uploaded_after must be YYYY-MM-DD."],
    ["uploaded_after=2026-09-01&uploaded_before=nope", "uploaded_before must be YYYY-MM-DD."],
    ["uploaded_after=2026-09-02&uploaded_before=2026-09-01", "uploaded_after must be on or before uploaded_before."],
    ["source_system=nope&uploaded_after=nope", "source_system is invalid."],
    ["referral_id=42bad&uploaded_after=nope", "referral_id must be a positive whole number."],
  ]) {
    const fixture = boundary();
    const response = await fixture.files(`?${query}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, message);
    assert.equal(fixture.calls.lists.length, 0);
  }
});

test("route authentication, resource denial and same-origin failures retain their boundaries", async () => {
  for (const [options, expected] of [[{ denied: true }, 403], [{ missing: true }, 404]]) {
    const fixture = boundary(options);
    assert.equal((await fixture.files("?referral_id=42")).status, expected);
    assert.equal((await fixture.patch({ if_match: 7, patch: { admissionDate: "2026-09-01" } })).status, expected);
    assert.equal(fixture.calls.lists.length + fixture.calls.patches.length, 0);
  }
  const fixture = boundary();
  assert.equal((await fixture.patch({ if_match: 7, patch: { admissionDate: "2026-09-01" } }, "https://other.invalid")).status, 403);
  assert.equal(fixture.calls.access.length, 0);
});

test("date of admit requires acceptance but does not replace the canonical date validator", async () => {
  for (const outcome of [undefined, "declined"]) {
    const fixture = boundary({ outcome });
    const response = await fixture.patch({ if_match: 7, patch: { admissionDate: "2026-09-01" } });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "Record an accepted supervisor decision before entering the date of admit.");
    assert.equal(fixture.calls.patches.length, 0);
  }
  for (const outcome of [undefined, "accepted"]) {
    const fixture = boundary({ outcome });
    for (const admissionDate of ["2026-04-31", "   "]) {
      const response = await fixture.patch({ if_match: 7, patch: { admissionDate } });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "admissionDate must be a real calendar date in YYYY-MM-DD or M/D/YYYY format.");
    }
    assert.equal(fixture.calls.patches.length, 0);
  }
});

test("accepted date changes and blank clearing retain version, mutation and actor arguments", async () => {
  for (const [outcome, admissionDate] of [["accepted", "2026-09-01"], [undefined, ""]]) {
    const fixture = boundary({ outcome });
    const response = await fixture.patch({ if_match: 7, client_mutation_id: "fixture-date-save", patch: { admissionDate } });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const [id, patch, version, actor, sections, metadata] = fixture.calls.patches[0];
    assert.equal(id, 42);
    assert.equal(patch.admissionDate, admissionDate.trim());
    assert.equal(version, 7);
    assert.deepEqual(actor, user);
    assert.equal(sections, null);
    assert.equal(metadata.mutationId, "fixture-date-save");
    assert.equal(metadata.mutationScope, "referral_patch");
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  }
});

test("invalid versions and concurrent changes are not mistaken for successful admission updates", async () => {
  const fixture = boundary({ outcome: "accepted", conflict: true });
  assert.equal((await fixture.patch({ if_match: 0, patch: { admissionDate: "2026-09-01" } })).status, 400);
  assert.equal((await fixture.patch({ if_match: 7, if_match_sections: {}, patch: { admissionDate: "2026-09-01" } })).status, 400);
  assert.equal(fixture.calls.patches.length, 0);
  const response = await fixture.patch({ if_match: 7, patch: { admissionDate: "2026-09-01" } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).conflict, true);
});

test("request logs exclude query contents, patch fields and admission dates", async () => {
  const fixture = boundary({ outcome: "accepted" });
  await fixture.files("?q=PRIVATE-SYNTHETIC-FILE-TEXT&uploaded_after=2026-09-01");
  await fixture.patch({ if_match: 7, patch: { admissionDate: "2026-09-01", summary: "PRIVATE-SYNTHETIC-NOTE-TEXT" } });
  const logs = JSON.stringify(fixture.calls.logs);
  assert.doesNotMatch(logs, /PRIVATE-SYNTHETIC|2026-09-01|uploaded_after/);
  assert.ok(fixture.calls.logs.some((line) => JSON.parse(line).route === "/api/files"));
  assert.ok(fixture.calls.logs.some((line) => JSON.parse(line).route === "/api/referrals/[referralId]"));
});

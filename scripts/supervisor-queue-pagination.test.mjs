import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

function fixture() {
  const items = Array.from({ length: 501 }, (_, index) => ({
    id: `exception:${index}`, referral_id: index,
    kind: index === 500 ? "ehr_handoff_failed" : "overdue_requirement",
    severity: "critical",
  }));
  const snapshot = { generated_at: "2026-09-28T00:00:00Z", total: items.length,
    counts: { overdue_requirement: 500, ehr_handoff_failed: 1 },
    severity_counts: { critical: 501, attention: 0, review: 0 }, items };
  let reads = 0;
  let authorized = true;
  const route = loadEntry("app/api/operations/supervisor-queue/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: (_request, roles) => {
      assert.deepEqual(Array.from(roles), ["admin", "assessment_coordinator", "reviewer", "viewer"]);
      return authorized ? { ok: true } : { ok: false, response: new Response(null, { status: 401 }) };
    } },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, work) => work() },
    "@/lib/pipeline/operations-snapshot": { getSupervisorExceptionSnapshot: () => { reads++; return snapshot; } },
  });
  return { snapshot, get: (query = "") => route.GET(new Request(`http://localhost/api/operations/supervisor-queue${query}`)),
    reads: () => reads, deny: () => { authorized = false; } };
}

test("bounded queue pages preserve totals and expose failed handoffs beyond entry 250", async () => {
  const { get, snapshot } = fixture();
  const collected = [];
  let offset = 0;
  do {
    const response = await get(`?offset=${offset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control"), /private, no-store/);
    const page = await response.json();
    assert.ok(page.items.length <= 250);
    assert.deepEqual(page.counts, snapshot.counts);
    assert.deepEqual(page.severity_counts, snapshot.severity_counts);
    assert.equal(page.total, 501);
    collected.push(...page.items);
    if (page.next_offset !== null) assert.ok(page.next_offset > offset);
    offset = page.next_offset;
  } while (offset !== null);
  assert.deepEqual(collected, snapshot.items);
  assert.equal(collected.at(-1).kind, "ehr_handoff_failed");
  assert.equal((await (await get("?offset=501")).json()).next_offset, null);
});

test("invalid queue offsets never read the store", async () => {
  const { get, reads } = fixture();
  for (const offset of ["", "-1", "1.5", "Infinity", "foo", "9007199254740992", "01"]) {
    assert.equal((await get(`?offset=${offset}`)).status, 400, offset);
  }
  assert.equal(reads(), 0);
});

test("every queue page remains authenticated", async () => {
  const { get, reads, deny } = fixture();
  deny();
  assert.equal((await get("?offset=250")).status, 401);
  assert.equal(reads(), 0);
});

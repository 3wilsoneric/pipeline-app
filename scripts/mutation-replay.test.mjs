import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

const replay = loadEntry("lib/persistence/mutation-replay.ts");
const user = { id: "synthetic-assessor" };
const fingerprint = (command, actor = user, operation = "contact_create", target = "directory") =>
  replay.mutationRequestFingerprint(operation, target, actor, command, replay.mutationReplayRequest(actor, command));

test("validated command order is neutral while array order, values, target and operation remain bound", () => {
  const original = fingerprint({ name: "Synthetic", flags: ["a", "b"], nested: { a: 1, b: 2 } });
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.equal(original, fingerprint({ nested: { b: 2, a: 1 }, flags: ["a", "b"], name: "Synthetic" }));
  for (const command of [
    { name: "Changed", flags: ["a", "b"], nested: { a: 1, b: 2 } },
    { name: "Synthetic", flags: ["b", "a"], nested: { a: 1, b: 2 } },
    { name: "Synthetic", flags: ["a", "b"], nested: { a: 1, b: null } },
  ]) assert.notEqual(original, fingerprint(command));
  assert.notEqual(fingerprint({}), fingerprint({}, user, "contact_update"));
  assert.notEqual(fingerprint({}), fingerprint({}, user, "contact_create", "other"));
});

test("both effective and initiating principal are bound, including delegated sessions", () => {
  const direct = fingerprint({});
  const delegated = { ...user, delegation: { initiatedBy: { id: "synthetic-supervisor" } } };
  assert.notEqual(direct, fingerprint({}, { id: "other-assessor" }));
  assert.notEqual(direct, fingerprint({}, delegated));
  assert.notEqual(fingerprint({}, delegated), fingerprint({}, { ...delegated, delegation: { initiatedBy: { id: "other-supervisor" } } }));
  assert.equal(direct, fingerprint({}, { ...user, name: "Changed display name" }));
});

test("legacy and mismatched receipts fail closed, without guessing from mutable record contents", () => {
  const expected = fingerprint({});
  for (const stored of [undefined, null, "", fingerprint({ changed: true })]) {
    assert.throws(() => replay.assertMutationReplayFingerprint(stored, expected), replay.MutationReplayConflictError);
  }
  replay.assertMutationReplayFingerprint(expected, expected);
});

test("the shared API boundary reports typed conflicts, retains private headers, releases capacity and redacts unknown errors", async () => {
  const logs = [], metrics = [];
  let released = 0;
  const { withApiLogging } = loadEntry("lib/observability/api-logging.ts", {
    "@/lib/persistence/mutation-replay": replay,
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: (...args) => metrics.push(args) },
    "@/lib/reliability/request-governor": { acquireRequestCapacity: () => ({ ok: true, release: () => { released++; } }) },
  }, { console: { log: (s) => logs.push(s), warn: (s) => logs.push(s), error: (s) => logs.push(s) } });
  for (const [error, status] of [[new replay.MutationReplayConflictError(), 409], [new Error("synthetic-secret-value"), 500]]) {
    const response = await withApiLogging(new Request("http://localhost/api/contacts", { method: "POST" }), "/api/contacts", async () => { throw error; });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.ok(response.headers.get("x-request-id"));
    const body = await response.json();
    assert.equal(body.code, status === 409 ? "mutation_replay_conflict" : undefined);
    assert.equal(JSON.stringify(body).includes("synthetic-secret-value"), false);
  }
  assert.equal(released, 2);
  assert.equal(logs.some((s) => s.includes("synthetic-secret-value")), false);
  assert.ok(metrics.some((m) => m[3].status_class === "4xx"));
  assert.ok(metrics.some((m) => m[3].status_class === "5xx"));
});

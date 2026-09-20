import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the actual React callback with controlled effects. The keyed app
// route remounts across clients, so it cannot exercise same-instance ref reuse.
const source = ts.createSourceFile("AssessmentWorkspace.tsx", readFileSync("components/pipeline/AssessmentWorkspace.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "syncOfflineChanges") callback = node.initializer.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, "Canonical sync callback must exist");
const compiled = ts.transpileModule(`const run = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const started = deferred();
  const response = deferred();
  const removed = [];
  const messages = [];
  const received = [];
  const context = {
    window: { navigator: { onLine: true } }, offlinePrincipal: "principal-a",
    PipelineApiError: class extends Error { status = 0; },
    offlineSyncRef: { current: false },
    initializedAssessmentIdRef: { current: { id: "assessment-a", principal: "principal-a" } },
    selectedRef: { current: { assessment_id: "assessment-a" } },
    saveQueueRef: { current: Promise.resolve() },
    dirtySectionsRef: { current: new Set() }, remoteChangeRef: { current: null },
    draftRef: { current: {} }, workbookSourcesRef: { current: {} },
    editableSectionData: () => ({}), assessmentSaveGroups: () => [],
    flushOfflineAssessmentMutations: async () => ({ completed: 0, conflicts: 1, remaining: 0 }),
    fetchPipelineJson: async () => { started.resolve(); await response.promise; return { assessment: { assessment_id: "assessment-a" } }; },
    receiveRemoteAssessment: (record) => received.push(record.assessment_id),
    removeOfflineAssessmentDraft: async (...args) => removed.push(args),
    setPendingOfflineSaves: () => {}, setMessage: (message) => messages.push(message),
  };
  const run = () => new Function(...Object.keys(context), `${compiled}; return run;`)(...Object.values(context))();
  return { context, run, started, response, removed, messages, received };
}

for (const change of ["another assessment", "A to B to A", "another principal", "unmounted"]) {
  test(`late reconciliation preserves the old draft after ${change}`, async () => {
    const f = fixture();
    const pending = f.run();
    await f.started.promise;
    const id = change === "another assessment" ? "assessment-b" : "assessment-a";
    const principal = change === "another principal" ? "principal-b" : "principal-a";
    f.context.selectedRef.current = { assessment_id: id };
    f.context.initializedAssessmentIdRef.current = change === "unmounted" ? null : { id, principal };
    // The new session is clean, unlike A's unresolved offline answer.
    f.context.dirtySectionsRef.current = new Set();
    f.response.resolve();
    await pending;
    assert.deepEqual(f.removed, []);
    assert.deepEqual(f.received, []);
    assert.deepEqual(f.messages, []);
    assert.equal(f.context.offlineSyncRef.current, false);
  });
}

test("unchanged clean session still completes its acknowledged cleanup", async () => {
  const f = fixture();
  const pending = f.run();
  await f.started.promise;
  f.response.resolve();
  await pending;
  assert.deepEqual(f.removed, [["principal-a", "assessment-a"]]);
  assert.deepEqual(f.messages, ["Offline changes synced"]);
});

test("unchanged dirty session retains its unsaved answer", async () => {
  const f = fixture();
  f.context.dirtySectionsRef.current.add("prior_history");
  const pending = f.run();
  await f.started.promise;
  f.response.resolve();
  await pending;
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.messages, ["Changes saved on this device; waiting to sync"]);
});

test("switching principal while a queued sender waits preserves the mutation without dispatching it", async () => {
  const f = fixture();
  const queued = deferred();
  const releaseQueue = deferred();
  const requests = [];
  f.context.saveQueueRef.current = releaseQueue.promise;
  f.context.fetchPipelineJson = async (...args) => { requests.push(args); return {}; };
  f.context.flushOfflineAssessmentMutations = async (_principal, send) => {
    queued.resolve();
    await assert.rejects(send({ url: "/api/assessments/assessment-a", method: "PATCH", body: "{}" }), (error) => error.status === 0);
    return { completed: 0, conflicts: 0, remaining: 1 };
  };
  const pending = f.run();
  await queued.promise;
  f.context.initializedAssessmentIdRef.current = { id: "assessment-a", principal: "principal-b" };
  releaseQueue.resolve();
  await pending;
  assert.deepEqual(requests, []);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.messages, []);
});

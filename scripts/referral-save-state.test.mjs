import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const state = loadTypeScriptModule(process.cwd(), "components/pipeline/referral-canvas-save-state.ts");
const values = (name = "Synthetic", sourceFile = "original.pdf") => ({
  fields: { name: { value: name, sourceFile } }, conserved: "", tagsInput: "", documents: {}, initialPacket: null,
});
const snapshot = (draft, keys = ["name"]) => state.captureReferralSaveSnapshot(new Set(keys), draft, "face_sheet", {});

test("save acknowledgement clears only unchanged captured fields", () => {
  const saved = snapshot(values());
  assert.deepEqual([...state.reconcileSavedDirtyKeys(new Set(["name", "phone"]), saved, values(), true)], ["phone"]);
  assert.deepEqual([...state.reconcileSavedDirtyKeys(new Set(["name"]), saved, values("New typing"), true)], ["name"]);
  assert.deepEqual([...state.reconcileSavedDirtyKeys(new Set(["name"]), saved, values("Synthetic", "new-source.pdf"), true)], ["name"]);
});

test("snapshot preserves its dirty keys and upload selection when the live queue changes", () => {
  const keys = new Set(["name", "documents"]);
  const first = new File(["one"], "first.pdf");
  const pending = { face: first };
  const saved = state.captureReferralSaveSnapshot(keys, values(), "face_sheet", pending);
  keys.clear(); pending.face = new File(["two"], "second.pdf");
  assert.deepEqual([...saved.dirtyKeys], ["name", "documents"]);
  assert.equal(saved.pendingDocuments.face, first);
});

test("either upload queue keeps document changes recoverable until every upload finishes", () => {
  const file = new File(["synthetic"], "queued.pdf");
  const saved = snapshot(values(), ["documents"]);
  for (const [pending, additional] of [[{ face: file }, []], [{}, [file]], [{ face: file }, [file]]]) {
    const hasUploads = state.hasPendingDocumentUploads(pending, additional);
    assert.equal(hasUploads, true);
    assert.deepEqual([...state.reconcileSavedDirtyKeys(new Set(["documents"]), saved, values(), !hasUploads)], ["documents"]);
  }
  assert.equal(state.hasPendingDocumentUploads({}, []), false);
  assert.equal(state.reconcileSavedDirtyKeys(new Set(["documents"]), saved, values(), true).size, 0);
});

test("a newly selected initial packet survives an older packet acknowledgement", () => {
  const first = new File(["first"], "packet.pdf");
  const next = new File(["second"], "packet.pdf");
  const saved = snapshot({ ...values(), initialPacket: first }, ["initialPacket"]);
  assert.equal(state.reconcileSavedDirtyKeys(new Set(["initialPacket"]), saved, { ...values(), initialPacket: next }, true).size, 1);
  assert.equal(state.reconcileSavedDirtyKeys(new Set(["initialPacket"]), saved, values(), true).size, 0);
});

test("actual canvas save completion does not delete recovery while another file is queued", async () => {
  const source = ts.createSourceFile("canvas.tsx", readFileSync("components/pipeline/ReferralPacketCanvas.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "finishReferralSave") callback = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback);
  const compiled = ts.transpileModule(`const finish = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  for (const queued of [true, false]) {
    const draft = values();
    const removed = [];
    const context = {
      ...state,
      dirtyKeysRef: { current: new Set(["documents"]) },
      fieldsRef: { current: draft.fields }, conservedRef: { current: "" }, tagsInputRef: { current: "" },
      documentsRef: { current: {} }, initialPacketRef: { current: null }, pendingDocumentsRef: { current: {} },
      additionalFilesRef: { current: queued ? [new File(["queued"], "queued.pdf")] : [] },
      setDirtyKeys: () => {}, setFields: () => {}, mergeRemoteReferralFields: () => {}, rebaseDraftTracking: () => {},
      clearSessionDraft: async (id) => { removed.push(id); }, setRecoveredDraftAt: () => {}, setRecoveredPacketName: () => {},
      setRemoteChange: () => {}, setSavedAt: () => {},
    };
    const finish = new Function(...Object.keys(context), `${compiled}; return finish;`)(...Object.values(context));
    await finish({ id: 42 }, snapshot(draft, ["documents"]));
    assert.deepEqual(removed, queued ? [] : [42]);
    assert.equal(context.dirtyKeysRef.current.has("documents"), queued);
  }
});

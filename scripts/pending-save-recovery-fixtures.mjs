#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import ts from "typescript";
import { chromium } from "@playwright/test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const draftTypes = loadTypeScriptModule(process.cwd(), "lib/pipeline/user-workspace-state-types.ts");
const local = {};
const codecSource = ts.transpileModule(readFileSync("lib/pipeline/referral-local-recovery.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function("exports", "require", codecSource)(local, (name) => name.endsWith("user-workspace-state-types") ? draftTypes : {});
const fields = Object.fromEntries(draftTypes.referralCanvasFieldKeys?.map((key) => [key, { value: "" }]) ?? []);
// The parser's canonical field inventory is exported by the referral types owner.
const referralTypes = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-types.ts");
for (const key of referralTypes.referralCanvasFieldKeys) fields[key] = { value: "" };
fields.name.value = "Synthetic pending intake";
const draft = {
  schema: 1, savedAt: new Date().toISOString(), dirtyKeys: ["name", "initialPacket", "documents"], fields,
  conserved: "", tagsInput: "", documents: {}, initialPacketName: "synthetic.pdf", initialPacketCategory: "face_sheet",
};
assert.ok(draftTypes.parsePipelineReferralDraft(draft));
const recovery = {
  draft, ownerPrincipalId: "synthetic-owner", initialPacket: new File([new Uint8Array([0, 10, 255, 13])], "synthetic.pdf", { type: "application/pdf", lastModified: 123 }),
  pendingDocuments: { medical: new File(["medical bytes"], "medical.txt", { type: "text/plain" }) },
  additionalFiles: [new File(["additional bytes"], "additional.txt")],
};
const reference = "new-133c3e28-2731-4d4f-9c32-175a8ac96fcb";
const encoded = await local.encodeReferralRecovery(reference, recovery).arrayBuffer();
const decoded = local.decodeReferralRecovery(encoded);
assert.equal(decoded.reference, reference);
assert.equal(JSON.stringify(decoded.draft), JSON.stringify(draftTypes.parsePipelineReferralDraft(draft)));
assert.deepEqual(new Uint8Array(await decoded.initialPacket.arrayBuffer()), new Uint8Array([0, 10, 255, 13]));
assert.equal(decoded.initialPacket.lastModified, 123);
assert.equal(await decoded.pendingDocuments.medical.text(), "medical bytes");
assert.equal(await decoded.additionalFiles[0].text(), "additional bytes");
assert.throws(() => local.decodeReferralRecovery(encoded.slice(0, -1)), /incomplete/);

const source = ts.transpileModule(readFileSync("lib/offline/offline-assessment-store.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const server = createServer((_request, response) => response.end("<!doctype html><title>Pending recovery fixture</title>"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const installStore = async () => page.evaluate((code) => {
    const exports = {};
    new Function("exports", "require", code)(exports, () => ({}));
    window.fixtureStore = exports;
  }, source);
  await installStore();
  await page.evaluate(async (bytes) => {
    await window.fixtureStore.saveOfflineReferralDraft("principal-a", "draft-a", new Blob([new Uint8Array(bytes)]));
    await window.fixtureStore.saveOfflineAssessmentDraft("principal-a", "assessment-a", { schema: 1, dirtySections: ["identity"], data: { first_name: "Synthetic pending answer" } });
  }, Array.from(new Uint8Array(encoded)));
  await page.reload();
  await installStore();
  const restored = await page.evaluate(async () => {
    const store = window.fixtureStore;
    return {
      referral: Array.from(new Uint8Array((await store.loadOfflineReferralDrafts("principal-a"))[0])),
      otherPrincipal: (await store.loadOfflineReferralDrafts("principal-b")).length,
      answer: (await store.loadOfflineAssessmentDraft("principal-a", "assessment-a")).data.first_name,
    };
  });
  assert.deepEqual(restored.referral, Array.from(new Uint8Array(encoded)));
  assert.equal(restored.otherPrincipal, 0);
  assert.equal(restored.answer, "Synthetic pending answer");
  const failures = await page.evaluate(async () => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const result = originalPut.apply(this, args);
      if (this.name === "records" || this.name === "mutations") this.transaction.abort();
      return result;
    };
    const results = await Promise.allSettled([
      window.fixtureStore.saveOfflineReferralDraft("principal-a", "aborted", new Blob(["must not claim saved"])),
      window.fixtureStore.saveOfflineAssessmentDraft("principal-a", "aborted", { dirtySections: ["identity"] }),
      window.fixtureStore.queueOfflineAssessmentMutation("principal-a", { dedupeKey: "aborted", url: "/api/synthetic", method: "PATCH", body: "{}", createdAt: new Date().toISOString() }),
    ]);
    IDBObjectStore.prototype.put = originalPut;
    return results.map((result) => result.status);
  });
  assert.deepEqual(failures, ["rejected", "rejected", "rejected"]);
  await page.evaluate(async () => {
    await window.fixtureStore.removeOfflineReferralDraft("principal-a", "draft-a");
    if ((await window.fixtureStore.loadOfflineReferralDrafts("principal-a")).length !== 0) throw new Error("Completed intake recovery was retained.");
  });
  console.log("PASS: encrypted answers and all file bytes survive reload; principals are isolated; aborted transactions reject; completed intake cleanup succeeds.");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

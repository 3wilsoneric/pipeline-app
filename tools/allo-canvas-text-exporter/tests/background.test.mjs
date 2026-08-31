import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const values = new Map();
let messageListener;
const tabMessages = [];
const tabCreates = [];
const actionCalls = [];
const storage = {
  async get(keys) {
    if (keys === null) return Object.fromEntries(values);
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, values.get(key)]));
    if (typeof keys === "object") return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, values.has(key) ? values.get(key) : fallback]));
    return { [keys]: values.get(keys) };
  },
  async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); },
  async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); }
};

const chrome = {
  storage: { local: storage },
  runtime: { lastError: null, onMessage: { addListener(listener) { messageListener = listener; } } },
  action: {
    async setBadgeText(options) { actionCalls.push({ method: "setBadgeText", options }); },
    async setBadgeBackgroundColor(options) { actionCalls.push({ method: "setBadgeBackgroundColor", options }); },
    async setTitle(options) { actionCalls.push({ method: "setTitle", options }); }
  },
  tabs: {
    async create(options) { tabCreates.push(options); return { id: 91, status: "loading", ...options }; },
    async update(id, updates) { return { id, ...updates }; },
    async get(id) { return { id, status: "complete", url: "https://allo.io/canvases" }; },
    sendMessage(id, message, callback) {
      tabMessages.push({ id, message });
      if (message.type === "ALLO_CANVAS_TEXT_TAB_STATUS") callback({ ok: true, contentTemplateCount: 1 });
      else if (message.type === "ALLO_CANVAS_TEXT_START_CONTENT") callback({ ok: true, runId: "content-worker", total: 2 });
      else callback({ ok: true, runId: "catalog-worker" });
    }
  }
};
const context = vm.createContext({ chrome, Date, Object, String, Number, Boolean, Promise, console });
vm.runInContext(fs.readFileSync(new URL("../background.js", import.meta.url), "utf8"), context);

const send = (message) => new Promise((resolve) => messageListener(message, {}, resolve));

const worker = await send({ type: "ALLO_CANVAS_TEXT_START_DEDICATED_SCAN" });
assert.equal(worker.ok, true);
assert.equal(worker.tabId, 91);
assert.equal(tabMessages[0].message.type, "ALLO_CANVAS_TEXT_START_CATALOG");
assert.equal((await send({ type: "ALLO_CANVAS_TEXT_STATUS" })).state.worker.status, "running");

await send({
  type: "ALLO_CANVAS_TEXT_PAGE_EVENT",
  event: {
    type: "worker-progress",
    runId: "catalog-worker",
    stage: "reading",
    completed: 8,
    discovered: 9,
    skipped: 1,
    updatedAt: "2026-08-29T00:00:00.000Z"
  }
});
const progressStatus = (await send({ type: "ALLO_CANVAS_TEXT_STATUS" })).state.worker;
assert.equal(progressStatus.stage, "reading");
assert.equal(progressStatus.completed, 8);
assert.equal(progressStatus.discovered, 9);
assert.equal(progressStatus.skipped, 1);
assert.equal(actionCalls.some((call) => call.method === "setBadgeText" && call.options.text === "8"), true);

assert.equal((await send({ type: "ALLO_CANVAS_TEXT_RESET_CATALOG", runId: "catalog-1" })).ok, true);
await send({
  type: "ALLO_CANVAS_TEXT_PAGE_EVENT",
  event: {
    type: "catalog-batch", runId: "catalog-1", observedCanvasCount: 2, expectedCanvasCount: 2,
    canvases: [{ id: "1", name: "One" }, { id: "2", name: "Two" }],
    projects: [{ id: "9", name: "Admissions" }]
  }
});
await send({
  type: "ALLO_CANVAS_TEXT_PAGE_EVENT",
  event: { type: "catalog-complete", runId: "catalog-1", canvasCount: 2, projectCount: 1, expectedCanvasCount: 2, completeCoverage: true }
});

const prepared = await send({ type: "ALLO_CANVAS_TEXT_PREPARE_CONTENT", runId: "content-1" });
assert.equal(prepared.ok, true);
assert.equal(prepared.canvases.length, 2);

await send({
  type: "ALLO_CANVAS_TEXT_PAGE_EVENT",
  event: { type: "content-start", runId: "content-1", total: 2, contentTemplateCount: 1 }
});
await send({
  type: "ALLO_CANVAS_TEXT_PAGE_EVENT",
  event: { type: "content-result", runId: "content-1", index: 0, completed: 1, total: 2, result: { canvas: { id: "1" }, blocks: [] } }
});

const status = await send({ type: "ALLO_CANVAS_TEXT_STATUS" });
assert.equal(status.state.catalog.completeCoverage, true);
assert.equal(status.state.content.completed, 1);
assert.equal(values.has("alloCanvasTextResult:content-1:000000"), true);

await send({
  type: "ALLO_CANVAS_TEXT_PAGE_EVENT",
  event: {
    type: "catalog-complete",
    runId: "partial-catalog",
    canvasCount: 50,
    projectCount: 19,
    expectedCanvasCount: null,
    completeCoverage: false
  }
});
const partialStatus = await send({ type: "ALLO_CANVAS_TEXT_STATUS" });
assert.equal(partialStatus.state.catalog.status, "error");
assert.equal(partialStatus.state.worker.status, "error");
assert.match(partialStatus.state.worker.error, /without verified full coverage/);

const imported = await send({
  type: "ALLO_CANVAS_TEXT_IMPORT_CATALOG",
  canvases: [
    { id: "canvas-1", name: "First", project_id: "project-1", project_name: "Admissions" },
    { id: "canvas-2", name: "Second", project_id: "project-1", project_name: "Admissions" }
  ]
});
assert.equal(imported.ok, true);
assert.equal(imported.count, 2);
assert.equal((await send({ type: "ALLO_CANVAS_TEXT_STATUS" })).state.catalog.source, "imported-file-manifest");

const importedWorker = await send({ type: "ALLO_CANVAS_TEXT_START_DEDICATED_SCAN" });
assert.equal(importedWorker.ok, true);
assert.equal(importedWorker.total, 2);
assert.match(tabCreates.at(-1).url, /\/canvases\?task=canvas-1/);
assert.equal(tabMessages.some(({ message }) => message.type === "ALLO_CANVAS_TEXT_TAB_STATUS"), true);
assert.equal(tabMessages.some(({ message }) => message.type === "ALLO_CANVAS_TEXT_START_CONTENT"), true);
const importedWorkerStatus = (await send({ type: "ALLO_CANVAS_TEXT_STATUS" })).state.worker;
assert.equal(importedWorkerStatus.stage, "reading");
assert.equal(importedWorkerStatus.discovered, 2);

console.log("background catalog and result persistence tests passed");

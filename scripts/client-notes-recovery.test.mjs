import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry, clean } from "./contact-import-fixtures.mjs";

const settle = async () => { for (let i = 0; i < 16; i++) await new Promise(setImmediate); };
class ApiError extends Error {
  constructor(status, payload) { super("synthetic failure"); this.status = status; this.payload = payload; }
}
function fixture(t, { recovered = null, blocks = [], put, get, recoveryFails = false } = {}) {
  const writes = [], copies = [], summaries = [], timers = new Map();
  let timerId = 0;
  const owner = loadEntry("components/pipeline/client-notes-controller.ts", {
    "@/lib/auth/authenticated-fetch": { PipelineApiError: ApiError, fetchPipelineJson: async (url, init = {}) => {
      if (init.method !== "PUT") return get ? get() : { blocks };
      const value = JSON.parse(init.body); writes.push({ url, ...value });
      return put ? put(value, writes.length) : { block: { block_key: url.split("/").at(-1), body: value.body, version: value.if_match + 1, updated_at: "2026-09-27T00:00:00Z" } };
    } },
    "@/lib/offline/offline-assessment-store": {
      loadOfflineClientNotes: async () => { if (recoveryFails) throw new Error("storage blocked"); return recovered; },
      saveOfflineClientNotes: async (principal, referralId, entries) => copies.push(clean({ principal, referralId, entries })),
    },
    "./useLatestNotes": { rememberLatestNote: (...args) => summaries.push(args) },
  }, { setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const controller = new owner.ClientNotesController("account-a", 42);
  t.after(() => controller.dispose());
  return { controller, writes, copies, summaries, retry: () => { for (const [id, fn] of timers) { timers.delete(id); fn(); } } };
}

test("notes recover an encrypted unsaved heading and clear recovery only after acknowledgment", async (t) => {
  let release;
  const f = fixture(t, { recovered: { entries: { before: { body: "Unsaved fixture", saved: "", version: 0 } }, recoveredId: "old-slot" },
    put: (value) => new Promise((resolve) => { release = () => resolve({ block: { body: value.body, version: 1, updated_at: "2026-09-27" } }); }) });
  await f.controller.load(); await settle();
  assert.equal(f.controller.state.entries.before.body, "Unsaved fixture");
  assert.equal(f.copies.at(-1).entries.before.body, "Unsaved fixture");
  release(); await settle();
  assert.equal(f.controller.state.entries.before.saved, "Unsaved fixture");
  assert.deepEqual(f.copies.at(-1).entries, {});
});

test("notes accept a lost success reply while preserving newer typing, without a false conflict", async (t) => {
  const f = fixture(t, { put: (value, call) => {
    if (call === 1) throw new Error("response lost after commit");
    if (call === 2) throw new ApiError(409, { block: { body: "First", version: 1, updated_at: "2026-09-27" } });
    return { block: { body: value.body, version: 2, updated_at: "2026-09-27" } };
  } });
  await f.controller.load();
  f.controller.change("before", "First"); f.controller.flush("before"); await settle();
  f.controller.change("before", "First plus newer typing"); f.controller.flush("before"); await settle();
  assert.deepEqual(clean(f.controller.state.conflicts), {});
  assert.equal(f.controller.state.entries.before.saved, "First plus newer typing");
  assert.deepEqual(f.writes.map(({ if_match }) => if_match), [0, 0, 1]);
});

test("a true conflict preserves both copies and never blocks another heading", async (t) => {
  const f = fixture(t, { put: (value) => {
    if (value.body.startsWith("Mine") && value.if_match === 0) throw new ApiError(409, { block: { body: "Other screen", version: 1, updated_at: "2026-09-27" } });
    return { block: { body: value.body, version: value.if_match + 1, updated_at: "2026-09-27" } };
  } });
  await f.controller.load();
  f.controller.change("before", "Mine"); f.controller.flushAll(); await settle();
  f.controller.change("before", "Mine extended"); f.controller.change("collateral", "Independent"); f.controller.flushAll(); await settle();
  assert.equal(f.controller.state.entries.before.body, "Mine extended");
  assert.equal(f.controller.state.conflicts.before.theirs.body, "Other screen");
  assert.equal(f.controller.state.entries.collateral.saved, "Independent");
  assert.equal(f.writes.filter((write) => write.url.endsWith("/before")).length, 1);
  f.controller.resolve("before", "mine"); await settle();
  assert.equal(f.controller.state.entries.before.saved, "Mine extended");
  assert.equal(f.controller.state.entries.before.version, 2);
});

test("disposed sessions ignore late replies and stop all queued writes", async (t) => {
  let release;
  const f = fixture(t, { put: () => new Promise((resolve) => { release = resolve; }) });
  await f.controller.load(); f.controller.change("before", "Old account"); f.controller.flushAll(); await settle();
  f.controller.change("collateral", "Never send under next account");
  f.controller.dispose();
  release({ block: { body: "Old account", version: 1, updated_at: "2026-09-27" } }); await settle(); f.retry();
  assert.equal(f.writes.length, 1);
  assert.equal(f.summaries.length, 0);
});

test("browser storage failure still permits server saving without erasing unreadable recovery", async (t) => {
  const f = fixture(t, { recoveryFails: true });
  await f.controller.load(); assert.equal(f.controller.state.loaded, true);
  f.controller.change("before", "Server save still works"); f.controller.flushAll(); await settle();
  assert.equal(f.controller.state.entries.before.saved, "Server save still works");
  assert.equal(f.copies.length, 0);
});

test("two views subscribe to one text/version, including edits during a slow save", async (t) => {
  let release;
  const f = fixture(t, { put: (value, call) => call === 1
    ? new Promise((resolve) => { release = () => resolve({ block: { body: value.body, version: 1, updated_at: "2026-09-27" } }); })
    : { block: { body: value.body, version: 2, updated_at: "2026-09-27" } } });
  await f.controller.load(); const views = [null, null];
  f.controller.subscribe(() => { views[0] = f.controller.snapshot(); });
  const unsubscribe = f.controller.subscribe(() => { views[1] = f.controller.snapshot(); });
  f.controller.change("before", "Initial"); f.controller.flushAll(); await settle();
  f.controller.change("before", "Newer"); assert.equal(views[0], views[1]); unsubscribe();
  release(); await settle();
  assert.equal(views[0].entries.before.saved, "Newer");
  assert.equal(f.writes.length, 2);
});

test("a stale notes refresh cannot replace typing or a newer save acknowledgment", async (t) => {
  let release, reads = 0;
  const f = fixture(t, { get: () => ++reads === 1 ? { blocks: [] }
    : new Promise((resolve) => { release = resolve; }) });
  await f.controller.load();
  const refresh = f.controller.load();
  f.controller.change("before", "Written after refresh began");
  f.controller.flushAll(); await settle();
  release({ blocks: [] }); await refresh;
  assert.equal(f.controller.state.entries.before.body, "Written after refresh began");
  assert.equal(f.controller.state.entries.before.saved, "Written after refresh began");
  assert.equal(f.controller.state.entries.before.version, 1);
});

test("reopening clean notes refreshes another screen's newer saved text", async (t) => {
  const blocks = [];
  const f = fixture(t, { blocks });
  await f.controller.load();
  blocks.push({ block_key: "before", body: "Saved on another screen", version: 2 });
  await f.controller.load();
  assert.equal(f.controller.state.entries.before.body, "Saved on another screen");
  assert.equal(f.writes.length, 0);
});

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

for (const original of ["", "Original note"]) {
  test(`undoing an in-flight note save to ${original ? "its original text" : "empty text"} survives a lost reply and retry`, async (t) => {
    let loseReply;
    let remote = { block_key: "notes", body: original, version: 1, updated_at: "2026-10-12" };
    const f = fixture(t, { blocks: [remote], put: (value, call) => {
      if (value.if_match !== remote.version) throw new ApiError(409, { block: remote });
      remote = { ...remote, body: value.body, version: remote.version + 1 };
      if (call === 1) return new Promise((_resolve, reject) => { loseReply = () => reject(new Error("response lost after commit")); });
      return { block: remote };
    } });
    await f.controller.load();
    f.controller.change("notes", "Temporary edit"); f.controller.flush("notes"); await settle();
    f.controller.change("notes", original); await settle();
    assert.equal(f.copies.at(-1).entries.notes?.body, original, "keep the undo until the earlier request is reconciled");
    loseReply(); await settle();
    assert.equal(f.controller.canRelease(), false, "leaving the client must not dispose an uncertain save");
    f.controller.flushAll(); await settle();
    assert.equal(remote.body, original);
    assert.deepEqual(f.writes.map(({ if_match }) => if_match), [1, 1, 2]);
    assert.equal(f.controller.state.entries.notes.saved, original);
    assert.deepEqual(clean(f.controller.state.conflicts), {});
    assert.deepEqual(f.copies.at(-1).entries, {});
    assert.equal(f.controller.canRelease(), true);
  });
}

test("reloading restores an undo whose earlier note save committed without a reply", async (t) => {
  const remote = { block_key: "notes", body: "Temporary edit", version: 2, updated_at: "2026-10-12" };
  const f = fixture(t, { blocks: [remote], recovered: { entries: {
    notes: { body: "Original note", saved: "Original note", sent: "Temporary edit", version: 1 },
  } } });
  await f.controller.load(); await settle();
  assert.equal(f.controller.state.entries.notes.body, "Original note");
  assert.deepEqual(f.writes.map(({ body, if_match }) => ({ body, if_match })), [{ body: "Original note", if_match: 2 }]);
  assert.deepEqual(clean(f.controller.state.conflicts), {});
  assert.deepEqual(f.copies.at(-1).entries, {});
});

test("an unsent undo stays a no-op and a read-back matching the undo needs no duplicate write", async (t) => {
  const block = { block_key: "notes", body: "Original note", version: 1, updated_at: "2026-10-12" };
  const f = fixture(t, { blocks: [block] });
  await f.controller.load();
  f.controller.change("notes", "Temporary edit");
  f.controller.change("notes", "Original note"); f.controller.flushAll(); await settle();
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.copies.at(-1).entries, {});
  const restored = fixture(t, { blocks: [block], recovered: { entries: {
    notes: { body: "Original note", saved: "Original note", sent: "Temporary edit", version: 1 },
  } } });
  await restored.controller.load(); await settle();
  assert.equal(restored.writes.length, 0);
  assert.deepEqual(restored.copies.at(-1).entries, {});
  assert.equal(restored.controller.canRelease(), true);
});

test("recovering an undo preserves another assessor's conflicting note without overwriting it", async (t) => {
  const theirs = { block_key: "notes", body: "Another assessor's note", version: 3, updated_at: "2026-10-12" };
  const f = fixture(t, { blocks: [theirs], recovered: { entries: {
    notes: { body: "Original note", saved: "Original note", sent: "Temporary edit", version: 1 },
  } } });
  await f.controller.load(); await settle();
  assert.equal(f.writes.length, 0);
  assert.equal(f.controller.state.entries.notes.body, "Original note");
  assert.equal(f.controller.state.conflicts.notes.theirs.body, theirs.body);
  assert.equal(f.copies.at(-1).entries.notes.body, "Original note");
  assert.equal(f.controller.canRelease(), false);
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

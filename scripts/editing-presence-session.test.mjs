import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

const settle = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(t, { visible = true, online = true, request, readPresence = false } = {}) {
  const document = new EventTarget();
  document.visibilityState = visible ? "visible" : "hidden";
  const navigator = { onLine: online };
  const window = new EventTarget();
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  window.setInterval = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay, next: now + delay });
    return id;
  };
  window.clearInterval = (id) => timers.delete(id);
  const calls = [];
  const seen = [];
  const owner = loadEntry("components/pipeline/editing-presence-session.ts", {
    "@/lib/auth/authenticated-fetch": {
      fetchPipelineJson: async (url, init) => {
        const call = { url, ...init, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined };
        calls.push(call);
        return request ? request(call) : { presence: [{ actor_id: "synthetic-peer" }] };
      },
    },
  }, { document, navigator, window });
  const stop = owner.startEditingPresenceSession({
    referralId: 42,
    section: "assessment:identity",
    ...(readPresence ? { onPresence: (presence) => seen.push(presence) } : {}),
  });
  t.after(stop);
  const emit = (target, name) => target.dispatchEvent(new Event(name));
  return {
    calls, seen, stop, timers,
    writes: () => calls.filter((call) => call.method === "POST"),
    releases: () => calls.filter((call) => call.method === "DELETE"),
    visibility: (state) => { document.visibilityState = state; emit(document, "visibilitychange"); },
    online: (state) => { navigator.onLine = state; emit(window, state ? "online" : "offline"); },
    event: (name) => emit(window, name),
    advance: async (ms) => {
      const end = now + ms;
      for (;;) {
        const due = [...timers.values()].filter((timer) => timer.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.delay;
        due.callback();
        await settle();
      }
      now = end;
    },
  };
}

test("visible work renews the same section lease every 15 seconds and retains peer reads", async (t) => {
  const f = fixture(t, { readPresence: true });
  await settle();
  const first = f.writes()[0];
  assert.equal(first.url, "/api/referrals/42/presence");
  assert.equal(first.body.section, "assessment:identity");
  assert.equal(first.headers["Content-Type"], "application/json");
  assert.equal(f.seen[0][0].actor_id, "synthetic-peer");
  await f.advance(14_999);
  assert.equal(f.writes().length, 1);
  await f.advance(1);
  assert.equal(f.writes().length, 2);
  assert.equal(f.writes()[1].body.lease_id, first.body.lease_id);
  assert.equal(f.seen.length, 2);
});

test("hidden tabs release once and stay quiet beyond the full alert window; return renews immediately", async (t) => {
  const f = fixture(t);
  await settle();
  const oldId = f.writes()[0].body.lease_id;
  f.visibility("hidden");
  assert.equal(f.releases().length, 1);
  assert.equal(f.releases()[0].body.lease_id, oldId);
  assert.equal(f.releases()[0].keepalive, true);
  assert.equal(f.timers.size, 0);
  await f.advance(20 * 60_000);
  f.event("focus");
  assert.equal(f.writes().length, 1);
  assert.equal(f.releases().length, 1);
  f.visibility("visible");
  await settle();
  assert.equal(f.writes().length, 2);
  assert.notEqual(f.writes()[1].body.lease_id, oldId);
  assert.equal(f.timers.size, 1);
});

test("initial hidden or offline tabs create no editing marker until active", async (t) => {
  for (const initial of [{ visible: false }, { online: false }]) {
    const f = fixture(t, initial);
    await f.advance(120_000);
    assert.equal(f.calls.length, 0);
    f.visibility("visible");
    f.online(true);
    await settle();
    assert.equal(f.writes().length, 1);
  }
});

test("page cache suspension releases even without visibilitychange and pageshow restores once", async (t) => {
  const f = fixture(t);
  await settle();
  f.event("pagehide");
  await f.advance(120_000);
  f.event("focus");
  assert.equal(f.writes().length, 1);
  assert.equal(f.releases().length, 1);
  f.event("pageshow");
  f.event("focus");
  await settle();
  assert.equal(f.writes().length, 2);
  assert.equal(f.timers.size, 1);
});

test("offline retirement and reconnection never require a save or block the caller", async (t) => {
  const f = fixture(t);
  await settle();
  f.online(false);
  await f.advance(120_000);
  assert.equal(f.writes().length, 1);
  f.online(true);
  await settle();
  assert.equal(f.writes().length, 2);
  assert.ok(f.calls.every((call) => call.url === "/api/referrals/42/presence"));
});

test("late heartbeat completion cleans only the retired lease, never the resumed session", async (t) => {
  const oldPost = deferred();
  let posts = 0;
  const f = fixture(t, { readPresence: true, request: (call) => {
    if (call.method === "POST" && ++posts === 1) return oldPost.promise;
    return { presence: [{ actor_id: "fresh-peer" }] };
  } });
  const oldId = f.writes()[0].body.lease_id;
  f.visibility("hidden");
  f.visibility("visible");
  await settle();
  const newId = f.writes()[1].body.lease_id;
  assert.notEqual(oldId, newId);
  oldPost.resolve({});
  await settle();
  assert.equal(f.releases().length, 2);
  assert.ok(f.releases().every((call) => call.body.lease_id === oldId));
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0][0].actor_id, "fresh-peer");
  await f.advance(15_000);
  assert.equal(f.writes().at(-1).body.lease_id, newId);
});

test("late peer response cannot overwrite the current session's presence", async (t) => {
  const oldRead = deferred();
  let reads = 0;
  const f = fixture(t, { readPresence: true, request: (call) => {
    if (call.method === "GET" && ++reads === 1) return oldRead.promise;
    return { presence: [{ actor_id: "current-peer" }] };
  } });
  await settle();
  f.visibility("hidden");
  f.visibility("visible");
  await settle();
  oldRead.resolve({ presence: [{ actor_id: "stale-peer" }] });
  await settle();
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0][0].actor_id, "current-peer");
});

test("slow requests do not overlap and failures retry only while visible", async (t) => {
  const pending = deferred();
  let attempts = 0;
  const f = fixture(t, { request: (call) => {
    if (call.method === "POST" && ++attempts === 1) return pending.promise;
    return {};
  } });
  await f.advance(60_000);
  f.event("focus");
  assert.equal(f.writes().length, 1);
  pending.reject(new Error("Synthetic connection failure"));
  await settle();
  await f.advance(15_000);
  assert.equal(f.writes().length, 2);
  f.visibility("hidden");
  await f.advance(60_000);
  assert.equal(f.writes().length, 2);
});

test("failed release is advisory and disposal removes every path that could renew", async (t) => {
  const f = fixture(t, { request: (call) => {
    if (call.method === "DELETE") throw new Error("Synthetic offline release");
    return {};
  } });
  await settle();
  assert.equal(f.stop(), undefined);
  f.stop();
  f.visibility("hidden");
  f.visibility("visible");
  f.event("pageshow");
  f.event("focus");
  f.online(false);
  f.online(true);
  await f.advance(120_000);
  assert.equal(f.writes().length, 1);
  assert.equal(f.releases().length, 1);
  assert.equal(f.timers.size, 0);
});

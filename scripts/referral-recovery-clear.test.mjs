import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

function fixture(respond) {
  const requests = [], cleared = [];
  const client = loadEntry("lib/pipeline/referral-draft-recovery.ts", {
    "@/lib/auth/authenticated-fetch": { fetchPipelineJson: async (path, options = {}) => {
      const request = { path, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : null };
      requests.push(request);
      return respond(request);
    } },
    "@/lib/pipeline/referral-local-recovery": { clearLocalReferralRecovery: async (key) => { cleared.push(key); }, listLocalReferralRecoveries: async () => [] },
    "@/lib/pipeline/user-workspace-state-client": { usesServerUserWorkspaceState: () => true },
  });
  return { client, requests, cleared };
}

test("confirmed absent recovery drafts need no server delete; local cleanup remains", async () => {
  const f = fixture(() => ({ draft: null, version: 0 }));
  await f.client.loadServerReferralDraft(42);
  await f.client.clearServerReferralDraft(42);
  await f.client.clearServerReferralDraft(42);
  assert.deepEqual(f.requests.map(r => r.method), ["GET"]);
  assert.deepEqual(f.cleared, [42, 42]);
});

test("an unknown draft is checked with version zero rather than assumed absent", async () => {
  const f = fixture(() => ({ deleted: false }));
  await f.client.clearServerReferralDraft(42);
  assert.deepEqual(f.requests.map(r => [r.method, r.body]), [["DELETE", { if_match: 0 }]]);
});

test("known nonzero draft deletes retain compare-and-swap and then skip duplicates", async () => {
  const f = fixture(() => ({ deleted: true }));
  await f.client.clearServerReferralDraft(42, 7);
  await f.client.clearServerReferralDraft(42);
  assert.deepEqual(f.requests.map(r => r.body), [{ if_match: 7 }]);
  assert.deepEqual(f.cleared, [42, 42]);
});

test("a queued save is awaited before deciding whether a draft needs deletion", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(async r => r.method === "PUT" ? pending : ({ version: 0, draft: null }));
  await f.client.loadServerReferralDraft(42);
  const saving = f.client.saveServerReferralDraft(42, {});
  const clearing = f.client.clearServerReferralDraft(42);
  release({ version: 9 });
  await Promise.all([saving, clearing]);
  assert.deepEqual(f.requests.map(r => [r.method, r.body?.if_match]), [["GET", undefined], ["PUT", 0], ["DELETE", 9]]);
});

test("failed/conflicting deletion never clears local recovery or advances its version", async () => {
  let failed = true;
  const f = fixture(() => { if (failed) throw new Error("newer draft exists"); return { deleted: true }; });
  await assert.rejects(f.client.clearServerReferralDraft(42, 7), /newer draft/);
  assert.deepEqual(f.cleared, []);
  failed = false;
  await f.client.clearServerReferralDraft(42);
  assert.deepEqual(f.requests.map(r => r.body), [{ if_match: 7 }, { if_match: 7 }]);
  assert.deepEqual(f.cleared, [42]);
});

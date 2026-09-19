import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
import { loadEntry } from "./contact-import-fixtures.mjs";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const model = loadTypeScriptModule(root, "lib/pipeline/community-recipient-lists.ts");
const clean = (value) => JSON.parse(JSON.stringify(value));
const recipient = (name = "Alex", email = "alex@example.test") => ({ name, email });
const seeded = () => ({ schema: 1, lists: [{ community: "San Pablo", version: 1, to: [recipient()], cc: [], sourceDates: ["2026-09-15"], updatedAt: null }] });

test("Outlook-style entries, quoted commas, separators, duplicate addresses and mixed case", () => {
  const parsed = model.parseRecipientText('"Taylor, Alex" <ALEX@example.test>; Casey <casey@example.test>\nALEX@example.test, third@example.test');
  assert.deepEqual(clean(parsed.recipients), [recipient("Taylor, Alex"), recipient("Casey", "casey@example.test"), recipient("", "third@example.test")]);
  assert.deepEqual(clean(model.parseRecipientText(" \n; ").recipients), []);
  assert.ok(model.parseRecipientText("Name without address").error);
  assert.ok(model.parseRecipientText("a@example.test; invalid").error, "Invalid batches are not partially added");
  assert.ok(model.parseRecipientText("x".repeat(32_001)).error);
});

test("unique To/Cc, validation limits, sender injection and empty lists", () => {
  assert.equal(model.parseRecipientFields({ to: [recipient()], cc: [recipient("AL", "ALEX@example.test")] }), null);
  assert.equal(model.parseListRecipient(recipient("bad\r\nBcc: private", "a@example.test")), null);
  for (const email of ["bad", "a@example.test\r\nBcc:x@example.test", "a@host..test", "<a@example.test>"]) assert.equal(model.parseListRecipient(recipient("", email)), null);
  assert.deepEqual(clean(model.parseRecipientFields({ to: [], cc: [] })), { to: [], cc: [] });
  assert.equal(model.parseRecipientFields({ to: Array.from({ length: 101 }, (_, i) => recipient("", `a${i}@example.test`)), cc: [] }), null);
  const added = model.addListRecipients({ to: [recipient()], cc: [] }, "cc", [recipient("Alias", "ALEX@example.test"), recipient("Pat", "pat@example.test")]);
  assert.equal(added.added, 1);
  assert.equal(added.fields.to.length, 1);
  assert.equal(added.fields.cc[0].email, "pat@example.test");
});

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "recipient-lists-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const path = join(directory, "community-recipient-lists.json");
  await fs.writeFile(path, JSON.stringify(seeded()), { mode: 0o600 });
  const load = () => loadTypeScriptModule(root, "lib/pipeline/community-recipient-list-store.ts", {
    process: { ...process, env: { PIPELINE_PERSONA_DEMO: "true", PIPELINE_PERSONA_DEMO_ROOT: directory } },
    crypto: globalThis.crypto,
    require: (name) => name === "node:fs/promises" ? { ...fs, ...overrides } : require(name),
  });
  return { path, load, store: load() };
}

const command = (changes = {}) => ({ community: "San Pablo", version: 1, recipients: { to: [], cc: [recipient("Pat", "pat@example.test")] }, mutationId: crypto.randomUUID(), actorId: "test-editor", ...changes });

test("save/reload, exact retries, conflict protection and restricted file permissions", async (t) => {
  const { store, path, load } = await fixture(t);
  const input = command();
  const saved = await store.saveCommunityRecipientList(input);
  assert.equal(saved.ok, true);
  assert.equal(saved.list.version, 2);
  assert.equal(saved.list.lastMutation, undefined);
  const before = await fs.readFile(path, "utf8");
  const replay = await load().saveCommunityRecipientList(input);
  assert.equal(replay.list.version, 2);
  assert.equal(await fs.readFile(path, "utf8"), before);
  const stale = await store.saveCommunityRecipientList(command());
  assert.equal(stale.status, 409);
  const mismatch = await store.saveCommunityRecipientList({ ...input, version: 2, recipients: { to: [], cc: [] } });
  assert.equal(mismatch.status, 409);
  assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(clean((await load().readCommunityRecipientLists())[0].sourceDates), ["2026-09-15"]);
});

test("independent writers cannot overwrite the same version", async (t) => {
  const { store, load } = await fixture(t);
  const results = await Promise.all([store.saveCommunityRecipientList(command()), load().saveCommunityRecipientList(command())]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok).status, 409);
  assert.equal((await store.readCommunityRecipientLists())[0].version, 2);
});

test("failed atomic replacement preserves the prior list and releases the lock", async (t) => {
  const { store, path, load } = await fixture(t, { rename: async () => { throw new Error("disk failure"); } });
  const before = await fs.readFile(path, "utf8");
  await assert.rejects(store.saveCommunityRecipientList(command()), /disk failure/);
  assert.equal(await fs.readFile(path, "utf8"), before);
  await assert.rejects(fs.stat(`${path}.lock`), { code: "ENOENT" });
  assert.equal((await load().readCommunityRecipientLists())[0].version, 1);
});

test("corrupt files fail closed; draft storage unavailable outside local demo", async (t) => {
  const { store, path } = await fixture(t);
  await fs.writeFile(path, '{broken');
  await assert.rejects(store.readCommunityRecipientLists());
  await assert.rejects(store.saveCommunityRecipientList(command()));
  assert.equal(await fs.readFile(path, "utf8"), '{broken');
  const disabled = loadTypeScriptModule(root, "lib/pipeline/community-recipient-list-store.ts", { process: { ...process, env: {} } });
  assert.equal(disabled.recipientListsAvailable(), false);
  await assert.rejects(disabled.readCommunityRecipientLists(), /unavailable/);
});

function route(store, { authorized = true, enabled = true } = {}) {
  return loadEntry("app/api/community-recipient-lists/route.ts", {
    "@/lib/pipeline/community-recipient-lists": model,
    "@/lib/pipeline/community-recipient-list-store": { ...store, recipientListsAvailable: () => enabled },
    "@/lib/auth/pipeline-auth": { requirePipelineUser: (_request, roles) => { assert.deepEqual(clean(roles), ["admin", "assessment_coordinator"]); return authorized ? { ok: true, user: { id: "test-editor" } } : { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) }; } },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, handler) => handler() },
  });
}
const request = (body, origin = "http://localhost") => new Request("http://localhost/api/community-recipient-lists", { method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

test("API rejects unauthorized, unavailable, cross-origin, oversized, duplicate and malformed writes", async (t) => {
  const { store, path } = await fixture(t);
  const input = command();
  const body = { community: input.community, version: input.version, mutationId: input.mutationId, ...input.recipients };
  const api = route(store);
  assert.equal((await route(store, { authorized: false }).GET(new Request('http://localhost'))).status, 403);
  assert.equal((await route(store, { authorized: false }).PUT(request(body))).status, 403);
  assert.equal((await route(store, { enabled: false }).PUT(request(body))).status, 404);
  assert.equal((await api.PUT(request(body, 'https://elsewhere.test'))).status, 403);
  assert.equal((await api.PUT(request({ ...body, to: [recipient()], cc: [recipient()] }))).status, 400);
  assert.equal((await api.PUT(request({ ...body, community: "Unknown" }))).status, 400);
  assert.equal((await api.PUT(request({ ...body, version: 0 }))).status, 400);
  assert.equal((await api.PUT(request({ ...body, mutationId: "invalid" }))).status, 400);
  assert.equal((await api.PUT(request({ ...body, extra: "x".repeat(64_000) }))).status, 413);
  assert.equal(JSON.parse(await fs.readFile(path, 'utf8')).lists[0].version, 1);
  assert.equal((await api.PUT(request(body))).status, 200);
  assert.equal((await api.GET(new Request('http://localhost'))).status, 200);
});

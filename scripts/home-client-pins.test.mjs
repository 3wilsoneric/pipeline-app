import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { loadEntry, clean } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const continuity = loadTypeScriptModule(process.cwd(), "lib/pipeline/work-continuity.ts");
const visit = { referralId: 42, location: { view: "assessment", assessmentSection: "identity", assessmentQuestion: "date_of_birth" }, visitedAt: "2026-10-31T10:00:00Z" };

test("pins validate their boundary and preserve visits, drafts' positions and assignment acknowledgments", () => {
  for (const pinReferral of [null, [], 7, { id: 0, pinned: true }, { id: "42", pinned: true }, { id: 2.5, pinned: true }, { id: 42, pinned: "true" }]) {
    assert.equal(continuity.parsePipelineWorkContinuityPatch({ pinReferral }), null);
  }
  let state = continuity.mergePipelineWorkContinuityState(continuity.emptyPipelineWorkContinuityState(), { lastWorkspace: visit, acknowledgeAssignmentIds: ["assignment-1"] });
  assert.ok(continuity.parsePipelineWorkContinuityState(state), "legacy state without pins still loads");
  for (const id of [42, 43, 42]) state = continuity.mergePipelineWorkContinuityState(state, { pinReferral: { id, pinned: true } });
  assert.deepEqual(clean(state.pinnedReferralIds), [42, 43]);
  state = continuity.mergePipelineWorkContinuityState(state, { pinReferral: { id: 42, pinned: false } });
  assert.deepEqual(clean(state.pinnedReferralIds), [43]);
  assert.deepEqual(clean(state.recentWorkspaces), [visit]);
  assert.deepEqual(clean(state.acknowledgedAssignmentIds), ["assignment-1"]);
});

function stateStore(path, sql) {
  return loadEntry("lib/pipeline/user-workspace-state-store.ts", {
    "@/lib/auth/pipeline-auth": { getPipelineAuthMode: () => "demo" },
    "@/lib/desktop/desktop-server-config": { isPipelineDesktopStateEnabled: () => true },
    "@/lib/database/pipeline-database": { getPipelineDatabaseReadiness: () => ({ mode: sql ? "postgres" : "disconnected", ready: true }), getPipelineSql: () => sql },
  }, { process: { ...process, env: { NODE_ENV: "test", NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED: "true", PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE: "true", PIPELINE_DESKTOP_STATE_STORE_PATH: path } } });
}
function pinStore(store) {
  return loadEntry("lib/pipeline/work-continuity-store.ts", { "@/lib/pipeline/user-workspace-state-store": store, "@/lib/pipeline/work-continuity": continuity });
}
async function exerciseStore(store, reload) {
  await store.patchPipelineWorkContinuityState("assessor-a", { lastWorkspace: visit, acknowledgeAssignmentIds: ["assignment-1"] });
  const results = await Promise.all([
    store.patchPipelineWorkContinuityState("assessor-a", { pinReferral: { id: 42, pinned: true } }),
    store.patchPipelineWorkContinuityState("assessor-a", { pinReferral: { id: 43, pinned: true } }),
  ]);
  assert.ok(results.every(Boolean), "concurrent changes retry against the latest version");
  await store.patchPipelineWorkContinuityState("assessor-b", { pinReferral: { id: 44, pinned: true } });
  await store.patchPipelineWorkContinuityState("assessor-a", { lastWorkspace: { ...visit, referralId: 43, visitedAt: "2026-10-31T11:00:00Z" } });
  await store.patchPipelineWorkContinuityState("assessor-a", { pinReferral: { id: 42, pinned: false } });
  const reloaded = reload();
  const a = await reloaded.getPipelineWorkContinuityState("assessor-a");
  assert.deepEqual(clean(a.state.pinnedReferralIds), [43]);
  assert.equal(a.state.recentWorkspaces.length, 2);
  assert.deepEqual(clean(a.state.acknowledgedAssignmentIds), ["assignment-1"]);
  assert.deepEqual(clean((await reloaded.getPipelineWorkContinuityState("assessor-b")).state.pinnedReferralIds), [44]);
}

test("pins persist and isolate assessors through the real local state adapter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pipeline-pins-"));
  try { const path = join(dir, "state.json"); await exerciseStore(pinStore(stateStore(path)), () => pinStore(stateStore(path))); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test("pins persist and merge concurrently through the real PostgreSQL state adapter", { skip: !process.env.PIPELINE_PIN_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.PIPELINE_PIN_TEST_DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/pipeline_pin_fixture", "requires an isolated local fixture database");
  const sql = postgres(url.href, { max: 4 });
  try {
    await sql`create schema pipeline`;
    await sql`create table pipeline.schema_migrations (migration_id text primary key)`;
    const migrationConnection = await sql.reserve();
    try {
      for (const name of ["0006_user_workspace_state", "0033_workflow_continuity"]) await migrationConnection.unsafe(await readFile(`database/migrations/${name}.sql`, "utf8"));
    } finally { migrationConnection.release(); }
    await exerciseStore(pinStore(stateStore(undefined, sql)), () => pinStore(stateStore(undefined, sql)));
  } finally { await sql.end(); }
});

test("Home exposes only authorized active IDs and keeps pins separate from recency", async () => {
  const state = { schema: 1, acknowledgedAssignmentIds: [], pinnedReferralIds: [42, 43, 99], recentWorkspaces: [visit, { ...visit, referralId: 43 }, { ...visit, referralId: 99 }] };
  const owner = loadEntry("lib/pipeline/home-continuity.ts", {
    "@/lib/pipeline/work-continuity-store": { getPipelineWorkContinuityState: async () => ({ state }) },
    "@/lib/pipeline/user-workspace-state-store": { getUserWorkspaceStateReadiness: () => ({ ready: true }), listUserWorkspaceState: async () => [] },
    "@/lib/pipeline/workspace-activity": { listWorkspaceActivity: async () => ({ items: [] }) },
  });
  const items = [{ referral_id: 42, board: { stage: "in_progress" } }, { referral_id: 43, board: { stage: null } }];
  const home = await owner.getHomeContinuity({ id: "assessor-a" }, { active_items: items, all_board_items: items }, "2026-10-31T12:00:00Z");
  assert.deepEqual(clean(home.pinned_referral_ids), [42]);
  assert.deepEqual(clean(home.recent_referral_ids), [42]);
  assert.deepEqual(state.pinnedReferralIds, [42, 43, 99], "presentation filtering does not erase personal saved state");
});

test("pin route requires auth, same origin and referral access; unpin and other continuity updates remain usable", async () => {
  let signedIn = true;
  const writes = [];
  const routes = loadEntry("app/api/me/work-continuity/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => signedIn ? { ok: true, user: { id: "assessor-a" } } : { ok: false, response: new Response(null, { status: 401 }) } },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _path, run) => run() },
    "@/lib/pipeline/user-workspace-state-store": { getUserWorkspaceStateReadiness: () => ({ ready: true }) },
    "@/lib/pipeline/referral-access": { requireReferralAccess: async (_user, id) => id === 42 ? { ok: true } : { ok: false, response: new Response(null, { status: 404 }) } },
    "@/lib/pipeline/work-continuity-store": { patchPipelineWorkContinuityState: async (principal, patch) => { writes.push({ principal, patch: clean(patch) }); return continuity.emptyPipelineWorkContinuityState(); } },
  });
  const request = (body, origin = "http://localhost") => new Request("http://localhost/api/me/work-continuity", { method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await routes.PATCH(request({ pinReferral: { id: 42, pinned: true } }, "https://external.invalid"))).status, 403);
  assert.equal((await routes.PATCH(request({ pinReferral: { id: 99, pinned: true } }))).status, 404);
  assert.equal((await routes.PATCH(request({ pinReferral: { id: "42", pinned: true } }))).status, 400);
  signedIn = false;
  assert.equal((await routes.PATCH(request({ pinReferral: { id: 42, pinned: true } }))).status, 401);
  assert.equal(writes.length, 0);
  signedIn = true;
  for (const patch of [{ pinReferral: { id: 42, pinned: true } }, { pinReferral: { id: 99, pinned: false } }, { lastWorkspace: visit }]) assert.equal((await routes.PATCH(request(patch))).status, 200);
  assert.ok(writes.every(write => write.principal === "assessor-a"));
});

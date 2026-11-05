import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

test("personal email layout: persistence, identity isolation, input boundaries and concurrent versions", async () => {
  const directory = mkdtempSync("/tmp/pipeline-layout-");
  try {
    const env = { NODE_ENV: "test", NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "true", PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE: "true", PIPELINE_DESKTOP_STATE_STORE_PATH: join(directory, "state.json") };
    const owner = () => loadEntry("lib/pipeline/user-workspace-state-store.ts", {
      "@/lib/auth/pipeline-auth": { getPipelineAuthMode: () => "entra_jwt" },
      "@/lib/desktop/desktop-server-config": { isPipelineDesktopStateEnabled: () => false },
      "@/lib/database/pipeline-database": { getPipelineDatabaseReadiness: () => ({ mode: "local_file", ready: true }) },
    }, { process: { env } });
    const store = owner();
    const route = loadEntry("app/api/me/meet-client-layout/route.ts", {
      "@/lib/pipeline/user-workspace-state-store": store,
      "@/lib/observability/api-logging": { withApiLogging: (_request, _path, callback) => callback() },
      "@/lib/auth/pipeline-auth": { requirePipelineUser: request => request.headers.get("x-test-user") ? { ok: true, user: { id: request.headers.get("x-test-user") } } : { ok: false, response: new Response(null, { status: 401 }) } },
    });
    const request = (user = "assessor-a", data, origin = "http://localhost") => new Request("http://localhost/api/me/meet-client-layout", { method: data ? "PUT" : "GET", headers: { ...(user ? { "x-test-user": user } : {}), Origin: origin, "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
    assert.equal((await route.GET(request(""))).status, 401);
    const initialResponse = await route.GET(request());
    assert.match(initialResponse.headers.get("cache-control"), /private, no-store/);
    const initial = await initialResponse.json();
    assert.equal(initial.version, 0);
    const layout = { ...initial.layout, sectionOrder: initial.layout.sectionOrder.toReversed(), sectionFormats: { bio: "bullets" } };
    assert.equal((await route.PUT(request("assessor-a", { layout, if_match: 0 }, "https://untrusted.invalid"))).status, 403);
    for (const value of [{ ...layout, sectionText: { bio: "Private client" } }, { ...layout, sectionOrder: ["bio"] }, { ...layout, sectionFormats: { bio: "script" } }]) assert.equal((await route.PUT(request("assessor-a", { layout: value, if_match: 0 }))).status, 400);
    const writes = await Promise.all([route.PUT(request("assessor-a", { layout, if_match: 0 })), route.PUT(request("assessor-a", { layout, if_match: 0 }))]);
    assert.deepEqual(writes.map(r => r.status).sort(), [200, 409]);
    assert.deepEqual((await (await route.GET(request())).json()).layout, layout);
    assert.equal((await (await route.GET(request("assessor-b"))).json()).version, 0);
    const persisted = await owner().getUserWorkspaceState("assessor-a", "referral_email_draft", "preferred-layout");
    assert.deepEqual(JSON.parse(JSON.stringify(persisted.payload)), layout);
    assert.ok(Date.parse(persisted.expires_at) - Date.now() > 3_600 * 86_400_000);
    assert.equal(await store.getUserWorkspaceState("assessor-a", "referral_email_draft", "7"), null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

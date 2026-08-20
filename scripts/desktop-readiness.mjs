#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const read = (file) => readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const layout = read("app/layout.tsx");
const runtime = read("components/desktop/DesktopRuntime.tsx");
const config = read("lib/desktop/desktop-config.ts");
const worker = read("public/sw.js");
const offline = read("public/offline.html");
const manifest = read("app/desktop-manifest.webmanifest/route.ts");
const recents = read("lib/pipeline/recent-destinations.ts");
const workspaceClient = read("lib/pipeline/user-workspace-state-client.ts");
const canvas = read("components/pipeline/ReferralPacketCanvas.tsx");
const draftClient = read("lib/pipeline/referral-draft-recovery.ts");
const workspaceStore = read("lib/pipeline/user-workspace-state-store.ts");
const recentsRoute = read("app/api/me/recents/route.ts");
const draftsRoute = read("app/api/me/referral-drafts/[draftKey]/route.ts");
const migration = read("database/migrations/0006_user_workspace_state.sql");
const env = read(".env.example");
const docs = read("docs/DESKTOP_DISTRIBUTION.md");
const nextConfig = read("next.config.ts");
const browserTests = read("tests/e2e/desktop-readiness.spec.ts");

check("desktop public flag defaults off", env.includes("NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=false"));
check("desktop server-state flag defaults off", env.includes("PIPELINE_DESKTOP_STATE_ENABLED=false"));
check("desktop flag has one browser-safe source of truth", config.includes('NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED === "true"'));
check(
  "manifest is linked only behind the public flag and respects the application base path",
  layout.includes('isPipelineDesktopEnabled() ? toPipelinePath("/desktop-manifest.webmanifest") : undefined'),
);
check("worker registration is feature gated", runtime.includes("if (!isPipelineDesktopEnabled())") && runtime.includes("serviceWorker.register"));
check("disabled runtime unregisters Pipeline worker", runtime.includes("registration.unregister()") && runtime.includes("PIPELINE_DESKTOP_CACHE_PREFIX"));
check("worker has a versioned Pipeline-only cache", worker.includes('CACHE_NAME = `${CACHE_PREFIX}v1`') && worker.includes('CACHE_PREFIX = "pipeline-static-"'));
check("worker caches only explicit assets and hashed Next assets", worker.includes("isExplicitStaticAsset") && worker.includes('url.pathname.startsWith("/_next/static/")'));
check("worker never caches navigations", worker.includes('request.mode === "navigate"') && worker.includes("fetch(request).catch"));
check("worker has no API caching branch", !/cacheStaticAsset\([^)]*\/api/.test(worker) && !worker.includes('pathname.startsWith("/api/")'));
check("worker reads only its named cache", !worker.includes("caches.match("));
check("worker script is never HTTP cached", nextConfig.includes('source: "/sw.js"') && nextConfig.includes('no-cache, no-store, must-revalidate'));
check("offline page contains no runtime script", !/<script/i.test(offline));
check("offline page states that records are unavailable", offline.includes("never stored for offline use"));
check("manifest is standalone and same-origin scoped", manifest.includes('display: "standalone"') && manifest.includes('start_url: "/"') && manifest.includes('scope: "/"'));

for (const file of ["public/pwa/icon-192.png", "public/pwa/icon-512.png", "public/pwa/icon-maskable-512.png"]) {
  check(`${file} is a non-empty PNG`, statSync(file).size > 1_000 && createHash("sha256").update(readFileSync(file)).digest("hex").length === 64);
}

check(
  "recents use the server for desktop and authenticated web sessions",
  recents.includes("/api/me/recents")
    && recents.includes("usesServerUserWorkspaceState()")
    && workspaceClient.includes("pipelineAuthRequired || isPipelineDesktopEnabled()"),
);
check(
  "recents keep legacy session behavior only when server workspace state is disabled",
  recents.includes("window.sessionStorage.setItem(storageKey")
    && recents.indexOf("usesServerUserWorkspaceState()") < recents.indexOf("window.sessionStorage.setItem(storageKey"),
);
check("drafts use the server when desktop is enabled", draftClient.includes("/api/me/referral-drafts/") && canvas.includes("usesServerReferralDrafts()"));
check("draft server mode does not write browser storage", canvas.includes("if (usesServerReferralDrafts())") && canvas.indexOf("saveServerReferralDraft") < canvas.indexOf("window.sessionStorage.setItem(canvasDraftStorageKey"));
check("recents API authenticates and protects writes", recentsRoute.includes("requirePipelineUser") && recentsRoute.includes("requireSameOriginMutation"));
check("draft API authenticates and protects writes", draftsRoute.includes("requirePipelineUser") && draftsRoute.includes("requireSameOriginMutation"));
check("personal-state responses are not cacheable", recentsRoute.includes("private, no-store") && draftsRoute.includes("private, no-store"));
check("workspace store is server-only", workspaceStore.includes('import "server-only"'));
check("workspace keys always include the signed-in principal", workspaceStore.includes("principal_id = ${principalId}") && migration.includes("primary key (principal_id, state_kind, state_key)"));
check("workspace writes serialize by principal and record", workspaceStore.includes("pg_advisory_xact_lock") && workspaceStore.includes("expectedVersion"));
check("drafts and recents have explicit expiration", draftsRoute.includes("ttlDays: 30") && recentsRoute.includes("ttlDays: 180"));
check("local desktop state is prohibited in production", workspaceStore.includes('process.env.NODE_ENV !== "production"'));
check("desktop runbook documents MSIX, Intune, rollback, and cache audit", ["MSIX packaging", "Intune", "Rollback and kill switch", "Cache Storage"].every((term) => docs.includes(term)));
check("browser tests exercise generic offline fallback", browserTests.includes("falls back to a generic PHI-free offline screen") && browserTests.includes("setOffline(true)"));
check("browser tests exercise cache upgrade and kill switch", browserTests.includes("pipeline-static-v0") && browserTests.includes("PIPELINE_DISABLE_DESKTOP_CACHE") && browserTests.includes("unrelated-application-cache"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  enabled: process.env.NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED === "true" || process.env.PIPELINE_DESKTOP_STATE_ENABLED === "true",
  checks,
  configuration_present: {
    NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED: Boolean(process.env.NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED?.trim()),
    PIPELINE_DESKTOP_STATE_ENABLED: Boolean(process.env.PIPELINE_DESKTOP_STATE_ENABLED?.trim()),
    PIPELINE_DATABASE_URL: Boolean(process.env.PIPELINE_DATABASE_URL?.trim()),
  },
  note: "Configuration reports presence only. Values, identities, drafts, recents, and record data are never printed.",
}, null, 2));

if (failed.length > 0) process.exit(1);

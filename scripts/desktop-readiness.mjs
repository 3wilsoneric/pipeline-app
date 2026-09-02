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
const offlineAssessment = read("public/offline-assessment.html");
const offlineAssessmentRuntime = read("public/offline-assessment.js");
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
check("worker scope follows the Pipeline application base path", runtime.includes("PIPELINE_SERVICE_WORKER_SCOPE") && config.includes('toPipelinePath("/")'));
check("disabled runtime unregisters Pipeline worker", runtime.includes("registration.unregister()") && runtime.includes("PIPELINE_DESKTOP_CACHE_PREFIX"));
check(
  "worker has a versioned Pipeline-only cache",
  /CACHE_NAME = `\$\{CACHE_PREFIX\}v\d+`/.test(worker)
    && worker.includes('CACHE_PREFIX = "pipeline-static-"'),
);
check("worker static paths are confined to its registration scope", worker.includes("self.registration.scope") && worker.includes("scopedPath"));
check("worker caches only explicit assets and scoped hashed Next assets", worker.includes("isExplicitStaticAsset") && worker.includes('url.pathname.startsWith(scopedPath("/_next/static/"))'));
check("worker never caches navigations", worker.includes('request.mode === "navigate"') && worker.includes("fetch(request).catch"));
check("worker has no API caching branch", !/cacheStaticAsset\([^)]*\/api/.test(worker) && !worker.includes('pathname.startsWith("/api/")'));
check("worker reads only its named cache", !worker.includes("caches.match("));
check("worker script is never HTTP cached", nextConfig.includes('source: "/sw.js"') && nextConfig.includes('no-cache, no-store, must-revalidate'));
check("offline page contains no runtime script", !/<script/i.test(offline));
check("offline page explains encrypted active-assessment recovery", offline.includes("encrypted working set on this device"));
const assessmentWorkspace = read("components/pipeline/AssessmentWorkspace.tsx");
const offlineStore = read("lib/offline/offline-assessment-store.ts");
const authProvider = read("components/auth/PipelineAuthProvider.tsx");
check("assessment drafts use encrypted IndexedDB", assessmentWorkspace.includes("saveOfflineAssessmentDraft") && offlineStore.includes('name: "AES-GCM"'));
check("assessment recovery never writes browser session storage", !assessmentWorkspace.includes("sessionStorage"));
check("offline assessment saves replay on reconnect", assessmentWorkspace.includes("flushOfflineAssessmentMutations") && assessmentWorkspace.includes('window.addEventListener("online"'));
check("offline records expire and sign-out cleanup exists", offlineStore.includes("expiryMs") && read("components/auth/PipelineAuthProvider.tsx").includes("clearPipelineOfflineData"));
check(
  "cold-start shell is static, self-contained, and denied network access",
  offlineAssessment.includes('script-src \'self\'')
    && offlineAssessment.includes("connect-src 'none'")
    && offlineAssessment.includes('src="offline-assessment.js"')
    && !/<script(?![^>]*src=)/i.test(offlineAssessment),
);
check(
  "cold-start runtime reads only the encrypted active working set",
  offlineAssessmentRuntime.includes('DATABASE_NAME = "pipeline-offline-v1"')
    && offlineAssessmentRuntime.includes('crypto.subtle.decrypt')
    && offlineAssessmentRuntime.includes('crypto.subtle.encrypt')
    && offlineAssessmentRuntime.includes('ACTIVE_KEY = "current-assessment"')
    && !offlineAssessmentRuntime.includes("fetch(")
    && !offlineAssessmentRuntime.includes("XMLHttpRequest"),
);
check(
  "working-set ownership is isolated and signed assessments are removed",
  offlineStore.includes("enforceActivePrincipal")
    && offlineStore.includes("saveOfflineAssessmentWorkingSet")
    && assessmentWorkspace.includes("removeOfflineAssessmentWorkingSet")
    && assessmentWorkspace.includes("assessment.signed_at")
    && assessmentWorkspace.includes("!canEditClinical")
    && authProvider.includes("initializeOfflineAssessmentStore"),
);
check("manifest is standalone and scoped through the Pipeline base path", manifest.includes('display: "standalone"') && manifest.includes("pipelineScope") && manifest.includes("toPipelinePath"));

for (const [file, minimumBytes] of [
  ["public/pwa/pipeline-favicon-32-v3.png", 100],
  ["public/pwa/pipeline-app-icon-192-v5.png", 1_000],
  ["public/pwa/pipeline-app-icon-512-v5.png", 1_000],
  ["public/pwa/pipeline-app-icon-1024-v5.png", 1_000],
  ["public/pwa/pipeline-app-icon-maskable-512-v5.png", 1_000],
  ["public/pwa/pipeline-app-icon-maskable-1024-v5.png", 1_000],
]) {
  check(`${file} is a non-empty PNG`, statSync(file).size > minimumBytes && createHash("sha256").update(readFileSync(file)).digest("hex").length === 64);
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
check("browser tests exercise encrypted cold-start editing and reconnect", browserTests.includes("Saved on this device · syncs after reconnect") && browserTests.includes("Return to Pipeline and sync"));
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

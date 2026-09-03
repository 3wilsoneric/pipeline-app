#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceFiles = ["app", "components", "lib"]
  .flatMap((directory) => walk(path.join(root, directory)))
  .filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file));
const read = (file) => readFileSync(file, "utf8");
const relative = (file) => path.relative(root, file);
const checks = [];
const check = (name, condition, files = []) => checks.push({ name, ok: Boolean(condition), ...(files.length ? { files } : {}) });

const forbiddenEndpointFiles = sourceFiles.filter((file) => read(file).includes("/api/platform/bootstrap"));
check("full Alamo bootstrap endpoint is absent", forbiddenEndpointFiles.length === 0, forbiddenEndpointFiles.map(relative));

const allowedPublicVariables = new Set([
  "NEXT_PUBLIC_ENTRA_TENANT_ID",
  "NEXT_PUBLIC_ENTRA_CLIENT_ID",
  "NEXT_PUBLIC_PIPELINE_API_SCOPE",
  "NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED",
  "NEXT_PUBLIC_PIPELINE_BASE_PATH",
  "NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED",
  "NEXT_PUBLIC_ALAMO_PLATFORM_URL",
  "NEXT_PUBLIC_PIPELINE_DEMO_MODE",
  "NEXT_PUBLIC_PIPELINE_DEMO_URL",
]);
const publicVariablePattern = /NEXT_PUBLIC_[A-Z0-9_]+/g;
const publicVariables = new Set(sourceFiles.flatMap((file) => read(file).match(publicVariablePattern) ?? []));
const unexpectedPublicVariables = [...publicVariables].filter((name) => !allowedPublicVariables.has(name));
check("only approved browser configuration is public", unexpectedPublicVariables.length === 0, unexpectedPublicVariables);

const clientFiles = sourceFiles.filter((file) => /^\s*["']use client["'];/m.test(read(file)));
const forbiddenClientPatterns = [
  /PIPELINE_DATABASE_URL/,
  /PIPELINE_ALAMO_CLIENT_SECRET/,
  /DATABRICKS_TOKEN/,
  /DATABRICKS_CLIENT_SECRET/,
  /DOCUMENT_INTELLIGENCE_KEY/,
  /ANTHROPIC_API_KEY/,
  /AZURE_STORAGE_CONNECTION_STRING/,
  /AZURE_STORAGE_ACCOUNT_KEY/,
  /PIPELINE_WORKER_SHARED_SECRET/,
  /from ["']postgres["']/,
  /@\/lib\/database\/pipeline-database/,
  /@\/lib\/clinical\/clinical-data/,
  /@\/lib\/pipeline\/client-history-store/,
];
const poisonedClientFiles = clientFiles.filter((file) => forbiddenClientPatterns.some((pattern) => pattern.test(read(file))));
check("client modules contain no server credentials or data adapters", poisonedClientFiles.length === 0, poisonedClientFiles.map(relative));

const directClinicalSourcePatterns = [/eldermark/i, /databricks/i, /\/api\/integrations\/pipeline\/clinical/i];
const browserClinicalLeaks = clientFiles.filter((file) => directClinicalSourcePatterns.some((pattern) => pattern.test(read(file))));
check("browser modules do not call ElderMark, Databricks, or Alamo integration routes", browserClinicalLeaks.length === 0, browserClinicalLeaks.map(relative));

const serverBoundaryFiles = [
  "lib/database/pipeline-database.ts",
  "lib/pipeline/referral-store.ts",
  "lib/pipeline/workflow-store.ts",
  "lib/pipeline/resident-link-store.ts",
  "lib/pipeline/client-history-store.ts",
  "lib/pipeline/local-document-store.ts",
  "lib/pipeline/user-workspace-state-store.ts",
  "lib/desktop/desktop-server-config.ts",
  "lib/assessment/assessment-store.ts",
  "lib/assessment/assessment-client-identity.ts",
  "lib/integration/client-update-outbox.ts",
  "lib/clinical/clinical-data.ts",
  "lib/clinical/demo-clinical-data.ts",
  "lib/extraction/backend-config.ts",
  "lib/extraction/azure-blob.ts",
  "lib/extraction/databricks.ts",
  "lib/extraction/document-processing.ts",
  "lib/extraction/processing-worker.ts",
  "lib/extraction/document-assets.ts",
  "lib/observability/api-logging.ts",
  "lib/reliability/request-governor.ts",
  "lib/auth/pipeline-auth.ts",
  "lib/auth/assessor-session.ts",
];
const missingServerOnly = serverBoundaryFiles.filter((file) => !read(path.join(root, file)).includes('import "server-only"'));
check("privileged adapters are marked server-only", missingServerOnly.length === 0, missingServerOnly);

const apiLogging = read(path.join(root, "lib/observability/api-logging.ts"));
check("API logging does not accept URLs or request bodies", !/url\??:|query\??:|body\??:|token\??:|resident/i.test(apiLogging));
check("API request IDs are generated server-side", apiLogging.includes("crypto.randomUUID()") && !apiLogging.includes('headers.get("x-request-id")'));
check("API responses are centrally private and non-cacheable", apiLogging.includes('"Cache-Control", "private, no-store, max-age=0"') && apiLogging.includes('"Pragma", "no-cache"'));

const nextConfig = read(path.join(root, "next.config.ts"));
check("framework disclosure is disabled", nextConfig.includes("poweredByHeader: false"));
const pipelineAuth = read(path.join(root, "lib/auth/pipeline-auth.ts"));
const authSession = read(path.join(root, "app/api/auth/session/route.ts"));
check("session mutations require same-origin requests", authSession.includes("requireSameOriginMutation(request)"));
const assessorSession = read(path.join(root, "lib/auth/assessor-session.ts"));
const assessorSessionRoute = read(path.join(root, "app/api/auth/assessor-session/route.ts"));
const assessorSessionPolicy = read(path.join(root, "lib/auth/assessor-session-policy.ts"));
check("God mode uses an encrypted full-session HttpOnly strict cookie",
  assessorSession.includes("new EncryptJWT")
  && assessorSession.includes("jwtDecrypt")
  && assessorSession.includes("8 * 60 * 60")
  && assessorSession.includes("HttpOnly; SameSite=Strict")
  && assessorSession.includes("setJti(delegation.sessionId)"));
check("God mode remains bound to the initiating administrator",
  assessorSession.includes("delegation.initiatedBy.id !== authenticatedUser.id")
  && assessorSession.includes('authenticatedUser.roles.includes("admin")'));
check("invalid or expired God mode tokens fail closed instead of restoring administrator authority",
  pipelineAuth.includes("if (!delegation) return authFailure(403")
  && pipelineAuth.includes("if (!user) return authFailure(403"));
check("God mode can select any other active non-merged Pipeline account",
  assessorSessionRoute.includes("isEligibleGodModeTarget(member, auth.user.id)")
  && assessorSessionPolicy.includes("member.principal_id !== administratorId")
  && assessorSessionPolicy.includes('member.identity_status !== "merged"'));
check("God mode retains administrator authority in the selected account context",
  assessorSessionPolicy.includes('const godModeRoles: PipelineRole[] = ["admin", "assessment_coordinator", "reviewer", "viewer"]'));
check("God mode mutations are same-origin and do not call Entra or invitation APIs",
  assessorSessionRoute.includes("requireSameOriginMutation(request)")
  && !/graph\.microsoft|invite|invitation|entra/i.test(assessorSessionRoute));
check("session rotation and sign-out exit God mode",
  authSession.includes("clearAssessorSessionCookie(request)"));
const assessmentSignRoute = read(path.join(root, "app/api/assessments/[assessmentId]/sign/route.ts"));
const assessmentAddendumRoute = read(path.join(root, "app/api/assessments/[assessmentId]/addenda/route.ts"));
const ehrHandoffRoute = read(path.join(root, "app/api/referrals/[referralId]/ehr-handoff/route.ts"));
check("God mode signatures and external handoffs retain the initiating administrator identity",
  [assessmentSignRoute, assessmentAddendumRoute, ehrHandoffRoute]
    .every((source) => source.includes("pipelineAccountableActor")));
const delegatedWriteRoutes = [
  "app/api/assessments/[assessmentId]/addenda/route.ts",
  "app/api/assessments/[assessmentId]/route.ts",
  "app/api/assessments/[assessmentId]/schedule/route.ts",
  "app/api/assessments/[assessmentId]/sign/route.ts",
  "app/api/assessments/[assessmentId]/start/route.ts",
  "app/api/files/import-review/[itemId]/route.ts",
  "app/api/packets/[packetId]/fields/[fieldKey]/retry/route.ts",
  "app/api/packets/[packetId]/fields/[fieldKey]/review/route.ts",
  "app/api/referrals/[referralId]/assessments/import/route.ts",
  "app/api/referrals/[referralId]/assessments/route.ts",
  "app/api/referrals/[referralId]/assessments/sync-packet/route.ts",
  "app/api/referrals/[referralId]/census-reconciliation/route.ts",
  "app/api/referrals/[referralId]/decision/route.ts",
  "app/api/referrals/[referralId]/ehr-handoff/route.ts",
  "app/api/referrals/[referralId]/manual-intake/route.ts",
  "app/api/referrals/[referralId]/meet-client-email/route.ts",
  "app/api/referrals/[referralId]/recommendation/route.ts",
  "app/api/referrals/[referralId]/route.ts",
  "app/api/referrals/[referralId]/transition/route.ts",
  "app/api/referrals/[referralId]/work-items/[workItemId]/route.ts",
  "app/api/referrals/route.ts",
  "app/api/resident-links/[linkId]/route.ts",
  "app/api/resident-links/route.ts",
  "app/api/trash/referrals/[referralId]/restore/route.ts",
  "app/api/uploads/complete/route.ts",
  "app/api/uploads/create-url/route.ts",
];
const missingDelegatedAttribution = delegatedWriteRoutes.filter((file) => {
  const source = read(path.join(root, file));
  return !source.includes("pipelineAuditActor") && !source.includes("pipelineAccountableActor");
});
check("God mode referral and assessment writes preserve administrator attribution",
  missingDelegatedAttribution.length === 0,
  missingDelegatedAttribution);
const proxy = read(path.join(root, "proxy.ts"));
check("note-lab-only identities are blocked from Pipeline pages and APIs",
  proxy.includes("canAccessPipeline(auth.user)")
  && proxy.includes('toPipelinePath("/note-lab/practice")')
  && pipelineAuth.includes('"Pipeline.NoteLabReviewer"')
  && pipelineAuth.includes('accessScope === "note_lab"'));
const ci = read(path.join(root, ".github/workflows/ci.yml"));
const platformReadiness = read(path.join(root, "scripts/platform-readiness.mjs"));
check("CI blocks high-severity dependency advisories", ci.includes("npm audit --audit-level=high"));
check(
  "CI audits every API method policy without a duplicate workflow step",
  ci.includes("npm run check:platform:fast")
    && platformReadiness.includes('args: ["scripts/api-route-policy-audit.mjs"]'),
);
check("all third-party CI actions are immutable", !/uses:\s*[^\s]+@v\d+/m.test(ci));

const clinicalAdapter = read(path.join(root, "lib/clinical/clinical-data.ts"));
for (const endpoint of ["/health", "/census", "/roster", "/residents/", "/clients", "/medications/summary"]) {
  check(`clinical adapter permits ${endpoint}`, clinicalAdapter.includes(endpoint));
}
check("clinical adapter uses only the dedicated integration prefix", clinicalAdapter.includes('const CLINICAL_API_PREFIX = "/api/integrations/pipeline/clinical"'));

const databricksAdapter = read(path.join(root, "lib/extraction/databricks.ts"));
check("Databricks adapter exchanges OAuth M2M credentials for bounded short-lived tokens",
  databricksAdapter.includes("/oidc/v1/token")
  && databricksAdapter.includes('scope: "all-apis"')
  && databricksAdapter.includes("expiresAtMs")
  && !databricksAdapter.includes('required("DATABRICKS_TOKEN")'));

const envExample = read(path.join(root, ".env.example"));
for (const secret of ["PIPELINE_DATABASE_URL", "PIPELINE_ALAMO_CLIENT_SECRET", "DATABRICKS_TOKEN", "DATABRICKS_CLIENT_SECRET", "DOCUMENT_INTELLIGENCE_KEY", "ANTHROPIC_API_KEY", "AZURE_STORAGE_ACCOUNT_KEY", "PIPELINE_WORKER_SHARED_SECRET"]) {
  check(`${secret} is not NEXT_PUBLIC`, !envExample.includes(`NEXT_PUBLIC_${secret}`));
}

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const file = path.join(directory, entry);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

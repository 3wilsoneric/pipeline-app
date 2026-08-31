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
];
const missingServerOnly = serverBoundaryFiles.filter((file) => !read(path.join(root, file)).includes('import "server-only"'));
check("privileged adapters are marked server-only", missingServerOnly.length === 0, missingServerOnly);

const apiLogging = read(path.join(root, "lib/observability/api-logging.ts"));
check("API logging does not accept URLs or request bodies", !/url\??:|query\??:|body\??:|token\??:|resident/i.test(apiLogging));
check("API request IDs are generated server-side", apiLogging.includes("crypto.randomUUID()") && !apiLogging.includes('headers.get("x-request-id")'));
check("API responses are centrally private and non-cacheable", apiLogging.includes('"Cache-Control", "private, no-store, max-age=0"') && apiLogging.includes('"Pragma", "no-cache"'));

const nextConfig = read(path.join(root, "next.config.ts"));
check("framework disclosure is disabled", nextConfig.includes("poweredByHeader: false"));
const authSession = read(path.join(root, "app/api/auth/session/route.ts"));
check("session mutations require same-origin requests", authSession.includes("requireSameOriginMutation(request)"));
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

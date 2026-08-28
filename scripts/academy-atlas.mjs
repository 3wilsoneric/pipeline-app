#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const outputPath = "lib/academy/academy-atlas.generated.json";
const checkOnly = process.argv.includes("--check");
const curriculum = loadTypeScriptModule(root, "lib/academy/academy-curriculum.ts");
const moduleIds = new Set(curriculum.academyModuleIds);
const sourceRoots = ["app", "components", "lib", "database", "databricks", "scripts", "tests", "infra", "public", "shared", "docs"];
const rootFiles = [
  ".dockerignore",
  ".env.example",
  ".github/dependabot.yml",
  ".github/dependency-review-config.yml",
  ".github/workflows/assurance.yml",
  ".github/workflows/ci.yml",
  ".gitignore",
  ".nvmrc",
  "AGENTS.md",
  "CLAUDE.md",
  "Dockerfile",
  "Dockerfile.acr",
  "Dockerfile.operations",
  "Dockerfile.ops",
  "README.md",
  "databricks.yml",
  "eslint.config.mjs",
  "instrumentation.ts",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "playwright.operational.config.ts",
  "postcss.config.mjs",
  "proxy.ts",
  "tsconfig.json",
];
const skippedNames = new Set([".DS_Store"]);
const skippedSegments = new Set(["__pycache__"]);
const entries = [];
const errors = [];
const moduleRules = [
  { patterns: [/\/academy\//, /Academy/, /academy-/], modules: ["system-map", "vertical-change-capstone"] },
  { patterns: [/auth\//, /^proxy\.ts$/, /^app\/sign-in\//, /^components\/auth\//], modules: ["entra-session", "authorization-phi"] },
  { patterns: [/^app\/api\/clinical\//, /^app\/api\/profiles\//, /^lib\/clinical\//, /unified-profile/, /clinical-reconciliation/], modules: ["clinical-adapter-profiles", "identity-matching-reconciliation"] },
  { patterns: [/resident-link/, /master-record-matching/, /client-history/, /canonical_client/, /master-dataset-merge/, /allo-import-identity/], modules: ["identity-matching-reconciliation", "clinical-adapter-profiles"] },
  { patterns: [/^app\/api\/assessments\//, /^app\/api\/me\/assessment-drafts\//, /^lib\/assessment\//, /AssessmentWorkspace/, /ClientAssessmentSummary/, /assessment-/], modules: ["assessment-schema-ownership", "assessment-lifecycle"] },
  { patterns: [/ehr-handoff/, /recommendation\/route/, /decision\/route/, /^lib\/integration\//, /clinical-value-presentation/], modules: ["medication-decision-ehr", "assessment-decision-handoff"] },
  { patterns: [/^app\/api\/(?:uploads|packets|files)\//, /^app\/api\/internal\/extraction\//, /^lib\/extraction\//, /^databricks\//], modules: ["upload-storage", "extraction-worker", "provenance-review"] },
  { patterns: [/extraction-quality/, /extraction-corpus/, /backlog-rehearsal/, /batch-manifest/, /storage-consistency/, /sample-packet/], modules: ["quality-backlog-recovery", "provenance-review"] },
  { patterns: [/document-requirement/, /referral-progress/, /PacketExtractionReview/], modules: ["pre-assessment-workflow", "provenance-review"] },
  { patterns: [/referral-workflow/, /workflow-(?:records|store|status)/, /work-items/, /transition\/route/, /referral-operating-model/], modules: ["workflow-state", "admissions-operating-model"] },
  { patterns: [/referral-sections/, /editing-presence/, /collaboration/, /concurrenc/, /idempotenc/], modules: ["concurrency-idempotency", "stores-transactions"] },
  { patterns: [/^app\/api\/referrals\//, /^app\/api\/trash\/referrals\//, /referral-(?:types|validation|store|packet-upload)/], modules: ["create-referral", "route-handler-contract", "validation-authorization"] },
  { patterns: [/ReferralPacketCanvas/, /ReferralHome/, /ReferralWorklist/, /ReferralProgressPanel/, /ReferralActivityPanel/, /ReferralFilePreviewDialog/, /ReferralWorkflowTracker/, /PipelineTrash/], modules: ["referral-workspace-ui", "create-referral"] },
  { patterns: [/PipelineCalendar/, /ClientProfile/, /OperationsDashboard/, /PipelineOverviewRoute/, /PipelineWelcome/], modules: ["assessment-calendar-profiles-ui", "read-models-search-operations"] },
  { patterns: [/PipelineAppShell/, /PipelineHeader/, /PipelineActionNav/, /pipeline-shell-context/, /client-navigation/, /workspace-presentation/, /community-config/], modules: ["shell-navigation", "admissions-operating-model"] },
  { patterns: [/^app\/api\/(?:operations|search|calendar)\//, /referral-(?:query|sort|sort-cursor|worklist-filter)/, /site-search/, /operations-/, /calendar-(?:store|types)/, /fuzzy-search/, /keyset-cursor/], modules: ["read-models-search-operations", "query-performance-retention"] },
  { patterns: [/draft/, /offline/, /responsive-accessibility/, /performance-navigation/, /visual-regression/, /^public\/sw\.js$/, /^app\/(?:not-found|.*error|.*loading)/], modules: ["frontend-resilience", "assessment-calendar-profiles-ui"] },
  { patterns: [/^database\/(?:migrations|rollbacks)\//, /^database\/migration-checksums\.json$/], modules: ["schema-migrations", "database-foundations"] },
  { patterns: [/pipeline-database/, /store-adapter/, /-store\.ts$/, /database-(?:readiness|fixtures|assurance)/, /postgres-integrity/], modules: ["stores-transactions", "database-foundations"] },
  { patterns: [/query-plan/, /retention/, /database-(?:backup|restore)/, /storage-capacity/, /postgres-capacity/], modules: ["query-performance-retention", "operations-recovery-release"] },
  { patterns: [/metric/, /alert/, /request-governor/, /capacity/, /chaos/, /recovery/, /release/, /^infra\//, /deployment/], modules: ["operations-recovery-release", "threat-supply-chain"] },
  { patterns: [/security/, /supply-chain/, /license/, /sbom/, /artifact-audit/, /^\.github\//, /Dockerfile/, /ABUSE_AND_ALERTING/], modules: ["threat-supply-chain", "authorization-phi"] },
  { patterns: [/^tests\//, /^scripts\/.*(?:test|fixture|contract|fuzz|replay|certif|readiness|scorecard|audit)/, /PLATFORM_ASSURANCE/, /TEST_EFFECTIVENESS/, /EXTREME_TESTING/], modules: ["test-assurance", "operations-recovery-release"] },
  { patterns: [/^app\/api\//, /api-route-policy/], modules: ["route-handler-contract", "validation-authorization"] },
  { patterns: [/^components\//, /^app\/\(pipeline\)\//, /^app\/(?:layout|globals)/, /^public\//], modules: ["next-react-runtime", "frontend-resilience"] },
  { patterns: [/refactor/, /code-quality/, /code-hygiene/, /complexity/, /complete-repository-audit/, /ci-change-impact/], modules: ["vertical-change-capstone", "test-assurance"] },
  { patterns: [/^scripts\//, /^docs\//], modules: ["developer-toolchain", "vertical-change-capstone"] },
  { patterns: [/^lib\//, /^shared\//], modules: ["types-and-boundaries", "system-map"] },
];
const subsystemPrefixes = [
  ["app/api/", "API routes"],
  ["app/", "App Router"],
  ["components/auth/", "Authentication UI"],
  ["components/", "Pipeline UI"],
  ["lib/assessment/", "Assessment domain"],
  ["lib/auth/", "Identity and access"],
  ["lib/clinical/", "Clinical integration"],
  ["lib/database/", "Database runtime"],
  ["lib/extraction/", "Document extraction"],
  ["lib/observability/", "Reliability"],
  ["lib/reliability/", "Reliability"],
  ["lib/pipeline/", "Referral domain"],
  ["database/", "PostgreSQL schema"],
  ["databricks/", "Databricks worker"],
  ["infra/", "Azure infrastructure"],
  ["scripts/", "Engineering tooling"],
  ["tests/", "Browser tests"],
  ["docs/", "Documentation"],
  ["public/", "Static runtime"],
];
const kindRules = [
  { pattern: /\.spec\.tsx?$/, kind: "browser-test" },
  { pattern: /\.bicep$/, kind: "infrastructure" },
  { pattern: /\.md$/, kind: "documentation" },
  { pattern: /\.py$/, kind: "worker" },
  { pattern: /\.mjs$/, kind: "tooling" },
  { pattern: /route\.ts$/, kind: "route-handler" },
  { pattern: /\.tsx$/, kind: "react-component" },
  { pattern: /\.ts$/, kind: "typescript-module" },
  { pattern: /\.(?:png|jpg|jpeg|svg|ico|woff2?)$/, kind: "asset" },
  { pattern: /\.json$/, kind: "configuration" },
];
const toolingRuntimePrefixes = ["scripts/", "tests/", "infra/", ".github/"];
const browserRuntimePrefixes = ["components/", "public/"];
const serverRuntimePrefixes = ["app/api/", "lib/auth/", "lib/database/", "lib/clinical/", "lib/extraction/"];

for (const sourceRoot of sourceRoots) {
  if (existsSync(path.join(root, sourceRoot))) await walk(sourceRoot);
}
for (const file of rootFiles) {
  if (existsSync(path.join(root, file))) await addFile(file);
}

entries.sort((left, right) => left.path.localeCompare(right.path));
const fingerprint = createHash("sha256")
  .update(entries.map((entry) => JSON.stringify(entry)).join("\n"))
  .digest("hex");
const atlas = {
  schemaVersion: 1,
  generatedAt: `source-fingerprint:${fingerprint.slice(0, 16)}`,
  fingerprint,
  totals: {
    files: entries.length,
    lines: entries.reduce((total, entry) => total + entry.lines, 0),
    coveredFiles: entries.filter((entry) => entry.moduleIds.length > 0).length,
  },
  entries,
};
const serialized = `${JSON.stringify(atlas, null, 2)}\n`;

for (const entry of entries) {
  for (const moduleId of entry.moduleIds) {
    if (!moduleIds.has(moduleId)) errors.push(`${entry.path} maps to unknown module ${moduleId}.`);
  }
  if (entry.moduleIds.length === 0) errors.push(`${entry.path} has no Academy module owner.`);
}

if (checkOnly) {
  const current = await readFile(path.join(root, outputPath), "utf8").catch(() => "");
  if (current !== serialized) errors.push(`Repository atlas is stale. Run npm run academy:atlas.`);
} else if (errors.length === 0) {
  await writeFile(path.join(root, outputPath), serialized, "utf8");
}

const result = {
  ok: errors.length === 0,
  mode: checkOnly ? "check" : "write",
  output: outputPath,
  files: atlas.totals.files,
  lines: atlas.totals.lines,
  covered_files: atlas.totals.coveredFiles,
  fingerprint,
  errors,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;

async function walk(relativeDirectory) {
  const items = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  for (const item of items) {
    if (skippedNames.has(item.name) || skippedSegments.has(item.name)) continue;
    const relativePath = path.posix.join(relativeDirectory.replaceAll(path.sep, "/"), item.name);
    if (item.isDirectory()) await walk(relativePath);
    else if (item.isFile()) await addFile(relativePath);
  }
}

async function addFile(relativePath) {
  if (relativePath === outputPath) return;
  const absolutePath = path.join(root, relativePath);
  const fileStat = await stat(absolutePath);
  if (fileStat.size > 5 * 1024 * 1024) return;
  const buffer = await readFile(absolutePath);
  const text = isTextFile(relativePath) ? buffer.toString("utf8") : "";
  const modules = modulesFor(relativePath);
  entries.push({
    path: relativePath,
    subsystem: subsystemFor(relativePath),
    kind: kindFor(relativePath),
    runtime: runtimeFor(relativePath),
    risk: riskFor(relativePath),
    lines: text ? text.split(/\r?\n/).length : 0,
    moduleIds: [...new Set(modules)].sort(),
  });
}

function modulesFor(file) {
  return moduleRules.find((rule) => matches(file, rule.patterns))?.modules
    ?? ["developer-toolchain", "system-map"];
}

function subsystemFor(file) {
  return subsystemPrefixes.find(([prefix]) => file.startsWith(prefix))?.[1]
    ?? "Repository configuration";
}

function kindFor(file) {
  if (/\.sql$/.test(file)) return file.includes("/rollbacks/") ? "rollback" : "migration";
  return kindRules.find((rule) => rule.pattern.test(file))?.kind ?? "repository-file";
}

function runtimeFor(file) {
  if (file.startsWith("docs/")) return "documentation";
  if (file.startsWith("database/")) return "postgres";
  if (file.startsWith("databricks/")) return "worker";
  if (startsWithAny(file, toolingRuntimePrefixes)) return "tooling";
  if (startsWithAny(file, browserRuntimePrefixes) || file.includes("offline-assessment")) return "browser";
  if (startsWithAny(file, serverRuntimePrefixes)) return "next-server";
  if (file.startsWith("app/")) return "shared";
  return "shared";
}

function riskFor(file) {
  if (matches(file, [/^database\/migrations\//, /^lib\/(?:auth|database|extraction|clinical)\//, /(?:referral|assessment|workflow)-store/, /^app\/api\/internal\//, /decision\/route/, /ehr-handoff/])) return "critical";
  if (matches(file, [/^app\/api\//, /^infra\//, /^proxy\.ts$/, /migration/, /security/, /backup/, /restore/, /release/, /worker/])) return "high";
  return "standard";
}

function isTextFile(file) {
  return /\.(?:css|csv|d\.mts|html|js|json|md|mjs|py|sh|sql|svg|ts|tsx|txt|webmanifest|yml|yaml)$/.test(file)
    || !path.extname(file)
    || file.startsWith("Dockerfile");
}

function matches(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function startsWithAny(value, prefixes) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

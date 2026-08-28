#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = process.cwd();
const GENERATED_AT = new Date().toISOString();
const REPORT_DATE = GENERATED_AT.slice(0, 10);
const REPORT_PATH = "docs/reliability/complete-repository-audit-latest.md";
const FILE_INVENTORY_PATH = "docs/reliability/repository-file-inventory.json";
const DEPENDENCY_INVENTORY_PATH = "docs/reliability/dependency-inventory.json";
const AUDIT_ARTIFACTS = new Set([REPORT_PATH, FILE_INVENTORY_PATH, DEPENDENCY_INVENTORY_PATH]);
const SELF_ANALYSIS_PATHS = new Set(["scripts/code-hygiene-audit.mjs", "scripts/code-quality-readiness.mjs", "scripts/complete-repository-audit.mjs"]);
const TEXT_EXTENSIONS = new Set([
  "", ".acr", ".bicep", ".cjs", ".css", ".dockerignore", ".example", ".gitignore",
  ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".mts", ".nvmrc", ".operations",
  ".ops", ".py", ".sh", ".sql", ".svg", ".ts", ".tsx", ".txt",
  ".webmanifest", ".yaml", ".yml",
]);

const DIRECT_DEPENDENCY_REVIEWS = {
  "@azure/identity": ["Server-side Azure credentials and managed identity", "Credential-chain ambiguity, accidental browser import, tenant mismatch, token logging, and unmanaged retries."],
  "@azure/msal-browser": ["Browser Entra session and token acquisition", "Client secrets in browser code, redirect loops, stale account selection, overbroad scopes, and cache/session expiry behavior."],
  "@azure/msal-react": ["React bindings for browser Entra authentication", "Provider remounts, login races, missing loading/error states, and rendering protected content before authentication settles."],
  "@azure/storage-blob": ["Private document and backup storage", "Public containers, long-lived SAS URLs, path traversal, unbounded downloads, missing content headers, and retry amplification."],
  "@napi-rs/canvas": ["Server-side PDF thumbnail rasterization", "Native binary compatibility, memory exhaustion, malformed-image handling, and accidental inclusion in browser bundles."],
  "@tesseract.js-data/eng": ["Pinned English OCR language data", "Runtime bundle growth, version mismatch with Tesseract, and loading data from an untrusted remote location."],
  "fflate": ["Browser-side ZIP generation for bounded exports", "Zip bombs, unbounded in-memory archives, unsafe filenames, and exporting data without authorization or formula escaping."],
  "jose": ["JWT signing and validation", "Missing issuer/audience/algorithm checks, clock-skew mistakes, key rotation, and accepting untrusted claims as authorization."],
  "lucide-react": ["Shared interface icons", "Unlabelled icon-only controls, inconsistent sizing, and importing the full icon set into client bundles."],
  "next": ["Application framework and server runtime", "Server/client boundary leaks, cache semantics, route-handler behavior, dynamic rendering drift, and framework-version API changes."],
  "pdfjs-dist": ["PDF parsing, page rendering, and previews", "Worker configuration, malformed/oversized PDFs, page-count limits, memory cleanup, CSP compatibility, and version drift."],
  "postgres": ["PostgreSQL client", "Pool exhaustion, missing transaction boundaries, unsafe dynamic SQL, statement timeouts, retrying non-idempotent writes, and connection leaks."],
  "react": ["User-interface runtime", "Effect races, stale closures, unstable keys, hydration mismatches, and state duplicated across server/client boundaries."],
  "react-dom": ["React DOM rendering", "Hydration mismatch, focus loss, route-announcer conflicts, and browser-only APIs during server rendering."],
  "server-only": ["Build-time server-boundary guard", "Missing imports in credential/data modules and false confidence when transitive client imports bypass the intended boundary."],
  "tesseract.js": ["Fallback OCR engine", "CPU and memory denial of service, unbounded worker creation, language-data loading, cleanup, and low-confidence output treated as truth."],
  "@playwright/test": ["Browser journey and accessibility testing", "Skipped production-critical paths, shared test state, flaky timing assertions, and tests that pass only against warm caches."],
  "@tailwindcss/postcss": ["Tailwind PostCSS integration", "Build-version incompatibility and generated CSS growth."],
  "@types/node": ["Node.js type declarations", "Type/runtime version mismatch with the deployment image."],
  "@types/react": ["React type declarations", "Type/runtime mismatch and suppressions hiding changed React behavior."],
  "@types/react-dom": ["React DOM type declarations", "Type/runtime mismatch and incorrect server/client assumptions."],
  "axe-core": ["Automated accessibility checks", "Treating automated scans as complete accessibility coverage and ignoring keyboard/focus/manual checks."],
  "babel-plugin-react-compiler": ["React compiler transform", "Compiler/runtime incompatibility, changed memoization behavior, and transforms not exercised in development mode."],
  "eslint": ["Static code-quality enforcement", "Rule drift, ignored directories, and warnings that do not fail CI."],
  "eslint-config-next": ["Next.js lint rules", "Framework/config version mismatch and disabled server/client boundary rules."],
  "postcss": ["CSS transformation runtime", "Plugin ordering, parser vulnerabilities, and output differences between local and CI builds."],
  "tailwindcss": ["Utility CSS generation", "Unbounded content scanning, stale classes, generated CSS growth, and version-specific syntax."],
  "typescript": ["Static type checking and compiler APIs", "Compiler-version drift, skipped checks, broad assertions, and emitted/runtime behavior assumed from types."],
};

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function repositoryPaths() {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();
}

function trackedDeletedPaths(paths) {
  return paths.filter((path) => !existsSync(join(ROOT, path)));
}

function isText(path) {
  if (["Dockerfile", "Dockerfile.acr", "Dockerfile.operations", "Dockerfile.ops", "AGENTS.md", "CLAUDE.md"].includes(path)) return true;
  if (path.endsWith(".env.example")) return true;
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function countLines(value) {
  if (!value) return 0;
  return value.split(/\r?\n/u).length;
}

function roleFor(path) {
  if (AUDIT_ARTIFACTS.has(path)) return "Generated audit evidence";
  if (path.startsWith("app/api/")) return "HTTP API route";
  if (path.startsWith("app/")) return "Next.js route or application shell";
  if (path.startsWith("components/auth/")) return "Authentication UI";
  if (path.startsWith("components/pipeline/")) return "Pipeline user interface";
  if (path.startsWith("components/")) return "Shared user interface";
  if (path.startsWith("lib/auth/")) return "Authentication and request security";
  if (path.startsWith("lib/database/")) return "Database access";
  if (path.startsWith("lib/extraction/")) return "Document ingestion and extraction";
  if (path.startsWith("lib/clinical/")) return "Governed clinical adapter";
  if (path.startsWith("lib/observability/")) return "PHI-safe observability";
  if (path.startsWith("lib/assessment/")) return "Assessment domain";
  if (path.startsWith("lib/pipeline/")) return "Pipeline domain";
  if (path.startsWith("lib/")) return "Shared server/domain library";
  if (path.startsWith("database/migrations/")) return "Forward database migration";
  if (path.startsWith("database/rollbacks/")) return "Database rollback";
  if (path.startsWith("database/")) return "Database fixture or manifest";
  if (path.startsWith("infra/azure/")) return "Azure infrastructure as code";
  if (path.startsWith("scripts/fixtures/")) return "Sanitized test fixture";
  if (path.startsWith("scripts/")) return "Operator, verification, or data script";
  if (path.startsWith("tests/e2e/")) return "Browser journey test or snapshot";
  if (path.startsWith("docs/") || path.startsWith("wiki/")) return "Documentation or runbook";
  if (path.startsWith("public/") || /\.(?:ico|png|svg|woff2)$/u.test(path)) return "Static asset";
  if (path.startsWith(".github/")) return "CI or supply-chain configuration";
  if (path.startsWith("databricks/")) return "Databricks worker";
  if (/^(?:Dockerfile|next\.config|playwright\.config|postcss\.config|eslint\.config|proxy\.|instrumentation\.|package|tsconfig|\.env|\.gitignore|\.dockerignore|\.nvmrc|databricks\.yml)/u.test(path)) return "Build, runtime, or repository configuration";
  return "Repository support file";
}

function riskFor(path, role, lines) {
  if (/^(?:app\/api\/(?:auth|internal|uploads)|lib\/(?:auth|database)|database\/migrations|infra\/azure|proxy\.|instrumentation\.)/u.test(path)) return "critical";
  if (role === "HTTP API route" || /^(?:lib\/(?:extraction|clinical)|database\/rollbacks|scripts\/(?:apply-database|database-|import-|upload-|rollback-|pilot-reset|seed-production|purge-))/u.test(path)) return "high";
  if (lines >= 1_000 || /^(?:components\/pipeline|lib\/pipeline|lib\/assessment|\.github\/workflows)/u.test(path)) return "medium";
  return "low";
}

function verificationFor(path, role) {
  if (role === "HTTP API route") return "check:api + check:route-policy + targeted E2E";
  if (role.includes("Authentication")) return "check:security + authentication E2E";
  if (role === "Database access" || role.includes("database migration") || role === "Database rollback") return "check:database + database:fixtures + rollback/query-plan drill";
  if (role === "Document ingestion and extraction" || role === "Databricks worker") return "check:extraction + check:extraction-worker + sample packet";
  if (role === "Governed clinical adapter") return "check:clinical + check:security";
  if (role === "Azure infrastructure as code") return "check:infrastructure + Azure what-if";
  if (role.includes("user interface") || role === "Authentication UI" || role === "Next.js route or application shell") return "typecheck + lint + build + responsive/accessibility E2E";
  if (role === "Browser journey test or snapshot") return "run owning Playwright project and review skips/snapshots";
  if (role === "CI or supply-chain configuration") return "check:ci-impact + check:supply-chain + CI dry run";
  if (role === "Operator, verification, or data script") return "execute with sanitized fixture; verify dry-run/fail-closed behavior";
  if (role === "Documentation or runbook") return "link/config drift review against executable source";
  if (role === "Static asset") return "visual render, dimensions, compression, cache headers, and provenance";
  if (role === "Generated audit evidence") return "regenerate with npm run audit:repository";
  return "check:platform:fast and owning feature test";
}

function genericConcern(role) {
  const concerns = {
    "HTTP API route": "Check authentication and role authorization, schema validation, status mapping, idempotency/version conflicts, bounded payloads, and PHI-safe errors/logs.",
    "Next.js route or application shell": "Check server/client boundaries, loading/error/empty states, navigation persistence, metadata, and hydration behavior.",
    "Authentication UI": "Check redirect loops, session restoration, account switching, keyboard access, and protected-content flashes.",
    "Pipeline user interface": "Check duplicated state, autosave/conflicts, focus and labels, responsive overflow, stale data, and recoverable actions.",
    "Authentication and request security": "Check issuer/audience/tenant/role validation, cookie and CSRF rules, redirect allowlists, fail-closed defaults, and secret-safe logs.",
    "Database access": "Check parameterization, transaction and lock scope, statement timeouts, optimistic versions, pool lifecycle, pagination, and retry safety.",
    "Document ingestion and extraction": "Check MIME/signature/size/page limits, opaque blob paths, idempotency, provenance, confidence review, worker cleanup, and retry/dead-letter behavior.",
    "Governed clinical adapter": "Check server-only credentials, exact endpoint allowlist, pagination/staleness, response-size limits, identity joins, and fail-closed outages.",
    "PHI-safe observability": "Check low-cardinality dimensions, no IDs/names/query strings/tokens/upstream bodies, bounded values, and metric failure isolation.",
    "Assessment domain": "Check schema evolution, list-vs-string fields, resident/date identity, required-field gates, edit versions, and repeated-assessment history.",
    "Pipeline domain": "Check single sources of truth, explicit state transitions, ownership/deadlines, concurrency versions, deterministic search/filtering, and audit records.",
    "Forward database migration": "Check rerun safety, locking/backfill duration, null/default transitions, index strategy, old-code compatibility, and matching rollback/verification.",
    "Database rollback": "Check data-loss boundaries, exact migration pairing, dependency ordering, transactional safety, and rehearsed restoration path.",
    "Azure infrastructure as code": "Check least-privilege RBAC, secret references, private networking, retention/backup, resource names, cost defaults, and what-if output.",
    "Operator, verification, or data script": "Check destructive confirmation, dry-run mode, bounded inputs, deterministic exit codes, resumability, secret/PHI-safe output, and partial-failure recovery.",
    "Browser journey test or snapshot": "Check deterministic isolation, meaningful assertions, authenticated roles, mobile/desktop parity, concurrency, recovery, and skipped-path justification.",
    "CI or supply-chain configuration": "Check least-privilege tokens, pinned actions, path filters, cache poisoning, secret exposure, cancellation/concurrency, and required-gate coverage.",
    "Documentation or runbook": "Check stale commands, obsolete architecture, contradictory sources of truth, missing owners, unsafe examples, and unverified recovery instructions.",
    "Static asset": "Check unnecessary bytes, stale branding, accessible alternatives, correct dimensions, cache behavior, and license/provenance.",
    "Sanitized test fixture": "Check that data is synthetic/sanitized, deterministic, schema-current, minimal, and impossible to load in live runtime.",
    "Build, runtime, or repository configuration": "Check local/CI/production parity, secret handling, ignored outputs, runtime version pinning, bundle boundaries, and deployment defaults.",
    "Generated audit evidence": "Do not edit manually; regenerate and verify that inventory counts match the current worktree.",
  };
  return concerns[role] ?? "Check ownership, stale duplication, unsafe defaults, error handling, and whether an executable test covers the file's behavior.";
}

function detectedConcerns(path, text, lines, bytes, role) {
  const concerns = [];
  const add = (condition, message) => { if (condition) concerns.push(message); };
  if (AUDIT_ARTIFACTS.has(path)) return concerns;
  add(lines >= 1_000, `Large module (${lines} lines): split by behavior before adding more responsibilities.`);
  add(bytes >= 1_000_000, `Large repository object (${Math.round(bytes / 1024)} KiB): confirm it belongs in Git and is compressed.`);
  if (!text) return concerns;
  add(!SELF_ANALYSIS_PATHS.has(path) && /\b(?:TODO|FIXME|HACK|XXX)\b/u.test(text), "Contains TODO/FIXME/HACK marker; confirm an owner and release disposition.");
  add(!SELF_ANALYSIS_PATHS.has(path) && /@ts-ignore\b|\bas any\b|:\s*any\b/u.test(text), "Contains unsafe type escape; replace with validation or a narrow type.");
  add(!SELF_ANALYSIS_PATHS.has(path) && /dangerouslySetInnerHTML|\beval\s*\(|new\s+Function\b/u.test(text), "Contains dynamic HTML/code execution; prove sanitization or remove it.");
  add(/NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|CONNECTION_STRING|PRIVATE_KEY)/u.test(text), "References a secret-like public environment variable; this must never ship.");
  add(/process\.env\b/u.test(text) && /^(?:components|app\/(?!api)|lib\/pipeline\/user-workspace-state-client)/u.test(path), "Reads environment state near browser-capable code; verify only explicitly public values cross the bundle boundary.");
  add(/console\.(?:log|warn|error|debug)\s*\(/u.test(text) && /^(?:app|components|lib)\//u.test(path), "Contains runtime console logging; verify messages cannot include PHI, tokens, query strings, or upstream bodies.");
  add(/(?<![.\w])(?:exec|execFile|spawn)(?:Sync)?\s*\(/u.test(text), "Executes a subprocess; validate arguments, avoid shell interpolation, bound runtime, and propagate failures.");
  add(/(?:rmSync|unlinkSync|rmdirSync|DROP\s+(?:TABLE|DATABASE)|DELETE\s+FROM)/iu.test(text) && role === "Operator, verification, or data script", "Contains destructive behavior; require dry-run, explicit scope, and recovery evidence.");
  add(/setInterval\s*\(|setTimeout\s*\(/u.test(text) && /^(?:components|app)\//u.test(path), "Uses timers in UI/runtime code; verify cleanup, visibility behavior, backoff, and no duplicate pollers.");
  add(/localStorage|sessionStorage/u.test(text), "Uses browser storage; verify no PHI/tokens, user scoping, expiry, and cross-session cleanup.");
  add(/Math\.random\s*\(/u.test(text) && /^(?:app|lib)\//u.test(path), "Uses non-deterministic randomness; do not use for security, durable IDs, or reproducible ordering.");
  add(/https?:\/\//u.test(text) && !/^(?:docs|README|package-lock|\.github\/dependabot)/u.test(path), "Contains a hard-coded URL; verify environment portability, allowlisting, and that no endpoint is obsolete.");
  add(/SELECT\s+\*/iu.test(text), "Uses SELECT *; verify response growth, schema coupling, and PHI minimization.");
  add(/catch\s*\([^)]*\)\s*\{\s*\}/u.test(text), "Contains an empty catch block; failures may be silently hidden.");
  add(/\.catch\s*\(\s*\(?.*?\)?\s*=>\s*(?:undefined|null|\{\s*\})/u.test(text), "Explicitly suppresses a rejected promise; verify this is genuinely optional and observable.");
  add(/\b(?:password|client_secret|private_key)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{12,}["']/iu.test(text) && !path.endsWith(".example") && !path.includes("fixtures"), "Looks like an embedded credential literal; inspect immediately without copying the value into logs.");
  return concerns;
}

function auditFiles() {
  const allPaths = repositoryPaths();
  const deleted = trackedDeletedPaths(allPaths);
  const files = [];
  for (const path of allPaths) {
    const absolute = join(ROOT, path);
    if (!existsSync(absolute)) continue;
    const stats = statSync(absolute);
    const bytes = readFileSync(absolute);
    const text = isText(path) ? bytes.toString("utf8") : "";
    const lines = text ? countLines(text) : null;
    const role = roleFor(path);
    const risk = riskFor(path, role, lines ?? 0);
    const detected = detectedConcerns(path, text, lines ?? 0, stats.size, role);
    files.push({
      path,
      content_sha256: createHash("sha256").update(bytes).digest("hex"),
      role,
      risk,
      bytes: stats.size,
      lines,
      detected_concerns: detected,
      review_focus: detected[0] ?? genericConcern(role),
      verification: verificationFor(path, role),
    });
  }
  return { files, pending_deletions: deleted };
}

function packageNameFromLockPath(path) {
  const fragment = path.split("node_modules/").at(-1);
  return fragment || path;
}

function installHooksFor(lockPath) {
  const packageJson = join(ROOT, lockPath, "package.json");
  if (!existsSync(packageJson)) return [];
  try {
    const parsed = JSON.parse(readFileSync(packageJson, "utf8"));
    return ["preinstall", "install", "postinstall"].filter((name) => parsed.scripts?.[name]);
  } catch {
    return ["unreadable-package-json"];
  }
}

function auditDependencies() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const directNames = new Set(Object.keys(manifest.dependencies ?? {}));
  const devNames = new Set(Object.keys(manifest.devDependencies ?? {}));
  const repositoryText = repositoryPaths()
    .filter((path) => existsSync(join(ROOT, path)) && isText(path) && !path.startsWith("docs/reliability/") && path !== REPORT_PATH)
    .map((path) => [path, readFileSync(join(ROOT, path), "utf8")]);
  const direct = [...directNames, ...devNames].sort().map((name) => {
    const [purpose, review] = DIRECT_DEPENDENCY_REVIEWS[name] ?? ["Declared project dependency", "Confirm necessity, runtime boundary, maintenance, security advisories, license, and bundle impact."];
    const lockEntry = lock.packages?.[`node_modules/${name}`] ?? {};
    return {
      name,
      requested: manifest.dependencies?.[name] ?? manifest.devDependencies?.[name],
      resolved: lockEntry.version ?? null,
      scope: directNames.has(name) ? "runtime" : "development",
      license: lockEntry.license ?? "not-declared-in-lockfile",
      purpose,
      review_focus: review,
      referenced_by: repositoryText
        .filter(([, text]) => text.includes(name))
        .map(([path]) => path)
        .sort(),
    };
  });
  const locked = Object.entries(lock.packages ?? {})
    .filter(([path]) => path)
    .map(([path, entry]) => ({
      name: packageNameFromLockPath(path),
      version: entry.version ?? "unknown",
      path,
      license: entry.license ?? "not-declared-in-lockfile",
      development: Boolean(entry.dev),
      optional: Boolean(entry.optional),
      peer: Boolean(entry.peer),
      integrity_present: Boolean(entry.integrity),
      registry_source: !entry.resolved || entry.resolved.startsWith("https://registry.npmjs.org/"),
      install_hooks: installHooksFor(path),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version) || left.path.localeCompare(right.path));

  let installed = { resolvedPackages: null, dependencyEdges: null, problems: [] };
  try {
    const tree = JSON.parse(execFileSync("npm", ["ls", "--all", "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    const versions = new Set();
    let edges = 0;
    const visit = (dependencies) => {
      for (const [name, value] of Object.entries(dependencies ?? {})) {
        edges += 1;
        versions.add(`${name}@${value.version ?? "unknown"}`);
        visit(value.dependencies);
      }
    };
    visit(tree.dependencies);
    installed = { resolvedPackages: versions.size, dependencyEdges: edges, problems: tree.problems ?? [] };
  } catch (error) {
    const output = error.stdout?.toString?.() ?? "{}";
    try {
      const tree = JSON.parse(output);
      installed.problems = tree.problems ?? ["npm ls failed"];
    } catch {
      installed.problems = ["npm ls failed and returned unreadable output"];
    }
  }
  return { direct, locked, installed };
}

function escapeTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderReport(fileAudit, dependencies) {
  const riskCounts = Object.fromEntries(["critical", "high", "medium", "low"].map((risk) => [risk, fileAudit.files.filter((file) => file.risk === risk).length]));
  const flagged = fileAudit.files.filter((file) => file.detected_concerns.length > 0);
  const installHooks = dependencies.locked.filter((dependency) => dependency.install_hooks.length > 0);
  const missingLicenses = dependencies.locked.filter((dependency) => dependency.license === "not-declared-in-lockfile");
  const nonRegistry = dependencies.locked.filter((dependency) => !dependency.registry_source);
  const versionsByName = new Map();
  for (const dependency of dependencies.locked) {
    const versions = versionsByName.get(dependency.name) ?? new Set();
    versions.add(dependency.version);
    versionsByName.set(dependency.name, versions);
  }
  const duplicateVersions = [...versionsByName]
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({ name, versions: [...versions].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const sections = [];
  sections.push("# Complete Repository and Dependency Audit");
  sections.push("");
  sections.push(`Audit date: ${REPORT_DATE}`);
  sections.push("");
  sections.push("This is a deterministic inventory of the current worktree. It covers every repository-owned file that exists on disk, records tracked files pending deletion separately, and inventories every package-lock entry. It does not include ignored runtime data, `.git`, `node_modules`, `.next`, Playwright output, or local secrets. The per-file review focus is a release checklist, not a claim that generic static analysis can prove behavior correct.");
  sections.push("");
  sections.push("## Executive Summary");
  sections.push("");
  sections.push(`- Existing repository files: ${fileAudit.files.length}`);
  sections.push(`- Tracked paths pending deletion: ${fileAudit.pending_deletions.length}`);
  sections.push(`- Risk classification: ${riskCounts.critical} critical, ${riskCounts.high} high, ${riskCounts.medium} medium, ${riskCounts.low} low`);
  sections.push(`- Files with concrete static review flags: ${flagged.length}`);
  sections.push(`- Direct dependencies: ${dependencies.direct.length}`);
  sections.push(`- Locked dependency locations: ${dependencies.locked.length}`);
  sections.push(`- Installed unique package versions: ${dependencies.installed.resolvedPackages ?? "unavailable"}`);
  sections.push(`- Installed dependency edges: ${dependencies.installed.dependencyEdges ?? "unavailable"}`);
  sections.push(`- Locked packages with install hooks: ${installHooks.length}`);
  sections.push(`- Locked entries without a declared lockfile license: ${missingLicenses.length}`);
  sections.push(`- Locked entries with a non-npm-registry source: ${nonRegistry.length}`);
  sections.push(`- Package names resolved at multiple versions: ${duplicateVersions.length}`);
  sections.push("");
  sections.push("## Immediate Findings");
  sections.push("");
  if (dependencies.installed.problems.length > 0) {
    for (const problem of dependencies.installed.problems) {
      const optionalLockEntry = dependencies.locked.find((dependency) => problem.includes(`${dependency.name}@${dependency.version}`) && dependency.optional);
      sections.push(optionalLockEntry
        ? `- Installed-tree note: ${problem}. This is a lockfile-declared optional platform package, not an undeclared application dependency.`
        : `- Installed-tree hygiene: ${problem}`);
    }
  } else {
    sections.push("- The installed dependency tree contains no npm-reported problems.");
  }
  sections.push("- Critical/high files require behavior tests and boundary verification; static review alone is not release evidence.");
  sections.push("- Large UI and fixture modules are called out individually so future work does not add more responsibilities to them.");
  sections.push("- Generated audit files are listed but must be regenerated rather than edited manually.");
  sections.push("");
  sections.push("## Human Triage Required");
  sections.push("");
  sections.push(`- Review all ${flagged.length} current static flags; this generator does not auto-dismiss findings from an older audit.`);
  sections.push(`- Resolve or explicitly accept all ${fileAudit.pending_deletions.length} tracked pending deletions in the same change as their replacements.`);
  sections.push(`- Review all ${dependencies.installed.problems.length} installed-tree problems and every direct dependency with zero repository references.`);
  sections.push("- Record confirmed findings, owners, and disposition in the approved refactor slice rather than editing this generated report.");
  sections.push("");
  sections.push("## Direct Dependency Review");
  sections.push("");
  sections.push("| Dependency | Scope | Requested -> resolved | License | Purpose | Repository references | Mistakes to look for |");
  sections.push("|---|---|---|---|---|---:|---|");
  for (const dependency of dependencies.direct) {
    sections.push(`| ${escapeTable(dependency.name)} | ${dependency.scope} | ${escapeTable(dependency.requested)} -> ${escapeTable(dependency.resolved)} | ${escapeTable(dependency.license)} | ${escapeTable(dependency.purpose)} | ${dependency.referenced_by.length} | ${escapeTable(dependency.review_focus)} |`);
  }
  sections.push("");
  sections.push("Reference counts are literal repository references, including build configuration and package scripts. Zero does not automatically mean unused when a framework discovers a dependency by convention.");
  sections.push("");
  sections.push("## Per-File Audit");
  sections.push("");
  sections.push("Every existing repository file is listed below. `Review focus` names the most likely failure class for that exact file; `Verification` names the minimum evidence expected before release.");
  sections.push("");
  sections.push("| File | Role | Risk | Size / lines | Review focus | Verification |");
  sections.push("|---|---|---:|---:|---|---|");
  for (const file of fileAudit.files) {
    const size = file.lines === null ? `${file.bytes} B / binary` : `${file.bytes} B / ${file.lines} lines`;
    sections.push(`| \`${escapeTable(file.path)}\` | ${escapeTable(file.role)} | ${file.risk} | ${size} | ${escapeTable(file.review_focus)} | ${escapeTable(file.verification)} |`);
  }
  sections.push("");
  sections.push("## Detected Static Review Flags");
  sections.push("");
  if (flagged.length === 0) sections.push("None.");
  else {
    sections.push("These are inspection prompts, not automatically confirmed defects. Each must be resolved as expected behavior, repaired, or assigned before release.");
    sections.push("");
    for (const file of flagged) sections.push(`- \`${file.path}\`: ${file.detected_concerns.join(" ")}`);
  }
  sections.push("");
  sections.push("## Pending Deletions");
  sections.push("");
  if (fileAudit.pending_deletions.length === 0) sections.push("None.");
  else for (const path of fileAudit.pending_deletions) sections.push(`- \`${path}\`: tracked in HEAD but absent from the current worktree; verify imports/replacements before commit.`);
  sections.push("");
  sections.push("## Complete Locked Dependency Inventory");
  sections.push("");
  sections.push("Duplicate package names at different paths or versions are intentionally retained; they represent the actual lockfile surface.");
  sections.push("");
  sections.push("| Package | Version | Scope flags | License | Integrity | Source | Install hooks | Lock path |");
  sections.push("|---|---|---|---|---|---|---|---|");
  for (const dependency of dependencies.locked) {
    const flags = [dependency.development ? "dev" : "runtime", dependency.optional ? "optional" : null, dependency.peer ? "peer" : null].filter(Boolean).join(", ");
    sections.push(`| ${escapeTable(dependency.name)} | ${escapeTable(dependency.version)} | ${flags} | ${escapeTable(dependency.license)} | ${dependency.integrity_present ? "yes" : "no"} | ${dependency.registry_source ? "npm registry" : "other"} | ${escapeTable(dependency.install_hooks.join(", ") || "none")} | \`${escapeTable(dependency.path)}\` |`);
  }
  sections.push("");
  sections.push("## Dependency Duplication and Install Hooks");
  sections.push("");
  if (duplicateVersions.length === 0) sections.push("No package name resolves to multiple versions.");
  else for (const dependency of duplicateVersions) sections.push(`- \`${dependency.name}\`: ${dependency.versions.join(", ")}`);
  sections.push("");
  if (installHooks.length === 0) sections.push("No locked package has an installed lifecycle hook.");
  else for (const dependency of installHooks) sections.push(`- \`${dependency.name}@${dependency.version}\`: ${dependency.install_hooks.join(", ")} at \`${dependency.path}\``);
  sections.push("");
  sections.push("## Review Method");
  sections.push("");
  sections.push("1. Enumerate Git-tracked and non-ignored untracked paths; separate paths already deleted in the worktree.");
  sections.push("2. Read every existing file as bytes and every recognized text file as UTF-8.");
  sections.push("3. Classify role/risk and scan for large modules, type escapes, dynamic execution, secret-like public variables, runtime logging, subprocesses, destructive operations, timers, browser storage, hard-coded URLs, broad SQL, silent catches, and embedded credential patterns.");
  sections.push("4. Parse `package.json`, `package-lock.json`, installed package manifests, and `npm ls --all` to capture versions, licenses, source integrity, install hooks, dependency edges, and tree problems.");
  sections.push("5. Associate every file class with the executable verification required before release.");
  sections.push("");
  sections.push("Machine-readable evidence:");
  sections.push(`- \`${FILE_INVENTORY_PATH}\``);
  sections.push(`- \`${DEPENDENCY_INVENTORY_PATH}\``);
  sections.push("");
  return `${sections.join("\n").trimEnd()}\n`;
}

mkdirSync(join(ROOT, "docs/reliability"), { recursive: true });
const fileAudit = auditFiles();
const dependencies = auditDependencies();
const evidenceMetadata = {
  generated_at: GENERATED_AT,
  audit_date: REPORT_DATE,
  git_head: git(["rev-parse", "HEAD"]).trim(),
};
writeFileSync(join(ROOT, FILE_INVENTORY_PATH), `${JSON.stringify({ ...evidenceMetadata, ...fileAudit }, null, 2)}\n`);
writeFileSync(join(ROOT, DEPENDENCY_INVENTORY_PATH), `${JSON.stringify({ ...evidenceMetadata, ...dependencies }, null, 2)}\n`);
writeFileSync(join(ROOT, REPORT_PATH), renderReport(fileAudit, dependencies));

console.log(JSON.stringify({
  ok: true,
  report: REPORT_PATH,
  file_inventory: FILE_INVENTORY_PATH,
  dependency_inventory: DEPENDENCY_INVENTORY_PATH,
  existing_files: fileAudit.files.length,
  pending_deletions: fileAudit.pending_deletions.length,
  direct_dependencies: dependencies.direct.length,
  locked_dependency_locations: dependencies.locked.length,
  installed_unique_versions: dependencies.installed.resolvedPackages,
  installed_dependency_edges: dependencies.installed.dependencyEdges,
  installed_tree_problems: dependencies.installed.problems,
}, null, 2));

#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { extname } from "node:path";
import ts from "typescript";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const policy = readJson("docs/refactoring/code-quality-policy.json");
const registry = readJson("docs/refactoring/refactor-slices.json");
const manifest = readJson("package.json");
const lock = readJson("package-lock.json");
const tsconfig = readJson("tsconfig.json");
const inventory = readJson("docs/reliability/repository-file-inventory.json");
const dependencyInventory = readJson("docs/reliability/dependency-inventory.json");
const errors = [];
const warnings = [];
const cloudRefactorRun = process.env.GITHUB_ACTIONS === "true"
  && process.env.PIPELINE_REFACTOR_CLOUD_RUN === "true";

function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitObjectExists(revision, path) {
  try {
    git(["cat-file", "-e", `${revision}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

function repositoryPaths() {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();
}

function repositoryPathsAtRevision(revision) {
  return git(["ls-tree", "-r", "--name-only", "-z", revision])
    .split("\0")
    .filter(Boolean)
    .sort();
}

function packageName(specifier) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function collectModuleSpecifiers(path) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, scriptKind(path));
  const specifiers = [];
  const add = (node) => { if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text); };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") add(node.arguments[0]);
      if (ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === "require"
        && node.expression.name.text === "resolve") add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function scriptKind(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseWorktrees() {
  const records = [];
  let current = null;
  for (const line of git(["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), head: "", branch: "detached" };
      records.push(current);
    } else if (current && line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (current && line.startsWith("branch refs/heads/")) current.branch = line.slice(18);
  }
  return records.map((record) => {
    let divergence = ["0", "0"];
    if (record.branch !== "detached") {
      try { divergence = git(["rev-list", "--left-right", "--count", `main...${record.branch}`]).split(/\s+/u); } catch { divergence = ["0", "0"]; }
    }
    const [mainOnly = "0", branchOnly = "0"] = divergence;
    return {
      ...record,
      changes: git(["status", "--porcelain=v1"], record.path).split("\n").filter(Boolean).length,
      mainOnly: Number(mainOnly),
      branchOnly: Number(branchOnly),
    };
  });
}

if (policy.schemaVersion !== 1) errors.push("Code-quality policy must use schemaVersion 1.");
if (lock.lockfileVersion !== policy.runtime.lockfileVersion) errors.push(`package-lock.json must use lockfileVersion ${policy.runtime.lockfileVersion}.`);
if (tsconfig.compilerOptions?.strict !== policy.typescript.requireStrict) errors.push("TypeScript strict mode must remain enabled.");
if (tsconfig.compilerOptions?.noEmit !== policy.typescript.requireNoEmit) errors.push("TypeScript noEmit must remain enabled.");
if (tsconfig.compilerOptions?.skipLibCheck) warnings.push("skipLibCheck is enabled; dependency declaration errors are not currently checked.");
if (tsconfig.compilerOptions?.allowJs) warnings.push("allowJs is enabled; JavaScript migration scope remains broader than typed application code.");

const nvmMajor = Number(readFileSync(".nvmrc", "utf8").trim().replace(/^v/u, "").split(".")[0]);
if (nvmMajor !== policy.runtime.nodeMajor) errors.push(`.nvmrc must select Node ${policy.runtime.nodeMajor}.`);
if (!String(manifest.engines?.node ?? "").includes(String(policy.runtime.nodeMajor))) errors.push(`package.json engines.node must include Node ${policy.runtime.nodeMajor}.`);
const nodeTypesVersion = lock.packages?.["node_modules/@types/node"]?.version;
if (Number(nodeTypesVersion?.split(".")[0]) !== policy.runtime.nodeMajor) {
  warnings.push(`@types/node ${nodeTypesVersion ?? "missing"} does not match the selected Node ${policy.runtime.nodeMajor} runtime.`);
}

const rootLock = lock.packages?.[""] ?? {};
for (const scope of ["dependencies", "devDependencies"]) {
  for (const [name, requested] of Object.entries(manifest[scope] ?? {})) {
    if (rootLock[scope]?.[name] !== requested) errors.push(`${name} is out of sync between package.json and package-lock.json.`);
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry) {
      errors.push(`${name} is missing from the package lock.`);
      continue;
    }
    if (policy.dependencies.requireRegistryIntegrity && !entry.integrity) errors.push(`${name} is not integrity pinned in package-lock.json.`);
    if (entry.resolved && !entry.resolved.startsWith("https://registry.npmjs.org/")) errors.push(`${name} resolves outside the npm registry.`);
    const installedPath = `node_modules/${name}/package.json`;
    if (!existsSync(installedPath)) warnings.push(`${name} is not installed locally; run npm ci before certification.`);
    else if (readJson(installedPath).version !== entry.version) errors.push(`${name} installed version does not match package-lock.json.`);
  }
}

for (const [name, override] of Object.entries(manifest.overrides ?? {})) {
  const entry = lock.packages?.[`node_modules/${name}`];
  if (entry && entry.version !== override) errors.push(`Override ${name}@${override} does not match the root locked version ${entry.version}.`);
}

const directDependencyCount = Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) }).length;
if (directDependencyCount > policy.dependencies.maximumDirectDependencies) errors.push(`Direct dependency count ${directDependencyCount} exceeds ${policy.dependencies.maximumDirectDependencies}.`);
if ((dependencyInventory.locked?.length ?? 0) > policy.dependencies.maximumLockedPackageLocations) errors.push(`Locked package locations ${dependencyInventory.locked.length} exceed ${policy.dependencies.maximumLockedPackageLocations}.`);
const versionsByPackage = new Map();
for (const dependency of dependencyInventory.locked ?? []) {
  const versions = versionsByPackage.get(dependency.name) ?? new Set();
  versions.add(dependency.version);
  versionsByPackage.set(dependency.name, versions);
}
const duplicateVersionPackages = [...versionsByPackage.values()].filter((versions) => versions.size > 1).length;
if (duplicateVersionPackages > policy.dependencies.maximumDuplicateVersionPackages) errors.push(`Multi-version package count ${duplicateVersionPackages} exceeds ${policy.dependencies.maximumDuplicateVersionPackages}.`);
const installedHooks = (dependencyInventory.locked ?? []).filter((dependency) => dependency.install_hooks?.length);
const allowedHooks = policy.dependencies.allowedInstallHooks ?? {};
for (const dependency of installedHooks) {
  const key = `${dependency.name}@${dependency.version}`;
  const allowed = allowedHooks[key];
  if (!allowed || dependency.install_hooks.some((hook) => !allowed.hooks.includes(hook))) errors.push(`Unapproved install hook on ${key}: ${dependency.install_hooks.join(", ")}.`);
}
for (const key of Object.keys(allowedHooks)) if (!installedHooks.some((dependency) => `${dependency.name}@${dependency.version}` === key)) warnings.push(`Stale install-hook allowance ${key}.`);
if (lock.packages?.["node_modules/next"]?.version !== lock.packages?.["node_modules/eslint-config-next"]?.version) {
  errors.push("next and eslint-config-next must stay on the same exact version.");
}
if (lock.packages?.["node_modules/react"]?.version !== lock.packages?.["node_modules/react-dom"]?.version) {
  errors.push("react and react-dom must stay on the same exact version.");
}

const paths = repositoryPaths();
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const importedPackages = new Set();
for (const path of paths) {
  if (!sourceExtensions.has(extname(path)) || !existsSync(path)) continue;
  for (const specifier of collectModuleSpecifiers(path)) {
    const name = packageName(specifier);
    if (name) importedPackages.add(name);
  }
}
const cssText = paths.filter((path) => path.endsWith(".css") && existsSync(path)).map((path) => readFileSync(path, "utf8")).join("\n");
for (const match of cssText.matchAll(/@import\s+["']([^"']+)["']/gu)) {
  const name = packageName(match[1]);
  if (name) importedPackages.add(name);
}
const packageScripts = Object.values(manifest.scripts ?? {}).join("\n");
if (/\bnext\b/u.test(packageScripts)) importedPackages.add("next");
if (/\beslint\b/u.test(packageScripts)) importedPackages.add("eslint");
if (/\bplaywright\b/u.test(packageScripts)) importedPackages.add("@playwright/test");
for (const name of Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) })) {
  if (!importedPackages.has(name) && !policy.dependencies.conventionOnly?.[name]) errors.push(`Direct dependency ${name} has no executable repository reference or documented convention.`);
}

const excludedSuppressionScanners = new Set([
  "scripts/code-hygiene-audit.mjs",
  "scripts/code-quality-readiness.mjs",
  "scripts/complete-repository-audit.mjs",
]);
let tsIgnore = 0;
let tsNoCheck = 0;
let explicitAny = 0;
const eslintDisables = [];
for (const path of paths) {
  if (!sourceExtensions.has(extname(path)) || !existsSync(path) || excludedSuppressionScanners.has(path)) continue;
  const value = readFileSync(path, "utf8");
  tsIgnore += (value.match(/@ts-ignore\b/gu) ?? []).length;
  tsNoCheck += (value.match(/@ts-nocheck\b/gu) ?? []).length;
  explicitAny += (value.match(/\bas\s+any\b|:\s*any\b|<any>/gu) ?? []).length;
  for (const match of value.matchAll(/eslint-disable(?:-next-line)?\s+([^\n*]+?)(?:\s+--|\s*\*\/|$)/gu)) {
    for (const rule of match[1].split(/[,\s]+/u).filter(Boolean)) eslintDisables.push({ path, rule });
  }
}
if (tsIgnore > policy.typescript.maximumTsIgnore) errors.push(`@ts-ignore count ${tsIgnore} exceeds ${policy.typescript.maximumTsIgnore}.`);
if (tsNoCheck > policy.typescript.maximumTsNoCheck) errors.push(`@ts-nocheck count ${tsNoCheck} exceeds ${policy.typescript.maximumTsNoCheck}.`);
if (explicitAny > policy.typescript.maximumExplicitAny) errors.push(`Explicit any count ${explicitAny} exceeds ${policy.typescript.maximumExplicitAny}.`);
const allowedDisables = new Set((policy.typescript.allowedEslintDisables ?? []).map((item) => `${item.path}#${item.rule}`));
for (const item of eslintDisables) if (!allowedDisables.has(`${item.path}#${item.rule}`)) errors.push(`Undocumented ESLint disable ${item.path}#${item.rule}.`);
for (const key of allowedDisables) if (!eslintDisables.some((item) => `${item.path}#${item.rule}` === key)) warnings.push(`Stale ESLint-disable allowance ${key}.`);

const auditArtifacts = new Set(policy.auditArtifacts ?? []);
const auditedByPath = new Map((inventory.files ?? []).map((file) => [file.path, file]));
const inventoryDrift = [];
for (const path of paths) {
  if (auditArtifacts.has(path) || !existsSync(path)) continue;
  const audited = auditedByPath.get(path);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (!audited || audited.content_sha256 !== digest) inventoryDrift.push(path);
}
for (const path of auditedByPath.keys()) {
  if (!auditArtifacts.has(path) && !paths.includes(path)) inventoryDrift.push(path);
}
if (inventoryDrift.length > 0) warnings.push(`Repository audit is stale for ${new Set(inventoryDrift).size} paths; run npm run audit:repository.`);

const trackedArtifactPattern = /^(?:\.env(?:\.|$)|\.next(?:-|\/)|coverage\/|outputs\/|playwright-report\/|test-results\/|tmp\/)/u;
for (const path of git(["ls-files"]).split("\n").filter(Boolean)) {
  if (trackedArtifactPattern.test(path) && path !== ".env.example") errors.push(`Generated or secret-shaped path is tracked: ${path}.`);
}

const worktrees = parseWorktrees();
for (const worktree of worktrees) {
  if (worktree.mainOnly >= policy.worktrees.warnWhenBehindMainBy) warnings.push(`${worktree.branch} is ${worktree.mainOnly} commits behind main.`);
  if (worktree.branchOnly > 0) warnings.push(`${worktree.branch} has ${worktree.branchOnly} commit(s) not on main and needs an explicit disposition.`);
}
const currentPath = realpathSync(process.cwd());
const currentWorktree = worktrees.find((worktree) => realpathSync(worktree.path) === currentPath);
if ((currentWorktree?.changes ?? 0) > 0) warnings.push(`Current worktree has ${currentWorktree.changes} changed paths; keep refactor scope isolated.`);

const activeSlice = registry.slices.find((slice) => slice.status === "in_progress");
if (registry.mode === "active" && activeSlice) {
  const governancePaths = new Set([
    "docs/refactoring/evidence-matrix.json",
    "docs/refactoring/refactor-slices.json",
    ...(activeSlice.assuranceRecord ? [activeSlice.assuranceRecord] : []),
    ...auditArtifacts,
  ]);
  const allowedChangePaths = activeSlice.allowedChangePaths ?? [];
  const isAllowedChange = (path) => governancePaths.has(path)
    || allowedChangePaths.some((allowed) => allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed);
  if (Number(nodeTypesVersion?.split(".")[0]) !== policy.runtime.nodeMajor) errors.push("Active refactoring requires Node runtime and @types/node major alignment.");
  if (inventoryDrift.length > 0) errors.push("Active refactoring requires a current every-file repository audit.");
  if (policy.worktrees.requireDedicatedWorktreeForActiveSlice) {
    if (!currentWorktree?.branch.startsWith(policy.worktrees.requiredActiveBranchPrefix)) errors.push(`Active refactoring must use a ${policy.worktrees.requiredActiveBranchPrefix}* branch.`);
    if (!activeSlice.worktreePath || !activeSlice.branch || !activeSlice.startingCommit) errors.push(`${activeSlice.id} must record worktreePath, branch, and startingCommit.`);
    if (!cloudRefactorRun && activeSlice.worktreePath && (!existsSync(activeSlice.worktreePath) || realpathSync(activeSlice.worktreePath) !== currentPath)) errors.push(`${activeSlice.id} is running from the wrong worktree.`);
    if (cloudRefactorRun && (!process.env.GITHUB_WORKSPACE || realpathSync(process.env.GITHUB_WORKSPACE) !== currentPath)) errors.push(`${activeSlice.id} cloud execution must run from the isolated GitHub workspace.`);
    if (activeSlice.branch && activeSlice.branch !== currentWorktree?.branch) errors.push(`${activeSlice.id} registry branch does not match the current branch.`);
    if (activeSlice.startingCommit) {
      try { git(["merge-base", "--is-ancestor", activeSlice.startingCommit, "HEAD"]); } catch { errors.push(`${activeSlice.id} startingCommit is not an ancestor of HEAD.`); }
      try {
        const branchPoint = git(["merge-base", "main", "HEAD"]);
        if (branchPoint !== activeSlice.startingCommit) errors.push(`${activeSlice.id} must fork from its exact recorded startingCommit; merge-base with main is ${branchPoint}.`);
      } catch {
        errors.push(`${activeSlice.id} starting branch point could not be verified.`);
      }
    }
  }

  let startingPaths = [];
  if (activeSlice.startingCommit) {
    try {
      startingPaths = repositoryPathsAtRevision(activeSlice.startingCommit);
    } catch {
      errors.push(`${activeSlice.id} startingCommit file inventory could not be read.`);
    }
  }

  let fileAuditDispositionPaths = new Set();
  if (!activeSlice.fileAuditDisposition || !existsSync(activeSlice.fileAuditDisposition)) {
    errors.push(`${activeSlice.id} must reference an approved file audit disposition.`);
  } else {
    const disposition = readJson(activeSlice.fileAuditDisposition);
    if (disposition.schemaVersion !== 1) errors.push(`${activeSlice.id} file audit disposition must use schemaVersion 1.`);
    if (disposition.sliceId !== activeSlice.id) errors.push(`${activeSlice.id} file audit disposition has the wrong sliceId.`);
    if (disposition.startingCommit !== activeSlice.startingCommit) errors.push(`${activeSlice.id} file audit disposition must use the registry startingCommit.`);
    if (!disposition.humanOwner || !disposition.reviewedAt || !disposition.reviewedBy || !disposition.approvedAt) errors.push(`${activeSlice.id} file audit disposition lacks human review metadata.`);
    if (disposition.humanOwner === disposition.reviewedBy) errors.push(`${activeSlice.id} file audit disposition requires an independent reviewer.`);
    const isCoreScopePath = (path) => activeSlice.paths.some((scope) => path === scope || path.startsWith(`${scope.replace(/\/$/u, "")}/`));
    const scopedPaths = [...new Set([...startingPaths, ...paths].filter(isCoreScopePath))].sort();
    const dispositionByPath = new Map();
    for (const file of disposition.files ?? []) {
      if (dispositionByPath.has(file.path)) errors.push(`${activeSlice.id} file audit disposition repeats ${file.path}.`);
      dispositionByPath.set(file.path, file);
      if (!isCoreScopePath(file.path) && !isAllowedChange(file.path)) errors.push(`${activeSlice.id} file audit disposition includes out-of-scope path ${file.path}.`);
      if (!file.purpose || !Array.isArray(file.callers) || !Array.isArray(file.publicExports) || !Array.isArray(file.sideEffects) || !file.failureBehavior || !Array.isArray(file.tests) || file.tests.length === 0 || !file.decision || !file.decisionReason) {
        errors.push(`${activeSlice.id} file audit disposition is incomplete for ${file.path}.`);
      }
      const existedAtStart = activeSlice.startingCommit && gitObjectExists(activeSlice.startingCommit, file.path);
      if (!existedAtStart && (file.plannedNew !== true || !file.dependencyDirection)) {
        errors.push(`${activeSlice.id} planned new file ${file.path} requires plannedNew true and an explicit dependencyDirection.`);
      }
      if (existedAtStart && file.plannedNew === true) errors.push(`${activeSlice.id} marks existing file ${file.path} as plannedNew.`);
      if (!["keep", "split", "move", "replace", "delete"].includes(file.decision)) errors.push(`${activeSlice.id} file audit disposition has invalid decision for ${file.path}.`);
      const prompts = new Map((file.staticPrompts ?? []).map((prompt) => [prompt.prompt, prompt]));
      for (const prompt of auditedByPath.get(file.path)?.detected_concerns ?? []) {
        const reviewed = prompts.get(prompt);
        if (!reviewed || !["confirmed", "expected", "false_positive", "deferred"].includes(reviewed.disposition) || !reviewed.reason || !reviewed.owner) {
          errors.push(`${activeSlice.id} has an undispositioned static prompt for ${file.path}: ${prompt}`);
        }
      }
    }
    for (const path of scopedPaths) if (!dispositionByPath.has(path)) errors.push(`${activeSlice.id} file audit disposition is missing ${path}.`);
    fileAuditDispositionPaths = new Set(dispositionByPath.keys());
  }

  if (allowedChangePaths.length === 0) errors.push(`${activeSlice.id} must define exact allowedChangePaths before implementation.`);
  const changedPaths = new Set([
    ...(activeSlice.startingCommit ? git(["diff", "--name-only", activeSlice.startingCommit]).split("\n").filter(Boolean) : []),
    ...git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean),
  ]);
  for (const path of changedPaths) {
    if (!isAllowedChange(path)) errors.push(`${activeSlice.id} changed out-of-scope path ${path}.`);
    if (!governancePaths.has(path) && !fileAuditDispositionPaths.has(path)) {
      errors.push(`${activeSlice.id} changed file ${path} without an approved file audit disposition.`);
    }
  }
}

const result = {
  ok: errors.length === 0,
  mode: registry.mode,
  files: { current: paths.length, inventoryDrift: new Set(inventoryDrift).size },
  types: { tsIgnore, tsNoCheck, explicitAny, eslintDisables: eslintDisables.length, skipLibCheck: Boolean(tsconfig.compilerOptions?.skipLibCheck), allowJs: Boolean(tsconfig.compilerOptions?.allowJs) },
  dependencies: { direct: directDependencyCount, lockedLocations: dependencyInventory.locked?.length ?? 0, duplicateVersionPackages, installHooks: installedHooks.length, importedOrInvoked: importedPackages.size, nodeTypesVersion },
  worktrees,
  execution: { cloudRefactorRun },
  errors,
  warnings,
  interpretation: registry.mode === "setup_only"
    ? "Setup debt remains visible without authorizing a refactor. Active mode promotes inventory, runtime-alignment, and dedicated-worktree gaps to failures."
    : "An active slice must remain inside its recorded dedicated worktree and current audited boundary.",
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

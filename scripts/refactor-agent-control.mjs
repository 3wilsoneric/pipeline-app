#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = process.env.PIPELINE_REPOSITORY_ROOT
  ? resolve(process.env.PIPELINE_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL("..", import.meta.url)));
const registryPath = "docs/refactoring/refactor-slices.json";
const policyPath = "docs/refactoring/code-quality-policy.json";
const manifestPath = "package.json";

const immutableAgentPaths = [
  ".env",
  ".env.local",
  ".github/codex/",
  ".github/workflows/",
  "database/migrations/",
  "docs/refactoring/code-quality-policy.json",
  "docs/refactoring/evidence-matrix.json",
  "docs/refactoring/performance-budgets.json",
  "docs/refactoring/refactor-slices.json",
  "infra/",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "scripts/apply-database-migrations.mjs",
];

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const equalsIndex = item.indexOf("=");
    if (equalsIndex !== -1) {
      options[item.slice(2, equalsIndex)] = item.slice(equalsIndex + 1);
      continue;
    }
    const key = item.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = "true";
    }
  }
  return { command, options };
}

function normalizePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
    throw new Error(`Unsafe repository path: ${String(path)}`);
  }
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe repository path: ${path}`);
  }
  return normalized;
}

function matchesPath(path, candidate) {
  const normalizedPath = normalizePath(path);
  const normalizedCandidate = normalizePath(candidate);
  return normalizedCandidate.endsWith("/")
    ? normalizedPath.startsWith(normalizedCandidate)
    : normalizedPath === normalizedCandidate;
}

export function isImmutableAgentPath(path) {
  return immutableAgentPaths.some((candidate) => matchesPath(path, candidate));
}

export function isAllowedChangePath(path, allowedPaths, generatedPaths = []) {
  if (isImmutableAgentPath(path)) return false;
  return [...allowedPaths, ...generatedPaths].some((candidate) => matchesPath(path, candidate));
}

function findActiveSlice(registry, requested) {
  const activeSlices = registry.slices.filter((slice) => slice.status === "in_progress");
  if (activeSlices.length > 1) throw new Error("Only one refactor slice may be in_progress.");
  if (activeSlices.length === 0) return null;
  const selected = requested === "auto"
    ? activeSlices[0]
    : registry.slices.find((candidate) => candidate.id === requested);
  if (!selected) throw new Error(`Unknown refactor slice: ${requested}`);
  if (selected.id !== activeSlices[0].id || selected.status !== "in_progress") {
    throw new Error(`${selected.id} is not the single active in_progress slice.`);
  }
  return selected;
}

function validateApproval(slice) {
  const errors = [];
  if (!slice.owner || slice.owner === "unassigned") errors.push("A human owner is required.");
  if (!slice.approvedBy || !slice.approvedAt) errors.push("Human approval metadata is required.");
  if (!slice.branch) errors.push("An isolated branch is required.");
  if (!slice.worktreePath) errors.push("worktreePath must record the approved isolated checkout.");
  return errors;
}

function validateCollections(slice) {
  const errors = [];
  if (!Array.isArray(slice.allowedChangePaths) || slice.allowedChangePaths.length === 0) errors.push("allowedChangePaths must not be empty.");
  if (!Array.isArray(slice.invariants) || slice.invariants.length === 0) errors.push("At least one invariant is required.");
  if (!Array.isArray(slice.requiredGates) || slice.requiredGates.length === 0) errors.push("At least one required gate is required.");
  return errors;
}

function validateBranch(slice, policy) {
  const errors = [];
  if (slice.branch && !slice.branch.startsWith(policy.worktrees.requiredActiveBranchPrefix)) {
    errors.push(`branch must begin with ${policy.worktrees.requiredActiveBranchPrefix}.`);
  }
  if (!/^[a-f0-9]{40}$/u.test(slice.startingCommit ?? "")) errors.push("startingCommit must be a full Git commit SHA.");
  return errors;
}

function validateEvidenceFiles(slice, fileExists) {
  const errors = [];
  if (!slice.architectureNarrative || !fileExists(resolve(repositoryRoot, slice.architectureNarrative))) errors.push("The approved architecture narrative is missing.");
  if (!slice.fileAuditDisposition || !fileExists(resolve(repositoryRoot, slice.fileAuditDisposition))) errors.push("The approved file audit disposition is missing.");
  return errors;
}

function validateAllowedPaths(slice) {
  const errors = [];
  for (const path of slice.allowedChangePaths ?? []) {
    try {
      normalizePath(path);
      if (isImmutableAgentPath(path)) errors.push(`Protected path cannot be agent-mutable: ${path}.`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

function validateRequiredGates(slice, manifest) {
  return (slice.requiredGates ?? [])
    .filter((gate) => !manifest.scripts?.[gate])
    .map((gate) => `Unknown npm gate: ${gate}.`);
}

function toSelection(slice) {
  return {
    enabled: true,
    reason: "Approved active slice selected.",
    sliceId: slice.id,
    owner: slice.owner,
    approvedBy: slice.approvedBy,
    approvedAt: slice.approvedAt,
    branch: slice.branch,
    startingCommit: slice.startingCommit,
    architectureNarrative: slice.architectureNarrative,
    fileAuditDisposition: slice.fileAuditDisposition,
    allowedChangePaths: slice.allowedChangePaths,
    invariants: slice.invariants,
    requiredGates: slice.requiredGates,
    requiresBrowser: slice.requiredGates.some((gate) => gate.startsWith("test:e2e")),
    requiresPostgres: slice.requiredGates.some((gate) => gate.startsWith("database:")),
  };
}

export function selectSlice({ registry, policy, manifest, requested = "auto", fileExists = existsSync }) {
  if (registry.mode === "setup_only") {
    return { enabled: false, reason: "The refactor registry remains in setup_only mode." };
  }
  if (registry.mode !== "active") throw new Error(`Unsupported refactor registry mode: ${registry.mode}`);
  const slice = findActiveSlice(registry, requested);
  if (!slice) return { enabled: false, reason: "No refactor slice is in_progress." };
  const errors = [
    ...validateApproval(slice),
    ...validateCollections(slice),
    ...validateBranch(slice, policy),
    ...validateEvidenceFiles(slice, fileExists),
    ...validateAllowedPaths(slice),
    ...validateRequiredGates(slice, manifest),
  ];
  if (errors.length > 0) throw new Error(`${slice.id} is not cloud-run ready:\n- ${errors.join("\n- ")}`);
  return toSelection(slice);
}

function appendGitHubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replaceAll("\n", "%0A")}`);
  writeFileSync(outputPath, `${lines.join("\n")}\n`, { flag: "a" });
}

function git(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function collectChangedPaths(base) {
  const mergeBase = git(["merge-base", base, "HEAD"]);
  const committed = git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", mergeBase, "HEAD"]);
  const working = git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", "HEAD"]);
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB", "HEAD"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([committed, working, staged, untracked].flatMap((value) => value.split("\n")).filter(Boolean))].sort();
}

export function validateAgentResult(result) {
  const errors = [];
  if (!["ready_for_review", "in_progress", "blocked"].includes(result?.status)) errors.push("status is invalid.");
  if (typeof result?.summary !== "string" || result.summary.trim().length === 0) errors.push("summary is required.");
  if (!Array.isArray(result?.changes)) errors.push("changes must be an array.");
  if (!Array.isArray(result?.tests)) errors.push("tests must be an array.");
  if (!Array.isArray(result?.blockers)) errors.push("blockers must be an array.");
  if (!Array.isArray(result?.nextSteps)) errors.push("nextSteps must be an array.");
  if (errors.length > 0) throw new Error(`Invalid Codex result: ${errors.join(" ")}`);
  return result;
}

function selectionCommand(options) {
  const registry = readJson(registryPath);
  const policy = readJson(policyPath);
  const manifest = readJson(manifestPath);
  const selection = selectSlice({ registry, policy, manifest, requested: options.requested ?? "auto" });
  if (options.out) writeFileSync(resolve(repositoryRoot, options.out), `${JSON.stringify(selection, null, 2)}\n`);
  appendGitHubOutput({
    enabled: selection.enabled,
    reason: selection.reason,
    slice_id: selection.sliceId ?? "",
    branch: selection.branch ?? "",
    starting_commit: selection.startingCommit ?? "",
    requires_browser: selection.requiresBrowser ?? false,
    requires_postgres: selection.requiresPostgres ?? false,
  });
  console.log(JSON.stringify(selection, null, 2));
}

function renderPromptCommand(options) {
  if (!options.selection || !options.template || !options.out) throw new Error("render-prompt requires --selection, --template, and --out.");
  const selection = readJson(options.selection);
  if (!selection.enabled) throw new Error("Cannot render a prompt for a disabled selection.");
  const template = readFileSync(resolve(repositoryRoot, options.template), "utf8").trim();
  const context = [
    "",
    "## Approved execution context",
    `- Slice: ${selection.sliceId}`,
    `- Human owner: ${selection.owner}`,
    `- Approved by: ${selection.approvedBy} at ${selection.approvedAt}`,
    `- Starting commit: ${selection.startingCommit}`,
    `- Branch: ${selection.branch}`,
    `- Cloud attempt: ${options.attempt ?? "1"}`,
    `- Architecture narrative: ${selection.architectureNarrative}`,
    `- File audit: ${selection.fileAuditDisposition}`,
    "",
    "Allowed change paths:",
    ...selection.allowedChangePaths.map((path) => `- ${path}`),
    "",
    "Behavioral invariants:",
    ...selection.invariants.map((invariant) => `- ${invariant}`),
    "",
    "Focused gates:",
    ...selection.requiredGates.map((gate) => `- npm run ${gate}`),
    "",
  ].join("\n");
  writeFileSync(resolve(repositoryRoot, options.out), `${template}\n${context}`);
  console.log(`Rendered guarded prompt for ${selection.sliceId}.`);
}

function guardCommand(options) {
  if (!options.slice || !options.base) throw new Error("guard requires --slice and --base.");
  const registry = readJson(registryPath);
  const policy = readJson(policyPath);
  const slice = registry.slices.find((candidate) => candidate.id === options.slice);
  if (!slice) throw new Error(`Unknown refactor slice: ${options.slice}`);
  const generatedPaths = options["include-generated"] === "true" ? policy.auditArtifacts ?? [] : [];
  const changedPaths = collectChangedPaths(options.base);
  const rejected = changedPaths.filter((path) => !isAllowedChangePath(path, slice.allowedChangePaths ?? [], generatedPaths));
  const symlinks = changedPaths.filter((path) => {
    const absolutePath = resolve(repositoryRoot, path);
    return existsSync(absolutePath) && lstatSync(absolutePath).isSymbolicLink();
  });
  if (rejected.length > 0 || symlinks.length > 0) {
    throw new Error([
      rejected.length > 0 ? `Out-of-scope paths:\n- ${rejected.join("\n- ")}` : "",
      symlinks.length > 0 ? `Changed symlinks are prohibited:\n- ${symlinks.join("\n- ")}` : "",
    ].filter(Boolean).join("\n"));
  }
  console.log(JSON.stringify({ ok: true, slice: slice.id, base: options.base, changedPaths, generatedPaths }, null, 2));
}

function runGatesCommand(options) {
  if (!options.slice) throw new Error("run-gates requires --slice.");
  const registry = readJson(registryPath);
  const slice = registry.slices.find((candidate) => candidate.id === options.slice);
  if (!slice) throw new Error(`Unknown refactor slice: ${options.slice}`);
  const results = [];
  for (const gate of slice.requiredGates) {
    const result = spawnSync("npm", ["run", gate], { cwd: repositoryRoot, env: process.env, encoding: "utf8", stdio: "inherit" });
    results.push({ gate, exitCode: result.status ?? 1 });
    if (result.status !== 0) break;
  }
  if (options.out) writeFileSync(resolve(repositoryRoot, options.out), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
}

function validateResultCommand(options) {
  if (!options.path) throw new Error("validate-result requires --path.");
  const result = validateAgentResult(readJson(options.path));
  appendGitHubOutput({ agent_status: result.status });
  console.log(JSON.stringify(result, null, 2));
}

export function runCli(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === "select") selectionCommand(options);
  else if (command === "render-prompt") renderPromptCommand(options);
  else if (command === "guard") guardCommand(options);
  else if (command === "run-gates") runGatesCommand(options);
  else if (command === "validate-result") validateResultCommand(options);
  else throw new Error(`Unknown command: ${command ?? "unset"}`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "docs/REFACTORING_PLAYBOOK.md",
  "docs/refactoring/README.md",
  "docs/refactoring/ARCHITECTURE_NARRATIVE_TEMPLATE.md",
  "docs/refactoring/ADAPTER_PARITY_CONTRACT.md",
  "docs/refactoring/AUTHORIZATION_CHARACTERIZATION_PLAN.md",
  "docs/refactoring/CODE_QUALITY_POLICY.md",
  "docs/refactoring/CLOUD_REFACTOR_RUNBOOK.md",
  "docs/refactoring/COMPATIBILITY_MATRIX.md",
  "docs/refactoring/CONTROL_PLANE_MAP.md",
  "docs/refactoring/DECISION_RECORD_TEMPLATE.md",
  "docs/refactoring/OWNERSHIP_AND_BRANCH_PROTECTION.md",
  "docs/refactoring/REFACTOR_SLICE_TEMPLATE.md",
  "docs/refactoring/SHADOW_COMPARISON_CONTRACT.md",
  "docs/refactoring/WORKTREE_RUNBOOK.md",
  "docs/refactoring/characterization-manifest.example.json",
  "docs/refactoring/code-quality-policy.json",
  "docs/refactoring/file-audit-disposition.example.json",
  "docs/refactoring/evidence-matrix.json",
  "docs/refactoring/performance-budgets.json",
  "docs/refactoring/refactor-slices.json",
  "docs/reliability/refactor-baseline-2026-08-27.json",
  "docs/reliability/refactor-baseline-2026-08-27-setup.json",
  "docs/reliability/complete-repository-audit-latest.md",
  "docs/reliability/dependency-inventory.json",
  "docs/reliability/repository-file-inventory.json",
  "scripts/code-quality-readiness.mjs",
  "scripts/codebase-refactor-baseline.mjs",
  "scripts/compare-refactor-baselines.mjs",
  "scripts/refactor-evidence-readiness.mjs",
  "scripts/refactor-agent-control.mjs",
  "scripts/refactor-agent-control-fixtures.mjs",
];

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const registry = JSON.parse(readFileSync("docs/refactoring/refactor-slices.json", "utf8"));
const errors = [];
const warnings = [];

for (const path of requiredFiles) {
  if (!existsSync(path)) errors.push(`Missing refactor setup file: ${path}.`);
}

for (const name of ["audit:repository", "codebase:baseline", "codebase:baseline:compare", "check:code-quality", "check:refactor-agent", "check:refactor-evidence", "check:refactor-setup", "certify:refactor"]) {
  if (!packageJson.scripts?.[name]) errors.push(`Missing package script: ${name}.`);
}

if (registry.schemaVersion !== 1) errors.push("Refactor slice registry must use schemaVersion 1.");
if (!["setup_only", "active"].includes(registry.mode)) errors.push("Refactor slice registry mode must be setup_only or active.");
if (!Array.isArray(registry.slices) || registry.slices.length < 5) errors.push("Refactor slice registry must define the planned bounded slices.");

const ids = new Set();
const priorities = new Set();
const allowedStatuses = new Set(["not_started", "characterized", "approved", "in_progress", "soaking", "complete"]);
for (const slice of registry.slices ?? []) {
  if (ids.has(slice.id)) errors.push(`Duplicate refactor slice id: ${slice.id}.`);
  ids.add(slice.id);
  if (!Number.isInteger(slice.priority) || slice.priority < 1) errors.push(`${slice.id} must have a positive integer priority.`);
  if (priorities.has(slice.priority)) errors.push(`Duplicate refactor slice priority: ${slice.priority}.`);
  priorities.add(slice.priority);
  if (!allowedStatuses.has(slice.status)) errors.push(`${slice.id} has an invalid status: ${slice.status}.`);
  if (registry.mode === "setup_only" && slice.status !== "not_started") errors.push(`${slice.id} must remain not_started during setup_only mode.`);
  if (!Array.isArray(slice.paths) || slice.paths.length === 0) errors.push(`${slice.id} has no bounded path scope.`);
  for (const path of slice.paths ?? []) {
    if (!existsSync(path)) errors.push(`${slice.id} references missing scope path ${path}.`);
  }
  if (!Array.isArray(slice.invariants) || slice.invariants.length === 0) errors.push(`${slice.id} has no recorded invariants.`);
  if (!Array.isArray(slice.allowedChangePaths)) errors.push(`${slice.id} must define allowedChangePaths.`);
  if (new Set(slice.allowedChangePaths ?? []).size !== (slice.allowedChangePaths?.length ?? 0)) errors.push(`${slice.id} has duplicate allowedChangePaths.`);
  for (const path of slice.allowedChangePaths ?? []) {
    if (!path || path.startsWith("/") || path.split("/").includes("..")) errors.push(`${slice.id} has unsafe allowed change path ${path}.`);
  }
  if (!Array.isArray(slice.requiredGates) || slice.requiredGates.length === 0) errors.push(`${slice.id} has no focused required gates.`);
  for (const gate of slice.requiredGates ?? []) {
    if (!packageJson.scripts?.[gate]) errors.push(`${slice.id} references missing package script ${gate}.`);
  }
  if (!slice.owner || slice.owner === "unassigned") {
    if (slice.status === "not_started") warnings.push(`${slice.id} still needs a human owner before work starts.`);
    else errors.push(`${slice.id} cannot move beyond not_started without a human owner.`);
  }
  if (slice.status !== "not_started") {
    if (!slice.architectureNarrative || !existsSync(slice.architectureNarrative)) {
      errors.push(`${slice.id} requires an existing architectureNarrative before work starts.`);
    }
    if (!slice.approvedBy || !slice.approvedAt) errors.push(`${slice.id} requires explicit human approval metadata.`);
    if (slice.allowedChangePaths.length === 0) errors.push(`${slice.id} requires an explicit allowedChangePaths list before work starts.`);
    if (!slice.fileAuditDisposition || !existsSync(slice.fileAuditDisposition)) {
      errors.push(`${slice.id} requires an existing fileAuditDisposition before work starts.`);
    }
  }
}

const activeSlices = registry.slices?.filter((slice) => slice.status === "in_progress") ?? [];
if (activeSlices.length > 1) errors.push("Only one bounded refactor slice may be in_progress at a time.");
if (registry.mode === "active" && activeSlices.length === 0) warnings.push("Registry is active but no slice is currently in_progress.");

const baseline = JSON.parse(readFileSync("docs/reliability/refactor-baseline-2026-08-27-setup.json", "utf8"));
if (baseline.schemaVersion !== 1) errors.push("Committed refactor baseline must use schemaVersion 1.");
if ((baseline.totals?.files ?? 0) === 0) errors.push("Committed refactor baseline is empty.");

const result = {
  ok: errors.length === 0,
  mode: registry.mode,
  plannedSlices: registry.slices?.length ?? 0,
  startedSlices: registry.slices?.filter((slice) => slice.status !== "not_started").length ?? 0,
  activeSlice: activeSlices[0]?.id ?? null,
  errors,
  warnings,
  nextHumanAction: "Choose one slice, assign its human owner, complete its architecture narrative, and resolve its before_start evidence before changing implementation code.",
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

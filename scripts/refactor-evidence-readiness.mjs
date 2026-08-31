#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const registry = JSON.parse(readFileSync("docs/refactoring/refactor-slices.json", "utf8"));
const matrix = JSON.parse(readFileSync("docs/refactoring/evidence-matrix.json", "utf8"));
const budgets = JSON.parse(readFileSync("docs/refactoring/performance-budgets.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const errors = [];
const warnings = [];
const allowedStatuses = new Set(["satisfied", "partial", "missing", "blocked", "conditional", "not_applicable"]);
const allowedPhases = new Set(["before_start", "before_complete", "before_cutover"]);
const readyStatuses = new Set(["satisfied", "not_applicable"]);

if (matrix.schemaVersion !== 1) errors.push("Refactor evidence matrix must use schemaVersion 1.");
if (budgets.schemaVersion !== 1) errors.push("Refactor performance budgets must use schemaVersion 1.");

const registryById = new Map(registry.slices.map((slice) => [slice.id, slice]));
const evidenceById = new Map(matrix.slices.map((slice) => [slice.id, slice]));
for (const id of registryById.keys()) {
  if (!evidenceById.has(id)) errors.push(`Missing evidence matrix entry for ${id}.`);
}
for (const id of evidenceById.keys()) {
  if (!registryById.has(id)) errors.push(`Evidence matrix references unknown slice ${id}.`);
}

const profileIds = new Set(Object.keys(budgets.profiles ?? {}));
for (const [profileId, profile] of Object.entries(budgets.profiles ?? {})) {
  if (!Array.isArray(profile.requiredCommands) || profile.requiredCommands.length === 0) {
    errors.push(`Performance profile ${profileId} must define requiredCommands.`);
  }
  for (const command of profile.requiredCommands ?? []) {
    if (!packageJson.scripts?.[command]) errors.push(`Performance profile ${profileId} references missing package script ${command}.`);
  }
}

const globalItems = matrix.globalItems ?? [];
const globalIds = new Set();
for (const item of globalItems) {
  if (globalIds.has(item.id)) errors.push(`Duplicate global evidence id ${item.id}.`);
  globalIds.add(item.id);
  if (!allowedStatuses.has(item.status)) errors.push(`Global evidence ${item.id} has invalid status ${item.status}.`);
  if (!allowedPhases.has(item.phase)) errors.push(`Global evidence ${item.id} has invalid phase ${item.phase}.`);
  if (!item.note && item.status !== "satisfied") errors.push(`Global evidence ${item.id} must explain its ${item.status} status.`);
  if (item.status === "not_applicable" && (!item.approvedBy || !item.approvedAt)) errors.push(`Global evidence ${item.id} requires approval metadata before it can be not_applicable.`);
  for (const file of item.files ?? []) if (!existsSync(file)) errors.push(`Global evidence ${item.id} references missing file ${file}.`);
  for (const gate of item.gates ?? []) if (!packageJson.scripts?.[gate]) errors.push(`Global evidence ${item.id} references missing package script ${gate}.`);
  if (item.status === "satisfied" && (item.files?.length ?? 0) + (item.gates?.length ?? 0) === 0) errors.push(`Global evidence ${item.id} claims satisfied without executable or file evidence.`);
}
const unresolvedGlobal = globalItems.filter((item) => !readyStatuses.has(item.status));

const sliceResults = [];
for (const slice of registry.slices) {
  const evidence = evidenceById.get(slice.id);
  if (!evidence) continue;
  if (!profileIds.has(evidence.budgetProfile)) errors.push(`${slice.id} references unknown budget profile ${evidence.budgetProfile}.`);
  const budgetProfile = budgets.profiles?.[evidence.budgetProfile];
  for (const command of budgetProfile?.requiredCommands ?? []) {
    if (!slice.requiredGates?.includes(command)) {
      errors.push(`${slice.id} requiredGates must include performance-profile command ${command}.`);
    }
  }
  const itemIds = new Set();
  for (const item of evidence.items ?? []) {
    if (itemIds.has(item.id)) errors.push(`${slice.id} has duplicate evidence id ${item.id}.`);
    itemIds.add(item.id);
    if (!allowedStatuses.has(item.status)) errors.push(`${slice.id}/${item.id} has invalid status ${item.status}.`);
    if (!allowedPhases.has(item.phase)) errors.push(`${slice.id}/${item.id} has invalid phase ${item.phase}.`);
    if (!item.note && !["satisfied"].includes(item.status)) {
      errors.push(`${slice.id}/${item.id} must explain its ${item.status} status.`);
    }
    if (item.status === "not_applicable" && (!item.approvedBy || !item.approvedAt)) {
      errors.push(`${slice.id}/${item.id} requires approval metadata before it can be not_applicable.`);
    }
    for (const file of item.files ?? []) {
      if (!existsSync(file)) errors.push(`${slice.id}/${item.id} references missing evidence file ${file}.`);
    }
    for (const gate of item.gates ?? []) {
      if (!packageJson.scripts?.[gate]) errors.push(`${slice.id}/${item.id} references missing package script ${gate}.`);
    }
    if (item.status === "satisfied" && (item.files?.length ?? 0) + (item.gates?.length ?? 0) === 0) {
      errors.push(`${slice.id}/${item.id} claims satisfied without executable or file evidence.`);
    }
  }

  const beforeStart = [
    ...globalItems.filter((item) => item.phase === "before_start" && !readyStatuses.has(item.status)).map((item) => ({ ...item, id: `global:${item.id}` })),
    ...evidence.items.filter((item) => item.phase === "before_start" && !readyStatuses.has(item.status)),
  ];
  const beforeComplete = [
    ...globalItems.filter((item) => ["before_start", "before_complete"].includes(item.phase) && !readyStatuses.has(item.status)).map((item) => ({ ...item, id: `global:${item.id}` })),
    ...evidence.items.filter((item) => ["before_start", "before_complete"].includes(item.phase) && !readyStatuses.has(item.status)),
  ];
  const beforeCutover = [
    ...globalItems.filter((item) => !readyStatuses.has(item.status)).map((item) => ({ ...item, id: `global:${item.id}` })),
    ...evidence.items.filter((item) => !readyStatuses.has(item.status)),
  ];
  const started = slice.status !== "not_started";
  const governanceGaps = [];
  if (!slice.owner || slice.owner === "unassigned") governanceGaps.push("human_owner");
  if (!slice.architectureNarrative || !existsSync(slice.architectureNarrative)) governanceGaps.push("architecture_narrative");
  if (!slice.approvedBy || !slice.approvedAt) governanceGaps.push("start_approval");
  if (!slice.fileAuditDisposition || !existsSync(slice.fileAuditDisposition)) governanceGaps.push("file_audit_disposition");
  if (!slice.assuranceRecord || !existsSync(slice.assuranceRecord)) governanceGaps.push("assurance_record");
  if (started && beforeStart.length > 0) {
    errors.push(`${slice.id} started with unresolved before-start evidence: ${beforeStart.map((item) => item.id).join(", ")}.`);
  }
  if (started && governanceGaps.length > 0) {
    errors.push(`${slice.id} started with unresolved governance: ${governanceGaps.join(", ")}.`);
  }
  if (["soaking", "complete"].includes(slice.status) && beforeComplete.length > 0) {
    errors.push(`${slice.id} cannot ${slice.status === "complete" ? "complete" : "soak"} with unresolved evidence: ${beforeComplete.map((item) => item.id).join(", ")}.`);
  }
  if (slice.status === "complete" && beforeCutover.length > 0) {
    errors.push(`${slice.id} cannot complete before cutover evidence is resolved: ${beforeCutover.map((item) => item.id).join(", ")}.`);
  }
  if (!started && (governanceGaps.length > 0 || beforeStart.length > 0)) {
    warnings.push(
      `${slice.id} is not start-ready: ${[...governanceGaps, ...beforeStart.map((item) => item.id)].join(", ")}.`,
    );
  }

  sliceResults.push({
    id: slice.id,
    status: slice.status,
    budgetProfile: evidence.budgetProfile,
    governanceReady: governanceGaps.length === 0,
    evidenceStartReady: beforeStart.length === 0,
    startReady: governanceGaps.length === 0 && beforeStart.length === 0,
    beforeCompleteReady: beforeComplete.length === 0,
    cutoverReady: beforeCutover.length === 0,
    governanceGaps,
    unresolved: evidence.items
      .filter((item) => !readyStatuses.has(item.status))
      .map((item) => ({ id: item.id, phase: item.phase, status: item.status })),
  });
}

const result = {
  ok: errors.length === 0,
  mode: registry.mode,
  summary: {
    slices: sliceResults.length,
    unresolvedGlobal: unresolvedGlobal.length,
    governanceReady: sliceResults.filter((slice) => slice.governanceReady).length,
    evidenceStartReady: sliceResults.filter((slice) => slice.evidenceStartReady).length,
    startReady: sliceResults.filter((slice) => slice.startReady).length,
    completeReady: sliceResults.filter((slice) => slice.beforeCompleteReady).length,
    cutoverReady: sliceResults.filter((slice) => slice.cutoverReady).length,
  },
  global: globalItems.map((item) => ({ id: item.id, phase: item.phase, status: item.status })),
  slices: sliceResults,
  errors,
  warnings,
  interpretation: "Setup gaps are warnings while all slices remain not_started. The same gaps become failures when a slice advances beyond its permitted evidence phase.",
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

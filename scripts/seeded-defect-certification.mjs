#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const minimumKillRate = numericArgument("--minimum-kill-rate", 1);
const sandbox = mkdtempSync(path.join(tmpdir(), "pipeline-mutation-"));
const mutants = [
  mutant("WF-01", "workflow permits New to skip to Assessment", "lib/pipeline/referral-workflow.ts",
    'New: ["Packet Needed", "Declined"],', 'New: ["Packet Needed", "Assessment", "Declined"],'),
  mutant("WF-02", "accepted referral can reopen without admin review", "lib/pipeline/referral-workflow.ts",
    '  "Accepted / Admitted": [],', '  "Accepted / Admitted": ["New"],'),
  mutant("WF-03", "workflow begins without an owner", "lib/pipeline/referral-workflow.ts",
    'if (targetStage === "Packet Needed" && isUnassignedOwner(referral.owner))', 'if (false && targetStage === "Packet Needed" && isUnassignedOwner(referral.owner))'),
  mutant("WF-04", "packet review begins without a packet", "lib/pipeline/referral-workflow.ts",
    'if (targetStage === "Packet Review" && !hasInitialPacket(referral))', 'if (false && targetStage === "Packet Review" && !hasInitialPacket(referral))'),
  mutant("WF-05", "assessment begins before packet review", "lib/pipeline/referral-workflow.ts",
    'if (targetStage === "Assessment" && !isPacketReviewed(referral))', 'if (false && targetStage === "Assessment" && !isPacketReviewed(referral))'),
  mutant("WF-06", "community review begins before assessment completion", "lib/pipeline/referral-workflow.ts",
    'if (targetStage === "Community Review" && !isAssessmentComplete(referral, context))', 'if (false && targetStage === "Community Review" && !isAssessmentComplete(referral, context))'),
  mutant("WF-07", "accepted decision guard is inverted", "lib/pipeline/referral-workflow.ts",
    'getDecisionOutcome(referral, context) !== "accepted"', 'getDecisionOutcome(referral, context) === "accepted"'),
  mutant("WF-08", "move-in blockers are ignored", "lib/pipeline/referral-workflow.ts",
    'requirement.requiredFor === "move_in"', 'requirement.requiredFor === "ignored_gate"'),
  mutant("WF-09", "declined decision guard is inverted", "lib/pipeline/referral-workflow.ts",
    'getDecisionOutcome(referral, context) !== "declined"', 'getDecisionOutcome(referral, context) === "declined"'),
  mutant("WF-10", "decline reason is optional", "lib/pipeline/referral-workflow.ts",
    'if (!hasValue(context.decision?.reasonNote', 'if (false && !hasValue(context.decision?.reasonNote'),
  mutant("EX-01", "last extraction attempt retries forever", "lib/extraction/extraction-state.ts",
    'attempt >= maximum', 'attempt > maximum'),
  mutant("EX-02", "non-retryable extraction is retried", "lib/extraction/extraction-state.ts",
    'const deadLetter = !retryable || attempt >= maximum;', 'const deadLetter = attempt >= maximum;'),
  mutant("EX-03", "future queued jobs can be claimed", "lib/extraction/extraction-state.ts",
    'if (status === "queued") return nextAttemptAt <= now;', 'if (status === "queued") return true;'),
  mutant("EX-04", "unexpired running jobs can be reclaimed", "lib/extraction/extraction-state.ts",
    'leaseExpiresAt !== null && leaseExpiresAt <= now', 'leaseExpiresAt !== null'),
  mutant("EX-05", "successful jobs can silently requeue", "lib/extraction/extraction-state.ts",
    'succeeded: [],', 'succeeded: ["queued"],'),
  mutant("WR-01", "duplicate extracted fields are accepted", "lib/extraction/worker-report-validation.ts",
    'rejectDuplicateValues(input.fields?.map((field) => field.field_key) ?? [], "duplicate_field_key");', 'void input.fields;'),
  mutant("WR-02", "out-of-range confidence is accepted", "lib/extraction/worker-report-validation.ts",
    'value > 1', 'value > 2'),
  mutant("WR-03", "Blob traversal key is accepted", "lib/extraction/worker-report-validation.ts",
    'value.includes("..")', 'false'),
  mutant("ID-01", "name and DOB silently auto-match", "lib/pipeline/master-record-matching.ts",
    'status: "human_review",\n      reason: "source_resident_number_missing"', 'status: "matched",\n      reason: "source_resident_number_missing"'),
  mutant("ID-02", "DOB conflict is treated as a match", "lib/pipeline/master-record-matching.ts",
    'status: "blocked_conflict",\n      reason: "date_of_birth_conflict"', 'status: "matched",\n      reason: "date_of_birth_conflict"'),
];

try {
  cpSync(path.join(root, "lib"), path.join(sandbox, "lib"), { recursive: true });
  cpSync(path.join(root, "scripts"), path.join(sandbox, "scripts"), { recursive: true });
  symlinkSync(path.join(root, "node_modules"), path.join(sandbox, "node_modules"), "dir");

  const baseline = runContracts();
  if (!baseline.valid || !baseline.report.ok || baseline.status !== 0) {
    throw new Error("The critical safety baseline failed; mutation results would not be meaningful.");
  }

  const results = [];
  for (const item of mutants) {
    const file = path.join(sandbox, item.file);
    const original = readFileSync(file, "utf8");
    const occurrences = original.split(item.find).length - 1;
    if (occurrences !== 1) {
      results.push({ id: item.id, description: item.description, result: "invalid", reason: `replacement_occurrences_${occurrences}` });
      continue;
    }
    writeFileSync(file, original.replace(item.find, item.replace), "utf8");
    const execution = runContracts();
    writeFileSync(file, original, "utf8");
    if (!execution.valid) {
      results.push({ id: item.id, description: item.description, result: "invalid", reason: "detector_crashed" });
      continue;
    }
    const killed = execution.status !== 0 && execution.report.ok === false;
    results.push({
      id: item.id,
      description: item.description,
      result: killed ? "killed" : "survived",
      caught_by: killed ? execution.report.checks.filter((check) => !check.ok).map((check) => check.name) : [],
    });
  }

  const killed = results.filter((result) => result.result === "killed").length;
  const survived = results.filter((result) => result.result === "survived").length;
  const invalid = results.filter((result) => result.result === "invalid").length;
  const killRate = mutants.length === 0 ? 0 : killed / mutants.length;
  const ok = invalid === 0 && survived === 0 && killRate >= minimumKillRate;
  console.log(JSON.stringify({
    ok,
    baseline_checks: baseline.report.checks.length,
    mutants: mutants.length,
    killed,
    survived,
    invalid,
    kill_rate: round(killRate),
    minimum_kill_rate: minimumKillRate,
    results,
    note: "Mutations run only in an isolated temporary copy. The working tree is never modified.",
  }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

function runContracts() {
  const execution = spawnSync(process.execPath, ["scripts/critical-safety-contracts.mjs"], {
    cwd: sandbox,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NODE_ENV: "test" },
  });
  try {
    return { status: execution.status, valid: true, report: JSON.parse(execution.stdout.trim()) };
  } catch {
    return { status: execution.status, valid: false, report: null };
  }
}

function mutant(id, description, file, find, replace) {
  return { id, description, file, find, replace };
}

function numericArgument(name, fallback) {
  const argument = process.argv.find((value) => value.startsWith(`${name}=`));
  const value = argument ? Number(argument.slice(name.length + 1)) : fallback;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1.`);
  return value;
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { isAllowedChangePath, isImmutableAgentPath, selectSlice, validateAgentResult } from "./refactor-agent-control.mjs";

const policy = {
  worktrees: { requiredActiveBranchPrefix: "codex/refactor-" },
};
const manifest = {
  scripts: { "check:api": "node scripts/api-behavior-fixtures.mjs" },
};
const approvedSlice = {
  id: "referral-store-boundaries",
  priority: 1,
  status: "in_progress",
  owner: "Owner",
  approvedBy: "Reviewer",
  approvedAt: "2026-08-28T00:00:00Z",
  branch: "codex/refactor-referral-store-boundaries",
  startingCommit: "a".repeat(40),
  worktreePath: "/tmp/pipeline-refactor",
  architectureNarrative: "docs/refactoring/narrative.md",
  fileAuditDisposition: "docs/refactoring/files.json",
  assuranceRecord: "docs/refactoring/assurance.json",
  allowedChangePaths: ["lib/pipeline/referral-store.ts", "tests/referral-store/"],
  invariants: ["Stale writes remain rejected."],
  requiredGates: ["check:api"],
};
const fileExists = () => true;

assert.deepEqual(
  selectSlice({ registry: { mode: "setup_only", slices: [] }, policy, manifest, fileExists }),
  { enabled: false, reason: "The refactor registry remains in setup_only mode." },
);

const selected = selectSlice({ registry: { mode: "active", slices: [approvedSlice] }, policy, manifest, fileExists });
assert.equal(selected.enabled, true);
assert.equal(selected.sliceId, approvedSlice.id);
assert.equal(selected.branch, approvedSlice.branch);

assert.throws(
  () => selectSlice({ registry: { mode: "active", slices: [approvedSlice, { ...approvedSlice, id: "second" }] }, policy, manifest, fileExists }),
  /Only one refactor slice/u,
);

assert.equal(isAllowedChangePath("lib/pipeline/referral-store.ts", approvedSlice.allowedChangePaths), true);
assert.equal(isAllowedChangePath("tests/referral-store/behavior.spec.ts", approvedSlice.allowedChangePaths), true);
assert.equal(isAllowedChangePath("lib/pipeline/other.ts", approvedSlice.allowedChangePaths), false);
assert.equal(isImmutableAgentPath(".github/workflows/deploy-azure.yml"), true);
assert.equal(isAllowedChangePath("package.json", ["package.json"]), false);

const validResult = {
  status: "ready_for_review",
  summary: "Completed the bounded structural split.",
  changes: ["Split persistence adapter."],
  tests: ["npm run check:api"],
  blockers: [],
  nextSteps: ["Human review."],
};
assert.equal(validateAgentResult(validResult), validResult);
assert.throws(() => validateAgentResult({ ...validResult, status: "complete" }), /status is invalid/u);

console.log(JSON.stringify({ ok: true, fixtures: 11 }, null, 2));

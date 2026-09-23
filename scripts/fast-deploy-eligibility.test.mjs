import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { changedFiles, classifyFastDeployFiles } from "./fast-deploy-eligibility.mjs";

test("a UI edit and its tests may use the code-only lane", () => {
  const result = classifyFastDeployFiles([
    "components/pipeline/ClientFolder.module.css",
    "components/pipeline/ClientProfileView.tsx",
    "tests/e2e/pipeline-smoke.spec.ts",
  ]);
  assert.equal(result.eligible, true);
  assert.equal(result.runtime.length, 2);
});

test("a documentation-only change is not a deployable image", () => {
  assert.equal(classifyFastDeployFiles(["docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md"]).eligible, false);
});

test("database, API, worker, auth, dependency and deployment edits require the full lane", () => {
  for (const file of [
    "database/migrations/999_add_column.sql",
    "app/api/referrals/route.ts",
    "lib/pipeline/referral-store.ts",
    "public/sw.js",
    "scripts/worker.mjs",
    "package-lock.json",
    "AGENTS.md",
    ".github/workflows/deploy-azure.yml",
    "infra/azure/runtime.bicep",
  ]) {
    assert.equal(classifyFastDeployFiles(["components/pipeline/ClientFolder.module.css", file]).eligible, false, file);
  }
});

test("the Git range includes deletions, not an empty no-impact result", () => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-fast-deploy-"));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.email", "ci@pipeline.local");
    git("config", "user.name", "CI");
    writeFileSync(join(directory, "old.css"), "body {}\n");
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    unlinkSync(join(directory, "old.css"));
    git("add", "-u");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "delete");
    const head = git("rev-parse", "HEAD");
    assert.deepEqual(changedFiles(base, head, directory), ["old.css"]);
    assert.equal(classifyFastDeployFiles(changedFiles(base, head, directory)).eligible, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

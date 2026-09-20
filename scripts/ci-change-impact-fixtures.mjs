#!/usr/bin/env node

import { classifyChangeImpact } from "./ci-change-impact.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cases = [
  {
    name: "unknown change set runs both integration surfaces",
    files: null,
    expected: { browser: true, postgres: true },
  },
  {
    name: "empty change set is not classified as documentation-only",
    files: [],
    expected: { browser: true, postgres: true },
  },
  {
    name: "blank explicit paths run both integration surfaces",
    files: ["", "  "],
    expected: { browser: true, postgres: true },
  },
  {
    name: "documentation does not trigger expensive jobs",
    files: ["docs/PRODUCTION_READINESS.md"],
    expected: { browser: false, postgres: false },
  },
  {
    name: "component changes run browser coverage without a database drill",
    files: ["components/pipeline/ReferralPacketCanvas.tsx"],
    expected: { browser: true, postgres: false },
  },
  {
    name: "database migrations run PostgreSQL coverage",
    files: ["database/migrations/0014_example.sql"],
    expected: { browser: false, postgres: true },
  },
  {
    name: "API and store changes run both integration surfaces",
    files: ["app/api/referrals/route.ts", "lib/pipeline/referral-store.ts"],
    expected: { browser: true, postgres: true },
  },
  {
    name: "dependency changes run both integration surfaces",
    files: ["package-lock.json"],
    expected: { browser: true, postgres: true },
  },
  {
    name: "CI gate changes validate both integration lanes",
    files: [".github/workflows/ci.yml", "scripts/ci-change-impact.mjs"],
    expected: { browser: true, postgres: true },
  },
  {
    name: "proxy changes run browser security journeys",
    files: ["proxy.ts"],
    expected: { browser: true, postgres: false },
  },
  {
    name: "operational Playwright configuration runs browser assurance",
    files: ["playwright.operational.config.ts"],
    expected: { browser: true, postgres: false },
  },
  {
    name: "assurance registry changes run browser assurance",
    files: ["scripts/platform-assurance-registry.mjs"],
    expected: { browser: true, postgres: false },
  },
];

const checks = cases.map((fixture) => {
  const actual = classifyChangeImpact(fixture.files);
  return {
    name: fixture.name,
    ok: actual.browser === fixture.expected.browser && actual.postgres === fixture.expected.postgres,
  };
});

// Exercise real Git diffs: path-only fixtures cannot catch a missing D filter.
const root = mkdtempSync(path.join(tmpdir(), "pipeline-ci-impact-"));
const classifier = fileURLToPath(new URL("./ci-change-impact.mjs", import.meta.url));
const git = (...args) => execFileSync("git", [
  "-c", "user.name=Pipeline fixture", "-c", "user.email=fixture@pipeline.local",
  "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args,
], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const classify = (base, head, args = []) => JSON.parse(execFileSync(process.execPath, [classifier, ...args], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, CI_BASE_SHA: base, CI_HEAD_SHA: head, GITHUB_OUTPUT: path.join(root, "ci-output") },
}));
const check = (name, actual, browser, postgres, requiredPaths = []) => checks.push({
  name,
  ok: actual.browser === browser && actual.postgres === postgres
    && requiredPaths.every((file) => actual.files.includes(file)),
});

try {
  git("init", "--quiet");
  mkdirSync(path.join(root, "app/api/example"), { recursive: true });
  mkdirSync(path.join(root, "docs"));
  const route = "app/api/example/route.ts";
  writeFileSync(path.join(root, route), "export const example = true;\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture base");
  const base = git("rev-parse", "HEAD");

  rmSync(path.join(root, route));
  git("add", "-u");
  git("commit", "--quiet", "-m", "delete route");
  const deleted = git("rev-parse", "HEAD");
  check("deletion-only Git diff retains the deleted route", classify(base, deleted), true, true, [route]);
  check("explicit deleted path still selects its integration surfaces", classify(base, deleted, [`--files=${route}`]), true, true, [route]);

  writeFileSync(path.join(root, "docs/example.ts"), "export const example = true;\n");
  git("add", "docs/example.ts");
  git("commit", "--quiet", "-m", "add document");
  const documented = git("rev-parse", "HEAD");
  check("nonempty documentation-only Git diff skips integration surfaces", classify(deleted, documented), false, false);
  check("rename out of an API retains both paths", classify(base, documented), true, true, [route, "docs/example.ts"]);

  renameSync(path.join(root, "docs/example.ts"), path.join(root, route));
  git("add", "-A", "app", "docs");
  git("commit", "--quiet", "-m", "rename into API");
  const renamed = git("rev-parse", "HEAD");
  check("rename into an API retains both paths", classify(documented, renamed), true, true, [route, "docs/example.ts"]);

  git("commit", "--quiet", "--allow-empty", "-m", "empty change");
  check("different commits with an empty diff run both surfaces", classify(renamed, git("rev-parse", "HEAD")), true, true);
  check("identical commits run both surfaces", classify(base, base), true, true);
  check("missing base SHA runs both surfaces", classify("", renamed), true, true);
  check("empty explicit file list runs both surfaces", classify(base, renamed, ["--files="]), true, true);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: checks.every((check) => check.ok), checks }, null, 2));
if (checks.some((check) => !check.ok)) process.exit(1);

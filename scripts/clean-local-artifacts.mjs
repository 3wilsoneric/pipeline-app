#!/usr/bin/env node

import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const fixedArtifacts = new Set([
  ".next",
  "build",
  "coverage",
  "out",
  "playwright-report",
  "test-results",
  "tmp",
  "tsconfig.tsbuildinfo",
]);
const entries = await readdir(root, { withFileTypes: true });
const artifacts = entries
  .map((entry) => entry.name)
  .filter((name) => fixedArtifacts.has(name) || name.startsWith(".next-"))
  .sort();

for (const artifact of artifacts) {
  const target = path.resolve(root, artifact);
  if (path.dirname(target) !== root) throw new Error(`Refusing to remove path outside repository root: ${target}`);
  if (!dryRun) await rm(target, { force: true, recursive: true });
}

console.log(JSON.stringify({ ok: true, dry_run: dryRun, artifacts }, null, 2));

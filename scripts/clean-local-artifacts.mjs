#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const disposableNames = new Set(["coverage", "playwright-report", "test-results", "tsconfig.tsbuildinfo"]);
const minimumAgeMs = 7 * 24 * 60 * 60 * 1000;

// Only known generated output is eligible. Never include .data, tmp, research,
// tools, environment files, dependencies, or the default development build.
export async function planArtifactCleanup(root, { now = Date.now(), active = false } = {}) {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];
  const skipped = [];
  for (const entry of entries) {
    if (!disposableNames.has(entry.name) && !entry.name.startsWith(".next-")) continue;
    const target = path.join(root, entry.name);
    const stats = await lstat(target);
    let reason = entry.isSymbolicLink() ? "symbolic link" : active ? "active or unverified runtime" : "";
    if (!reason && now - stats.mtimeMs < minimumAgeMs) reason = "less than seven days old";
    if (await artifactHasBuildLock(target, stats)) reason = "build lock present";
    if (reason) skipped.push({ artifact: entry.name, reason });
    else candidates.push(entry.name);
  }
  return { candidates: candidates.sort(), skipped };
}

async function artifactHasBuildLock(target, stats) {
  if (!stats.isDirectory()) return false;
  let locked = false;
  for (const lock of ["lock", "dev/lock"]) {
    try { await lstat(path.join(target, lock)); locked = true; } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
  }
  return locked;
}

function runtimeMayBeActive(root) {
  try {
    const parents = new Map(execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" })
      .trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number)));
    const ancestors = new Set();
    for (let pid = process.pid; pid && !ancestors.has(pid); pid = parents.get(pid)) ancestors.add(pid);
    const open = execFileSync("lsof", ["-a", "-d", "cwd", "-c", "node", "-c", "next", "-c", "bun", "-c", "deno", "-F", "pn"], {
      encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"],
    });
    let pid = 0;
    for (const line of open.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      if (line.startsWith("n") && !ancestors.has(pid)) {
        const cwd = line.slice(1);
        if (cwd === root || cwd.startsWith(root + path.sep)) return true;
      }
    }
    return false;
  } catch {
    // Missing tools, permissions, or a timeout cannot prove an artifact is idle.
    return true;
  }
}

async function main() {
  const root = process.cwd();
  const args = process.argv.slice(2);
  const apply = args.includes("--apply") && !args.includes("--dry-run");
  const requested = args.filter((arg) => arg.startsWith("--artifact=")).map((arg) => arg.slice(11));
  if (args.some((arg) => !["--apply", "--dry-run"].includes(arg) && !arg.startsWith("--artifact="))) throw new Error("Use --dry-run, or --apply with explicit --artifact=NAME selections.");
  if (apply && requested.length === 0) throw new Error("Select each artifact explicitly with --artifact=NAME. No blanket deletion.");
  const plan = await planArtifactCleanup(root, { active: runtimeMayBeActive(root) });
  if (apply && requested.some((name) => !plan.candidates.includes(name))) throw new Error("A selected artifact is protected, recent, active, or outside this checkout. Nothing removed.");
  const removed = [];
  for (const artifact of apply ? [...new Set(requested)] : []) {
    const refreshed = await planArtifactCleanup(root, { active: runtimeMayBeActive(root) });
    if (!refreshed.candidates.includes(artifact)) throw new Error("Artifact state changed; cleanup stopped.");
    await rm(path.join(root, artifact), { recursive: true, force: false });
    removed.push(artifact);
  }
  console.log(JSON.stringify({ ok: true, dry_run: !apply, ...plan, removed }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

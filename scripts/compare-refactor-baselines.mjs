#!/usr/bin/env node

import { readFileSync } from "node:fs";

function argument(name) {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  return value?.slice(name.length + 3);
}

function readBaseline(path, label) {
  if (!path) throw new Error(`Missing --${label}=<baseline.json>.`);
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.schemaVersion !== 1 || !value.totals || !Array.isArray(value.files)) {
    throw new Error(`${path} is not a Pipeline refactor baseline schema v1 report.`);
  }
  return value;
}

function mapFiles(report) {
  return new Map(report.files.map((file) => [file.path, file]));
}

function delta(before, after) {
  return after - before;
}

function main() {
  const beforePath = argument("before");
  const afterPath = argument("after");
  const before = readBaseline(beforePath, "before");
  const after = readBaseline(afterPath, "after");
  const beforeFiles = mapFiles(before);
  const afterFiles = mapFiles(after);
  const totalKeys = [
    "files", "lines", "cycles", "duplicateGroups", "controlPlaneDuplicateGroups",
    "deadExportCandidates", "staticSourceContracts", "controlPlaneFiles",
  ];
  const totals = Object.fromEntries(totalKeys.map((key) => [key, {
    before: before.totals[key] ?? 0,
    after: after.totals[key] ?? 0,
    delta: delta(before.totals[key] ?? 0, after.totals[key] ?? 0),
  }]));

  const allPaths = new Set([...beforeFiles.keys(), ...afterFiles.keys()]);
  const fileChanges = [];
  for (const path of allPaths) {
    const left = beforeFiles.get(path);
    const right = afterFiles.get(path);
    fileChanges.push({
      path,
      status: !left ? "added" : !right ? "removed" : "retained",
      lines: delta(left?.lines ?? 0, right?.lines ?? 0),
      complexity: delta(left?.complexity ?? 0, right?.complexity ?? 0),
      duplicateBlocks: delta(left?.duplicateBlocks ?? 0, right?.duplicateBlocks ?? 0),
      staticSourceContracts: delta(left?.staticSourceContracts ?? 0, right?.staticSourceContracts ?? 0),
    });
  }

  const beforeHotspots = new Set(before.overlappingHotspots.map((item) => item.path));
  const afterHotspots = new Set(after.overlappingHotspots.map((item) => item.path));
  const regressions = [];
  if (totals.cycles.delta > 0) regressions.push(`Local dependency cycles increased by ${totals.cycles.delta}.`);
  if (totals.controlPlaneDuplicateGroups.delta > 0) {
    regressions.push(`Duplicate groups touching control-plane code increased by ${totals.controlPlaneDuplicateGroups.delta}.`);
  }
  if (totals.staticSourceContracts.delta > 0) {
    regressions.push(`Static source-string contracts increased by ${totals.staticSourceContracts.delta}.`);
  }

  const result = {
    ok: regressions.length === 0,
    before: { path: beforePath, generatedAt: before.generatedAt },
    after: { path: afterPath, generatedAt: after.generatedAt },
    totals,
    hotspotChanges: {
      entered: [...afterHotspots].filter((path) => !beforeHotspots.has(path)).sort(),
      exited: [...beforeHotspots].filter((path) => !afterHotspots.has(path)).sort(),
      retained: [...afterHotspots].filter((path) => beforeHotspots.has(path)).sort(),
    },
    largestComplexityIncreases: fileChanges
      .filter((item) => item.complexity > 0)
      .sort((left, right) => right.complexity - left.complexity || left.path.localeCompare(right.path))
      .slice(0, 10),
    largestComplexityReductions: fileChanges
      .filter((item) => item.complexity < 0)
      .sort((left, right) => left.complexity - right.complexity || left.path.localeCompare(right.path))
      .slice(0, 10),
    regressions,
    interpretation: "A structural metric regression requires review, not automatic rejection. Behavioral, database, performance, and visual evidence remain authoritative.",
  };

  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--fail-on-regression") && !result.ok) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to compare refactor baselines.");
  process.exit(1);
}

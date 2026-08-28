#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const registryPath = "docs/academy/academy-registry.json";
const refresh = process.argv.includes("--refresh");
const curriculum = loadTypeScriptModule(root, "lib/academy/academy-curriculum.ts");
const journeys = loadTypeScriptModule(root, "lib/academy/academy-journeys.ts");
const atlas = readJson("lib/academy/academy-atlas.generated.json");
let registry = readJson(registryPath);
const errors = [];
const warnings = [];
const sourcePaths = [...new Set(curriculum.academyModules.flatMap((module) => (
  module.sources.map((source) => source.path)
)))].sort();
const academyArtifactPaths = atlas.entries
  .map((entry) => entry.path)
  .filter((entryPath) => (
    entryPath.includes("academy")
    || entryPath === "components/pipeline/PipelineDeveloperAcademy.tsx"
  ))
  .filter((entryPath) => !entryPath.endsWith("academy-atlas.generated.json"));
const sourceFingerprint = fingerprintSources(sourcePaths);

if (refresh) {
  registry = {
    ...registry,
    schemaVersion: 2,
    curriculumVersion: curriculum.ACADEMY_CURRICULUM_VERSION,
    reviewedAt: new Date().toISOString().slice(0, 10),
    reviewedCommit: currentCommit(),
    sourceFingerprint,
    atlasFingerprint: atlas.fingerprint,
  };
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

check("registry schema is current", registry.schemaVersion === 2);
check("registry curriculum version matches source", registry.curriculumVersion === curriculum.ACADEMY_CURRICULUM_VERSION);
check("curriculum has ten distinct tracks", curriculum.academyTracks.length === 10 && unique(curriculum.academyTracks.map((track) => track.id)));
check("curriculum has at least thirty-six distinct modules", curriculum.academyModules.length >= 36 && unique(curriculum.academyModuleIds));
check("curriculum contains at least 100 guided hours", curriculum.academyTotalMinutes() >= 6_000);
check("curriculum has at least 144 distinct activities", curriculum.academyActivityIds.length >= 144 && unique(curriculum.academyActivityIds));
check("every track owns at least one module", curriculum.academyTracks.every((track) => curriculum.academyModules.some((module) => module.trackId === track.id)));
check("every prerequisite exists and precedes its dependent", prerequisitesAreOrdered());
check("the prerequisite graph is acyclic", findCycles().length === 0);
check("every module has complete teaching and mastery material", curriculum.academyModules.every((module) => (
  module.objectives.length >= 3
  && module.concepts.length >= 3
  && module.trace.length >= 3
  && module.lab.instructions.length >= 3
  && module.lab.acceptanceCriteria.length >= 3
  && module.check.options.length === 3
)));
check("every module minute budget equals its activity budget", curriculum.academyModules.every((module) => (
  module.minutes === module.activities.reduce((total, activity) => total + activity.minutes, 0)
)));
check("all source anchors exist and stay inside the repository", sourcePaths.every(validRepositoryFile));
check("reviewed source fingerprint is current", registry.sourceFingerprint === sourceFingerprint);
check("generated atlas fingerprint is reviewed", registry.atlasFingerprint === atlas.fingerprint);
check("generated atlas is complete", atlas.totals.files === atlas.entries.length && atlas.totals.coveredFiles === atlas.totals.files);
check("critical and high-risk files have a curriculum owner", atlas.entries.filter((entry) => entry.risk !== "standard").every(validAtlasEntry));
check("all atlas module owners are current", atlas.entries.every(validAtlasEntry));
check("golden journeys cover at least ten operator and engineering paths", journeys.academyJourneys.length >= 10);
check("all journey implementations and module links exist", journeys.academyJourneys.every((journey) => (
  journey.steps.every((step) => validRepositoryFile(step.source))
  && journey.moduleIds.every((moduleId) => curriculum.academyModuleIds.includes(moduleId))
)));
check("all required Academy documents exist", (registry.requiredDocuments ?? []).every(validRepositoryFile));
check("all required commands remain declared", requiredCommandsExist());
check("Academy-authored files contain no obvious credentials", academyArtifactPaths.every((artifactPath) => !containsSecretLikeMaterial(readFileSync(artifactPath, "utf8"))));

if (registry.reviewedCommit && registry.reviewedCommit !== currentCommit()) {
  warnings.push("The reviewed commit differs from HEAD. This is acceptable during active work only when fingerprints still match.");
}

const result = {
  ok: errors.length === 0,
  refreshed: refresh,
  reviewedAt: registry.reviewedAt,
  reviewedCommit: registry.reviewedCommit,
  curriculumVersion: curriculum.ACADEMY_CURRICULUM_VERSION,
  tracks: curriculum.academyTracks.length,
  modules: curriculum.academyModules.length,
  activities: curriculum.academyActivityIds.length,
  guidedHours: Math.round(curriculum.academyTotalMinutes() / 6) / 10,
  sourceFiles: sourcePaths.length,
  atlasFiles: atlas.totals.files,
  atlasLines: atlas.totals.lines,
  journeys: journeys.academyJourneys.length,
  sourceFingerprint,
  atlasFingerprint: atlas.fingerprint,
  errors,
  warnings,
  interpretation: errors.length === 0
    ? "The Academy is current, source-grounded, fully mapped, and structurally ready for use. Human review and teach-back still determine mastery."
    : "The Academy has drifted and must not be presented as current until every error is resolved.",
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;

function check(label, condition) {
  if (!condition) errors.push(label);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function validRepositoryFile(relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) return false;
  const resolved = path.resolve(root, relativePath);
  return resolved.startsWith(`${root}${path.sep}`) && existsSync(resolved);
}

function unique(values) {
  return values.length === new Set(values).size;
}

function prerequisitesAreOrdered() {
  const positions = new Map(curriculum.academyModules.map((module, index) => [module.id, index]));
  return curriculum.academyModules.every((module, index) => (
    module.prerequisites.every((prerequisite) => positions.has(prerequisite) && positions.get(prerequisite) < index)
  ));
}

function findCycles() {
  const graph = new Map(curriculum.academyModules.map((module) => [module.id, module.prerequisites]));
  const visited = new Set();
  const active = new Set();
  const cycles = [];
  function visit(id, stack = []) {
    if (active.has(id)) {
      cycles.push([...stack, id]);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const prerequisite of graph.get(id) ?? []) visit(prerequisite, [...stack, id]);
    active.delete(id);
  }
  for (const id of graph.keys()) visit(id);
  return cycles;
}

function fingerprintSources(paths) {
  const records = paths.map((relativePath) => {
    if (!validRepositoryFile(relativePath)) return `${relativePath}:missing`;
    const hash = createHash("sha256").update(readFileSync(relativePath)).digest("hex");
    return `${relativePath}:${hash}`;
  });
  return createHash("sha256").update(records.join("\n")).digest("hex");
}

function validAtlasEntry(entry) {
  return entry.moduleIds.length > 0
    && entry.moduleIds.every((moduleId) => curriculum.academyModuleIds.includes(moduleId));
}

function requiredCommandsExist() {
  const scripts = readJson("package.json").scripts ?? {};
  return (registry.requiredCommands ?? []).every((command) => typeof scripts[command] === "string");
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function containsSecretLikeMaterial(content) {
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/,
    /\bpostgres(?:ql)?:\/\/[^\s]+:[^\s]+@/i,
    /\bAccountKey=[A-Za-z0-9+/=]{20,}/,
  ].some((pattern) => pattern.test(content));
}

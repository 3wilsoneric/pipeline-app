#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const registryPath = "docs/training/training-registry.json";
const refresh = process.argv.includes("--refresh");
const curriculum = loadTypeScriptModule(root, "lib/training/operator-training-curriculum.ts");
const resources = loadTypeScriptModule(root, "lib/training/operator-training-resources.ts");
const tutorials = loadTypeScriptModule(root, "lib/training/operator-guided-tutorials.ts");
const videos = loadTypeScriptModule(root, "lib/training/operator-training-video-catalog.ts");
let registry = readJson(registryPath);
const errors = [];
const warnings = [];
const sourcePaths = [...new Set([
  ...curriculum.operatorModules.flatMap((module) => module.locations.map((location) => location.source)),
  ...resources.operatorJobAids.map((aid) => aid.location.source),
  ...resources.operatorCapabilities.map((capability) => capability.location.source),
  ...Object.values(tutorials.operatorGuideTargetSources),
])].sort();
const sourceFingerprint = fingerprintSources(sourcePaths);
const trainingArtifactPaths = [
  "app/(pipeline)/training/page.tsx",
  "app/api/training/progress/route.ts",
  "components/pipeline/PipelineOperatorAcademy.tsx",
  ...readdirSync("components/pipeline/training").map((name) => `components/pipeline/training/${name}`),
  ...readdirSync("lib/training").map((name) => `lib/training/${name}`),
  ...registry.requiredDocuments,
].sort();
const curriculumFingerprint = fingerprintSources(trainingArtifactPaths);

if (refresh) {
  registry = { ...registry, curriculumVersion: curriculum.OPERATOR_TRAINING_VERSION, reviewedAt: curriculum.OPERATOR_TRAINING_REVIEWED_AT, reviewedCommit: currentCommit(), sourceFingerprint, curriculumFingerprint };
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

check("registry schema is current", registry.schemaVersion === 1);
check("registry curriculum version matches source", registry.curriculumVersion === curriculum.OPERATOR_TRAINING_VERSION);
check("registry review date matches the deliberate curriculum review date", registry.reviewedAt === curriculum.OPERATOR_TRAINING_REVIEWED_AT);
check("curriculum has ten distinct tracks", curriculum.operatorTrainingTracks.length === 10 && unique(curriculum.operatorTrainingTracks.map((track) => track.id)));
check("curriculum has thirty-six distinct modules", curriculum.operatorModules.length === 36 && unique(curriculum.operatorModuleIds));
check("curriculum has 144 distinct activities", curriculum.operatorActivityIds.length === 144 && unique(curriculum.operatorActivityIds));
check("every track owns at least one module", curriculum.operatorTrainingTracks.every((track) => curriculum.operatorModules.some((module) => module.trackId === track.id)));
check("every module has complete operational teaching material", curriculum.operatorModules.every((module) => module.objectives.length >= 2 && module.criticalActions.length >= 2 && module.neverDo.length >= 2 && module.locations.length >= 1 && module.practice.steps.length >= 3 && module.practice.acceptanceCriteria.length >= 3 && module.check.options.length === 3));
check("every module has the standard four-activity mastery sequence", curriculum.operatorModules.every((module) => JSON.stringify(module.activities.map((activity) => activity.kind)) === JSON.stringify(["briefing", "guided-practice", "scenario", "knowledge-check"])));
check("module and activity minute budgets reconcile", curriculum.operatorModules.every((module) => module.minutes === module.activities.reduce((total, activity) => total + activity.minutes, 0)));
check("prerequisites exist, precede dependents, and remain acyclic", prerequisitesAreOrdered() && findCycles().length === 0);
check("every role has a substantive prerequisite-complete path", ["admin", "assessment_coordinator", "reviewer", "viewer"].every((role) => { const modules = curriculum.operatorModulesForRole(role); const ids = new Set(modules.map((module) => module.id)); return modules.length >= 8 && modules.every((module) => module.prerequisites.every((id) => ids.has(id))); }));
check("all product source anchors exist inside the repository", sourcePaths.every(validRepositoryFile));
check("reviewed product-source fingerprint is current", registry.sourceFingerprint === sourceFingerprint);
check("reviewed curriculum artifact fingerprint is current", registry.curriculumFingerprint === curriculumFingerprint);
check("scenario library covers every role and has one safe answer per case", resources.operatorScenarios.length >= 12 && ["admin", "assessment_coordinator", "reviewer", "viewer"].every((role) => resources.scenariosForRole(role).length >= 2) && resources.operatorScenarios.every((scenario) => scenario.choices.filter((choice) => choice.safe).length === 1 && scenario.moduleIds.every((id) => curriculum.operatorModuleIds.includes(id))));
check("job aids cover every role and have explicit stop conditions", ["admin", "assessment_coordinator", "reviewer", "viewer"].every((role) => resources.jobAidsForRole(role).length >= 1) && resources.operatorJobAids.every((aid) => aid.steps.length >= 5 && aid.stopAndEscalate.length >= 3));
check("product capabilities connect to current modules and files", resources.operatorCapabilities.length >= 10 && resources.operatorCapabilities.every((capability) => validRepositoryFile(capability.location.source) && capability.moduleIds.every((id) => curriculum.operatorModuleIds.includes(id))));
check("guided tutorials are distinct, substantive, and role complete", tutorials.operatorGuidedTutorials.length >= 4 && unique(tutorials.operatorGuidedTutorialIds) && ["admin", "assessment_coordinator", "reviewer", "viewer"].every((role) => tutorials.guidedTutorialsForRole(role).length >= 2) && tutorials.operatorGuidedTutorials.every((tutorial) => tutorial.steps.length >= 4 && unique(tutorial.steps.map((step) => step.id)) && tutorial.moduleIds.every((id) => curriculum.operatorModuleIds.includes(id))));
check("every guided step has a local route, authored rationale, and safety boundary", tutorials.operatorGuidedTutorials.every((tutorial) => tutorial.steps.every((step) => step.route.startsWith("/") && !step.route.startsWith("//") && step.message.length >= 40 && step.instruction.length >= 20 && step.why.length >= 30 && step.safety.length >= 30)));
check("guided target registry exactly covers the authored steps", unique(tutorials.operatorGuideTargetIds) && tutorials.operatorGuideTargetIds.length === Object.keys(tutorials.operatorGuideTargetSources).length && tutorials.operatorGuideTargetIds.every((id) => typeof tutorials.operatorGuideTargetSources[id] === "string"));
check("every guided target remains declared by its source component", tutorials.operatorGuideTargetIds.every((id) => { const source = tutorials.operatorGuideTargetSources[id]; return validRepositoryFile(source) && readFileSync(source, "utf8").includes(`\"${id}\"`); }));
check("guided workflows are action-led", tutorials.operatorGuidedTutorials.every((tutorial) => tutorial.steps.filter((step) => step.advance !== "confirm").length / tutorial.steps.length >= 0.6 && tutorial.steps.every((step) => step.phase.trim() && step.instruction.trim() && step.completion.trim())));
check("Loom video URLs are fail-closed to the reviewed host and route shape", videos.parseLoomVideoUrl("https://www.loom.com/share/1234567890abcdef")?.id === "1234567890abcdef" && videos.parseLoomVideoUrl("https://www.loom.com/embed/1234567890abcdef")?.id === "1234567890abcdef" && videos.parseLoomVideoUrl("https://attacker.example/share/1234567890abcdef") === null && videos.parseLoomVideoUrl("http://www.loom.com/share/1234567890abcdef") === null);
check("configured training videos map uniquely to current activities and valid Loom embeds", unique(videos.operatorTrainingVideoDefinitions.map((video) => `${video.moduleId}:${video.activityId}`)) && videos.operatorTrainingVideoDefinitions.every((video) => curriculum.operatorActivityIds.includes(`${video.moduleId}:${video.activityId}`) && videos.resolveOperatorTrainingVideo(video)?.embedUrl.startsWith("https://www.loom.com/embed/")));
check("verified interactions use an explicitly allowed action target", tutorials.operatorGuidedTutorials.every((tutorial) => tutorial.steps.filter((step) => step.advance !== "confirm").every((step) => tutorials.operatorGuideVerifiedActionTargets[step.advance]?.includes(step.target))));
check("creation, assessment, handoff, and export boundaries remain human checkpoints", tutorials.operatorGuidedTutorials.every((tutorial) => tutorial.steps.filter((step) => ["create-workspace", "assessment-begin-confirm", "assessment-sign", "assessment-schedule-save", "chart-email-handoff", "operations-report-export"].includes(step.target)).every((step) => step.advance === "confirm")));
check("all required training documents exist", registry.requiredDocuments.every(validRepositoryFile));
check("all required commands remain declared", requiredCommandsExist());

if (registry.reviewedCommit !== currentCommit()) warnings.push("The reviewed commit differs from HEAD; fingerprints remain the controlling drift signal during active work.");

const roleSummary = Object.fromEntries(["admin", "assessment_coordinator", "reviewer", "viewer"].map((role) => {
  const modules = curriculum.operatorModulesForRole(role);
  return [role, { modules: modules.length, hours: Math.round(modules.reduce((total, module) => total + module.minutes, 0) / 6) / 10, scenarios: resources.scenariosForRole(role).length }];
}));
const result = { ok: errors.length === 0, refreshed: refresh, curriculumVersion: curriculum.OPERATOR_TRAINING_VERSION, reviewedAt: registry.reviewedAt, tracks: curriculum.operatorTrainingTracks.length, modules: curriculum.operatorModules.length, activities: curriculum.operatorActivityIds.length, scenarios: resources.operatorScenarios.length, guidedTutorials: tutorials.operatorGuidedTutorials.length, guidedSteps: tutorials.operatorGuidedTutorials.reduce((total, tutorial) => total + tutorial.steps.length, 0), jobAids: resources.operatorJobAids.length, capabilities: resources.operatorCapabilities.length, sourceFiles: sourcePaths.length, sourceFingerprint, curriculumFingerprint, roleSummary, errors, warnings, interpretation: errors.length ? "Operator training has drifted and must not be represented as current." : "Operator training is structurally current; operational and clinical owners still approve material guidance." };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;

function check(label, condition) { if (!condition) errors.push(label); }
function readJson(relativePath) { return JSON.parse(readFileSync(path.join(root, relativePath), "utf8")); }
function validRepositoryFile(relativePath) { if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) return false; const resolved = path.resolve(root, relativePath); return resolved.startsWith(`${root}${path.sep}`) && existsSync(resolved); }
function unique(values) { return values.length === new Set(values).size; }
function prerequisitesAreOrdered() { const positions = new Map(curriculum.operatorModules.map((module, index) => [module.id, index])); return curriculum.operatorModules.every((module, index) => module.prerequisites.every((id) => positions.has(id) && positions.get(id) < index)); }
function findCycles() { const graph = new Map(curriculum.operatorModules.map((module) => [module.id, module.prerequisites])); const visited = new Set(); const active = new Set(); const cycles = []; const visit = (id) => { if (active.has(id)) { cycles.push(id); return; } if (visited.has(id)) return; visited.add(id); active.add(id); for (const prerequisite of graph.get(id) ?? []) visit(prerequisite); active.delete(id); }; for (const id of graph.keys()) visit(id); return cycles; }
function fingerprintSources(paths) { const records = paths.map((relativePath) => `${relativePath}:${validRepositoryFile(relativePath) ? createHash("sha256").update(readFileSync(relativePath)).digest("hex") : "missing"}`); return createHash("sha256").update(records.join("\n")).digest("hex"); }
function requiredCommandsExist() { const scripts = readJson("package.json").scripts ?? {}; return registry.requiredCommands.every((command) => typeof scripts[command] === "string"); }
function currentCommit() { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "unknown"; } }

#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const access = loadTypeScriptModule(root, "lib/academy/academy-access-policy.ts");
const curriculum = loadTypeScriptModule(root, "lib/academy/academy-curriculum.ts");
const journeys = loadTypeScriptModule(root, "lib/academy/academy-journeys.ts");
const progress = loadTypeScriptModule(root, "lib/academy/academy-progress-contract.ts");
const atlas = JSON.parse(readFileSync("lib/academy/academy-atlas.generated.json", "utf8"));
const routeSource = readFileSync("app/(pipeline)/academy/page.tsx", "utf8");
const progressRouteSource = readFileSync("app/api/academy/progress/route.ts", "utf8");
const serverAccessSource = readFileSync("lib/academy/academy-access.ts", "utf8");
const componentSource = readFileSync("components/pipeline/PipelineDeveloperAcademy.tsx", "utf8");
const checks = [];

check("production denies the Academy when no owner is configured", () => {
  const policy = access.createAcademyOwnerPolicy({ production: true });
  return !policy.explicitlyConfigured && !access.canAccessDeveloperAcademy(identity("owner@example.com"), policy);
});

check("production grants only an exact configured owner", () => {
  const policy = access.createAcademyOwnerPolicy({ production: true, ownerEmails: " Owner@Example.com " });
  return access.canAccessDeveloperAcademy(identity("owner@example.com"), policy)
    && !access.canAccessDeveloperAcademy(identity("other@example.com"), policy);
});

check("an exact Entra object ID can identify the owner", () => {
  const policy = access.createAcademyOwnerPolicy({ production: true, ownerObjectIds: " ACADEMY-OWNER-ID " });
  return access.canAccessDeveloperAcademy({ id: "academy-owner-id", email: "other@example.com" }, policy)
    && !access.canAccessDeveloperAcademy({ id: "different-id", email: "other@example.com" }, policy);
});

check("local fallback is limited to the configured mock identity", () => {
  const policy = access.createAcademyOwnerPolicy({ production: false, mockUserEmail: "developer@pipeline.local" });
  return access.canAccessDeveloperAcademy(identity("developer@pipeline.local"), policy)
    && !access.canAccessDeveloperAcademy(identity("viewer@pipeline.local"), policy);
});

check("page and progress API both hide the Academy from non-owners", () => (
  routeSource.includes("if (!owner) notFound()")
  && progressRouteSource.includes("if (!owner) return notFoundResponse()")
  && serverAccessSource.includes('import "server-only"')
));

check("mutating progress requires same-origin trust and bounded validation", () => (
  progressRouteSource.includes("requireSameOriginMutation(request)")
  && progressRouteSource.includes("readJsonBody(request, 320_000)")
  && progressRouteSource.includes("validateAcademyProgressUpdate")
));

check("owner configuration remains server-only", () => (
  serverAccessSource.includes("PIPELINE_ACADEMY_OWNER_EMAILS")
  && serverAccessSource.includes("PIPELINE_ACADEMY_OWNER_ENTRA_OBJECT_IDS")
  && !serverAccessSource.includes("NEXT_PUBLIC_PIPELINE_ACADEMY")
));

check("the enterprise curriculum has ten tracks, thirty-six modules, and 100+ hours", () => (
  curriculum.academyTracks.length === 10
  && curriculum.academyModules.length === 36
  && curriculum.academyTotalMinutes() >= 6_000
));

check("every module has the same four mastery activity kinds", () => (
  curriculum.academyModules.every((module) => (
    JSON.stringify(module.activities.map((activity) => activity.kind))
      === JSON.stringify(["learn", "source-trace", "lab", "knowledge-check"])
    && module.activities.reduce((total, activity) => total + activity.minutes, 0) === module.minutes
  ))
));

check("activity identities are unique and stable", () => {
  const generated = curriculum.academyModules.flatMap((module) => (
    module.activities.map((activity) => curriculum.academyActivityKey(module.id, activity.id))
  ));
  return generated.length === 144
    && generated.length === new Set(generated).size
    && JSON.stringify(generated) === JSON.stringify(curriculum.academyActivityIds);
});

check("all curriculum source readings exist", () => (
  curriculum.academyModules.every((module) => (
    module.sources.length >= 3 && module.sources.every((source) => existsSync(source.path))
  ))
));

check("trace and lab activities require written mastery evidence", () => (
  curriculum.academyModules.every((module) => (
    module.activities
      .filter((activity) => activity.kind === "source-trace" || activity.kind === "lab")
      .every((activity) => activity.evidencePrompt && activity.acceptanceCriteria?.length >= 3)
  ))
));

check("progress normalization rejects unknown identities", () => {
  const normalized = progress.normalizeAcademyProgress({
    completedActivityIds: [curriculum.academyActivityIds[0], "invented:activity"],
    activeModuleId: "invented-module",
    activeActivityId: "invented-activity",
    evidence: { "invented:activity": { text: "unsafe", updatedAt: new Date().toISOString() } },
  });
  return normalized.completedActivityIds.length === 1
    && !("invented:activity" in normalized.evidence)
    && curriculum.academyModuleIds.includes(normalized.activeModuleId);
});

check("concurrent progress merge preserves completion and newest evidence", () => {
  const first = progress.emptyAcademyProgress();
  const second = progress.emptyAcademyProgress();
  const firstId = curriculum.academyActivityIds[0];
  const secondId = curriculum.academyActivityIds[1];
  first.completedActivityIds = [firstId];
  second.completedActivityIds = [secondId];
  first.evidence[firstId] = { text: "first version", updatedAt: "2026-08-26T00:00:00.000Z" };
  second.evidence[firstId] = { text: "newest version", updatedAt: "2026-08-27T00:00:00.000Z" };
  const merged = progress.mergeAcademyProgress(first, second);
  return merged.completedActivityIds.includes(firstId)
    && merged.completedActivityIds.includes(secondId)
    && merged.evidence[firstId].text === "newest version";
});

check("all golden journeys point to current modules and source files", () => (
  journeys.academyJourneys.length >= 10
  && journeys.academyJourneys.every((journey) => (
    journey.steps.length >= 3
    && journey.moduleIds.every((moduleId) => curriculum.academyModuleIds.includes(moduleId))
    && journey.steps.every((step) => existsSync(step.source))
  ))
));

check("the generated atlas maps every maintained file to a current module", () => (
  atlas.totals.files > 500
  && atlas.totals.coveredFiles === atlas.totals.files
  && atlas.entries.every((entry) => (
    entry.moduleIds.length > 0
    && entry.moduleIds.every((moduleId) => curriculum.academyModuleIds.includes(moduleId))
  ))
));

check("the web shell exposes all enterprise views and safe persistence modes", () => (
  ["curriculum", "journeys", "repository", "labs", "mastery"].every((view) => componentSource.includes(`\"${view}\"`))
  && componentSource.includes("mergeAcademyProgress")
  && componentSource.includes("expectedRevision")
  && componentSource.includes("window.localStorage.setItem")
  && componentSource.includes("Never enter PHI")
));

const failures = checks.filter((item) => !item.ok);
const result = {
  ok: failures.length === 0,
  checks,
  tracks: curriculum.academyTracks.length,
  modules: curriculum.academyModules.length,
  activities: curriculum.academyActivityIds.length,
  guidedHours: Math.round(curriculum.academyTotalMinutes() / 6) / 10,
  journeys: journeys.academyJourneys.length,
  atlasFiles: atlas.totals.files,
  interpretation: failures.length === 0
    ? "Owner access, curriculum, progress, journey, atlas, and persistence contracts are intact."
    : "The private Academy contract has drifted and must be corrected before release.",
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;

function identity(email) {
  return { id: email, email };
}

function check(name, test) {
  let ok = false;
  try {
    ok = test() === true;
  } catch {
    ok = false;
  }
  checks.push({ name, ok });
}

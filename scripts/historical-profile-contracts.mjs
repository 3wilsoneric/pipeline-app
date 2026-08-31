#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const read = (file) => readFileSync(file, "utf8");
const profileModule = loadTypeScriptModule(process.cwd(), "lib/pipeline/historical-profile.ts");
const store = read("lib/pipeline/historical-profile-store.ts");
const contracts = read("lib/pipeline/historical-profile-contracts.ts");
const route = read("app/api/referrals/[referralId]/historical-profile/route.ts");
const assessmentRoute = read("app/api/referrals/[referralId]/assessments/route.ts");
const canvas = read("components/pipeline/ReferralPacketCanvas.tsx");
const historicalWorkspace = read("components/pipeline/HistoricalReferralProfile.tsx");

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const source = {
  candidateId: "synthetic-candidate",
  sourceCanvasId: "synthetic-canvas",
  sourceCanvasName: "Synthetic historical canvas",
  sourceProjectName: "Synthetic historical project",
  sourceLocator: "allo://canvas/synthetic-canvas",
  capturedAt: "2026-01-10T00:00:00.000Z",
  proposedValue: [
    "Client was alert and oriented x4 during the interview.",
    "Client uses a walker and needs standby assistance for transfers.",
    "This sentence is intentionally generic and should remain available for human source review.",
  ].join("\n"),
};
const profile = profileModule.buildHistoricalProfile(41, [source]);
const fields = profile.sections.flatMap((section) => section.fields.map((field) => field.targetField));

check("historical projection is explicitly read-only and never an assessment",
  profile.mode === "historical_profile" && profile.readOnly && !profile.assessmentCreated);
check("mapped evidence uses canonical assessment fields",
  fields.includes("cognition_orientation") && fields.includes("mobility"));
check("unmatched historical prose is preserved instead of forced into a field",
  profile.unmappedEvidence.length === 1 && profile.coverage.unmappedPassageCount === 1);
check("each mapped statement retains source provenance",
  profile.sections.every((section) => section.fields.every((field) => field.evidence.every((item) =>
    item.source.sourceCanvasId === source.sourceCanvasId && item.source.sourceLocator === source.sourceLocator))));
check("historical profile contracts distinguish mapped and unmapped evidence",
  contracts.includes("HistoricalProfileEvidence") && contracts.includes("HistoricalProfileUnmappedEvidence")
    && contracts.includes("assessmentCreated: false"));
check("database lookup prefers the exact referral link with canvas identity fallback",
  store.includes("s.referral_id = ${referral.id}") && store.includes("s.source_canvas_id = ${referral.sourceWorkspaceId ?? null}")
    && !store.includes("and s.source_canvas_name = ${") && !store.includes("referral.name"));
check("private manifests remain disabled in production",
  store.includes("process.env.NODE_ENV === \"production\"") && store.includes("PIPELINE_NOTE_LAB_MANIFEST_PATH"));
check("historical profile API is authenticated, access-scoped, and no-store",
  route.includes("requirePipelineUser") && route.includes("requireReferralAccess")
    && route.includes("workspaceStatus !== \"historical\"") && route.includes("private, no-store"));
check("normal assessment creation rejects historical workspaces",
  assessmentRoute.includes("Historical workspaces are read-only profiles and cannot create assessments."));
check("historical workspace exposes Profile but not the Assessment stage",
  canvas.includes("const historicalSteps") && canvas.includes("{ page: 1, label: \"Profile\" }")
    && canvas.includes("activePage === 2 && !isHistoricalWorkspace"));
check("historical workspace removes mutation affordances",
  canvas.includes("isHistoricalWorkspace ? (") && canvas.includes("Read only")
    && canvas.includes("readOnly={isHistoricalWorkspace}"));
check("historical UI clearly distinguishes retrieval from current assessment",
  historicalWorkspace.includes("This is not a completed assessment")
    && historicalWorkspace.includes("does not establish current status")
    && historicalWorkspace.includes("Source notes needing structure"));
check("historical projection code contains no clinical writes",
  !store.includes("insert into pipeline.assessments") && !store.includes("update pipeline.assessments")
    && !store.includes("update pipeline.referrals"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length) process.exit(1);

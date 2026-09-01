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
const capturedSource = {
  sourceCanvasId: "structured-canvas",
  sourceCanvasName: "Structured historical canvas",
  sourceProjectName: "June admissions",
  sourceLocator: "allo://canvas/structured-canvas",
  capturedAt: "2026-06-04T00:00:00.000Z",
  snapshotId: "structured-snapshot",
  blocks: [],
};
const blockValues = [
  ["NAME", "Activity", "paragraph"],
  ["GENDER", "Activity", "paragraph"],
  ["AGE", "Activity", "paragraph"],
  ["DOB", "Activity", "paragraph"],
  ["Example Person", "Activity", "paragraph"],
  ["Female", "Activity", "paragraph"],
  ["40", "Activity", "paragraph"],
  ["11/20/1985", "Activity", "paragraph"],
  ["Date Referral Received (M/D/Y):", "Activity", "paragraph"],
  ["05/28/2026", "Activity", "paragraph"],
  ["Assesment Date (M/D/Y):", "Activity", "paragraph"],
  ["06/02/2026", "Activity", "paragraph"],
  ["County:", "Activity", "paragraph"],
  ["Stanislaus", "Activity", "paragraph"],
  ["Referrent:", "Activity", "paragraph"],
  ["Example Referrer", "Activity", "paragraph"],
  ["Responsible Person:", "Activity", "paragraph"],
  ["Example Responsible Person", "Activity", "paragraph"],
  ["Residential program, unit C1", "Activity", "paragraph"],
  ["Subtasks", "Subtasks", "heading"],
  ["Original follow-up task", "Subtasks", "paragraph"],
];
capturedSource.blocks = blockValues.map(([text, heading, blockType], index) => ({
  blockId: `structured-block-${index + 1}`,
  ordinal: index + 1,
  pageNumber: null,
  pageTitle: null,
  blockType,
  semanticRole: "rendered-dom",
  headingPath: [heading],
  text,
}));
const sourceCompleteProfile = profileModule.buildHistoricalProfile(42, [], [capturedSource], [{
  documentId: "document-1",
  name: "Example face sheet.pdf",
  category: "face_sheet",
  contentType: "application/pdf",
  sizeBytes: 4096,
  pageCount: 2,
  uploadedAt: "2026-06-04T00:00:00.000Z",
  status: "uploaded",
  previewStatus: "ready",
  sourceSystem: "allo",
}]);
const sourceFacts = new Map(sourceCompleteProfile.facts.map((fact) => [fact.key, fact.value]));

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
check("raw source blocks produce profile facts even when no assessment-note candidate exists",
  sourceCompleteProfile.coverage.candidateCount === 0
    && sourceFacts.get("dob") === "11/20/1985"
    && sourceFacts.get("county") === "Stanislaus"
    && sourceFacts.get("assessment_date") === "06/02/2026"
    && sourceFacts.get("referrer") === "Example Referrer"
    && sourceFacts.get("responsible_person")?.includes("Residential program, unit C1"));
check("source-complete profile preserves documents and remaining workspace details",
  sourceCompleteProfile.documents.length === 1
    && sourceCompleteProfile.documents[0].name === "Example face sheet.pdf"
    && sourceCompleteProfile.sourceSections.some((section) =>
      section.blocks.some((block) => block.text === "Original follow-up task"))
    && sourceCompleteProfile.message === null);
check("database lookup prefers the exact referral link with canvas identity fallback",
  store.includes("s.referral_id = ${referral.id}") && store.includes("s.source_canvas_id = ${referral.sourceWorkspaceId ?? null}")
    && !store.includes("and s.source_canvas_name = ${") && !store.includes("referral.name"));
check("historical profiles recover bounded legacy Summary content from stored source blocks",
  store.includes("recoverLegacyCanvasAssessmentCandidate")
    && store.includes("pipeline.canvas_content_blocks")
    && store.includes("not exists ("));
check("historical profiles load latest raw canvas blocks and every linked document",
  store.includes("postgresCapturedSources")
    && store.includes("distinct on (source_canvas_id)")
    && store.includes("from pipeline.documents")
    && store.includes("where referral_id = ${referralId}"));
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
    && historicalWorkspace.includes("Historical facts and notes must be verified before reuse")
    && !historicalWorkspace.includes("CoverageFact")
    && historicalWorkspace.includes("Source notes needing structure")
    && historicalWorkspace.includes("Source documents")
    && historicalWorkspace.includes("Other source details"));
check("historical projection code contains no clinical writes",
  !store.includes("insert into pipeline.assessments") && !store.includes("update pipeline.assessments")
    && !store.includes("update pipeline.referrals"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length) process.exit(1);

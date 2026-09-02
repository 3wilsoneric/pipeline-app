#!/usr/bin/env node

import { readFileSync } from "node:fs";
import {
  analyzeClassifiedNotes,
  classifyNoteText,
  splitLabeledNoteSections,
} from "../lib/note-lab/note-lab-taxonomy-core.mjs";
import {
  classifyAssessmentNarrativeField,
  splitAssessmentNarrativePassages,
} from "../lib/note-lab/assessment-language-core.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const read = (file) => readFileSync(file, "utf8");
const access = read("lib/note-lab/note-lab-access.ts");
const standards = read("lib/note-lab/assessment-language-standards.ts");
const engine = read("lib/note-lab/note-lab-engine.ts");
const samples = read("lib/note-lab/note-lab-samples.ts");
const store = read("lib/note-lab/note-lab-store.ts");
const contracts = read("lib/note-lab/note-lab-contracts.ts");
const workspace = read("components/pipeline/note-lab/AssessmentPracticeWorkspace.tsx");
const route = read("app/api/note-lab/session/route.ts");
const page = read("app/(standalone-review)/note-lab/page.tsx");
const admittedAnalysis = read("scripts/analyze-admitted-note-structure.mjs");
const migration = read("database/migrations/0023_note_lab_field_reviews.sql");
const rollback = read("database/rollbacks/0023_note_lab_field_reviews.sql");
const engineModule = loadTypeScriptModule(process.cwd(), "lib/note-lab/note-lab-engine.ts");
const contractsModule = loadTypeScriptModule(process.cwd(), "lib/note-lab/note-lab-contracts.ts");
const standardsModule = loadTypeScriptModule(process.cwd(), "lib/note-lab/assessment-language-standards.ts");

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check("production route is explicitly feature flagged", access.includes("PIPELINE_NOTE_LAB_ENABLED") && access.includes("NODE_ENV === \"production\""));
check("only supervisor roles can enter", access.includes("admin") && access.includes("assessment_coordinator"));
check("page is hidden from indexing", page.includes("index: false") && page.includes("follow: false") && page.includes("notFound()"));
check("mutation requires lab authorization and same-origin validation", route.includes("requireAuthenticatedUser")
  && route.includes("canAccessNoteLab(auth.user)") && route.includes("requireSameOriginMutation")
  && route.includes("readJsonBody(request, 32_000)"));
check("source manifest is disabled in production", samples.includes("Private file sources are disabled in production") && samples.includes("PIPELINE_NOTE_LAB_MANIFEST_PATH"));
check("nine evidence-based documentation criteria are defined", standardsModule.noteLabDocumentationCriteria.length === 9
  && new Set(standardsModule.noteLabDocumentationCriteria.map((criterion) => criterion.id)).size === 9);
check("five concrete answer variations plus the baseline cover every documentation criterion", standardsModule.noteLabAnswerComponents.length === 5
  && new Set([...standardsModule.noteLabBaselineCriterionIds,
    ...standardsModule.noteLabAnswerComponents.flatMap((component) => component.criterionIds)]).size === 9
  && standardsModule.noteLabAnswerComponents.every((component) => component.examplePattern.length > 20));
check("controlled revision reasons cover evidence and language defects", standardsModule.noteLabRevisionReasons.length === 10
  && standards.includes("unsupported_inference") && standards.includes("stigmatizing_or_identity_first")
  && standards.includes("duplicated_stale_or_irrelevant"));
check("input requires field evidence and a coherent sample judgment", contracts.includes("selectedCriterionIds")
  && contracts.includes("sampleDisposition") && contracts.includes("revisionReasonIds")
  && contracts.includes("Select at least one reason the historical answer needs work."));
check("only one requested bounded field scenario is returned", store.includes("selectSessionScenario(catalog, calibrationProgress, requestedField)")
  && route.includes('searchParams.get("field")') && !store.includes("scenarioCatalog: catalog"));
check("calibration is bounded to fifteen field reviews", store.includes("NOTE_LAB_CALIBRATION_TARGET")
  && store.includes("reviews.slice(0, NOTE_LAB_CALIBRATION_TARGET)")
  && store.includes("This calibration is already complete."));
check("the combined rail preserves the assessment section navigation",
  workspace.includes('aria-label="Assessment section navigation"')
  && workspace.includes("assessmentPracticeNavigationGroups.map")
  && workspace.includes('aria-current={active ? "step" : undefined}')
  && workspace.includes("startSectionWalkthrough")
  && workspace.includes("Open guide for ${section.label}"));
check("only authored narrative questions can open guidance and the selected section bounds the walkthrough",
  workspace.includes("hasUsefulWritingGuidance")
  && workspace.includes("firstGuidedStepInSection")
  && workspace.includes("step.section === currentStep.section")
  && workspace.includes("setGuidedField(next.question.field)")
  && workspace.includes("Next field")
  && !workspace.includes("structuredQuestionGuidance")
  && !workspace.includes("/api/note-lab/session")
  && workspace.includes("Save and continue"));
check("language guidance is an anchored question tooltip without a modal gate",
  workspace.includes("PracticeQuestionTooltip")
  && workspace.includes("data-practice-field")
  && workspace.includes('role="dialog"')
  && workspace.includes("Close guide for ${label}")
  && !workspace.includes("QuestionGuidanceDialog")
  && !workspace.includes("OK, go to question"));
check("narrative guidance includes purpose, answer order, and a good example",
  workspace.includes("narrativeGuide.purpose")
  && workspace.includes("Use this order")
  && workspace.includes("specification.formatTemplate")
  && workspace.includes("specification.strongExample"));
check("the former language page redirects to the one combined workflow",
  page.includes("getAssessmentPracticeUser")
  && page.includes('redirect(toPipelinePath("/note-lab/practice"))'));
check("historical samples and review copy are absent from the combined UI",
  store.includes("corpusSamplesAvailable: 0")
  && !store.includes("attachReviewSample(baseScenario")
  && !workspace.includes("reviewSample")
  && !workspace.includes("Past note")
  && !workspace.includes("Historical answer"));
check("practice progress autosaves locally without writing clinical records",
  workspace.includes("window.localStorage")
  && workspace.includes("Autosaved in this browser")
  && workspace.includes("Save and continue")
  && !workspace.includes("fetch(")
  && !workspace.includes("Next section"));
check("field scenarios come from canonical writing specifications", engine.includes("getAssessmentNarrativeGuideCoverage().coveredFields")
  && engine.includes("getAssessmentFieldWritingSpec(field)") && engine.includes("formatStandard"));
check("historical text must map to a canonical assessment field", engine.includes("classifyAssessmentNarrativeField")
  && engine.includes("if (!mapping) continue") && engine.includes("getAssessmentNarrativeGuide(mapping.targetField)"));
check("direct identifiers receive deterministic masking", engine.includes("identityAliases") && engine.includes("[email]")
  && engine.includes("[phone]") && engine.includes("[identifier]") && engine.includes("[date]"));
check("sample selection is reviewer-stable and field scoped", engine.includes("sampleRank(reviewerId, scenario.id, left.id)")
  && engine.includes("sample.targetField === scenario.targetField"));
check("stale or mismatched samples cannot be submitted", engine.includes("The historical answer changed. Reload before saving this review."));
check("review writes are concurrency serialized", store.includes("pg_advisory_xact_lock") && store.includes("expectedRevision"));
check("review progress is isolated by signed-in reviewer", store.includes("where reviewer_principal_id = ${reviewerId}")
  && store.includes("localState.records.get(reviewerId)")
  && store.includes("localState.records.set(reviewerId"));
check("review rows are unique, reviewer scoped, and contain no note text", migration.includes("unique (reviewer_principal_id, calibration_version, scenario_id)")
  && migration.includes("revoke all on table pipeline.note_lab_field_reviews from public")
  && !migration.includes("note_text") && !migration.includes("source_canvas_id"));
check("new field-review migration has a scoped rollback", rollback.includes("drop table if exists pipeline.note_lab_field_reviews")
  && rollback.includes("0023_note_lab_field_reviews") && !rollback.includes("drop schema"));
check("the lab does not mutate clinical records", !store.includes("update pipeline.assessments") && !store.includes("update pipeline.referrals"));
check("admitted-note analysis requires explicit historical admission evidence",
  admittedAnalysis.includes('episode?.admit_date === "string"')
  && admittedAnalysis.includes("client.existing_history.episodes.some(hasAdmissionDate)"));
check("admitted-note analysis writes an owner-readable aggregate profile",
  admittedAnalysis.includes('dataClass: "private_aggregate"')
  && admittedAnalysis.includes('containsNoteText: false')
  && admittedAnalysis.includes("mode: 0o600"));
check("admitted-note analysis forbids causal or decision interpretation",
  admittedAnalysis.includes("not a comparison of admitted and non-admitted referrals")
  && admittedAnalysis.includes("No pattern in this profile may be interpreted as causing admission"));

const scenarioCatalog = engineModule.buildNoteLabScenarioCatalog();
check("every coachable field has a concrete standard", scenarioCatalog.length === 64
  && scenarioCatalog.every((scenario) => scenario.recommendedCriterionIds.length >= 4
    && scenario.formatStandard.instructionSteps.length >= 3
    && scenario.formatStandard.instructionSteps.every((step) => step.title.length > 3 && step.instruction.length > 20)
    && scenario.formatStandard.requiredElements.length > 0
    && scenario.formatStandard.referenceAnswer.length > 20));
check("the first calibration fields have field-specific writing instructions",
  scenarioCatalog.slice(0, 15).every((scenario) => scenario.formatStandard.instructionSteps.length >= 4)
  && scenarioCatalog[0].formatStandard.instructionSteps.some((step) => step.instruction.includes("failed placement")));
check("base scenarios contain no historical provenance", scenarioCatalog.every((scenario) => scenario.reviewSample === null)
  && !JSON.stringify(scenarioCatalog).includes("sourceCanvasId"));
const emptyProgress = contractsModule.emptyNoteLabProgress(contractsModule.NOTE_LAB_CALIBRATION_VERSION);
const emptyCalibration = engineModule.buildNoteLabCalibration(scenarioCatalog, emptyProgress);
check("the sidebar field sequence is bounded and canonical", emptyCalibration.fieldSteps.length === 15
  && emptyCalibration.fieldSteps[0].field === "prior_placements"
  && emptyCalibration.fieldSteps[14].field === "staff_interaction_notes"
  && emptyCalibration.fieldSteps.every((step) => !step.reviewed));
const firstScenario = engineModule.selectNextScenario(scenarioCatalog, emptyProgress);
const secondScenario = engineModule.selectNextScenario(scenarioCatalog, {
  ...emptyProgress,
  reviews: [{ scenarioId: scenarioCatalog[0].id }],
});
check("field review starts at the first canonical assessment narrative field", firstScenario?.targetField === "prior_placements"
  && firstScenario?.id === scenarioCatalog[0].id);
check("field review advances in canonical assessment order", secondScenario?.id === scenarioCatalog[1].id
  && secondScenario?.targetField === "prior_awol_failed_placements");
check("new reviewers start at field one and returning reviewers resume at the first unfinished field",
  engineModule.selectSessionScenario(scenarioCatalog, emptyProgress)?.id === scenarioCatalog[0].id
  && engineModule.selectSessionScenario(scenarioCatalog, {
    ...emptyProgress,
    reviews: [{ scenarioId: scenarioCatalog[0].id }],
  })?.id === scenarioCatalog[1].id);
check("direct field selection is bounded and defaults to field one",
  engineModule.selectCalibrationScenario(scenarioCatalog)?.id === scenarioCatalog[0].id
  && engineModule.selectCalibrationScenario(scenarioCatalog, scenarioCatalog[8].targetField)?.id === scenarioCatalog[8].id
  && engineModule.selectCalibrationScenario(scenarioCatalog, "not_a_field")?.id === scenarioCatalog[0].id);
const nonSequentialProgress = {
  ...emptyProgress,
  reviews: [scenarioCatalog[0], scenarioCatalog[2]].map((scenario, index) => ({
    scenarioId: scenario.id,
    targetField: scenario.targetField,
    selectedCriterionIds: ["direct_answer"],
    sampleId: null,
    sampleDisposition: null,
    revisionReasonIds: [],
    submittedAt: new Date(index).toISOString(),
  })),
};
const nonSequentialCalibration = engineModule.buildNoteLabCalibration(scenarioCatalog, nonSequentialProgress);
check("completed field state does not assume sequential review order",
  nonSequentialCalibration.fieldSteps[0].reviewed
  && !nonSequentialCalibration.fieldSteps[1].reviewed
  && nonSequentialCalibration.fieldSteps[2].reviewed);

const sample = {
  id: "answer_contract_sample",
  sourceCanvasId: "canvas_private_source",
  sourceSection: "assessment",
  targetField: scenarioCatalog[0].targetField,
  targetFieldLabel: scenarioCatalog[0].targetFieldLabel,
  fieldPurpose: scenarioCatalog[0].fieldPurpose,
  purposeTrack: scenarioCatalog[0].purposeTrack,
  text: "Per client report, the current finding occurs twice weekly and affects sleep.",
  wordCount: 12,
  lengthBand: "brief",
  mappingConfidence: "high",
  classification: classifyNoteText("Per client report, the current finding occurs twice weekly and affects sleep.", "assessment"),
};
const scenarioWithSample = engineModule.attachReviewSample(scenarioCatalog[0], [sample], "sample_set_contract", "reviewer_contract");
check("review scenarios expose redacted answer text without source provenance", scenarioWithSample.reviewSample?.id === sample.id
  && scenarioWithSample.reviewSample.text === sample.text
  && !JSON.stringify(scenarioWithSample).includes("canvas_private_source"));

const validReview = contractsModule.validateNoteLabReviewInput({
  expectedRevision: 0,
  calibrationVersion: contractsModule.NOTE_LAB_CALIBRATION_VERSION,
  scenarioId: scenarioWithSample.id,
  targetField: scenarioWithSample.targetField,
  selectedCriterionIds: ["direct_answer", "source_provenance", "timeframe_recency"],
  sampleId: sample.id,
  sampleDisposition: "revise",
  revisionReasonIds: ["missing_impact"],
});
check("a coherent historical-answer review is accepted", validReview.ok
  && validReview.value.selectedCriterionIds.length === 3
  && validReview.value.sampleDisposition === "revise");
check("revision without a reason and teaching with defects are rejected",
  !contractsModule.validateNoteLabReviewInput({
    expectedRevision: 0,
    calibrationVersion: contractsModule.NOTE_LAB_CALIBRATION_VERSION,
    scenarioId: scenarioWithSample.id,
    targetField: scenarioWithSample.targetField,
    selectedCriterionIds: ["direct_answer"],
    sampleId: sample.id,
    sampleDisposition: "revise",
    revisionReasonIds: [],
  }).ok
  && !contractsModule.validateNoteLabReviewInput({
    expectedRevision: 0,
    calibrationVersion: contractsModule.NOTE_LAB_CALIBRATION_VERSION,
    scenarioId: scenarioWithSample.id,
    targetField: scenarioWithSample.targetField,
    selectedCriterionIds: ["direct_answer"],
    sampleId: sample.id,
    sampleDisposition: "teach",
    revisionReasonIds: ["missing_impact"],
  }).ok);
check("sample-free fields can still save a standard", contractsModule.validateNoteLabReviewInput({
  expectedRevision: 0,
  calibrationVersion: contractsModule.NOTE_LAB_CALIBRATION_VERSION,
  scenarioId: scenarioCatalog[1].id,
  targetField: scenarioCatalog[1].targetField,
  selectedCriterionIds: ["direct_answer", "source_provenance"],
  sampleId: null,
  sampleDisposition: null,
  revisionReasonIds: [],
}).ok);

const medication = classifyNoteText("Per MAR, medication is 10 mg nightly. Client reports no side effects.", "medication");
check("medication notes classify into the medication domain", medication.primaryTopic === "medication"
  && medication.signals.includes("source_attribution") && medication.signals.includes("numeric_detail"));
const sections = splitLabeledNoteSections("[ALLO Summary]\nReferral received from county.\n\n[ALLO Interview]\nClient was alert and oriented x4.");
check("labeled canvas content is split before classification", sections.length === 2
  && sections[0].section === "summary" && sections[1].section === "interview");
const passages = splitAssessmentNarrativePassages("- Aware x4 during interview.\n- Uses a walker and needs standby assistance for transfers.");
check("broad summaries are split into field-sized evidence passages", passages.length === 2);
check("orientation language maps to the actual cognition field", classifyAssessmentNarrativeField("Client was alert and oriented x4 during the interview.")?.targetField === "cognition_orientation");
check("mobility language maps to the actual mobility field", classifyAssessmentNarrativeField("Client uses a walker and needs standby assistance for transfers.")?.targetField === "mobility");
check("ambiguous prose is quarantined instead of forced into a field", classifyAssessmentNarrativeField("Client had a nice conversation and the meeting ended.") === null);
check("structured medication adherence is not mislabeled as a free-text field", classifyAssessmentNarrativeField("Client reports no medication refusals.") === null);
check("current wording plus source attribution is not enough to claim current symptoms", classifyAssessmentNarrativeField("Client reports being currently sober and agrees with the treatment plan.") === null);
check("facility wording without a prior-placement marker is not treated as placement history", classifyAssessmentNarrativeField("The case manager thought this was a skilled nursing facility.") === null);
check("generic preference language is not treated as a placement preference", classifyAssessmentNarrativeField("Client does not want to refuse medication.") === null);
const profile = analyzeClassifiedNotes([
  { section: "medication", lengthBand: "brief", sourceCanvasId: "one", classification: medication },
  { section: "medication", lengthBand: "brief", sourceCanvasId: "two", classification: medication },
]);
check("aggregate analysis exposes only pairable corpus statistics", profile.sampleCount === 2
  && profile.pairableSampleCount === 2 && !JSON.stringify(profile).includes("10 mg"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);

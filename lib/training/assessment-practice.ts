import { getAssessmentCompletionSummary } from "@/lib/assessment/assessment-completion";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewSections,
  getRequiredAssessmentInterviewQuestions,
  hasAssessmentInterviewValue,
} from "@/lib/assessment/assessment-interview-schema";
import {
  assessmentToolFieldDefinitions,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";

export const assessmentPracticeRules = [
  { title: "Verify", detail: "Check carried-forward identity and referral facts against the source." },
  { title: "Ask", detail: "Ask the direct question before adding interpretation." },
  { title: "Follow up", detail: "Complete every conditional detail that opens." },
  { title: "Be specific", detail: "For support needs, state what help is needed, how often, and why." },
  { title: "Separate time", detail: "Keep past history distinct from the current presentation." },
  { title: "Attribute", detail: "Name the source when accounts differ; do not guess." },
  { title: "Finish", detail: "Record the client's goals and anything still awaiting confirmation." },
] as const;

export const assessmentPracticeSectionGuidance: Readonly<Record<AssessmentToolSection, string>> = {
  identity: "Verify the carried-forward identity, referral source, county, and current location before continuing.",
  prior_placement: "Keep the current setting separate from prior placements; add dates or duration when known.",
  prior_history: "Record the event, timeframe, outcome, and source without turning old history into current status.",
  diagnosis_clinical: "Separate the supplied diagnosis, what the client reports now, and what you directly observe.",
  functional_adl: "State the task, exact assistance level, frequency, and any cue, device, or safety need.",
  medication: "Compare client report with the supplied medication record and leave unresolved differences visible.",
  substance_use: "Separate history from current use and document substance, recency, frequency, impact, and insight.",
  behavioral_risk: "For every positive history, capture recency, frequency, trigger, response, outcome, and current status.",
  physical_health: "Connect each concern to the concrete diet, equipment, monitoring, or hands-on support required.",
  legal_conservatorship: "Use the verified legal status, dates, jurisdiction, requirements, and source; never infer it.",
  social_support: "Record the client's own goals and preferences alongside family, housing, and benefit context.",
  provenance_qc: "Resolve required answers, opened follow-ups, conflicting accounts, and items awaiting confirmation.",
};

const trainingConflicts = [
  "Medication adherence: the client reports taking medication as offered; the supplied MAR shows two refusals in the last 30 days.",
] as const;

const trainingAwaitingConfirmation = [
  "Confirm the medication refused and the most recent refusal date with the current facility.",
  "Confirm the date of the most recent hospitalization from the discharge record.",
] as const;

const definitionByField = new Map(
  assessmentToolFieldDefinitions.map((definition) => [definition.key, definition]),
);

export function getAssessmentPracticeReview(data: AssessmentToolData) {
  const completion = getAssessmentCompletionSummary(data);
  const requiredQuestions = getRequiredAssessmentInterviewQuestions(data);
  const conditionalFieldKeys = new Set(
    requiredQuestions
      .filter((question) => question.requiredWhen)
      .map((question) => question.field),
  );
  const openConditionalDetails = requiredQuestions
    .filter((question) => question.requiredWhen && !hasAssessmentInterviewValue(data[question.field]))
    .map((question) => assessmentInterviewFieldLabel(question.field));
  const missingRequired = completion.missing
    .filter((item) => {
      if (!item.key.startsWith("field:")) return true;
      const field = item.key.slice("field:".length) as AssessmentToolFieldKey;
      return !conditionalFieldKeys.has(field);
    })
    .map((item) => item.label);
  const sectionsReady = assessmentInterviewSections
    .filter((section) => {
      const requiredInSection = requiredQuestions.filter((question) => (
        definitionByField.get(question.field)?.section === section.key
      ));
      return requiredInSection.every((question) => hasAssessmentInterviewValue(data[question.field]));
    })
    .map((section) => section.label);

  return {
    missingRequired,
    openConditionalDetails,
    conflicts: [...trainingConflicts],
    awaitingConfirmation: [...trainingAwaitingConfirmation],
    sectionsReady,
  };
}

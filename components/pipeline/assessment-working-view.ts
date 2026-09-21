import {
  assessmentInterviewOptionLabel,
  getAssessmentInterviewQuestions,
  getAssessmentUnableReason,
  hasAssessmentInterviewValue,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentToolData, AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { assessmentPreparationGroups, preparationQuestions } from "@/lib/assessment/assessment-preparation";

import { assessmentConversationSections } from "@/lib/assessment/assessment-interview-schema";
export { assessmentConversationSections };

// Focus the conversation without removing fields from the full questionnaire,
// changing completion rules, or treating source records as client confirmation.
const recordReviewFields = new Set<AssessmentToolFieldKey>([
  "assessment_date", "community", "referral_received_date", "referrer_name", "referrer_contact",
  "county", "referring_facility", "prior_hospitalizations_count",
  "most_recent_hospitalization", "prior_5150_5250_holds", "diagnosis_categories",
  "diagnosis_other_detail", "secondary_diagnoses", "conservatorship_status", "hold_type",
  "most_recent_arrest_date", "most_recent_arrest_jail_time", "total_arrests", "court_dates",
  "medication_refusals_30_days", "injection_frequency", "last_injection", "next_injection_due",
]);

export function isInterviewFocusField(field: AssessmentToolFieldKey) {
  return !recordReviewFields.has(field);
}

export function assessmentWorkingSections(data: AssessmentToolData, pending: readonly AssessmentToolFieldKey[], preparing = false) {
  if (!preparing) return assessmentGapSections(data, pending, true);
  return assessmentPreparationGroups.map((group) => {
    const questions = preparationQuestions(group, data);
    return { ...group, questions, remaining: questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured") };
  });
}

// Provenance describes where an answer came from, not whether the client confirmed it.
export function assessmentAnswerOrigin(assessment: PipelineAssessmentRecord, data: AssessmentToolData, field: AssessmentToolFieldKey) {
  if (JSON.stringify(data[field]) !== JSON.stringify(assessment[field])) return "Updated in this session";
  const source = assessment.field_provenance[field]?.at(-1);
  if (!source || source.review_status === "rejected") return "";
  if (source.source_field_key.startsWith("manual.")) return "Entered in Pipeline";
  if (source.source_field_key.startsWith("workbook.")) return "From Excel backup";
  if (!source.source_file) return "From referral records";
  return `Source: ${source.source_file}${source.source_page_no ? ` · page ${source.source_page_no}` : ""}`;
}

export function assessmentGapSections(data: AssessmentToolData, pending: readonly AssessmentToolFieldKey[], interviewOnly = false) {
  return assessmentConversationSections.map((section) => {
    const referenceQuestions = getAssessmentInterviewQuestions(section.key, data);
    const questions = referenceQuestions.filter((question) => interviewOnly ? isInterviewFocusField(question.field) : question.field !== "assessment_date");
    const remaining = questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured");
    return { ...section, questions, referenceQuestions, remaining };
  });
}

export function assessmentQuestionStatus(question: AssessmentInterviewQuestion, data: AssessmentToolData, pending: readonly AssessmentToolFieldKey[]) {
  if (pending.includes(question.field)) return "verify";
  if (!hasAssessmentInterviewValue(data[question.field])) return "unanswered";
  if (data[question.field] === "unable_to_assess" && !getAssessmentUnableReason(data, question.field).trim()) return "reason";
  return "captured";
}

export function assessmentWorkingCounts(questions: readonly AssessmentInterviewQuestion[], data: AssessmentToolData, pending: readonly AssessmentToolFieldKey[]) {
  const statuses = questions.map((question) => assessmentQuestionStatus(question, data, pending));
  return {
    unanswered: statuses.filter((status) => status === "unanswered").length,
    verify: statuses.filter((status) => status === "verify").length,
    reasons: statuses.filter((status) => status === "reason").length,
    captured: statuses.filter((status) => status === "captured").length,
  };
}

export function assessmentWorkingCountLabel(counts: ReturnType<typeof assessmentWorkingCounts>) {
  const parts = [];
  if (counts.unanswered) parts.push(`${counts.unanswered} unanswered`);
  if (counts.verify) parts.push(`${counts.verify} to verify`);
  if (counts.reasons) parts.push(`${counts.reasons} ${counts.reasons === 1 ? "needs" : "need"} a reason`);
  return parts.join(" · ") || "Complete";
}

export function groupWorkingQuestions(questions: readonly AssessmentInterviewQuestion[]) {
  const groups = new Map<string, AssessmentInterviewQuestion[]>();
  for (const question of questions) groups.set(question.group, [...(groups.get(question.group) ?? []), question]);
  return Array.from(groups, ([label, questions]) => ({ label, questions }));
}

export function capturedAssessmentAnswer(question: AssessmentInterviewQuestion, data: AssessmentToolData) {
  const value = data[question.field];
  if (Array.isArray(value)) return value.map((item) => assessmentInterviewOptionLabel(question.field, item) ?? item).join("; ");
  if (typeof value === "string") return assessmentInterviewOptionLabel(question.field, value) ?? value;
  if (value === null) return "No confirmed answer";
  return String(value);
}

import {
  assessmentInterviewOptionLabel,
  getAssessmentInterviewQuestions,
  getAssessmentUnableReason,
  hasAssessmentInterviewValue,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentToolData, AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";

// Presentation order only: retain canonical fields, conditions, and source checks.
// Add cross-topic regrouping only when assessor feedback identifies a concrete gap.
export const assessmentConversationSections = ([
  ["identity", "Confirm the basics"],
  ["diagnosis_clinical", "How things are now"],
  ["functional_adl", "A usual day"],
  ["physical_health", "Health and comfort"],
  ["medication", "Medication"],
  ["prior_placement", "Living situation"],
  ["prior_history", "Recent care and history"],
  ["substance_use", "Substance use and recovery"],
  ["behavioral_risk", "Safety and support"],
  ["legal_conservatorship", "Decisions and legal support"],
  ["social_support", "What matters next"],
  ["provenance_qc", "Anything else"],
] as const).map(([key, label]) => ({ key, label }));

export function assessmentGapSections(data: AssessmentToolData, pending: readonly AssessmentToolFieldKey[]) {
  return assessmentConversationSections.map((section) => {
    const questions = getAssessmentInterviewQuestions(section.key, data);
    const remaining = questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured");
    return { ...section, questions, remaining };
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

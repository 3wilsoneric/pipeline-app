import {
  assessmentInterviewFieldLabel,
  assessmentInterviewOptionLabel,
  assessmentInterviewSections,
  getAssessmentInterviewQuestions,
  getAssessmentUnableReason,
  hasAssessmentInterviewValue,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentToolData, AssessmentToolFieldKey, AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";

// Presentation order only: retain canonical fields, conditions, and source checks.
// Add cross-topic regrouping only when assessor feedback identifies a concrete gap.
export const assessmentConversationSections = ([
  ["identity", "Confirm the basics", "Confirm the details the referral did not provide."],
  ["diagnosis_clinical", "How things are now", "How have things been for you recently?"],
  ["functional_adl", "A usual day", "Talk through a usual day and the help they need."],
  ["physical_health", "Health and comfort", "Check current health, comfort, and care needs."],
  ["medication", "Medication", "How are medications going day to day?"],
  ["prior_placement", "Living situation", "Where are they living now, and what is that like?"],
  ["prior_history", "Recent care and history", "Fill in recent stays and what led to this referral."],
  ["substance_use", "Substance use and recovery", "Clarify substance use and recovery history."],
  ["behavioral_risk", "Safety and support", "Discuss current safety concerns and what helps."],
  ["legal_conservatorship", "Decisions and legal support", "Confirm decision-making support and legal requirements."],
  ["social_support", "What matters next", "What matters to them about their next home?"],
  ["provenance_qc", "Anything else", "Anything else needed to understand this person?"],
] as const).map(([key, label, prompt]) => ({ key, label, prompt }));

export function assessmentGapSections(data: AssessmentToolData, pending: readonly AssessmentToolFieldKey[]) {
  return assessmentConversationSections.map((section) => {
    const questions = getAssessmentInterviewQuestions(section.key, data);
    const remaining = questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured");
    return { ...section, questions, remaining };
  });
}

export function assessmentConversationContext(section: AssessmentToolSection, data: AssessmentToolData, pending: readonly AssessmentToolFieldKey[]) {
  const all = assessmentInterviewSections.flatMap((item) => getAssessmentInterviewQuestions(item.key, data));
  // Surface recorded accommodations and current support, never infer clinical risk.
  const support: AssessmentToolFieldKey[] = ["current_safety_measures"];
  if (data.language_barrier === "yes") support.push("language_barrier", "language_barrier_details");
  if (data.linear_conversation === "no") support.push("linear_conversation", "linear_conversation_details");
  if (data.ambulatory === "no") support.push("ambulatory", "mobility");
  if (data.current_self_harm_ideation === "yes") support.push("current_self_harm_ideation", "current_self_harm_details");
  const captured = (question: AssessmentInterviewQuestion) => hasAssessmentInterviewValue(data[question.field]) || pending.includes(question.field);
  const supportQuestions = support.flatMap((field) => all.filter((question) => question.field === field && captured(question)));
  const relatedSections: AssessmentToolSection[] = section === "prior_history" ? [section, "prior_placement"] : [section];
  const relevant = relatedSections.flatMap((key) => getAssessmentInterviewQuestions(key, data)).filter((question) => captured(question) && !supportQuestions.some((item) => item.field === question.field));
  return [
    ...(supportQuestions.length ? [{ label: "Interview support", questions: supportQuestions }] : []),
    ...groupWorkingQuestions(relevant),
  ];
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
  if (counts.reasons) parts.push(`${counts.reasons} need a reason`);
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

export function matchesAssessmentQuestion(question: AssessmentInterviewQuestion, query: string) {
  return `${assessmentInterviewFieldLabel(question.field)} ${question.group}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

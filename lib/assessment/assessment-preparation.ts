import { assessmentInterviewQuestions, isAssessmentQuestionVisible } from "@/lib/assessment/assessment-interview-schema";
import { assessmentToolFieldDefinitions, type AssessmentToolData, type AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";

// Preparation uses the canonical questionnaire rather than a second answer
// store. The interview date is lifecycle-owned and edited through Details.
const groups: readonly { key: AssessmentToolSection; label: string; sections: readonly AssessmentToolSection[] }[] = [
  { key: "identity", label: "Referral & placement", sections: ["identity", "prior_placement"] },
  { key: "prior_history", label: "Clinical history & presentation", sections: ["prior_history", "diagnosis_clinical", "substance_use", "behavioral_risk"] },
  { key: "medication", label: "Medication & health", sections: ["medication", "physical_health"] },
  { key: "functional_adl", label: "Daily support", sections: ["functional_adl"] },
  { key: "legal_conservatorship", label: "Legal, supports & goals", sections: ["legal_conservatorship", "social_support", "provenance_qc"] },
];
const sectionByField = new Map(assessmentToolFieldDefinitions.map((field) => [field.key, field.section]));
export const assessmentPreparationGroups = groups.map((group) => ({
  ...group,
  fields: assessmentInterviewQuestions.filter((question) => group.sections.includes(sectionByField.get(question.field)!)).map((question) => question.field),
}));

export function preparationGroupForSection(section: AssessmentToolSection) {
  return assessmentPreparationGroups.find((group) => group.sections.includes(section)) ?? assessmentPreparationGroups[0];
}

export function preparationQuestions(group: typeof assessmentPreparationGroups[number], data: AssessmentToolData) {
  return assessmentInterviewQuestions.filter((question) => question.field !== "assessment_date"
    && group.fields.includes(question.field)
    && isAssessmentQuestionVisible(question, data));
}

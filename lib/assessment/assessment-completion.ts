import {
  requiredAssessmentToolFields,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
} from "./assessment-tool-schema";
import {
  assessmentInterviewFieldLabel,
  getAssessmentUnableReason,
  getRequiredAssessmentInterviewQuestions,
  getUnableToAssessQuestions,
} from "./assessment-interview-schema";

export type AssessmentCompletionRule = {
  key: string;
  label: string;
  fields: readonly AssessmentToolFieldKey[];
  mode: "all" | "any";
};

export const assessmentCompletionRules: readonly AssessmentCompletionRule[] = requiredAssessmentToolFields.map((field) => ({
    key: `field:${field}`,
    label: requiredFieldLabel(field),
    fields: [field],
    mode: "all" as const,
  }));

export function getAssessmentCompletionSummary(data: AssessmentToolData) {
  const fields = new Set<AssessmentToolFieldKey>([
    ...requiredAssessmentToolFields,
    ...getRequiredAssessmentInterviewQuestions(data).map((question) => question.field),
  ]);
  const answerRules = [...fields].map((field) => ({
    key: `field:${field}`,
    label: requiredFieldLabel(field),
    fields: [field] as readonly AssessmentToolFieldKey[],
    mode: "all" as const,
  })).map((rule) => ({
    ...rule,
    complete: rule.mode === "all"
      ? rule.fields.every((field) => hasAssessmentValue(data[field]))
      : rule.fields.some((field) => hasAssessmentValue(data[field])),
  }));
  const unableReasonRules = getUnableToAssessQuestions(data).map((question) => ({
    key: `unable:${question.field}`,
    label: `${assessmentInterviewFieldLabel(question.field)}: explain why it could not be assessed`,
    fields: ["unable_to_assess_reasons"] as readonly AssessmentToolFieldKey[],
    mode: "all" as const,
    complete: Boolean(getAssessmentUnableReason(data, question.field).trim()),
  }));
  const rules = [...answerRules, ...unableReasonRules];
  const complete = rules.filter((rule) => rule.complete).length;
  return {
    complete,
    total: rules.length,
    percent: rules.length === 0 ? 100 : Math.round((complete / rules.length) * 100),
    rules,
    missing: rules.filter((rule) => !rule.complete),
  };
}

function hasAssessmentValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.some((item) => item.trim().length > 0);
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined;
}

function requiredFieldLabel(field: AssessmentToolFieldKey) {
  return ({
    resident_number: "Resident number",
    resident_name: "Resident name",
    date_of_birth: "Date of birth",
    community: "Community",
    assessment_date: "Assessment date",
    assessor: "Assessor",
  } as Partial<Record<AssessmentToolFieldKey, string>>)[field] ?? assessmentInterviewFieldLabel(field);
}

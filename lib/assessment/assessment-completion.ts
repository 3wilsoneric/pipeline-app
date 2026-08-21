import {
  requiredAssessmentToolFields,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
} from "./assessment-tool-schema";

export type AssessmentCompletionRule = {
  key: string;
  label: string;
  fields: readonly AssessmentToolFieldKey[];
  mode: "all" | "any";
};

export const assessmentCompletionRules: readonly AssessmentCompletionRule[] = [
  ...requiredAssessmentToolFields.map((field) => ({
    key: `field:${field}`,
    label: requiredFieldLabel(field),
    fields: [field],
    mode: "all" as const,
  })),
  {
    key: "clinical_picture",
    label: "Clinical picture",
    fields: ["primary_diagnosis", "acuity_level", "cognition_orientation", "assessment_notes"],
    mode: "any",
  },
  {
    key: "functional_needs",
    label: "Functional and ADL needs",
    fields: ["adl_needs", "prompting_level", "mobility", "self_care_status"],
    mode: "any",
  },
  {
    key: "behavioral_risk",
    label: "Behavioral and safety risk",
    fields: ["behavioral_history", "si_hi_history", "elopement_risk", "aggression_risk"],
    mode: "any",
  },
  {
    key: "medication",
    label: "Medication at intake",
    fields: ["medications_at_intake", "medication_adherence", "lai_vs_oral", "prn_patterns"],
    mode: "any",
  },
] as const;

export function getAssessmentCompletionSummary(data: AssessmentToolData) {
  const rules = assessmentCompletionRules.map((rule) => ({
    ...rule,
    complete: rule.mode === "all"
      ? rule.fields.every((field) => hasAssessmentValue(data[field]))
      : rule.fields.some((field) => hasAssessmentValue(data[field])),
  }));
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
  } as Partial<Record<AssessmentToolFieldKey, string>>)[field] ?? field;
}

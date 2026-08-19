export const assessmentToolSections = [
  "identity",
  "prior_placement",
  "prior_history",
  "diagnosis_clinical",
  "functional_adl",
  "behavioral_risk",
  "legal_conservatorship",
  "medication",
  "substance_use",
  "social_support",
  "provenance_qc",
] as const;

export type AssessmentToolSection = (typeof assessmentToolSections)[number];
export type AssessmentValueType = "confidence" | "date" | "integer" | "string" | "string_list" | "timestamp";

export type AssessmentToolData = {
  resident_number: string | null;
  resident_name: string | null;
  date_of_birth: string | null;
  community: string | null;
  assessment_date: string | null;
  assessor: string | null;

  referring_facility: string | null;
  prior_setting_bucket: string | null;
  county: string | null;
  admit_date: string | null;

  prior_hospitalizations_count: number | null;
  most_recent_hospitalization: string | null;
  prior_5150_5250_holds: string | null;
  prior_placements: string | null;
  crisis_er_utilization: string | null;
  prior_awol_failed_placements: string | null;

  primary_diagnosis: string | null;
  secondary_diagnoses: string[];
  acuity_level: string | null;
  cognition_orientation: string | null;

  adl_needs: string | null;
  prompting_level: string | null;
  mobility: string | null;
  self_care_status: string | null;

  behavioral_history: string | null;
  triggers: string | null;
  si_hi_history: string | null;
  elopement_risk: string | null;
  aggression_risk: string | null;
  responds_to_internal_stimuli: string | null;

  conservatorship_status: string | null;
  conservatorship_type: string | null;
  conservator_name: string | null;
  hold_type: string | null;
  court_dates: string | null;
  probation_parole_justice: string | null;

  medications_at_intake: string[];
  medication_adherence: string | null;
  lai_vs_oral: string | null;
  prn_patterns: string | null;

  substances: string[];
  use_pattern: string | null;
  treatment_history: string | null;

  family_involvement: string | null;
  housing_history: string | null;
  prior_living_situation: string | null;
  benefits_income_status: string | null;
  discharge_planning_goals: string | null;

  source_file: string | null;
  match_confidence: number | null;
  assessment_notes: string | null;
  extraction_date: string | null;
};

export type AssessmentToolFieldKey = keyof AssessmentToolData;

export type AssessmentToolFieldDefinition = {
  key: AssessmentToolFieldKey;
  label: string;
  section: AssessmentToolSection;
  value_type: AssessmentValueType;
  required_for_completion: boolean;
  extraction_aliases: readonly string[];
};

export type AssessmentFieldProvenance = {
  source_field_key: string;
  source_file: string | null;
  confidence: number;
  review_status: "accepted" | "edited" | "pending" | "rejected";
  source_page_no: number | null;
  evidence_url: string | null;
};

export type UnmappedAssessmentField = AssessmentFieldProvenance & {
  value: string | null;
  reason?: "conflict" | "invalid" | "rejected" | "unmapped";
};

export type AssessmentToolRecord = AssessmentToolData & {
  /** Server-generated primary key. Repeated assessments never overwrite one another. */
  assessment_id: string;
  /** Immutable Alamo client identity when this assessment belongs to an existing client. */
  canonical_client_id: string | null;
  /** Confirmed Alamo community-qualified key. Never derive this from a name. */
  resident_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  field_provenance: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>;
  unmapped_fields: UnmappedAssessmentField[];
};

export type AssessmentExtractionField = {
  field_key: string;
  proposed_value: string | null;
  final_value?: string | null;
  confidence: number;
  review_status: "accepted" | "edited" | "pending" | "rejected";
  source_page_no?: number;
  evidence_url?: string;
};

export type AssessmentExtractionContext = {
  source_file?: string;
  extraction_date?: string;
  match_confidence?: number;
};

export type AssessmentExtractionMapping = {
  data: AssessmentToolData;
  field_provenance: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>;
  unmapped_fields: UnmappedAssessmentField[];
};

export type AssessmentValidationIssue = {
  field: AssessmentToolFieldKey | "assessment";
  message: string;
};

export const assessmentToolFieldDefinitions: readonly AssessmentToolFieldDefinition[] = [
  field("resident_number", "Resident number", "identity", "string", true, ["eldermark.resident_number", "referral.resident_number", "demographics.resident_number"]),
  field("resident_name", "Resident name", "identity", "string", true, ["referral.full_name", "demographics.full_name", "resident.name"]),
  field("date_of_birth", "Date of birth", "identity", "date", true, ["referral.date_of_birth", "demographics.date_of_birth"]),
  field("community", "Community", "identity", "string", true, ["assessment.community", "resident.community"]),
  field("assessment_date", "Assessment date", "identity", "date", true),
  field("assessor", "Assessor", "identity", "string", true),

  field("referring_facility", "Referring facility", "prior_placement", "string", false, ["referral.referring_facility"]),
  field("prior_setting_bucket", "Prior setting", "prior_placement", "string", false),
  field("county", "County", "prior_placement", "string", false, ["referral.county"]),
  field("admit_date", "Admit date", "prior_placement", "date", false, ["resident.admit_date"]),

  field("prior_hospitalizations_count", "Prior hospitalizations", "prior_history", "integer", false),
  field("most_recent_hospitalization", "Most recent hospitalization", "prior_history", "date", false),
  field("prior_5150_5250_holds", "Prior 5150 / 5250 holds", "prior_history", "string", false),
  field("prior_placements", "Prior placements", "prior_history", "string", false),
  field("crisis_er_utilization", "Crisis / ER utilization", "prior_history", "string", false),
  field("prior_awol_failed_placements", "Prior AWOL / failed placements", "prior_history", "string", false),

  field("primary_diagnosis", "Primary diagnosis", "diagnosis_clinical", "string", false, ["referral.primary_diagnosis"]),
  field("secondary_diagnoses", "Secondary diagnoses", "diagnosis_clinical", "string_list", false),
  field("acuity_level", "Acuity level", "diagnosis_clinical", "string", false),
  field("cognition_orientation", "Cognition / orientation", "diagnosis_clinical", "string", false),

  field("adl_needs", "ADL needs", "functional_adl", "string", false),
  field("prompting_level", "Prompting level", "functional_adl", "string", false),
  field("mobility", "Mobility", "functional_adl", "string", false, ["assessment.mobility"]),
  field("self_care_status", "Self-care status", "functional_adl", "string", false),

  field("behavioral_history", "Behavioral history", "behavioral_risk", "string", false, ["assessment.behaviors"]),
  field("triggers", "Triggers", "behavioral_risk", "string", false),
  field("si_hi_history", "SI / HI history", "behavioral_risk", "string", false),
  field("elopement_risk", "Elopement risk", "behavioral_risk", "string", false),
  field("aggression_risk", "Aggression risk", "behavioral_risk", "string", false),
  field("responds_to_internal_stimuli", "Responds to internal stimuli", "behavioral_risk", "string", false),

  field("conservatorship_status", "Conservatorship status", "legal_conservatorship", "string", false),
  field("conservatorship_type", "Conservatorship type", "legal_conservatorship", "string", false),
  field("conservator_name", "Conservator name", "legal_conservatorship", "string", false),
  field("hold_type", "Hold type", "legal_conservatorship", "string", false),
  field("court_dates", "Court dates", "legal_conservatorship", "string", false),
  field("probation_parole_justice", "Probation / parole / justice", "legal_conservatorship", "string", false),

  field("medications_at_intake", "Medications at intake", "medication", "string_list", false, ["referral.current_medications"]),
  field("medication_adherence", "Medication adherence", "medication", "string", false),
  field("lai_vs_oral", "LAI vs oral", "medication", "string", false),
  field("prn_patterns", "PRN patterns", "medication", "string", false),

  field("substances", "Substances", "substance_use", "string_list", false),
  field("use_pattern", "Use pattern", "substance_use", "string", false),
  field("treatment_history", "Treatment history", "substance_use", "string", false),

  field("family_involvement", "Family involvement", "social_support", "string", false),
  field("housing_history", "Housing history", "social_support", "string", false),
  field("prior_living_situation", "Prior living situation", "social_support", "string", false),
  field("benefits_income_status", "Benefits / income status", "social_support", "string", false),
  field("discharge_planning_goals", "Discharge planning goals", "social_support", "string", false),

  field("source_file", "Source file", "provenance_qc", "string", false),
  field("match_confidence", "Match confidence", "provenance_qc", "confidence", false),
  field("assessment_notes", "Assessment notes", "provenance_qc", "string", false, ["assessment.presenting_needs", "assessment.risk_notes", "assessment.medical_history", "referral.notes"]),
  field("extraction_date", "Extraction date", "provenance_qc", "timestamp", false),
] as const;

export const requiredAssessmentToolFields = assessmentToolFieldDefinitions
  .filter((definition) => definition.required_for_completion)
  .map((definition) => definition.key);

const definitionByKey = new Map(assessmentToolFieldDefinitions.map((definition) => [definition.key, definition]));
const targetByExtractionKey = new Map<string, AssessmentToolFieldKey>();
for (const definition of assessmentToolFieldDefinitions) {
  targetByExtractionKey.set(`assessment_tool.${definition.key}`, definition.key);
  targetByExtractionKey.set(`assessment.${definition.key}`, definition.key);
  for (const alias of definition.extraction_aliases) targetByExtractionKey.set(alias, definition.key);
}

const firstNameKeys = new Set(["assessment_tool.first_name", "assessment.first_name", "referral.first_name", "demographics.first_name"]);
const lastNameKeys = new Set(["assessment_tool.last_name", "assessment.last_name", "referral.last_name", "demographics.last_name"]);

export function createEmptyAssessmentToolData(): AssessmentToolData {
  return {
    resident_number: null,
    resident_name: null,
    date_of_birth: null,
    community: null,
    assessment_date: null,
    assessor: null,
    referring_facility: null,
    prior_setting_bucket: null,
    county: null,
    admit_date: null,
    prior_hospitalizations_count: null,
    most_recent_hospitalization: null,
    prior_5150_5250_holds: null,
    prior_placements: null,
    crisis_er_utilization: null,
    prior_awol_failed_placements: null,
    primary_diagnosis: null,
    secondary_diagnoses: [],
    acuity_level: null,
    cognition_orientation: null,
    adl_needs: null,
    prompting_level: null,
    mobility: null,
    self_care_status: null,
    behavioral_history: null,
    triggers: null,
    si_hi_history: null,
    elopement_risk: null,
    aggression_risk: null,
    responds_to_internal_stimuli: null,
    conservatorship_status: null,
    conservatorship_type: null,
    conservator_name: null,
    hold_type: null,
    court_dates: null,
    probation_parole_justice: null,
    medications_at_intake: [],
    medication_adherence: null,
    lai_vs_oral: null,
    prn_patterns: null,
    substances: [],
    use_pattern: null,
    treatment_history: null,
    family_involvement: null,
    housing_history: null,
    prior_living_situation: null,
    benefits_income_status: null,
    discharge_planning_goals: null,
    source_file: null,
    match_confidence: null,
    assessment_notes: null,
    extraction_date: null,
  };
}

export function mapExtractedAssessmentFields(
  fields: readonly AssessmentExtractionField[],
  context: AssessmentExtractionContext = {},
): AssessmentExtractionMapping {
  const data = createEmptyAssessmentToolData();
  const fieldProvenance: AssessmentExtractionMapping["field_provenance"] = {};
  const unmappedFields: UnmappedAssessmentField[] = [];
  let firstName = "";
  let lastName = "";

  if (context.source_file?.trim()) data.source_file = context.source_file.trim();
  if (context.extraction_date?.trim()) data.extraction_date = context.extraction_date.trim();
  if (context.match_confidence !== undefined) data.match_confidence = context.match_confidence;

  for (const extracted of fields) {
    const rawValue = extracted.final_value ?? extracted.proposed_value;
    const provenance = provenanceFor(extracted, context.source_file);
    if (extracted.review_status === "rejected") {
      unmappedFields.push({ ...provenance, value: rawValue });
      continue;
    }

    if (firstNameKeys.has(extracted.field_key)) {
      firstName = rawValue?.trim() ?? "";
      appendProvenance(fieldProvenance, "resident_name", provenance);
      continue;
    }
    if (lastNameKeys.has(extracted.field_key)) {
      lastName = rawValue?.trim() ?? "";
      appendProvenance(fieldProvenance, "resident_name", provenance);
      continue;
    }

    const target = targetByExtractionKey.get(extracted.field_key);
    const definition = target ? definitionByKey.get(target) : undefined;
    if (!target || !definition) {
      unmappedFields.push({ ...provenance, value: rawValue });
      continue;
    }

    const parsed = parseExtractionValue(rawValue, definition.value_type);
    if (!parsed.ok) {
      unmappedFields.push({ ...provenance, value: rawValue });
      continue;
    }

    if (definition.value_type === "string_list") {
      const existing = data[target];
      if (!Array.isArray(existing) || !Array.isArray(parsed.value)) {
        unmappedFields.push({ ...provenance, value: rawValue });
        continue;
      }
      (data[target] as string[]) = Array.from(new Set([...existing, ...parsed.value]));
    } else if (target === "assessment_notes") {
      const value = typeof parsed.value === "string" ? parsed.value : null;
      if (value) {
        data.assessment_notes = appendAssessmentNote(
          data.assessment_notes,
          narrativeSourceLabel(extracted.field_key, definition.label),
          value,
        );
      }
    } else {
      assignAssessmentValue(data, target, parsed.value);
    }
    appendProvenance(fieldProvenance, target, provenance);
  }

  if (!data.resident_name) {
    const combinedName = [firstName, lastName].filter(Boolean).join(" ");
    if (combinedName) data.resident_name = combinedName;
  }

  return {
    data,
    field_provenance: fieldProvenance,
    unmapped_fields: unmappedFields,
  };
}

export function validateAssessmentToolData(value: unknown): AssessmentValidationIssue[] {
  if (!isRecord(value)) return [{ field: "assessment", message: "Assessment data must be an object." }];

  const issues: AssessmentValidationIssue[] = [];
  const knownKeys = new Set(assessmentToolFieldDefinitions.map((definition) => definition.key));
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key as AssessmentToolFieldKey)) {
      issues.push({ field: "assessment", message: `Unknown assessment field: ${key}.` });
    }
  }

  for (const definition of assessmentToolFieldDefinitions) {
    const current = value[definition.key];
    if (current === null || current === undefined) continue;

    if (definition.value_type === "string_list") {
      if (!Array.isArray(current) || current.length > 200 || current.some((item) => typeof item !== "string" || !item.trim() || item.length > 2000)) {
        issues.push({ field: definition.key, message: `${definition.label} must be a list of non-empty text values.` });
      }
      continue;
    }
    if (definition.value_type === "integer") {
      if (typeof current !== "number" || !Number.isInteger(current) || current < 0 || current > 10000) {
        issues.push({ field: definition.key, message: `${definition.label} must be a non-negative whole number.` });
      }
      continue;
    }
    if (definition.value_type === "confidence") {
      if (typeof current !== "number" || !Number.isFinite(current) || current < 0 || current > 1) {
        issues.push({ field: definition.key, message: `${definition.label} must be between 0 and 1.` });
      }
      continue;
    }
    if (typeof current !== "string" || current.length > (definition.key === "assessment_notes" ? 50000 : 10000)) {
      issues.push({ field: definition.key, message: `${definition.label} has an invalid value.` });
      continue;
    }
    if (definition.value_type === "date" && !isIsoDate(current)) {
      issues.push({ field: definition.key, message: `${definition.label} must use YYYY-MM-DD.` });
    }
    if (definition.value_type === "timestamp" && !Number.isFinite(Date.parse(current))) {
      issues.push({ field: definition.key, message: `${definition.label} must be an ISO timestamp.` });
    }
  }

  return issues;
}

export function getAssessmentToolCompleteness(data: AssessmentToolData) {
  const missing_fields = requiredAssessmentToolFields.filter((key) => !hasAssessmentValue(data[key]));
  const required_total = requiredAssessmentToolFields.length;
  const required_ready = required_total - missing_fields.length;
  return {
    required_total,
    required_ready,
    missing_fields,
    percent: required_total === 0 ? 100 : Math.round((required_ready / required_total) * 100),
  };
}

export function getAssessmentToolCoverage(data: AssessmentToolData) {
  const captured_fields = assessmentToolFieldDefinitions
    .filter((definition) => hasAssessmentValue(data[definition.key]))
    .map((definition) => definition.key);
  const missing_fields = assessmentToolFieldDefinitions
    .filter((definition) => !hasAssessmentValue(data[definition.key]))
    .map((definition) => definition.key);
  const total = assessmentToolFieldDefinitions.length;

  return {
    total,
    captured: captured_fields.length,
    captured_fields,
    missing_fields,
    percent: total === 0 ? 100 : Math.round((captured_fields.length / total) * 100),
  };
}

export function pickAssessmentToolData(value: Partial<AssessmentToolData>): AssessmentToolData {
  const data = createEmptyAssessmentToolData();
  for (const definition of assessmentToolFieldDefinitions) {
    const current = value[definition.key];
    if (current !== undefined) assignAssessmentValue(data, definition.key, current);
  }
  return data;
}

function field(
  key: AssessmentToolFieldKey,
  label: string,
  section: AssessmentToolSection,
  valueType: AssessmentValueType,
  requiredForCompletion: boolean,
  aliases: readonly string[] = [],
): AssessmentToolFieldDefinition {
  return {
    key,
    label,
    section,
    value_type: valueType,
    required_for_completion: requiredForCompletion,
    extraction_aliases: aliases,
  };
}

function provenanceFor(field: AssessmentExtractionField, sourceFile?: string): AssessmentFieldProvenance {
  return {
    source_field_key: field.field_key,
    source_file: sourceFile?.trim() || null,
    confidence: field.confidence,
    review_status: field.review_status,
    source_page_no: field.source_page_no ?? null,
    evidence_url: field.evidence_url ?? null,
  };
}

function appendProvenance(
  provenance: AssessmentExtractionMapping["field_provenance"],
  key: AssessmentToolFieldKey,
  value: AssessmentFieldProvenance,
) {
  provenance[key] = [...(provenance[key] ?? []), value];
}

function parseExtractionValue(value: string | null, valueType: AssessmentValueType): { ok: true; value: string | string[] | number | null } | { ok: false } {
  if (value === null || !value.trim()) return { ok: true, value: valueType === "string_list" ? [] : null };
  const trimmed = value.trim();

  if (valueType === "string_list") {
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string" && item.trim())) {
          return { ok: true, value: parsed.map((item) => item.trim()) };
        }
      } catch {
        return { ok: false };
      }
      return { ok: false };
    }
    // Do not split clinical lists on punctuation; one source value remains one item.
    return { ok: true, value: [trimmed] };
  }
  if (valueType === "integer") {
    if (!/^\d+$/.test(trimmed)) return { ok: false };
    return { ok: true, value: Number(trimmed) };
  }
  if (valueType === "confidence") {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? { ok: true, value: parsed } : { ok: false };
  }
  if (valueType === "date" && !isIsoDate(trimmed)) return { ok: false };
  if (valueType === "timestamp" && !Number.isFinite(Date.parse(trimmed))) return { ok: false };
  return { ok: true, value: trimmed };
}

function assignAssessmentValue(
  data: AssessmentToolData,
  key: AssessmentToolFieldKey,
  value: string | string[] | number | null,
) {
  if (key === "secondary_diagnoses" || key === "medications_at_intake" || key === "substances") {
    if (Array.isArray(value)) data[key] = value;
    return;
  }
  if (key === "prior_hospitalizations_count") {
    if (typeof value === "number" || value === null) data[key] = value;
    return;
  }
  if (key === "match_confidence") {
    if (typeof value === "number" || value === null) data[key] = value;
    return;
  }
  if (typeof value === "string" || value === null) data[key] = value;
}

function appendAssessmentNote(current: string | null, label: string, value: string) {
  const line = `${label}: ${value}`;
  return current ? `${current}\n\n${line}` : line;
}

function hasAssessmentValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function narrativeSourceLabel(fieldKey: string, fallback: string) {
  const labels: Record<string, string> = {
    "assessment.presenting_needs": "Presenting needs",
    "assessment.risk_notes": "Risk notes",
    "assessment.medical_history": "Medical history",
    "referral.notes": "Referral notes",
  };
  return labels[fieldKey] ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

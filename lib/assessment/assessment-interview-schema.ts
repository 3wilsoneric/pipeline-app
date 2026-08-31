import {
  assessmentToolFieldDefinitions,
  assessmentToolSections,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "./assessment-tool-schema";

export type AssessmentQuestionControl =
  | "date"
  | "multi_select"
  | "number"
  | "rating"
  | "select"
  | "text"
  | "textarea"
  | "yes_no";

export type AssessmentQuestionOption = { value: string; label: string };

export type AssessmentQuestionRule = {
  field: AssessmentToolFieldKey;
  operator: "equals" | "includes" | "not_equals" | "one_of";
  value: string | readonly string[];
};

export type AssessmentInterviewQuestion = {
  field: AssessmentToolFieldKey;
  group: string;
  control: AssessmentQuestionControl;
  options?: readonly AssessmentQuestionOption[];
  showWhen?: AssessmentQuestionRule;
  requiredWhen?: AssessmentQuestionRule;
  help?: string;
  placeholder?: string;
  span?: "full" | "half";
  min?: number;
  max?: number;
};

export type AssessmentInterviewSectionDefinition = {
  key: AssessmentToolSection;
  label: string;
  description: string;
};

const yesNo = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unable_to_assess", label: "Unable to assess" },
] as const;

const assistanceLevels = [
  { value: "independent", label: "Independent" },
  { value: "some_assistance", label: "Some assistance" },
  { value: "total_assistance", label: "Total assistance" },
] as const;

const diagnosisOptions = [
  { value: "schizophrenia", label: "Schizophrenia" },
  { value: "schizoaffective", label: "Schizoaffective disorder" },
  { value: "bipolar", label: "Bipolar disorder" },
  { value: "personality_disorder", label: "Personality disorder" },
  { value: "substance_use_disorder", label: "Substance use disorder" },
  { value: "psychosis", label: "Psychosis" },
  { value: "delusional_disorder", label: "Delusional disorder" },
  { value: "physical_health", label: "Physical health condition" },
  { value: "other", label: "Other" },
] as const;

const substanceOptions = [
  { value: "opioids", label: "Opioids" },
  { value: "amphetamines", label: "Amphetamines" },
  { value: "marijuana", label: "Marijuana" },
  { value: "alcohol", label: "Alcohol" },
  { value: "other", label: "Other" },
] as const;

const useFrequencyOptions = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "sporadic", label: "Sporadic" },
  { value: "rarely", label: "Rarely" },
] as const;

const conservatorshipOptions = [
  { value: "non_conserved", label: "Non-conserved" },
  { value: "lps", label: "LPS conservatorship" },
  { value: "temporary", label: "Temporary conservatorship (T-Con)" },
  { value: "murphy", label: "Murphy conservatorship" },
] as const;

const fieldDefinitionByKey = new Map(assessmentToolFieldDefinitions.map((definition) => [definition.key, definition]));

export const assessmentInterviewSections: readonly AssessmentInterviewSectionDefinition[] = [
  section("identity", "Client & referral", "Confirm identity, source, and where the client can be reached."),
  section("prior_placement", "Placement", "Record the current setting and prior placement context."),
  section("prior_history", "History", "Capture hospitalization, crisis, and placement trajectory."),
  section("diagnosis_clinical", "Clinical", "Document diagnoses, symptoms, cognition, and current presentation."),
  section("functional_adl", "Function", "Assess ADLs, communication, mobility, and participation."),
  section("legal_conservatorship", "Legal", "Capture conservatorship, forensic history, and court requirements."),
  section("medication", "Medication", "Review medication use, refusals, and injection needs."),
  section("substance_use", "Substance use", "Document use history, current use, frequency, and insight."),
  section("behavioral_risk", "Behavior & safety", "Assess challenging behavior, self-harm, assaults, elopement, and hallucinations."),
  section("physical_health", "Physical health", "Record health concerns, diet, skin integrity, and supportive equipment."),
  section("social_support", "Support & goals", "Capture relationships, prior living stability, and placement preferences."),
  section("provenance_qc", "Review", "Add information and placement questions that do not fit elsewhere."),
] as const;

export const assessmentInterviewQuestions: readonly AssessmentInterviewQuestion[] = [
  q("resident_name", "Identity", "text"),
  q("date_of_birth", "Identity", "date"),
  q("resident_number", "Identity", "text", { help: "Enter the ElderMark resident number only when one already exists." }),
  q("community", "Identity", "text"),
  q("assessment_date", "Interview", "date"),
  q("referral_received_date", "Referral source", "date"),
  q("referrer_name", "Referral source", "text"),
  q("referrer_contact", "Referral source", "text", { placeholder: "Phone, email, and best contact method" }),
  q("current_location", "Interview logistics", "text"),
  q("time_at_current_location", "Interview logistics", "text", { placeholder: "For example, 3 weeks" }),

  q("county", "Current placement", "text"),
  q("referring_facility", "Current placement", "text"),
  q("prior_setting_bucket", "Current placement", "text"),
  q("admit_date", "Current placement", "date"),
  q("prior_placements", "Placement trajectory", "textarea", { span: "full" }),
  q("prior_awol_failed_placements", "Placement trajectory", "textarea", { span: "full" }),

  q("prior_hospitalizations_count", "Hospital and crisis history", "number", { min: 0 }),
  q("most_recent_hospitalization", "Hospital and crisis history", "date"),
  q("prior_5150_5250_holds", "Hospital and crisis history", "textarea", { span: "full" }),
  q("crisis_er_utilization", "Hospital and crisis history", "textarea", { span: "full" }),

  q("diagnosis_categories", "Diagnoses", "multi_select", { options: diagnosisOptions, span: "full" }),
  q("diagnosis_other_detail", "Diagnoses", "text", { showWhen: includes("diagnosis_categories", "other"), requiredWhen: includes("diagnosis_categories", "other") }),
  q("primary_diagnosis", "Diagnoses", "text"),
  q("secondary_diagnoses", "Diagnoses", "textarea", { help: "Enter one diagnosis per line.", span: "full" }),
  q("current_symptoms", "Current presentation", "textarea", { span: "full" }),
  q("acuity_level", "Current presentation", "text"),
  q("cognition_orientation", "Current presentation", "textarea", { span: "full" }),

  q("dress_assistance_level", "Daily living", "select", { options: assistanceLevels }),
  q("dress_assistance_details", "Daily living", "textarea", { showWhen: oneOf("dress_assistance_level", ["some_assistance", "total_assistance"]), requiredWhen: oneOf("dress_assistance_level", ["some_assistance", "total_assistance"]), span: "full" }),
  q("bathing_assistance_level", "Daily living", "select", { options: assistanceLevels }),
  q("bathing_assistance_details", "Daily living", "textarea", { showWhen: oneOf("bathing_assistance_level", ["some_assistance", "total_assistance"]), requiredWhen: oneOf("bathing_assistance_level", ["some_assistance", "total_assistance"]), span: "full" }),
  q("overall_hygiene_rating", "Daily living", "rating", { min: 1, max: 5, help: "1 indicates significant concern; 5 indicates strong hygiene." }),
  q("adl_needs", "Daily living", "textarea", { span: "full" }),
  q("prompting_level", "Daily living", "text"),
  q("self_care_status", "Daily living", "text"),
  q("ambulatory", "Mobility", "yes_no", { options: yesNo }),
  q("mobility", "Mobility", "textarea", { showWhen: equals("ambulatory", "no"), requiredWhen: equals("ambulatory", "no"), span: "full", placeholder: "Describe assistance, device, or transfer needs" }),
  q("language_barrier", "Communication and participation", "yes_no", { options: yesNo }),
  q("language_barrier_details", "Communication and participation", "textarea", { showWhen: equals("language_barrier", "yes"), requiredWhen: equals("language_barrier", "yes"), span: "full" }),
  q("linear_conversation", "Communication and participation", "yes_no", { options: yesNo }),
  q("linear_conversation_details", "Communication and participation", "textarea", { showWhen: equals("linear_conversation", "no"), requiredWhen: equals("linear_conversation", "no"), span: "full" }),
  q("peer_interaction_rating", "Communication and participation", "rating", { min: 1, max: 5 }),
  q("peer_interaction_notes", "Communication and participation", "textarea"),
  q("staff_interaction_rating", "Communication and participation", "rating", { min: 1, max: 5 }),
  q("staff_interaction_notes", "Communication and participation", "textarea"),
  q("participates_in_programming", "Communication and participation", "yes_no", { options: yesNo }),
  q("programming_notes", "Communication and participation", "textarea", { span: "full" }),

  q("conservatorship_type", "Conservatorship", "select", { options: conservatorshipOptions }),
  q("conservator_name", "Conservatorship", "text", { showWhen: notEquals("conservatorship_type", "non_conserved"), requiredWhen: notEquals("conservatorship_type", "non_conserved") }),
  q("conservatorship_status", "Conservatorship", "text", { showWhen: notEquals("conservatorship_type", "non_conserved") }),
  q("hold_type", "Conservatorship", "text"),
  q("forensic_involvement", "Forensic history", "yes_no", { options: yesNo }),
  q("forensic_involvement_details", "Forensic history", "textarea", { showWhen: equals("forensic_involvement", "yes"), requiredWhen: equals("forensic_involvement", "yes"), span: "full" }),
  q("arrest_history", "Arrest history", "yes_no", { options: yesNo }),
  q("most_recent_arrest_date", "Arrest history", "date", { showWhen: equals("arrest_history", "yes"), requiredWhen: equals("arrest_history", "yes") }),
  q("most_recent_arrest_charge", "Arrest history", "text", { showWhen: equals("arrest_history", "yes"), requiredWhen: equals("arrest_history", "yes") }),
  q("most_recent_arrest_jail_time", "Arrest history", "text", { showWhen: equals("arrest_history", "yes") }),
  q("arrest_in_last_two_years", "Arrest history", "yes_no", { options: yesNo, showWhen: equals("arrest_history", "yes"), requiredWhen: equals("arrest_history", "yes") }),
  q("arrest_last_two_years_details", "Arrest history", "textarea", { showWhen: equals("arrest_in_last_two_years", "yes"), requiredWhen: equals("arrest_in_last_two_years", "yes"), span: "full" }),
  q("total_arrests", "Arrest history", "number", { showWhen: equals("arrest_history", "yes"), requiredWhen: equals("arrest_history", "yes"), min: 0 }),
  q("pc290_registration", "Forensic requirements", "yes_no", { options: yesNo }),
  q("arson_history", "Forensic requirements", "yes_no", { options: yesNo }),
  q("diversion_client", "Forensic requirements", "yes_no", { options: yesNo }),
  q("court_requirements", "Court requirements", "textarea", { span: "full" }),
  q("court_dates", "Court requirements", "textarea"),
  q("probation_parole_justice", "Court requirements", "textarea"),

  q("medication_adherence", "Medication compliance", "yes_no", { options: yesNo }),
  q("last_medication_refusal_date", "Medication refusals", "date", { showWhen: equals("medication_adherence", "no"), requiredWhen: equals("medication_adherence", "no") }),
  q("medication_refused", "Medication refusals", "text", { showWhen: equals("medication_adherence", "no"), requiredWhen: equals("medication_adherence", "no") }),
  q("medication_refusals_30_days", "Medication refusals", "number", { showWhen: equals("medication_adherence", "no"), requiredWhen: equals("medication_adherence", "no"), min: 0 }),
  q("medications_at_intake", "Medication profile", "textarea", { help: "Enter one medication per line.", span: "full" }),
  q("lai_vs_oral", "Medication profile", "text"),
  q("prn_patterns", "Medication profile", "textarea"),
  q("im_injections", "Medication profile", "yes_no", { options: yesNo }),

  q("substance_abuse_history", "Substance-use history", "yes_no", { options: yesNo }),
  q("active_substance_use", "Substance-use history", "yes_no", { options: yesNo }),
  q("substances", "Use pattern", "multi_select", { options: substanceOptions, showWhen: equals("substance_abuse_history", "yes"), requiredWhen: equals("substance_abuse_history", "yes"), span: "full" }),
  q("last_substance_use_date", "Use pattern", "date", { showWhen: equals("substance_abuse_history", "yes") }),
  q("use_pattern", "Use pattern", "select", { options: useFrequencyOptions, showWhen: equals("substance_abuse_history", "yes"), requiredWhen: equals("substance_abuse_history", "yes") }),
  q("substance_effect_on_baseline", "Use pattern", "textarea", { showWhen: equals("substance_abuse_history", "yes"), span: "full" }),
  q("longest_sobriety_months", "Recovery history", "number", { showWhen: equals("substance_abuse_history", "yes"), min: 0 }),
  q("substance_use_insight", "Recovery history", "yes_no", { options: yesNo, showWhen: equals("substance_abuse_history", "yes"), requiredWhen: equals("substance_abuse_history", "yes") }),
  q("substance_use_insight_details", "Recovery history", "textarea", { showWhen: equals("substance_abuse_history", "yes"), requiredWhen: equals("substance_abuse_history", "yes"), span: "full" }),
  q("treatment_history", "Recovery history", "textarea", { showWhen: equals("substance_abuse_history", "yes"), span: "full" }),

  q("behavioral_history", "Current behavior", "textarea", { span: "full", placeholder: "Describe challenging behaviors, patterns, and triggers" }),
  q("triggers", "Current behavior", "textarea", { span: "full" }),
  q("physical_altercations", "Current behavior", "yes_no", { options: yesNo }),
  q("physical_altercation_details", "Current behavior", "textarea", { showWhen: equals("physical_altercations", "yes"), requiredWhen: equals("physical_altercations", "yes"), span: "full" }),
  q("self_harm_history", "Self-harm", "yes_no", { options: yesNo }),
  q("last_self_harm_incident", "Self-harm", "textarea", { showWhen: equals("self_harm_history", "yes"), requiredWhen: equals("self_harm_history", "yes"), span: "full" }),
  q("current_self_harm_ideation", "Self-harm", "yes_no", { options: yesNo }),
  q("current_self_harm_details", "Self-harm", "textarea", { showWhen: equals("current_self_harm_ideation", "yes"), requiredWhen: equals("current_self_harm_ideation", "yes"), span: "full" }),
  q("current_safety_measures", "Self-harm", "textarea", { showWhen: equals("current_self_harm_ideation", "yes"), requiredWhen: equals("current_self_harm_ideation", "yes"), span: "full" }),
  q("assault_history", "Assault and elopement", "yes_no", { options: yesNo }),
  q("last_assault_details", "Assault and elopement", "textarea", { showWhen: equals("assault_history", "yes"), requiredWhen: equals("assault_history", "yes"), span: "full" }),
  q("assaults_last_two_years_count", "Assault and elopement", "number", { showWhen: equals("assault_history", "yes"), requiredWhen: equals("assault_history", "yes"), min: 0 }),
  q("elopement_history", "Assault and elopement", "yes_no", { options: yesNo }),
  q("elopement_risk", "Assault and elopement", "textarea", { showWhen: equals("elopement_history", "yes"), requiredWhen: equals("elopement_history", "yes"), span: "full" }),
  q("aggression_risk", "Assault and elopement", "textarea"),
  q("si_hi_history", "Assault and elopement", "textarea"),
  q("responds_to_internal_stimuli", "Hallucination history", "text"),
  q("auditory_hallucinations", "Hallucination history", "yes_no", { options: yesNo }),
  q("auditory_hallucination_nature", "Auditory hallucinations", "textarea", { showWhen: equals("auditory_hallucinations", "yes"), requiredWhen: equals("auditory_hallucinations", "yes"), span: "full" }),
  q("auditory_hallucination_frequency", "Auditory hallucinations", "text", { showWhen: equals("auditory_hallucinations", "yes") }),
  q("auditory_hallucination_triggers", "Auditory hallucinations", "textarea", { showWhen: equals("auditory_hallucinations", "yes") }),
  q("visual_hallucinations", "Hallucination history", "yes_no", { options: yesNo }),
  q("visual_hallucination_details", "Visual hallucinations", "textarea", { showWhen: equals("visual_hallucinations", "yes"), requiredWhen: equals("visual_hallucinations", "yes"), span: "full" }),
  q("visual_hallucination_recent", "Visual hallucinations", "textarea", { showWhen: equals("visual_hallucinations", "yes") }),
  q("olfactory_hallucinations", "Hallucination history", "yes_no", { options: yesNo }),
  q("olfactory_hallucination_details", "Olfactory hallucinations", "textarea", { showWhen: equals("olfactory_hallucinations", "yes"), requiredWhen: equals("olfactory_hallucinations", "yes"), span: "full" }),
  q("olfactory_hallucination_impact", "Olfactory hallucinations", "textarea", { showWhen: equals("olfactory_hallucinations", "yes") }),
  q("tactile_hallucinations", "Hallucination history", "yes_no", { options: yesNo }),
  q("tactile_hallucination_details", "Tactile hallucinations", "textarea", { showWhen: equals("tactile_hallucinations", "yes"), requiredWhen: equals("tactile_hallucinations", "yes"), span: "full" }),
  q("tactile_hallucination_frequency", "Tactile hallucinations", "text", { showWhen: equals("tactile_hallucinations", "yes") }),
  q("gustatory_hallucinations", "Hallucination history", "yes_no", { options: yesNo }),
  q("gustatory_hallucination_details", "Gustatory hallucinations", "textarea", { showWhen: equals("gustatory_hallucinations", "yes"), requiredWhen: equals("gustatory_hallucinations", "yes"), span: "full" }),
  q("hallucination_coping_strategies", "Hallucination impact and treatment", "textarea", { span: "full" }),
  q("hallucination_distress_impairment", "Hallucination impact and treatment", "textarea", { span: "full" }),
  q("hallucination_functional_impact", "Hallucination impact and treatment", "textarea", { span: "full" }),
  q("hallucination_treatment_history", "Hallucination impact and treatment", "textarea", { span: "full" }),

  q("physical_health_concerns", "Current health", "yes_no", { options: yesNo }),
  q("physical_health_diagnoses", "Current health", "textarea", { showWhen: equals("physical_health_concerns", "yes"), requiredWhen: equals("physical_health_concerns", "yes"), span: "full" }),
  q("physical_health_measures", "Current health", "textarea", { showWhen: equals("physical_health_concerns", "yes"), requiredWhen: equals("physical_health_concerns", "yes"), span: "full" }),
  q("diabetic", "Current health", "yes_no", { options: yesNo }),
  q("diabetic_details", "Current health", "textarea", { showWhen: equals("diabetic", "yes"), requiredWhen: equals("diabetic", "yes") }),
  q("special_diet", "Current health", "yes_no", { options: yesNo }),
  q("special_diet_details", "Current health", "textarea", { showWhen: equals("special_diet", "yes"), requiredWhen: equals("special_diet", "yes") }),
  q("skin_integrity_issue", "Current health", "yes_no", { options: yesNo }),
  q("skin_integrity_details", "Current health", "textarea", { showWhen: equals("skin_integrity_issue", "yes"), requiredWhen: equals("skin_integrity_issue", "yes"), span: "full" }),
  q("uses_dentures", "Supportive equipment", "yes_no", { options: yesNo }),
  q("uses_hearing_aids", "Supportive equipment", "yes_no", { options: yesNo }),
  q("uses_glasses", "Supportive equipment", "yes_no", { options: yesNo }),
  q("uses_oxygen", "Supportive equipment", "yes_no", { options: yesNo }),
  q("uses_hospital_bed", "Supportive equipment", "yes_no", { options: yesNo }),
  q("uses_cpap", "Supportive equipment", "yes_no", { options: yesNo }),
  q("catheter_care", "Supportive equipment", "yes_no", { options: yesNo }),
  q("colostomy", "Supportive equipment", "yes_no", { options: yesNo }),
  q("ileostomy", "Supportive equipment", "yes_no", { options: yesNo }),
  q("additional_health_notes", "Additional health", "textarea", { span: "full" }),

  q("family_involvement", "Support system", "textarea", { span: "full" }),
  q("friendships_social_connections", "Support system", "textarea", { span: "full" }),
  q("prior_living_situation", "Living history", "textarea", { span: "full" }),
  q("housing_history", "Living history", "textarea", { span: "full" }),
  q("benefits_income_status", "Living history", "textarea"),
  q("preferred_facility_characteristics", "Preferences and goals", "textarea", { span: "full" }),
  q("discharge_planning_goals", "Preferences and goals", "textarea", { span: "full" }),
  q("placement_preferences_concerns", "Preferences and goals", "textarea", { span: "full" }),

  q("additional_information", "Additional comments", "textarea", { span: "full" }),
  q("placement_process_questions", "Additional comments", "textarea", { span: "full" }),
] as const;

export const assessmentYesNoQuestionFields = assessmentInterviewQuestions
  .filter((question) => question.control === "yes_no")
  .map((question) => question.field);

export function getAssessmentInterviewQuestions(sectionKey: AssessmentToolSection, data: AssessmentToolData) {
  return assessmentInterviewQuestions.filter((question) => (
    fieldDefinitionByKey.get(question.field)?.section === sectionKey && isAssessmentQuestionVisible(question, data)
  ));
}

export function getAssessmentInterviewCoverage(data: AssessmentToolData) {
  const visible = assessmentInterviewQuestions.filter((question) => isAssessmentQuestionVisible(question, data));
  const captured = visible.filter((question) => hasAssessmentInterviewValue(data[question.field]));
  return {
    total: visible.length,
    captured: captured.length,
    captured_fields: captured.map((question) => question.field),
    missing_fields: visible.filter((question) => !hasAssessmentInterviewValue(data[question.field])).map((question) => question.field),
    percent: visible.length === 0 ? 100 : Math.round((captured.length / visible.length) * 100),
  };
}

export function getRequiredAssessmentInterviewQuestions(data: AssessmentToolData) {
  return assessmentInterviewQuestions.filter((question) => {
    if (!isAssessmentQuestionVisible(question, data)) return false;
    const fieldRequired = fieldDefinitionByKey.get(question.field)?.required_for_completion ?? false;
    return fieldRequired || Boolean(question.requiredWhen && matchesRule(question.requiredWhen, data));
  });
}

export function isAssessmentQuestionVisible(question: AssessmentInterviewQuestion, data: AssessmentToolData) {
  return !question.showWhen || matchesRule(question.showWhen, data);
}

export function hasAssessmentInterviewValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.some((item) => item.trim().length > 0);
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null;
}

export function getAssessmentUnableReason(data: AssessmentToolData, field: AssessmentToolFieldKey) {
  return data.unable_to_assess_reasons[field] ?? "";
}

export function setAssessmentUnableReason(
  reasons: AssessmentToolData["unable_to_assess_reasons"],
  field: AssessmentToolFieldKey,
  reason: string,
) {
  const next = { ...reasons };
  const normalized = reason.trim();
  if (normalized) next[field] = reason;
  else delete next[field];
  return next;
}

export function getUnableToAssessQuestions(data: AssessmentToolData) {
  return assessmentInterviewQuestions.filter((question) => (
    question.control === "yes_no"
      && isAssessmentQuestionVisible(question, data)
      && data[question.field] === "unable_to_assess"
  ));
}

export function assessmentInterviewFieldLabel(field: AssessmentToolFieldKey) {
  return fieldDefinitionByKey.get(field)?.label ?? field;
}

export function getAssessmentInterviewSnapshot(data: AssessmentToolData) {
  const adl = [data.dress_assistance_level, data.bathing_assistance_level];
  const adlValue = adl.every((value) => value === "independent")
    ? "No"
    : adl.some((value) => value === "some_assistance" || value === "total_assistance")
      ? "Yes"
      : "Not answered";
  return [
    snapshot("Active substance use", answerLabel(data.active_substance_use), "substance_use"),
    snapshot("Medication compliant", answerLabel(data.medication_adherence), "medication"),
    snapshot("ADL assistance", adlValue, "functional_adl"),
    snapshot("Programming", answerLabel(data.participates_in_programming), "functional_adl"),
    snapshot("Ambulatory", answerLabel(data.ambulatory), "functional_adl"),
    snapshot("Dietary restrictions", answerLabel(data.special_diet), "physical_health"),
    snapshot("Language barrier", answerLabel(data.language_barrier), "functional_adl"),
  ] as const;
}

function q(
  field: AssessmentToolFieldKey,
  group: string,
  control: AssessmentQuestionControl,
  options: Omit<AssessmentInterviewQuestion, "field" | "group" | "control"> = {},
): AssessmentInterviewQuestion {
  return { field, group, control, ...options };
}

function section(key: AssessmentToolSection, label: string, description: string): AssessmentInterviewSectionDefinition {
  return { key, label, description };
}

function equals(field: AssessmentToolFieldKey, value: string): AssessmentQuestionRule {
  return { field, operator: "equals", value };
}

function notEquals(field: AssessmentToolFieldKey, value: string): AssessmentQuestionRule {
  return { field, operator: "not_equals", value };
}

function includes(field: AssessmentToolFieldKey, value: string): AssessmentQuestionRule {
  return { field, operator: "includes", value };
}

function oneOf(field: AssessmentToolFieldKey, value: readonly string[]): AssessmentQuestionRule {
  return { field, operator: "one_of", value };
}

function matchesRule(rule: AssessmentQuestionRule, data: AssessmentToolData) {
  const current = data[rule.field];
  if (rule.operator === "includes") return Array.isArray(current) && typeof rule.value === "string" && current.includes(rule.value);
  if (rule.operator === "one_of") return !Array.isArray(current) && Array.isArray(rule.value) && rule.value.includes(String(current ?? ""));
  if (rule.operator === "not_equals") return hasAssessmentInterviewValue(current) && String(current) !== rule.value;
  return !Array.isArray(current) && String(current ?? "") === rule.value;
}

function answerLabel(value: string | null) {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "unable_to_assess") return "Unable to assess";
  return "Not answered";
}

function snapshot(label: string, value: string, sectionKey: AssessmentToolSection) {
  return { label, value, section: sectionKey };
}

if (assessmentInterviewSections.length !== assessmentToolSections.length) {
  throw new Error("Every assessment section needs interview navigation metadata.");
}

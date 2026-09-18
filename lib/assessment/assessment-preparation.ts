import {
  assessmentInterviewQuestions,
  isAssessmentQuestionVisible,
} from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentToolData, AssessmentToolFieldKey, AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";

// Preparation is a view of the real questionnaire, not another answer store.
// Keep current observations and client-confirmation questions in the full assessment.
export const assessmentPreparationGroups: readonly {
  key: AssessmentToolSection;
  label: string;
  sections: readonly AssessmentToolSection[];
  fields: readonly AssessmentToolFieldKey[];
}[] = [
  {
    key: "identity", label: "Referral & placement", sections: ["identity", "prior_placement"],
    fields: ["resident_name", "date_of_birth", "community", "referral_received_date", "referrer_name", "referrer_contact", "current_location", "time_at_current_location", "county", "prior_setting_bucket", "referring_facility", "prior_placements", "prior_awol_failed_placements"],
  },
  {
    key: "prior_history", label: "Clinical history", sections: ["prior_history", "diagnosis_clinical", "substance_use", "behavioral_risk"],
    fields: ["diagnosis_categories", "diagnosis_other_detail", "secondary_diagnoses", "prior_hospitalizations_count", "most_recent_hospitalization", "prior_5150_5250_holds", "crisis_er_utilization", "substance_abuse_history", "substances", "last_substance_use_date", "use_pattern", "substance_effect_on_baseline", "longest_sobriety_period", "treatment_history", "self_harm_history", "last_self_harm_incident", "assault_history", "last_assault_details", "assaults_last_two_years_count", "elopement_history", "elopement_risk", "si_hi_history"],
  },
  {
    key: "medication", label: "Medication & health", sections: ["medication", "physical_health"],
    fields: ["medications_at_intake", "medication_adherence", "last_medication_refusal_date", "medication_refused", "medication_refusals_30_days", "prn_patterns", "im_injections", "im_injections_details", "physical_health_concerns", "physical_health_diagnoses", "physical_health_measures", "diabetic", "diabetic_details", "special_diet", "special_diet_details", "skin_integrity_issue", "skin_integrity_details", "uses_dentures", "uses_hearing_aids", "uses_glasses", "uses_oxygen", "uses_hospital_bed", "uses_cpap", "catheter_care", "colostomy", "ileostomy", "incontinence_issues", "brief_change_support", "additional_health_notes"],
  },
  {
    key: "functional_adl", label: "Daily support", sections: ["functional_adl"],
    fields: ["dress_assistance_level", "dress_assistance_details", "bathing_assistance_level", "bathing_assistance_details", "adl_needs", "prompting_level", "self_care_status", "ambulatory", "mobility", "language_barrier", "language_barrier_details"],
  },
  {
    key: "legal_conservatorship", label: "Legal & supports", sections: ["legal_conservatorship", "social_support", "provenance_qc"],
    fields: ["conservatorship_type", "conservator_name", "conservatorship_status", "hold_type", "forensic_involvement", "forensic_involvement_details", "arrest_history", "most_recent_arrest_date", "most_recent_arrest_charge", "most_recent_arrest_jail_time", "arrest_in_last_two_years", "arrest_last_two_years_details", "total_arrests", "pc290_registration", "arson_history", "diversion_client", "court_requirements", "court_dates", "probation_parole_justice", "family_involvement", "friendships_social_connections", "prior_living_situation", "housing_history", "benefits_income_status"],
  },
];

export function preparationGroupForSection(section: AssessmentToolSection) {
  return assessmentPreparationGroups.find((group) => group.sections.includes(section)) ?? assessmentPreparationGroups[0];
}

export function preparationQuestions(group: typeof assessmentPreparationGroups[number], data: AssessmentToolData) {
  return assessmentInterviewQuestions.filter((question) => group.fields.includes(question.field) && isAssessmentQuestionVisible(question, data));
}

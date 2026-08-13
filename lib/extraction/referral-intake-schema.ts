import {
  assessmentToolFieldDefinitions,
  type AssessmentToolFieldDefinition,
  type AssessmentToolFieldKey,
} from "../assessment/assessment-tool-schema";

export type ReferralFormData = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  age: string;
  gender: string;
  phone: string;
  email: string;
  address: string;
  emergencyContact: string;
  emergencyPhone: string;
  diagnosis: string;
  symptoms: string;
  riskLevel: string;
  suicidalIdeation: boolean;
  homicidalIdeation: boolean;
  substanceUse: boolean;
  substanceDetails: string;
  currentMedications: string;
  allergies: string;
  medicalConditions: string;
  source: string;
  referringProvider: string;
  referringFacility: string;
  referringPhone: string;
  priority: string;
  legalStatus: string;
  medicalClearance: string;
  packetStatus: string;
  packetSummary: string;
  releaseOnFile: boolean;
  medListReceived: boolean;
  clinicalNotesReceived: boolean;
  preferredAdmissionDate: string;
  notes: string;
  specialNeeds: string;
};

export type ReferralExtraction = {
  [K in keyof ReferralFormData]?: ReferralFormData[K];
};

export type StringReferralFieldKey = {
  [K in keyof ReferralFormData]: ReferralFormData[K] extends string ? K : never;
}[keyof ReferralFormData];

export type ExtractionSection =
  | "person"
  | "clinical"
  | "referral_source"
  | "packet_details"
  | "assessment_packet";

export type ExtractionValueType =
  | "boolean"
  | "date"
  | "number"
  | "select"
  | "string"
  | "text";

export type ReviewTier = "critical" | "standard" | "optional";

export type ExtractionFieldDefinition<TFieldKey extends string = string> = {
  field: TFieldKey;
  field_key: string;
  label: string;
  section: ExtractionSection;
  value_type: ExtractionValueType;
  review_tier: ReviewTier;
  packet_preview?: boolean;
  required_for_review?: boolean;
  options?: readonly string[];
  extraction_hints: readonly string[];
  preferred_page_classes: readonly PacketPageClass[];
};

export const initialReferralFormData: ReferralFormData = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  age: "",
  gender: "",
  phone: "",
  email: "",
  address: "",
  emergencyContact: "",
  emergencyPhone: "",
  diagnosis: "",
  symptoms: "",
  riskLevel: "",
  suicidalIdeation: false,
  homicidalIdeation: false,
  substanceUse: false,
  substanceDetails: "",
  currentMedications: "",
  allergies: "",
  medicalConditions: "",
  source: "",
  referringProvider: "",
  referringFacility: "",
  referringPhone: "",
  priority: "medium",
  legalStatus: "voluntary",
  medicalClearance: "pending",
  packetStatus: "partial",
  packetSummary: "",
  releaseOnFile: false,
  medListReceived: false,
  clinicalNotesReceived: false,
  preferredAdmissionDate: "",
  notes: "",
  specialNeeds: "",
};

export const packetFieldDefinitions: ReadonlyArray<{
  field: StringReferralFieldKey;
  label: string;
}> = [
  { field: "firstName", label: "First name" },
  { field: "lastName", label: "Last name" },
  { field: "dateOfBirth", label: "Date of birth" },
  { field: "diagnosis", label: "Diagnosis" },
  { field: "currentMedications", label: "Current medications" },
  { field: "source", label: "Referral source" },
  { field: "referringProvider", label: "Referring provider" },
  { field: "referringFacility", label: "Referring facility" },
  { field: "packetSummary", label: "Packet summary" },
  { field: "medicalClearance", label: "Medical clearance" },
];

export const requiredAssessmentPacketFields = [
  "presentingNeeds",
  "levelOfCare",
  "mobility",
  "behaviors",
  "medicationCount",
  "riskNotes",
  "admissionDecision",
  "communityPreference",
  "guardianContact",
  "medicalHistory",
] as const;

export type AssessmentPacketFieldKey = (typeof requiredAssessmentPacketFields)[number];

export type AssessmentPacketFields = Record<AssessmentPacketFieldKey, string>;

export const emptyAssessmentPacketFields: AssessmentPacketFields = {
  presentingNeeds: "",
  levelOfCare: "",
  mobility: "",
  behaviors: "",
  medicationCount: "",
  riskNotes: "",
  admissionDecision: "",
  communityPreference: "",
  guardianContact: "",
  medicalHistory: "",
};

export const assessmentPacketFieldLabels: Record<AssessmentPacketFieldKey, string> = {
  presentingNeeds: "Presenting needs",
  levelOfCare: "Recommended level of care",
  mobility: "Mobility",
  behaviors: "Behavior / observation flags",
  medicationCount: "Medication count",
  riskNotes: "Risk notes",
  admissionDecision: "Admission decision",
  communityPreference: "Community preference",
  guardianContact: "Guardian / family contact",
  medicalHistory: "Medical history",
};

export const packetPageClassDefinitions = [
  {
    page_class: "demographics",
    label: "Demographics / face sheet",
    default_route: "document_intelligence",
    extraction_priority: 1,
  },
  {
    page_class: "assessment",
    label: "Clinical or psychiatric assessment",
    default_route: "claude_if_unstructured",
    extraction_priority: 1,
  },
  {
    page_class: "medication_list",
    label: "Medication list or medication administration record",
    default_route: "document_intelligence",
    extraction_priority: 1,
  },
  {
    page_class: "diagnosis_problem_list",
    label: "Diagnosis or problem list",
    default_route: "document_intelligence",
    extraction_priority: 1,
  },
  {
    page_class: "risk_safety",
    label: "Risk, hold, safety, behavior, or crisis notes",
    default_route: "claude_if_unstructured",
    extraction_priority: 1,
  },
  {
    page_class: "allergies_medical",
    label: "Allergies, medical history, vitals, labs, or testing",
    default_route: "document_intelligence",
    extraction_priority: 2,
  },
  {
    page_class: "legal_consent",
    label: "Release, consent, legal, guardian, or payee documents",
    default_route: "document_intelligence",
    extraction_priority: 2,
  },
  {
    page_class: "financial_payer",
    label: "Billing, payer, insurance, or benefits",
    default_route: "document_intelligence",
    extraction_priority: 3,
  },
  {
    page_class: "duplicate_irrelevant",
    label: "Duplicate, blank, cover sheet, or irrelevant attachment",
    default_route: "skip",
    extraction_priority: 5,
  },
  {
    page_class: "unknown",
    label: "Unknown page type",
    default_route: "manual_review",
    extraction_priority: 4,
  },
] as const;

export type PacketPageClass =
  (typeof packetPageClassDefinitions)[number]["page_class"];

export const referralIntakeExtractionFields: ReadonlyArray<
  ExtractionFieldDefinition<keyof ReferralFormData & string>
> = [
  {
    field: "firstName",
    field_key: "referral.first_name",
    label: "First name",
    section: "person",
    value_type: "string",
    review_tier: "critical",
    packet_preview: true,
    required_for_review: true,
    extraction_hints: ["client first name", "patient first name", "first name"],
    preferred_page_classes: ["demographics", "assessment"],
  },
  {
    field: "lastName",
    field_key: "referral.last_name",
    label: "Last name",
    section: "person",
    value_type: "string",
    review_tier: "critical",
    packet_preview: true,
    required_for_review: true,
    extraction_hints: ["client last name", "patient last name", "last name"],
    preferred_page_classes: ["demographics", "assessment"],
  },
  {
    field: "dateOfBirth",
    field_key: "referral.date_of_birth",
    label: "Date of birth",
    section: "person",
    value_type: "date",
    review_tier: "critical",
    packet_preview: true,
    required_for_review: true,
    extraction_hints: ["DOB", "date of birth", "DOB/Age"],
    preferred_page_classes: ["demographics", "assessment"],
  },
  {
    field: "age",
    field_key: "referral.age",
    label: "Age",
    section: "person",
    value_type: "number",
    review_tier: "standard",
    extraction_hints: ["age", "DOB/Age"],
    preferred_page_classes: ["demographics", "assessment"],
  },
  {
    field: "gender",
    field_key: "referral.gender",
    label: "Gender",
    section: "person",
    value_type: "select",
    review_tier: "standard",
    options: ["Male", "Female", "Non-binary", "Unknown"],
    extraction_hints: ["gender", "sex", "gender billing"],
    preferred_page_classes: ["demographics"],
  },
  {
    field: "phone",
    field_key: "referral.phone",
    label: "Phone",
    section: "person",
    value_type: "string",
    review_tier: "standard",
    extraction_hints: ["home phone", "cell phone", "contact phone"],
    preferred_page_classes: ["demographics"],
  },
  {
    field: "email",
    field_key: "referral.email",
    label: "Email",
    section: "person",
    value_type: "string",
    review_tier: "optional",
    extraction_hints: ["email", "contact by email"],
    preferred_page_classes: ["demographics"],
  },
  {
    field: "address",
    field_key: "referral.address",
    label: "Current address",
    section: "person",
    value_type: "text",
    review_tier: "standard",
    extraction_hints: ["physical address", "mailing address", "current address"],
    preferred_page_classes: ["demographics"],
  },
  {
    field: "emergencyContact",
    field_key: "referral.emergency_contact",
    label: "Emergency contact",
    section: "person",
    value_type: "string",
    review_tier: "standard",
    extraction_hints: ["emergency contact", "responsible party", "guardian"],
    preferred_page_classes: ["demographics", "legal_consent"],
  },
  {
    field: "emergencyPhone",
    field_key: "referral.emergency_phone",
    label: "Emergency phone",
    section: "person",
    value_type: "string",
    review_tier: "standard",
    extraction_hints: ["emergency phone", "responsible party phone"],
    preferred_page_classes: ["demographics", "legal_consent"],
  },
  {
    field: "diagnosis",
    field_key: "referral.primary_diagnosis",
    label: "Primary diagnosis",
    section: "clinical",
    value_type: "text",
    review_tier: "critical",
    packet_preview: true,
    required_for_review: true,
    extraction_hints: ["diagnosis", "diagnoses", "diagnostic impression", "problem list"],
    preferred_page_classes: ["diagnosis_problem_list", "assessment", "demographics"],
  },
  {
    field: "symptoms",
    field_key: "referral.presenting_symptoms",
    label: "Presenting symptoms",
    section: "clinical",
    value_type: "text",
    review_tier: "critical",
    extraction_hints: ["history of present illness", "presenting problem", "symptoms"],
    preferred_page_classes: ["assessment", "risk_safety"],
  },
  {
    field: "riskLevel",
    field_key: "referral.risk_level",
    label: "Risk level",
    section: "clinical",
    value_type: "select",
    review_tier: "critical",
    options: ["Low", "Moderate", "High", "Critical"],
    extraction_hints: ["risk", "acute risk", "danger to self", "danger to others", "grave disability"],
    preferred_page_classes: ["risk_safety", "assessment"],
  },
  {
    field: "suicidalIdeation",
    field_key: "referral.suicidal_ideation",
    label: "Suicidal ideation",
    section: "clinical",
    value_type: "boolean",
    review_tier: "critical",
    extraction_hints: ["suicidal ideation", "SI", "danger to self"],
    preferred_page_classes: ["risk_safety", "assessment"],
  },
  {
    field: "homicidalIdeation",
    field_key: "referral.homicidal_ideation",
    label: "Homicidal ideation",
    section: "clinical",
    value_type: "boolean",
    review_tier: "critical",
    extraction_hints: ["homicidal ideation", "HI", "danger to others"],
    preferred_page_classes: ["risk_safety", "assessment"],
  },
  {
    field: "substanceUse",
    field_key: "referral.substance_use",
    label: "Substance use concerns",
    section: "clinical",
    value_type: "boolean",
    review_tier: "critical",
    extraction_hints: ["substance use", "UDS", "toxicology", "methamphetamine", "alcohol"],
    preferred_page_classes: ["assessment", "risk_safety", "allergies_medical"],
  },
  {
    field: "substanceDetails",
    field_key: "referral.substance_details",
    label: "Substance use details",
    section: "clinical",
    value_type: "text",
    review_tier: "standard",
    extraction_hints: ["substance history", "toxicology details", "UDS details"],
    preferred_page_classes: ["assessment", "allergies_medical"],
  },
  {
    field: "currentMedications",
    field_key: "referral.current_medications",
    label: "Current medications",
    section: "clinical",
    value_type: "text",
    review_tier: "critical",
    packet_preview: true,
    required_for_review: true,
    extraction_hints: ["current medications", "medication list", "active meds", "MAR"],
    preferred_page_classes: ["medication_list", "assessment"],
  },
  {
    field: "allergies",
    field_key: "referral.allergies",
    label: "Allergies",
    section: "clinical",
    value_type: "text",
    review_tier: "critical",
    extraction_hints: ["allergies", "med allergies", "NKDA"],
    preferred_page_classes: ["allergies_medical", "assessment", "demographics"],
  },
  {
    field: "medicalConditions",
    field_key: "referral.medical_conditions",
    label: "Medical conditions",
    section: "clinical",
    value_type: "text",
    review_tier: "standard",
    extraction_hints: ["medical history", "general medical condition", "problem list"],
    preferred_page_classes: ["allergies_medical", "diagnosis_problem_list", "assessment"],
  },
  {
    field: "source",
    field_key: "referral.source",
    label: "Referral source",
    section: "referral_source",
    value_type: "select",
    review_tier: "standard",
    packet_preview: true,
    required_for_review: true,
    options: ["Hospital discharge", "Family direct", "Physician referral", "Community partner", "Self referral"],
    extraction_hints: ["referral source", "source", "hospital", "family", "physician"],
    preferred_page_classes: ["demographics", "assessment"],
  },
  {
    field: "referringProvider",
    field_key: "referral.referring_provider",
    label: "Referring provider",
    section: "referral_source",
    value_type: "string",
    review_tier: "standard",
    packet_preview: true,
    required_for_review: true,
    extraction_hints: ["referring provider", "physician", "employee name", "assessor"],
    preferred_page_classes: ["assessment", "demographics"],
  },
  {
    field: "referringFacility",
    field_key: "referral.referring_facility",
    label: "Referring facility",
    section: "referral_source",
    value_type: "string",
    review_tier: "standard",
    packet_preview: true,
    required_for_review: true,
    extraction_hints: ["facility", "program", "hospital", "clinic", "location"],
    preferred_page_classes: ["assessment", "demographics"],
  },
  {
    field: "referringPhone",
    field_key: "referral.referring_phone",
    label: "Referring phone",
    section: "referral_source",
    value_type: "string",
    review_tier: "optional",
    extraction_hints: ["referring phone", "facility phone", "provider phone"],
    preferred_page_classes: ["demographics"],
  },
  {
    field: "priority",
    field_key: "referral.priority",
    label: "Priority",
    section: "referral_source",
    value_type: "select",
    review_tier: "standard",
    options: ["low", "medium", "high"],
    extraction_hints: ["priority", "urgency", "acute risk"],
    preferred_page_classes: ["assessment", "risk_safety"],
  },
  {
    field: "legalStatus",
    field_key: "referral.legal_status",
    label: "Legal status",
    section: "clinical",
    value_type: "select",
    review_tier: "critical",
    options: ["voluntary", "hold", "conservatorship"],
    extraction_hints: ["legal status", "hold", "5150", "conservatorship", "voluntary"],
    preferred_page_classes: ["legal_consent", "risk_safety", "assessment"],
  },
  {
    field: "medicalClearance",
    field_key: "referral.medical_clearance",
    label: "Medical clearance",
    section: "clinical",
    value_type: "select",
    review_tier: "critical",
    packet_preview: true,
    required_for_review: true,
    options: ["pending", "requested", "complete"],
    extraction_hints: ["medical clearance", "cleared", "pending labs", "clearance requested"],
    preferred_page_classes: ["allergies_medical", "assessment"],
  },
  {
    field: "packetStatus",
    field_key: "referral.packet_status",
    label: "Packet status",
    section: "packet_details",
    value_type: "select",
    review_tier: "standard",
    options: ["missing", "partial", "ready for review"],
    extraction_hints: ["computed from required extracted fields and missing packet items"],
    preferred_page_classes: ["unknown"],
  },
  {
    field: "packetSummary",
    field_key: "referral.packet_summary",
    label: "Packet summary",
    section: "packet_details",
    value_type: "text",
    review_tier: "standard",
    packet_preview: true,
    required_for_review: true,
    extraction_hints: ["brief summary of documents received and extraction gaps"],
    preferred_page_classes: ["assessment", "demographics", "medication_list", "risk_safety"],
  },
  {
    field: "releaseOnFile",
    field_key: "referral.release_on_file",
    label: "Release on file",
    section: "packet_details",
    value_type: "boolean",
    review_tier: "standard",
    extraction_hints: ["release of information", "ROI", "release on file", "signed statement"],
    preferred_page_classes: ["legal_consent", "demographics"],
  },
  {
    field: "medListReceived",
    field_key: "referral.med_list_received",
    label: "Medication list received",
    section: "packet_details",
    value_type: "boolean",
    review_tier: "critical",
    extraction_hints: ["medication list page exists", "MAR exists", "active meds found"],
    preferred_page_classes: ["medication_list"],
  },
  {
    field: "clinicalNotesReceived",
    field_key: "referral.clinical_notes_received",
    label: "Clinical notes received",
    section: "packet_details",
    value_type: "boolean",
    review_tier: "standard",
    extraction_hints: ["clinical note exists", "assessment exists", "history of present illness"],
    preferred_page_classes: ["assessment", "risk_safety"],
  },
  {
    field: "preferredAdmissionDate",
    field_key: "referral.preferred_admission_date",
    label: "Preferred admit date",
    section: "referral_source",
    value_type: "date",
    review_tier: "optional",
    extraction_hints: ["preferred admit date", "target admission date", "admission date"],
    preferred_page_classes: ["assessment", "demographics"],
  },
  {
    field: "notes",
    field_key: "referral.notes",
    label: "Additional intake notes",
    section: "packet_details",
    value_type: "text",
    review_tier: "optional",
    extraction_hints: ["important coordinator notes derived from packet"],
    preferred_page_classes: ["assessment", "risk_safety"],
  },
  {
    field: "specialNeeds",
    field_key: "referral.special_needs",
    label: "Special needs / placement notes",
    section: "referral_source",
    value_type: "text",
    review_tier: "standard",
    extraction_hints: ["special needs", "mobility", "behavioral support", "placement notes"],
    preferred_page_classes: ["assessment", "allergies_medical", "risk_safety"],
  },
];

export const assessmentPacketExtractionFields: ReadonlyArray<
  ExtractionFieldDefinition<AssessmentPacketFieldKey>
> = [
  {
    field: "presentingNeeds",
    field_key: "assessment.presenting_needs",
    label: assessmentPacketFieldLabels.presentingNeeds,
    section: "assessment_packet",
    value_type: "text",
    review_tier: "critical",
    required_for_review: true,
    extraction_hints: ["presenting needs", "history of present illness", "reason for admission"],
    preferred_page_classes: ["assessment", "risk_safety"],
  },
  {
    field: "levelOfCare",
    field_key: "assessment.level_of_care",
    label: assessmentPacketFieldLabels.levelOfCare,
    section: "assessment_packet",
    value_type: "string",
    review_tier: "critical",
    required_for_review: true,
    extraction_hints: ["level of care", "recommended placement", "residential", "inpatient"],
    preferred_page_classes: ["assessment"],
  },
  {
    field: "mobility",
    field_key: "assessment.mobility",
    label: assessmentPacketFieldLabels.mobility,
    section: "assessment_packet",
    value_type: "text",
    review_tier: "standard",
    required_for_review: true,
    extraction_hints: ["mobility", "ADL", "ambulation", "walker", "standby assist"],
    preferred_page_classes: ["assessment", "allergies_medical"],
  },
  {
    field: "behaviors",
    field_key: "assessment.behaviors",
    label: assessmentPacketFieldLabels.behaviors,
    section: "assessment_packet",
    value_type: "text",
    review_tier: "critical",
    required_for_review: true,
    extraction_hints: ["behavior", "aggression", "agitation", "observation", "safety"],
    preferred_page_classes: ["assessment", "risk_safety"],
  },
  {
    field: "medicationCount",
    field_key: "assessment.medication_count",
    label: assessmentPacketFieldLabels.medicationCount,
    section: "assessment_packet",
    value_type: "string",
    review_tier: "standard",
    required_for_review: true,
    extraction_hints: ["count active medications from med list", "active meds"],
    preferred_page_classes: ["medication_list"],
  },
  {
    field: "riskNotes",
    field_key: "assessment.risk_notes",
    label: assessmentPacketFieldLabels.riskNotes,
    section: "assessment_packet",
    value_type: "text",
    review_tier: "critical",
    required_for_review: true,
    extraction_hints: ["risk notes", "danger to self", "danger to others", "grave disability", "SI", "HI"],
    preferred_page_classes: ["risk_safety", "assessment"],
  },
  {
    field: "admissionDecision",
    field_key: "assessment.admission_decision",
    label: assessmentPacketFieldLabels.admissionDecision,
    section: "assessment_packet",
    value_type: "text",
    review_tier: "critical",
    required_for_review: true,
    extraction_hints: ["admission decision", "disposition", "recommendation", "admit", "decline"],
    preferred_page_classes: ["assessment"],
  },
  {
    field: "communityPreference",
    field_key: "assessment.community_preference",
    label: assessmentPacketFieldLabels.communityPreference,
    section: "assessment_packet",
    value_type: "string",
    review_tier: "standard",
    required_for_review: true,
    extraction_hints: ["community preference", "preferred placement", "location"],
    preferred_page_classes: ["assessment", "demographics"],
  },
  {
    field: "guardianContact",
    field_key: "assessment.guardian_contact",
    label: assessmentPacketFieldLabels.guardianContact,
    section: "assessment_packet",
    value_type: "text",
    review_tier: "standard",
    required_for_review: true,
    extraction_hints: ["guardian", "family contact", "responsible party", "payee"],
    preferred_page_classes: ["demographics", "legal_consent"],
  },
  {
    field: "medicalHistory",
    field_key: "assessment.medical_history",
    label: assessmentPacketFieldLabels.medicalHistory,
    section: "assessment_packet",
    value_type: "text",
    review_tier: "standard",
    required_for_review: true,
    extraction_hints: ["medical history", "medical conditions", "problem list"],
    preferred_page_classes: ["assessment", "diagnosis_problem_list", "allergies_medical"],
  },
];

const assessmentContextFields = new Set<AssessmentToolFieldKey>([
  "source_file",
  "match_confidence",
  "extraction_date",
]);

/**
 * Canonical assessment extraction contract. Process metadata is supplied by
 * the extraction job, so it is intentionally excluded from model targets.
 */
export const assessmentToolExtractionFields: ReadonlyArray<
  ExtractionFieldDefinition<AssessmentToolFieldKey>
> = assessmentToolFieldDefinitions
  .filter((definition) => !assessmentContextFields.has(definition.key))
  .map((definition) => ({
    field: definition.key,
    field_key: `assessment_tool.${definition.key}`,
    label: definition.label,
    section: "assessment_packet",
    value_type: assessmentExtractionValueType(definition),
    review_tier: assessmentReviewTier(definition),
    required_for_review: definition.required_for_completion,
    extraction_hints: Array.from(new Set([
      definition.label,
      definition.key.replaceAll("_", " "),
      ...definition.extraction_aliases,
    ])),
    preferred_page_classes: assessmentPageClasses(definition.section),
  }));

/** Initial referral creation extracts only intake data. */
export const referralPacketExtractionTargets = [
  ...referralIntakeExtractionFields,
] as const;

/** Assessment extraction runs later from the client/referral canvas. */
export const assessmentWorkbookExtractionTargets = [
  ...assessmentToolExtractionFields,
] as const;

function assessmentExtractionValueType(
  definition: AssessmentToolFieldDefinition,
): ExtractionValueType {
  if (definition.value_type === "date") return "date";
  if (definition.value_type === "integer" || definition.value_type === "confidence") return "number";
  if (definition.value_type === "string") return "string";
  return "text";
}

function assessmentReviewTier(
  definition: AssessmentToolFieldDefinition,
): ReviewTier {
  if (definition.required_for_completion) return "critical";
  if ([
    "diagnosis_clinical",
    "behavioral_risk",
    "legal_conservatorship",
    "medication",
  ].includes(definition.section)) return "critical";
  if (definition.section === "provenance_qc") return "optional";
  return "standard";
}

function assessmentPageClasses(
  section: AssessmentToolFieldDefinition["section"],
): readonly PacketPageClass[] {
  const classes: Record<AssessmentToolFieldDefinition["section"], readonly PacketPageClass[]> = {
    identity: ["demographics", "assessment"],
    prior_placement: ["assessment", "demographics"],
    prior_history: ["assessment", "risk_safety"],
    diagnosis_clinical: ["diagnosis_problem_list", "assessment"],
    functional_adl: ["assessment", "allergies_medical"],
    behavioral_risk: ["risk_safety", "assessment"],
    legal_conservatorship: ["legal_consent", "risk_safety", "assessment"],
    medication: ["medication_list", "assessment"],
    substance_use: ["assessment", "risk_safety"],
    social_support: ["assessment", "demographics", "legal_consent"],
    provenance_qc: ["assessment"],
  };
  return classes[section];
}

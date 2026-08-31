import {
  assessmentToolFieldDefinitions,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "./assessment-tool-schema";
import { assessmentInterviewQuestions } from "./assessment-interview-schema";

export type AssessmentNarrativeGuideDomain =
  | "behavioral_risk"
  | "clinical"
  | "functional"
  | "legal"
  | "medication"
  | "physical_health"
  | "placement"
  | "social_support"
  | "substance_use";

export type AssessmentNarrativePurpose =
  | "behavior_pattern"
  | "benefits_status"
  | "clinical_presentation"
  | "communication_support"
  | "crisis_history"
  | "daily_support"
  | "diagnostic_record"
  | "health_support"
  | "legal_status"
  | "medication_reconciliation"
  | "perceptual_experience"
  | "perceptual_response"
  | "placement_preferences"
  | "placement_trajectory"
  | "safety_history"
  | "social_support"
  | "substance_pattern"
  | "supplemental_context"
  | "treatment_participation";

export type AssessmentNarrativeGuide = {
  field: AssessmentToolFieldKey;
  label: string;
  domain: AssessmentNarrativeGuideDomain;
  purposeTrack: AssessmentNarrativePurpose;
  purpose: string;
  reviewQuestion: string;
  thingsToCover: readonly string[];
  strongPattern: string;
  guardrail: string;
};

type PurposeGuide = Pick<
  AssessmentNarrativeGuide,
  "purpose" | "reviewQuestion" | "thingsToCover" | "strongPattern"
>;

const definitionsByField = new Map(
  assessmentToolFieldDefinitions.map((definition) => [definition.key, definition]),
);
const questionsByField = new Map(
  assessmentInterviewQuestions.map((question) => [question.field, question]),
);

const domainBySection: Record<AssessmentToolSection, AssessmentNarrativeGuideDomain> = {
  identity: "clinical",
  prior_placement: "placement",
  prior_history: "placement",
  diagnosis_clinical: "clinical",
  functional_adl: "functional",
  legal_conservatorship: "legal",
  medication: "medication",
  substance_use: "substance_use",
  behavioral_risk: "behavioral_risk",
  physical_health: "physical_health",
  social_support: "social_support",
  provenance_qc: "clinical",
};

const purposeGuides: Record<AssessmentNarrativePurpose, PurposeGuide> = {
  behavior_pattern: {
    purpose: "Describe observable behavior as a pattern: what happened, when, what preceded it, what followed, and what support changed the outcome.",
    reviewQuestion: "Could another assessor understand the current pattern, severity, triggers, and effective response without relying on a label?",
    thingsToCover: [
      "Most recent event and frequency within a stated timeframe",
      "Antecedent or trigger, observable behavior, and outcome",
      "Injury, intervention, consequence, or effect on placement",
      "What de-escalates the behavior and who supplied the information",
    ],
    strongPattern: "Per [source], the most recent [observable behavior] occurred [timeframe]. It typically follows [trigger] and results in [outcome/impact]. [Support] has [observed effect].",
  },
  benefits_status: {
    purpose: "Record the current benefit and income picture, who manages it, and what action is needed before transition.",
    reviewQuestion: "Does the answer identify each benefit, current status, verified source, payee or manager, and unresolved application or reinstatement step?",
    thingsToCover: [
      "Benefit or income type and active, suspended, pending, or unknown status",
      "Amount only when verified and relevant to planning",
      "Payee, account manager, or responsible contact",
      "Application, reinstatement, document, or follow-up still needed",
    ],
    strongPattern: "Per [source], [benefit/income] is [current status] as of [date/timeframe]. [Payee/contact] manages [specific responsibility]. [Document/action] is needed before [transition milestone].",
  },
  clinical_presentation: {
    purpose: "Capture the current presentation with client report, direct observation, and collateral information clearly separated.",
    reviewQuestion: "Does the answer state what is current, how often it occurs, how it affects function, and which source supports each fact?",
    thingsToCover: [
      "Direct observation during this assessment",
      "Client-reported symptom, onset, frequency, duration, and severity",
      "Functional effect and change from baseline",
      "Collateral agreement, conflict, and information not yet verified",
    ],
    strongPattern: "During the assessment, [observation]. The client reports [experience] since [timeframe], occurring [frequency] and affecting [function]. Per [collateral source], [corroborating/conflicting fact].",
  },
  communication_support: {
    purpose: "Describe the observed communication barrier or thought-process difficulty and the accommodation needed for a reliable assessment.",
    reviewQuestion: "Does the answer use an observable example, distinguish language from thought process, and identify the support that improves understanding?",
    thingsToCover: [
      "Observed communication pattern with a concrete example",
      "Language, hearing, cognition, speech, or thought-process factor involved",
      "Effect on comprehension, expression, consent, or interview reliability",
      "Interpreter, pacing, repetition, device, or other accommodation used",
    ],
    strongPattern: "During the assessment, [observable communication pattern]. This affected [comprehension/expression/reliability]. With [interpreter/accommodation], the client [observed response]. [Remaining limitation] is documented.",
  },
  crisis_history: {
    purpose: "Build a dated crisis-use history that distinguishes verified events from estimates and explains what led to each level of care.",
    reviewQuestion: "Can the reader identify when the event occurred, why crisis care was used, the outcome, and the source?",
    thingsToCover: [
      "Event type, date or bounded timeframe, and location",
      "Presenting concern and legal hold type when verified",
      "Disposition, length of stay, and change after intervention",
      "Record source plus any missing or conflicting history",
    ],
    strongPattern: "Per [record/source], [event or hold] occurred [date/timeframe] for [presenting concern]. The outcome was [disposition/change]. [Specific history] remains unverified.",
  },
  daily_support: {
    purpose: "State exactly what the client can do, what assistance is required, how often, and what equipment or cueing makes the task safe.",
    reviewQuestion: "Would staff know the exact task, assistance level, frequency, and safety consideration from this answer?",
    thingsToCover: [
      "Specific task and whether ability was observed or reported",
      "Independent, cueing, partial assistance, or total assistance",
      "Frequency, device, transfer, communication, or fall concern",
      "Baseline, recent change, and support that improves success",
    ],
    strongPattern: "[Observation/source] indicates the client can [task] with [assistance level] [frequency]. [Cue/device/support] is required for [specific step or safety need]. This is [stable/changed] from baseline.",
  },
  diagnostic_record: {
    purpose: "Record diagnoses as attributed data rather than clinical inference, with the source and verification status preserved.",
    reviewQuestion: "Is each diagnosis tied to a qualified source or record, with uncertainty and discrepancies made visible?",
    thingsToCover: [
      "Exact diagnosis wording and source",
      "Date or recency of the supporting record when available",
      "Active versus historical status if the source distinguishes it",
      "Conflicting records or diagnoses still awaiting verification",
    ],
    strongPattern: "[Source document/clinician] lists [diagnosis] as of [date/timeframe]. [Second source] [agrees/differs]. [Item] is not yet verified and is not presented as a new diagnosis.",
  },
  health_support: {
    purpose: "Describe current physical-health status and the concrete monitoring, equipment, diet, or nursing support needed for safe placement.",
    reviewQuestion: "Does the answer connect the current condition to treatment, support needs, function, and follow-up without interpreting medical data?",
    thingsToCover: [
      "Condition or symptom, current status, and change from baseline",
      "Treatment, monitoring, diet, equipment, wound, or nursing support",
      "Effect on mobility, self-care, sleep, or participation",
      "Information source and follow-up still required",
    ],
    strongPattern: "Per [source], [condition/symptom] is currently [status]. It affects [function]. Current support is [specific treatment/monitoring/equipment]. [Record/follow-up] is still needed.",
  },
  legal_status: {
    purpose: "Record the verified legal status, dates, jurisdiction, conditions, and responsible contacts without turning allegations into findings.",
    reviewQuestion: "Can the reader distinguish verified status and requirements from reported or missing information?",
    thingsToCover: [
      "Exact status, event, charge, or requirement and jurisdiction",
      "Relevant dates, current conditions, and supervision",
      "Source document or collateral contact",
      "Expired, conflicting, alleged, or missing information",
    ],
    strongPattern: "Per [document/source], [status/event] in [jurisdiction] is effective/occurred [date]. Current requirements are [specific conditions]. [Document/contact] is needed to verify [gap].",
  },
  medication_reconciliation: {
    purpose: "Create a medication account that can be reconciled safely against the MAR, pharmacy, or prescriber record.",
    reviewQuestion: "Are medication details, PRN use, source, effects, and reconciliation gaps precise enough for a safe handoff?",
    thingsToCover: [
      "Name, dose, route, frequency, indication when documented, and source",
      "PRN trigger, frequency of use, observed effect, and adverse effect",
      "Long-acting injection date or monitoring requirement when applicable",
      "Discrepancies requiring pharmacy or prescriber confirmation",
    ],
    strongPattern: "Per [MAR/pharmacy/client], [medication, dose, route, frequency]. [PRN/LAI detail] occurred [timeframe] with [effect]. [Discrepancy] requires reconciliation with [source].",
  },
  perceptual_experience: {
    purpose: "Describe the person's reported perceptual experience, recency, frequency, context, and meaning without validating or dismissing the content.",
    reviewQuestion: "Does the answer preserve the client's account while clarifying type, frequency, recency, trigger, distress, and safety relevance?",
    thingsToCover: [
      "Client-described experience in neutral language",
      "Most recent occurrence, frequency, duration, and trigger",
      "Command content or safety relevance when reported",
      "Observed response, source, uncertainty, and conflicting collateral",
    ],
    strongPattern: "The client reports [experience], most recently [timeframe], occurring [frequency/context]. The experience [does/does not] include [safety-relevant content] and causes [distress/impact]. [Observation/collateral] is documented separately.",
  },
  perceptual_response: {
    purpose: "Explain how perceptual symptoms affect daily function and which coping strategies or treatments have helped, failed, or remain untested.",
    reviewQuestion: "Does the answer connect symptoms to distress and function, then identify a specific response and observed outcome?",
    thingsToCover: [
      "Distress level and effect on sleep, self-care, participation, or safety",
      "Coping response used by the client",
      "Staff, medication, or environmental support tried",
      "Observed outcome, treatment history, and unresolved need",
    ],
    strongPattern: "When [experience] occurs, it affects [function/distress]. The client uses [coping response], while [support/treatment] has [observed outcome]. [Need or uncertainty] remains.",
  },
  placement_preferences: {
    purpose: "Capture the client's own placement goals, preferences, concerns, and tradeoffs so they can guide planning rather than be inferred by staff.",
    reviewQuestion: "Does the answer make the client's preference, reason, priority, concern, and realistic support need clear?",
    thingsToCover: [
      "Client-stated goal or preferred characteristic",
      "Reason the preference matters to the client",
      "Concerns, deal breakers, and acceptable alternatives",
      "Support or condition needed to make the plan workable",
    ],
    strongPattern: "The client prefers [setting/characteristic] because [stated reason]. Their primary concern is [concern], and they would consider [alternative] if [support/condition] is available.",
  },
  placement_trajectory: {
    purpose: "Explain where the client lived, how long, why each setting ended, and what conditions supported or undermined stability.",
    reviewQuestion: "Does the answer identify the setting, timeframe, reason it ended, source, and lesson for the next placement?",
    thingsToCover: [
      "Setting type and bounded dates or duration",
      "Specific reason the placement ended or changed",
      "Behavioral, care, environmental, or housing factor involved",
      "Support that worked plus source disagreement or missing history",
    ],
    strongPattern: "The client lived at [setting type] for [duration]. Per [source], it ended because [specific reason]. [Support] improved stability, while [factor] created difficulty. [Gap/conflict] remains.",
  },
  safety_history: {
    purpose: "Document current and historical safety concerns with precise recency, intent, behavior, protective factors, and active precautions.",
    reviewQuestion: "Can the reader distinguish current ideation or behavior from history and identify the present safety response?",
    thingsToCover: [
      "Current versus historical status and most recent event",
      "Ideation, intent, plan, means, behavior, and injury only as assessed",
      "Trigger, intervention, protective factor, and response",
      "Active precaution, responsible clinician, and unresolved uncertainty",
    ],
    strongPattern: "The client [reports/denies] [specific concern] currently. The most recent [event] was [timeframe] and involved [observable detail]. Protective factors include [factor]; current measures are [specific action/source].",
  },
  social_support: {
    purpose: "Describe who is involved, how reliably they participate, what support they provide, and what the client has authorized.",
    reviewQuestion: "Does the answer identify the relationship, contact pattern, practical role, reliability, consent, and any conflict?",
    thingsToCover: [
      "Relationship and contact frequency",
      "Practical, emotional, financial, or transition support provided",
      "Reliability, willingness, and client consent",
      "Conflict, boundary, or information that remains uncertain",
    ],
    strongPattern: "The client identifies [relationship] with contact [frequency]. This person assists with [specific support] and has [confirmed/not confirmed] willingness. [Consent/conflict/gap] remains.",
  },
  substance_pattern: {
    purpose: "Describe the substance-use pattern and its observed relationship to symptoms, function, safety, treatment, and recovery supports.",
    reviewQuestion: "Does the answer separate current from historical use and connect pattern, impact, insight, treatment, and source?",
    thingsToCover: [
      "Substance, amount or route when known, frequency, and last use",
      "Specific effect on symptoms, housing, function, treatment, or safety",
      "Treatment, withdrawal, overdose, sobriety, relapse, and support history",
      "Client insight, collateral disagreement, and unknowns",
    ],
    strongPattern: "The client reports [substance/pattern], last used [timeframe]. Use is associated with [specific impact]. [Treatment/support] resulted in [outcome]. Collateral [agrees/differs], and [gap] remains.",
  },
  supplemental_context: {
    purpose: "Add only decision-relevant information that is not already captured elsewhere, with a clear source and next action when one is needed.",
    reviewQuestion: "Is this information new, attributable, relevant to assessment or placement, and free of duplicated narrative?",
    thingsToCover: [
      "The specific unanswered question or new fact",
      "Why it matters to assessment, placement, or follow-up",
      "Source and verification status",
      "Owner and next action when information is still needed",
    ],
    strongPattern: "[Source] adds [new fact], which matters because [assessment/placement relevance]. [Item] is not yet verified; [role] will [next action] by [timeframe].",
  },
  treatment_participation: {
    purpose: "Describe actual communication, interaction, and program participation patterns rather than broad judgments about cooperation.",
    reviewQuestion: "Does the answer use observable examples, frequency, context, impact, and effective support?",
    thingsToCover: [
      "Observable interaction or participation behavior",
      "Frequency, setting, and whether the pattern is current",
      "Effect on peers, staff, treatment, or daily routine",
      "Prompt, accommodation, or support that changes the outcome",
    ],
    strongPattern: "Per [observation/source], the client [observable interaction/participation] [frequency/context]. This affects [treatment/function]. With [prompt/accommodation], the client [observed response].",
  },
};

const trackAssignments: ReadonlyArray<{
  track: AssessmentNarrativePurpose;
  fields: readonly AssessmentToolFieldKey[];
}> = [
  { track: "placement_trajectory", fields: ["prior_placements", "prior_awol_failed_placements", "prior_living_situation", "housing_history"] },
  { track: "crisis_history", fields: ["prior_5150_5250_holds", "crisis_er_utilization"] },
  { track: "diagnostic_record", fields: ["secondary_diagnoses"] },
  { track: "clinical_presentation", fields: ["current_symptoms", "cognition_orientation"] },
  { track: "communication_support", fields: ["language_barrier_details", "linear_conversation_details"] },
  { track: "daily_support", fields: ["dress_assistance_details", "bathing_assistance_details", "adl_needs", "mobility"] },
  { track: "treatment_participation", fields: ["peer_interaction_notes", "staff_interaction_notes", "programming_notes"] },
  { track: "legal_status", fields: ["forensic_involvement_details", "arrest_last_two_years_details", "court_requirements", "court_dates", "probation_parole_justice"] },
  { track: "medication_reconciliation", fields: ["medications_at_intake", "prn_patterns"] },
  { track: "substance_pattern", fields: ["substance_effect_on_baseline", "substance_use_insight_details", "treatment_history"] },
  { track: "behavior_pattern", fields: ["behavioral_history", "triggers", "physical_altercation_details", "last_assault_details", "elopement_risk", "aggression_risk"] },
  { track: "safety_history", fields: ["last_self_harm_incident", "current_self_harm_details", "current_safety_measures", "si_hi_history"] },
  { track: "perceptual_experience", fields: ["auditory_hallucination_nature", "auditory_hallucination_triggers", "visual_hallucination_details", "visual_hallucination_recent", "olfactory_hallucination_details", "olfactory_hallucination_impact", "tactile_hallucination_details", "gustatory_hallucination_details"] },
  { track: "perceptual_response", fields: ["hallucination_coping_strategies", "hallucination_distress_impairment", "hallucination_functional_impact", "hallucination_treatment_history"] },
  { track: "health_support", fields: ["physical_health_diagnoses", "physical_health_measures", "diabetic_details", "special_diet_details", "skin_integrity_details", "additional_health_notes"] },
  { track: "social_support", fields: ["family_involvement", "friendships_social_connections"] },
  { track: "benefits_status", fields: ["benefits_income_status"] },
  { track: "placement_preferences", fields: ["preferred_facility_characteristics", "discharge_planning_goals", "placement_preferences_concerns"] },
  { track: "supplemental_context", fields: ["additional_information", "placement_process_questions"] },
];

const purposeByField = buildPurposeMap(trackAssignments);

const domainGuardrails: Record<AssessmentNarrativeGuideDomain, string> = {
  behavioral_risk: "Do not infer intent, dangerousness, or a diagnosis. Preserve denials, uncertainty, and current-versus-historical distinctions.",
  clinical: "Use objective language. Do not add diagnoses, causes, quotations, or certainty that the assessor did not document.",
  functional: "Do not convert a single observation into a permanent ability level or omit the source of reported limitations.",
  legal: "Do not guess legal status or present allegations as findings. Attribute and date all legal information.",
  medication: "Never recommend, discontinue, or change medication. Preserve exact units and distinguish verified records from client recall.",
  physical_health: "Do not diagnose, interpret tests, or recommend treatment. Use the organization's escalation process for urgent concerns.",
  placement: "Avoid labels such as 'failed placement' without describing the observable reason, timeframe, and source.",
  social_support: "Do not assume willingness, capacity, consent, or reliability beyond what was reported or verified.",
  substance_use: "Use non-stigmatizing language and do not convert suspicion or collateral history into confirmed current use.",
};

export function isCoachableAssessmentField(field: string): field is AssessmentToolFieldKey {
  const question = questionsByField.get(field as AssessmentToolFieldKey);
  const definition = definitionsByField.get(field as AssessmentToolFieldKey);
  return Boolean(question?.control === "textarea" && definition && ["string", "string_list"].includes(definition.value_type));
}

export function getAssessmentNarrativeGuide(field: AssessmentToolFieldKey): AssessmentNarrativeGuide | null {
  if (!isCoachableAssessmentField(field)) return null;
  const definition = definitionsByField.get(field);
  const purposeTrack = purposeByField.get(field);
  if (!definition || !purposeTrack) return null;
  const domain = domainBySection[definition.section];
  return {
    field,
    label: definition.label,
    domain,
    purposeTrack,
    ...purposeGuides[purposeTrack],
    guardrail: domainGuardrails[domain],
  };
}

export function getAssessmentNarrativeGuideCoverage() {
  const coachableFields = assessmentInterviewQuestions
    .filter((question) => isCoachableAssessmentField(question.field))
    .map((question) => question.field);
  const missingFields = coachableFields.filter((field) => !purposeByField.has(field));
  return {
    coachableFields,
    coveredFields: coachableFields.filter((field) => purposeByField.has(field)),
    missingFields,
  };
}

function buildPurposeMap(assignments: typeof trackAssignments) {
  const result = new Map<AssessmentToolFieldKey, AssessmentNarrativePurpose>();
  for (const assignment of assignments) {
    for (const field of assignment.fields) {
      if (result.has(field)) throw new Error(`Assessment narrative field ${field} has more than one purpose track.`);
      result.set(field, assignment.track);
    }
  }
  return result;
}

const coverage = getAssessmentNarrativeGuideCoverage();
if (coverage.missingFields.length > 0) {
  throw new Error(`Assessment narrative guidance is missing for: ${coverage.missingFields.join(", ")}`);
}

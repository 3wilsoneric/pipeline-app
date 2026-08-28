import {
  assessmentToolFieldDefinitions,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "./assessment-tool-schema";
import { assessmentInterviewQuestions } from "./assessment-interview-schema";

export type AssessmentNoteGuideDomain =
  | "behavioral_risk"
  | "clinical"
  | "functional"
  | "legal"
  | "medication"
  | "physical_health"
  | "placement"
  | "social_support"
  | "substance_use";

export type AssessmentNoteGuide = {
  field: AssessmentToolFieldKey;
  label: string;
  domain: AssessmentNoteGuideDomain;
  thingsToCover: readonly string[];
  strongPattern: string;
  guardrail: string;
};

const definitionsByField = new Map(
  assessmentToolFieldDefinitions.map((definition) => [definition.key, definition]),
);
const questionsByField = new Map(
  assessmentInterviewQuestions.map((question) => [question.field, question]),
);

const domainBySection: Record<AssessmentToolSection, AssessmentNoteGuideDomain> = {
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

const domainGuides: Record<AssessmentNoteGuideDomain, Omit<AssessmentNoteGuide, "field" | "label" | "domain">> = {
  behavioral_risk: {
    thingsToCover: [
      "Most recent event, frequency, severity, and whether the pattern is current",
      "Trigger or antecedent, observable behavior, outcome, and any injury or intervention",
      "Current safety measures, protective factors, and what reliably de-escalates the situation",
      "Who reported each fact and what remains unverified",
    ],
    strongPattern: "[Source] reports [specific behavior] [frequency/timeframe], usually after [trigger]. It affects [safety/function]. [Support] has helped. [Unknown] remains unverified.",
    guardrail: "Do not infer intent, dangerousness, or a diagnosis. Preserve denials, uncertainty, and current-versus-historical distinctions.",
  },
  clinical: {
    thingsToCover: [
      "Client report, direct observation, and collateral information kept distinct",
      "Onset, frequency, duration, severity, and change from baseline",
      "Effect on sleep, participation, self-care, relationships, or safety",
      "Current supports and any important unknown or conflicting account",
    ],
    strongPattern: "During interview, [observation]. The client reports [symptom/fact] since [timeframe], occurring [frequency] and affecting [function]. Collateral from [source type] adds [fact]. [Gap] is not yet verified.",
    guardrail: "Use objective language. Do not add diagnoses, causes, quotations, or certainty that the assessor did not document.",
  },
  functional: {
    thingsToCover: [
      "Exact task and whether performance was observed or reported",
      "Independent, cueing, partial assistance, or total assistance",
      "How often support is needed and any device, transfer, or fall concern",
      "Baseline ability, recent change, and supports that improve success",
    ],
    strongPattern: "[Source/observation] indicates the client [task ability]. They require [level/frequency of help] for [specific step]. [Device or cue] is effective. This is [stable/changed] from baseline.",
    guardrail: "Do not convert a single observation into a permanent ability level or omit the source of reported limitations.",
  },
  legal: {
    thingsToCover: [
      "Exact legal status, jurisdiction, and source document or collateral source",
      "Relevant dates, conditions, registration, supervision, or court requirements",
      "Current contact or responsible party when verified",
      "Conflicts, expired information, and documents still needed",
    ],
    strongPattern: "Per [verified source], the current status is [status] in [jurisdiction] effective [date]. Requirements include [specific condition]. [Document/contact] is still needed to verify [gap].",
    guardrail: "Do not guess legal status or present allegations as findings. Attribute and date all legal information.",
  },
  medication: {
    thingsToCover: [
      "Medication name, dose, route, frequency, and source of verification when available",
      "Adherence or refusal pattern with dates, frequency, stated reason, and consequence",
      "PRN use, long-acting injection schedule, side effects, and monitoring needs",
      "Reconciliation gaps or discrepancies that require pharmacy/prescriber confirmation",
    ],
    strongPattern: "Per [MAR/client/collateral], [medication details]. Over [timeframe], adherence is [pattern]; [refusal/PRN detail]. [Effect or side effect] was reported. [Gap] requires reconciliation.",
    guardrail: "Never recommend, discontinue, or change medication. Preserve exact units and distinguish verified MAR data from client recall.",
  },
  physical_health: {
    thingsToCover: [
      "Condition or symptom, current status, severity, and change from baseline",
      "Treatment, monitoring, diet, equipment, wound/skin, or nursing support needed",
      "Effect on mobility, self-care, sleep, participation, or placement needs",
      "Source of information and follow-up still required",
    ],
    strongPattern: "[Source] reports [condition/symptom] currently [status/severity]. It affects [function]. Current treatment/support is [specific support]. [Follow-up or record] is needed to verify [gap].",
    guardrail: "Do not diagnose, interpret tests, or recommend treatment. Document urgent concerns through the organization’s escalation process, not only in this note.",
  },
  placement: {
    thingsToCover: [
      "Setting, approximate dates or duration, and reason the placement ended",
      "Behaviors, incidents, care needs, or environmental factors tied to placement stability",
      "Supports that worked and conditions associated with success or failure",
      "Source and any discrepancy between client, facility, and record accounts",
    ],
    strongPattern: "The client lived at [setting type] for [duration]. Per [source], the placement ended because [specific reason]. [Support] helped with [need], while [factor] reduced stability. [Conflict/gap] remains.",
    guardrail: "Avoid labels such as ‘failed placement’ without describing the observable reason and source.",
  },
  social_support: {
    thingsToCover: [
      "Relationship, contact frequency, involvement, and reliability of support",
      "Client-stated goals, preferences, and concerns in the client’s own meaning",
      "Practical support available for appointments, finances, housing, or transition",
      "Consent, conflict, or information that remains uncertain",
    ],
    strongPattern: "The client identifies [relationship/support] with contact [frequency]. This person assists with [specific support]. The client prefers [goal/preference] because [stated reason]. [Gap/consent issue] remains.",
    guardrail: "Do not assume willingness, capacity, consent, or reliability beyond what was reported or verified.",
  },
  substance_use: {
    thingsToCover: [
      "Substance, route/amount when known, frequency, last use, and current versus historical use",
      "Effect on baseline symptoms, function, housing, treatment, or safety",
      "Withdrawal, overdose, treatment, longest sobriety, relapse pattern, and supports",
      "Client insight, collateral account, discrepancies, and unknowns",
    ],
    strongPattern: "The client reports [substance/pattern], last used [date/timeframe]. Use is associated with [specific impact]. [Treatment/support] led to [outcome]. Collateral [agrees/differs]; [gap] remains unverified.",
    guardrail: "Use non-stigmatizing language and do not convert suspicion or collateral history into confirmed current use.",
  },
};

export function isCoachableAssessmentField(field: string): field is AssessmentToolFieldKey {
  const question = questionsByField.get(field as AssessmentToolFieldKey);
  const definition = definitionsByField.get(field as AssessmentToolFieldKey);
  return Boolean(question?.control === "textarea" && definition && ["string", "string_list"].includes(definition.value_type));
}

export function getAssessmentNoteGuide(field: AssessmentToolFieldKey): AssessmentNoteGuide | null {
  if (!isCoachableAssessmentField(field)) return null;
  const definition = definitionsByField.get(field);
  if (!definition) return null;
  const domain = domainBySection[definition.section];
  return {
    field,
    label: definition.label,
    domain,
    ...domainGuides[domain],
  };
}

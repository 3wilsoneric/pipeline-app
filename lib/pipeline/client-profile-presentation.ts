import type { ClinicalClientRecord } from "@/lib/clinical/clinical-contracts";

export type ClientProfileFact = {
  label: string;
  value: string;
};

export type ClientProfileSection = {
  key: string;
  label: string;
  facts: ClientProfileFact[];
};

export type ClientEpisodeSummary = {
  key: string;
  period: string;
  community: string;
  facts: ClientProfileFact[];
};

type FieldDefinition = {
  label: string;
  sources: string[];
  excludeSources?: string[];
  format?: "date" | "count" | "percent";
  maxItems?: number;
};

type SectionDefinition = {
  key: string;
  label: string;
  fields: FieldDefinition[];
};

const technicalObjectKeys = /^(source|sources|source_file|source_page|page|page_number|confidence|match_confidence|completion_status|review_status|evidence|created_at|updated_at|enriched_at|loaded_at|load_id|document_id|canonical_client_id)$/i;
const preferredObjectKeys = [
  "display_value",
  "normalized_value",
  "fact_value",
  "value",
  "text",
  "name",
  "label",
];

const profileSections: SectionDefinition[] = [
  {
    key: "personal",
    label: "Personal details",
    fields: [
      { label: "Resident number", sources: ["resident_number", "resident_numbers"], maxItems: 4 },
      { label: "Date of birth", sources: ["date_of_birth"], format: "date" },
      { label: "Age", sources: ["age"], format: "count" },
      { label: "Also known as", sources: ["name_variants", "platform_resident_names"], excludeSources: ["resident_name", "display_name"], maxItems: 8 },
      { label: "Gender", sources: ["gender_values_json", "gender"] },
      { label: "Race", sources: ["race_values_json", "race"] },
      { label: "Primary language", sources: ["primary_language_values_json", "primary_language"] },
      { label: "Marital status", sources: ["marital_status_values_json", "marital_status"] },
      { label: "Phone", sources: ["phone_values_json", "phone"], maxItems: 4 },
      { label: "Email", sources: ["email_values_json", "email"], maxItems: 4 },
    ],
  },
  {
    key: "placement",
    label: "Admission and placement",
    fields: [
      { label: "First admitted", sources: ["first_admit_date"], format: "date" },
      { label: "Most recent admission", sources: ["latest_structured_admit_date", "latest_admit_date", "admit_date"], format: "date" },
      { label: "Most recent discharge", sources: ["latest_structured_discharge_date", "latest_discharge_date", "discharge_date"], format: "date" },
      { label: "Prior setting", sources: ["prior_setting_bucket", "prior_setting_enriched_json", "operational_prior_setting_json", "structured_prior_setting_buckets_json", "previous_living_status_values_json"], maxItems: 6 },
      { label: "Prior placements", sources: ["prior_placements"], maxItems: 8 },
      { label: "Referring facility", sources: ["referring_facility", "referring_facilities_enriched_json", "operational_referring_facilities_json", "recovered_document_referring_json", "document_gap_referring_facilities_json"], maxItems: 6 },
      { label: "County", sources: ["county", "county_enriched_json", "operational_county_json", "recovered_document_county_json", "document_gap_county_json"], maxItems: 4 },
      { label: "Discharge destination", sources: ["discharge_destination_values_json", "discharge_destination"], maxItems: 6 },
      { label: "Recorded stays", sources: ["structured_admission_count", "episode_count"], format: "count" },
    ],
  },
  {
    key: "clinical",
    label: "Clinical overview",
    fields: [
      { label: "Primary diagnosis", sources: ["primary_diagnosis", "structured_primary_diagnoses_json", "diagnoses_enriched_json", "operational_diagnoses_json"], maxItems: 6 },
      { label: "Other diagnoses", sources: ["secondary_diagnoses", "structured_diagnoses_json"], maxItems: 12 },
      { label: "Active medications", sources: ["active_medications_json", "active_medications"], maxItems: 12 },
      { label: "Active allergies", sources: ["active_allergies_json", "active_allergies", "allergies"], maxItems: 12 },
      { label: "Primary physician", sources: ["primary_physician_values_json", "physician"], maxItems: 4 },
      { label: "Acuity level", sources: ["acuity_level"] },
      { label: "Cognition and orientation", sources: ["cognition_orientation"] },
      { label: "ADL needs", sources: ["adl_needs"], maxItems: 10 },
      { label: "Prompting level", sources: ["prompting_level"] },
      { label: "Mobility", sources: ["mobility"] },
      { label: "Self-care", sources: ["self_care_status"] },
      { label: "Behavioral history", sources: ["behavioral_history"], maxItems: 10 },
      { label: "Known triggers", sources: ["triggers"], maxItems: 10 },
      { label: "SI/HI history", sources: ["si_hi_history"] },
      { label: "Elopement risk", sources: ["elopement_risk"] },
      { label: "Aggression risk", sources: ["aggression_risk"] },
      { label: "Responds to internal stimuli", sources: ["responds_to_internal_stimuli"] },
      { label: "Prior hospitalizations", sources: ["prior_hospitalizations_count", "hospitalization_count"], format: "count" },
      { label: "Most recent hospitalization", sources: ["most_recent_hospitalization"], format: "date" },
      { label: "Prior holds", sources: ["prior_5150_5250_holds"], maxItems: 8 },
      { label: "Crisis or ER use", sources: ["crisis_er_utilization"] },
      { label: "Substance use", sources: ["substance_use", "substances", "substance_use_enriched_json", "operational_substance_use_json", "recovered_document_substance_json"], maxItems: 8 },
      { label: "Substance use pattern", sources: ["use_pattern"] },
      { label: "Substance treatment history", sources: ["treatment_history"] },
      { label: "Medication at intake", sources: ["medications_at_intake"], maxItems: 12 },
      { label: "Medication adherence", sources: ["medication_adherence"] },
      { label: "Medication route", sources: ["lai_vs_oral"] },
      { label: "PRN patterns", sources: ["prn_patterns"] },
      { label: "Latest assessment", sources: ["latest_assessment_date"], format: "date" },
      { label: "Active service plans", sources: ["active_service_plan_count"], format: "count" },
      { label: "Incidents, last 30 days", sources: ["incidents_30d", "incident_count_30d"], format: "count" },
      { label: "Most recent incident", sources: ["last_incident_date", "latest_incident_date"], format: "date" },
      { label: "MAR completion, last 30 days", sources: ["mar_compliance_pct_30d", "medication_completion_pct"], format: "percent" },
      { label: "Medication refusals, last 30 days", sources: ["medication_refusals_30d", "refusals_30d"], format: "count" },
    ],
  },
  {
    key: "support",
    label: "Legal and support",
    fields: [
      { label: "Conservatorship", sources: ["conservatorship", "conservatorship_enriched_json", "operational_conservatorship_json", "recovered_document_conservatorship_json"], maxItems: 6 },
      { label: "Conservatorship type", sources: ["conservatorship_type"] },
      { label: "Conservator", sources: ["conservator_name"] },
      { label: "Hold type", sources: ["hold_type"] },
      { label: "Court dates", sources: ["court_dates"], maxItems: 6 },
      { label: "Justice involvement", sources: ["probation_parole_justice"] },
      { label: "Payor", sources: ["payer_values_json", "payer_values_enriched_json", "operational_payer_values_json", "recovered_document_payer_json", "payor"], maxItems: 6 },
      { label: "Family involvement", sources: ["family_involvement"] },
      { label: "Housing history", sources: ["housing_history"] },
      { label: "Prior living situation", sources: ["prior_living_situation"] },
      { label: "Benefits and income", sources: ["benefits_income_status"] },
      { label: "Discharge goals", sources: ["discharge_planning_goals"], maxItems: 8 },
      { label: "Advance directive", sources: ["advance_directive_values_json"] },
      { label: "Code status", sources: ["code_status_values_json"] },
      { label: "Transportation preference", sources: ["transportation_preference_values_json"], maxItems: 6 },
      { label: "Emergency contacts", sources: ["emergency_contact_count"], format: "count" },
      { label: "Legal contacts", sources: ["legal_contact_count"], format: "count" },
    ],
  },
];

function parseStructuredText(value: string): unknown {
  const text = value.trim();
  if (!text || !((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}")))) {
    return value;
  }
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function readableValues(value: unknown, depth = 0): string[] {
  if (value == null || depth > 5) return [];
  if (typeof value === "boolean") return [value ? "Yes" : "No"];
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? [new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)]
      : [];
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || /^(null|undefined|n\/a|none|not reported)$/i.test(text)) return [];
    const parsed = parseStructuredText(text);
    return parsed === value ? [text] : readableValues(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.flatMap((entry) => readableValues(entry, depth + 1));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of preferredObjectKeys) {
      if (!(key in record)) continue;
      const preferred = readableValues(record[key], depth + 1);
      if (preferred.length) return preferred;
    }
    return Object.entries(record).flatMap(([key, nestedValue]) =>
      technicalObjectKeys.test(key) ? [] : readableValues(nestedValue, depth + 1));
  }
  return [];
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function formatValues(values: string[], maxItems: number) {
  const normalized = uniqueValues(values);
  if (!normalized.length) return null;
  const shown = normalized.slice(0, maxItems);
  const remaining = normalized.length - shown.length;
  return `${shown.join(" · ")}${remaining > 0 ? ` · ${remaining.toLocaleString()} more` : ""}`;
}

function firstSourceValues(profile: Record<string, unknown>, sources: string[]) {
  for (const source of sources) {
    const values = readableValues(profile[source]);
    if (values.length) return values;
  }
  return [];
}

function buildFact(profile: Record<string, unknown>, definition: FieldDefinition): ClientProfileFact | null {
  const excluded = new Set(
    (definition.excludeSources ?? [])
      .flatMap((source) => readableValues(profile[source]))
      .map((value) => value.toLowerCase()),
  );
  const values = firstSourceValues(profile, definition.sources)
    .filter((value) => !excluded.has(value.toLowerCase()));
  if (!values.length) return null;

  let value: string | null;
  if (definition.format === "date") {
    value = formatProfileDate(values[0]);
  } else if (definition.format === "count") {
    const number = Number(values[0].replaceAll(",", ""));
    value = Number.isFinite(number) ? new Intl.NumberFormat("en-US").format(number) : formatValues(values, 1);
  } else if (definition.format === "percent") {
    const number = Number(values[0].replace("%", ""));
    value = Number.isFinite(number) ? `${number.toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : formatValues(values, 1);
  } else {
    value = formatValues(values, definition.maxItems ?? 8);
  }
  return value ? { label: definition.label, value } : null;
}

export function buildClientProfileSections(profile: ClinicalClientRecord): ClientProfileSection[] {
  return profileSections.map((section) => ({
    key: section.key,
    label: section.label,
    facts: section.fields
      .map((field) => buildFact(profile, field))
      .filter((fact): fact is ClientProfileFact => Boolean(fact)),
  })).filter((section) => section.facts.length > 0);
}

function firstValue(record: Record<string, unknown>, sources: string[]) {
  return firstSourceValues(record, sources)[0] ?? "";
}

function episodeFact(record: Record<string, unknown>, label: string, sources: string[], format?: FieldDefinition["format"]) {
  return buildFact(record, { label, sources, ...(format ? { format } : {}) });
}

export function buildClientEpisodeSummaries(episodes: ClinicalClientRecord[]): ClientEpisodeSummary[] {
  return episodes.map((episode, index) => {
    const admitted = firstValue(episode, ["admit_date", "admission_date", "episode_start_date", "latest_admit_date"]);
    const discharged = firstValue(episode, ["discharge_date", "latest_discharge_date", "episode_end_date"]);
    const community = firstValue(episode, ["facility_name", "community_name", "facility_canonical", "community"]);
    const facts = [
      episodeFact(episode, "Status", ["episode_status", "status", "current_status"]),
      episodeFact(episode, "Resident number", ["resident_number", "resident_id", "res_number"]),
      episodeFact(episode, "Unit", ["unit_number", "unit"]),
      episodeFact(episode, "Care level", ["care_level"]),
      episodeFact(episode, "Payor", ["payor", "payer"]),
      episodeFact(episode, "Primary diagnosis", ["primary_diagnosis", "diagnosis"]),
      episodeFact(episode, "Length of stay", ["los_days", "length_of_stay"], "count"),
      episodeFact(episode, "Discharge destination", ["discharge_destination", "disposition"]),
      episodeFact(episode, "Outcome", ["discharge_outcome", "outcome", "discharge_reason"]),
    ].filter((fact): fact is ClientProfileFact => Boolean(fact));

    return {
      key: `${admitted || "episode"}-${discharged || "current"}-${index}`,
      period: `${formatProfileDate(admitted) || "Admission not recorded"} to ${discharged ? formatProfileDate(discharged) : "Current"}`,
      community: community || "Community not recorded",
      facts,
    };
  });
}

export function hasReadableProfileValue(value: unknown) {
  return readableValues(value).length > 0;
}

export function formatProfileDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

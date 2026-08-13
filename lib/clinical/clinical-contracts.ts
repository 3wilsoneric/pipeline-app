export type ClinicalFreshness = {
  status: "fresh" | "stale" | "unknown";
  age_hours: number | null;
  max_age_hours: number;
  warning: string | null;
};

export type ClinicalMetadata = {
  source: "alamo_platform";
  snapshot_id: string;
  generated_at: string;
  data_as_of: string;
  retrieved_at: string;
  freshness: ClinicalFreshness;
};

export type ClinicalReconciliationStatus = "matched" | "mismatch" | "unavailable";

export type ClinicalCensusCommunity = {
  community_id: string;
  community_name: string;
  city: string;
  state: string;
  current_census: number | null;
  roster_count: number;
  reconciliation_status: ClinicalReconciliationStatus;
  delta: number | null;
};

export type ClinicalCensusResponse = ClinicalMetadata & {
  communities: ClinicalCensusCommunity[];
  portfolio_census_total: number | null;
  roster_count: number;
  reconciliation_status: ClinicalReconciliationStatus;
  delta: number | null;
};

export type ClinicalResident = {
  resident_id: string;
  resident_key: string;
  /** ElderMark business key. Nullable until the Alamo contract supplies it. */
  resident_number: string | null;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  community_id: string;
  community_name: string;
  unit: string | null;
  age: number | null;
  admit_date: string | null;
  length_of_stay_days: number | null;
  care_level: string | null;
  payor: string | null;
  primary_diagnosis: string | null;
  physician: string | null;
  diet: string | null;
};

export type ClinicalResidentSearchResult = Pick<
  ClinicalResident,
  "resident_id" | "resident_key" | "resident_number" | "display_name" | "community_id" | "community_name" | "unit"
>;

export type ClinicalRosterResponse = ClinicalMetadata & {
  residents: ClinicalResident[];
  total: number;
  limit: number;
  next_cursor: string | null;
  query: string;
  community: string | null;
};

export type ClinicalResidentResponse = ClinicalMetadata & {
  resident: ClinicalResident;
};

export type ClinicalMedicationCommunity = {
  community_id: string;
  community_name: string;
  scheduled_count: number | null;
  given_count: number | null;
  compliance_pct: number | null;
  refusal_count: number | null;
  held_or_not_given_count: number | null;
};

export type ClinicalMedicationSummaryResponse = ClinicalMetadata & {
  period: string;
  portfolio: {
    scheduled_count: number | null;
    given_count: number | null;
    compliance_pct: number | null;
    refusal_count: number | null;
    held_or_not_given_count: number | null;
  };
  communities: ClinicalMedicationCommunity[];
  coverage: {
    complete: boolean;
    communities_expected: number;
    communities_reported: number;
  };
  detail_policy: "governed_summary_only";
};

export type ClinicalHealthResponse = {
  source: "alamo_platform";
  snapshot_id: string | null;
  generated_at: string | null;
  data_as_of: string | null;
  retrieved_at: string;
  freshness: ClinicalFreshness;
  ready: boolean;
  status: "ready" | "degraded" | "unavailable";
  contract_version: string;
  checks: {
    snapshot_available: boolean;
    qa_approved: boolean;
    census_ready: boolean;
    roster_ready: boolean;
    medication_summary_ready: boolean;
  };
};

type UnknownRecord = Record<string, unknown>;

export function parseClinicalHealthResponse(value: unknown): ClinicalHealthResponse {
  const row = record(value, "clinical health response");
  const snapshotId = nullableString(row.snapshot_id, "snapshot_id");
  const generatedAt = nullableTimestamp(row.generated_at, "generated_at");
  const dataAsOf = nullableDate(row.data_as_of, "data_as_of");
  const checks = record(row.checks, "checks");
  const status = enumValue(row.status, ["ready", "degraded", "unavailable"] as const, "status");

  return {
    source: sourceValue(row.source),
    snapshot_id: snapshotId,
    generated_at: generatedAt,
    data_as_of: dataAsOf,
    retrieved_at: timestamp(row.retrieved_at, "retrieved_at"),
    freshness: parseFreshness(row.freshness),
    ready: booleanValue(row.ready, "ready"),
    status,
    contract_version: stringValue(row.contract_version, "contract_version"),
    checks: {
      snapshot_available: booleanValue(checks.snapshot_available, "checks.snapshot_available"),
      qa_approved: booleanValue(checks.qa_approved, "checks.qa_approved"),
      census_ready: booleanValue(checks.census_ready, "checks.census_ready"),
      roster_ready: booleanValue(checks.roster_ready, "checks.roster_ready"),
      medication_summary_ready: booleanValue(checks.medication_summary_ready, "checks.medication_summary_ready"),
    },
  };
}

export function parseClinicalCensusResponse(value: unknown): ClinicalCensusResponse {
  const row = record(value, "clinical census response");
  return {
    ...parseMetadata(row),
    communities: array(row.communities, "communities").map((value, index) => {
      const community = record(value, `communities[${index}]`);
      return {
        community_id: stringValue(community.community_id, "community_id"),
        community_name: stringValue(community.community_name, "community_name"),
        city: stringValue(community.city, "city"),
        state: stringValue(community.state, "state"),
        current_census: nullableInteger(community.current_census, "current_census"),
        roster_count: integer(community.roster_count, "roster_count"),
        reconciliation_status: reconciliationStatus(community.reconciliation_status),
        delta: nullableInteger(community.delta, "delta", -10000),
      };
    }),
    portfolio_census_total: nullableInteger(row.portfolio_census_total, "portfolio_census_total"),
    roster_count: integer(row.roster_count, "roster_count"),
    reconciliation_status: reconciliationStatus(row.reconciliation_status),
    delta: nullableInteger(row.delta, "delta", -10000),
  };
}

export function parseClinicalRosterResponse(value: unknown): ClinicalRosterResponse {
  const row = record(value, "clinical roster response");
  const limit = integer(row.limit, "limit", 1, 200);
  const residents = array(row.residents, "residents").map(parseResident);
  if (residents.length > limit || residents.length > 200) {
    throw new Error("Clinical roster response exceeds its declared page size.");
  }
  return {
    ...parseMetadata(row),
    residents,
    total: integer(row.total, "total"),
    limit,
    next_cursor: nullableString(row.next_cursor, "next_cursor", 2048),
    query: stringValue(row.query, "query", 128, true),
    community: nullableString(row.community, "community", 128),
  };
}

export function parseClinicalResidentResponse(value: unknown): ClinicalResidentResponse {
  const row = record(value, "clinical resident response");
  return {
    ...parseMetadata(row),
    resident: parseResident(row.resident, 0),
  };
}

export function parseClinicalMedicationSummaryResponse(value: unknown): ClinicalMedicationSummaryResponse {
  const row = record(value, "clinical medication summary response");
  const portfolio = record(row.portfolio, "portfolio");
  const coverage = record(row.coverage, "coverage");
  const communities = array(row.communities, "communities").map((value, index) => {
    const community = record(value, `communities[${index}]`);
    return {
      community_id: stringValue(community.community_id, "community_id"),
      community_name: stringValue(community.community_name, "community_name"),
      scheduled_count: nullableInteger(community.scheduled_count, "scheduled_count"),
      given_count: nullableInteger(community.given_count, "given_count"),
      compliance_pct: nullableNumber(community.compliance_pct, "compliance_pct", 0, 100),
      refusal_count: nullableInteger(community.refusal_count, "refusal_count"),
      held_or_not_given_count: nullableInteger(community.held_or_not_given_count, "held_or_not_given_count"),
    };
  });
  if (row.detail_policy !== "governed_summary_only") {
    throw new Error("Clinical medication detail policy is not approved.");
  }
  assertNoMedicationDetailKeys(row);

  return {
    ...parseMetadata(row),
    period: month(row.period, "period"),
    portfolio: {
      scheduled_count: nullableInteger(portfolio.scheduled_count, "portfolio.scheduled_count"),
      given_count: nullableInteger(portfolio.given_count, "portfolio.given_count"),
      compliance_pct: nullableNumber(portfolio.compliance_pct, "portfolio.compliance_pct", 0, 100),
      refusal_count: nullableInteger(portfolio.refusal_count, "portfolio.refusal_count"),
      held_or_not_given_count: nullableInteger(portfolio.held_or_not_given_count, "portfolio.held_or_not_given_count"),
    },
    communities,
    coverage: {
      complete: booleanValue(coverage.complete, "coverage.complete"),
      communities_expected: integer(coverage.communities_expected, "coverage.communities_expected"),
      communities_reported: integer(coverage.communities_reported, "coverage.communities_reported"),
    },
    detail_policy: "governed_summary_only",
  };
}

export function toClinicalResidentSearchResult(resident: ClinicalResident): ClinicalResidentSearchResult {
  return {
    resident_id: resident.resident_id,
    resident_key: resident.resident_key,
    resident_number: resident.resident_number,
    display_name: resident.display_name,
    community_id: resident.community_id,
    community_name: resident.community_name,
    unit: resident.unit,
  };
}

function parseMetadata(row: UnknownRecord): ClinicalMetadata {
  return {
    source: sourceValue(row.source),
    snapshot_id: stringValue(row.snapshot_id, "snapshot_id"),
    generated_at: timestamp(row.generated_at, "generated_at"),
    data_as_of: date(row.data_as_of, "data_as_of"),
    retrieved_at: timestamp(row.retrieved_at, "retrieved_at"),
    freshness: parseFreshness(row.freshness),
  };
}

function parseFreshness(value: unknown): ClinicalFreshness {
  const row = record(value, "freshness");
  return {
    status: enumValue(row.status, ["fresh", "stale", "unknown"] as const, "freshness.status"),
    age_hours: nullableNumber(row.age_hours, "freshness.age_hours", 0, 24 * 365),
    max_age_hours: numberValue(row.max_age_hours, "freshness.max_age_hours", 1, 24 * 14),
    warning: nullableString(row.warning, "freshness.warning", 1000),
  };
}

function parseResident(value: unknown, index: number): ClinicalResident {
  const row = record(value, `residents[${index}]`);
  return {
    resident_id: stringValue(row.resident_id, "resident_id", 128),
    resident_key: stringValue(row.resident_key, "resident_key", 256),
    resident_number: row.resident_number === undefined
      ? null
      : nullableString(row.resident_number, "resident_number", 128),
    display_name: stringValue(row.display_name, "display_name", 400),
    first_name: nullableString(row.first_name, "first_name", 200),
    last_name: nullableString(row.last_name, "last_name", 200),
    date_of_birth: row.date_of_birth === undefined
      ? null
      : nullableDate(row.date_of_birth, "date_of_birth"),
    community_id: stringValue(row.community_id, "community_id", 64),
    community_name: stringValue(row.community_name, "community_name", 400),
    unit: nullableString(row.unit, "unit", 200),
    age: nullableInteger(row.age, "age", 0, 125),
    admit_date: nullableDate(row.admit_date, "admit_date"),
    length_of_stay_days: nullableInteger(row.length_of_stay_days, "length_of_stay_days", 0, 36500),
    care_level: nullableString(row.care_level, "care_level"),
    payor: nullableString(row.payor, "payor"),
    primary_diagnosis: nullableString(row.primary_diagnosis, "primary_diagnosis", 2000),
    physician: nullableString(row.physician, "physician"),
    diet: nullableString(row.diet, "diet", 2000),
  };
}

function assertNoMedicationDetailKeys(value: unknown) {
  const forbidden = new Set(["medication", "medication_name", "notes", "note_text", "resident_name", "resident_id", "resident_number", "administration_id"]);
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.has(key.toLowerCase())) {
        throw new Error("Clinical medication response contains unapproved detail fields.");
      }
      visit(child);
    }
  };
  visit(value);
}

function sourceValue(value: unknown): "alamo_platform" {
  if (value !== "alamo_platform") throw new Error("Clinical response has an invalid source.");
  return value;
}

function reconciliationStatus(value: unknown): ClinicalReconciliationStatus {
  return enumValue(value, ["matched", "mismatch", "unavailable"] as const, "reconciliation_status");
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`Clinical response has an invalid ${label}.`);
  return value as T[number];
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Clinical response has an invalid ${label}.`);
  return value as UnknownRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Clinical response has an invalid ${label}.`);
  return value;
}

function stringValue(value: unknown, label: string, maximum = 1000, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maximum) {
    throw new Error(`Clinical response has an invalid ${label}.`);
  }
  return value;
}

function nullableString(value: unknown, label: string, maximum = 1000): string | null {
  if (value === null) return null;
  return stringValue(value, label, maximum);
}

function numberValue(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Clinical response has an invalid ${label}.`);
  }
  return value;
}

function nullableNumber(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null) return null;
  return numberValue(value, label, minimum, maximum);
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = numberValue(value, label, minimum, maximum);
  if (!Number.isInteger(parsed)) throw new Error(`Clinical response has an invalid ${label}.`);
  return parsed;
}

function nullableInteger(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null) return null;
  return integer(value, label, minimum, maximum);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Clinical response has an invalid ${label}.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const parsed = stringValue(value, label);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`Clinical response has an invalid ${label}.`);
  return parsed;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  return timestamp(value, label);
}

function date(value: unknown, label: string): string {
  const parsed = stringValue(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed) || new Date(`${parsed}T00:00:00.000Z`).toISOString().slice(0, 10) !== parsed) {
    throw new Error(`Clinical response has an invalid ${label}.`);
  }
  return parsed;
}

function nullableDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  return date(value, label);
}

function month(value: unknown, label: string): string {
  const parsed = stringValue(value, label, 7);
  if (!/^\d{4}-\d{2}$/.test(parsed)) throw new Error(`Clinical response has an invalid ${label}.`);
  return parsed;
}

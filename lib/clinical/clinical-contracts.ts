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
  canonical_client_id: string | null;
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

export type ClinicalResidentDirectoryResult = ClinicalResidentSearchResult & Pick<
  ClinicalResident,
  "admit_date" | "care_level" | "length_of_stay_days"
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

export type ClinicalJsonValue =
  | string
  | number
  | boolean
  | null
  | ClinicalJsonValue[]
  | { [key: string]: ClinicalJsonValue };

export type ClinicalClientRecord = { [key: string]: ClinicalJsonValue };

export type ClinicalClientDirectoryItem = {
  canonical_client_id: string;
  display_name: string;
  gender: string | null;
  resident_numbers: string[];
  current_resident: boolean;
  community_names: string[];
  current_community: string | null;
  unit: string | null;
  admit_date: string | null;
  care_level: string | null;
  episode_count: number;
};

export type ClinicalClientDatabaseSummary = {
  dataset: string;
  version: string | number;
  baseline_date: string;
  generated_at: string;
  client_count: number;
  field_count: number;
};

export type ClinicalClientDatabaseDetail = ClinicalClientDatabaseSummary & {
  fields: string[];
};

export type ClinicalClientSourceDocument = {
  document_id: string;
  display_name: string;
  content_type: string;
  page_count: number | null;
  linked_at: string | null;
  link_source: string | null;
  thumbnail_available: boolean;
  preview_available: boolean;
};

export type ClinicalClientFactStatus =
  | "verified"
  | "needs_review"
  | "not_documented"
  | "no_source_documents";

export type ClinicalClientFact = {
  field_name: string;
  value: string;
  completion_status: ClinicalClientFactStatus;
  evidence_count: number;
  confidence: number | null;
};

export type ClinicalClientFactEvidence = {
  document_id: string;
  document_name: string;
  page_number: number;
  excerpt: string;
  candidate_value: string | null;
  confidence: number;
  status: "accepted" | "needs_review" | "candidate";
};

export type ClinicalClientFactEvidenceResponse = ClinicalMetadata & {
  canonical_client_id: string;
  fact: ClinicalClientFact;
  evidence: ClinicalClientFactEvidence[];
  total: number;
  limit: number;
  next_cursor: string | null;
};

export type ClinicalClientDocumentSearchResult = {
  document_id: string;
  document_name: string;
  page_number: number;
  section: string | null;
  snippet: string;
};

export type ClinicalClientDocumentSearchResponse = ClinicalMetadata & {
  canonical_client_id: string;
  query: string;
  document_id: string | null;
  results: ClinicalClientDocumentSearchResult[];
  total: number;
  limit: number;
  next_cursor: string | null;
};

export type ClinicalClientDirectoryResponse = ClinicalMetadata & {
  clients: ClinicalClientDirectoryItem[];
  total: number;
  limit: number;
  next_cursor: string | null;
  query: string;
  community: string | null;
  client_database: ClinicalClientDatabaseSummary;
};

export type ClinicalClientDetail = ClinicalClientDirectoryItem & {
  resident_profile: ClinicalClientRecord | null;
  resident_profiles: ClinicalClientRecord[];
  resident_episode_history: ClinicalClientRecord[];
  enrichment: ClinicalClientRecord;
  source_documents: ClinicalClientSourceDocument[];
  facts: ClinicalClientFact[];
};

export type ClinicalClientResponse = ClinicalMetadata & {
  client: ClinicalClientDetail;
  client_database: ClinicalClientDatabaseDetail;
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
    client_database_ready: boolean;
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
      client_database_ready: booleanValue(checks.client_database_ready, "checks.client_database_ready"),
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

export function parseClinicalClientDirectoryResponse(value: unknown): ClinicalClientDirectoryResponse {
  const row = record(value, "clinical client directory response");
  const limit = integer(row.limit, "limit", 1, 200);
  const clients = array(row.clients, "clients").map((client, index) =>
    parseClientDirectoryItem(client, `clients[${index}]`),
  );
  if (clients.length > limit || clients.length > 200) {
    throw new Error("Clinical client directory response exceeds its declared page size.");
  }
  return {
    ...parseMetadata(row),
    clients,
    total: integer(row.total, "total"),
    limit,
    next_cursor: nullableString(row.next_cursor, "next_cursor", 2048),
    query: stringValue(row.query, "query", 128, true),
    community: nullableString(row.community, "community", 128),
    client_database: parseClientDatabaseSummary(row.client_database, false),
  };
}

export function parseClinicalClientResponse(value: unknown): ClinicalClientResponse {
  const row = record(value, "clinical client response");
  const client = record(row.client, "client");
  return {
    ...parseMetadata(row),
    client: {
      ...parseClientDirectoryItem(client, "client"),
      resident_profile: client.resident_profile === null
        ? null
        : parseClinicalRecord(client.resident_profile, "client.resident_profile"),
      resident_profiles: array(client.resident_profiles, "client.resident_profiles").map((profile, index) =>
        parseClinicalRecord(profile, `client.resident_profiles[${index}]`),
      ),
      resident_episode_history: array(client.resident_episode_history, "client.resident_episode_history").map((episode, index) =>
        parseClinicalRecord(episode, `client.resident_episode_history[${index}]`),
      ),
      enrichment: parseClinicalRecord(client.enrichment, "client.enrichment"),
      source_documents: client.source_documents === undefined
        ? []
        : array(client.source_documents, "client.source_documents").map((document, index) =>
          parseClientSourceDocument(document, `client.source_documents[${index}]`),
        ),
      facts: client.facts === undefined
        ? []
        : array(client.facts, "client.facts").map((fact, index) =>
          parseClientFact(fact, `client.facts[${index}]`),
        ),
    },
    client_database: parseClientDatabaseSummary(row.client_database, true),
  };
}

export function parseClinicalClientFactEvidenceResponse(
  value: unknown,
): ClinicalClientFactEvidenceResponse {
  const row = record(value, "clinical client fact evidence response");
  const limit = integer(row.limit, "limit", 1, 50);
  const evidence = array(row.evidence, "evidence").map((value, index) => {
    const item = record(value, `evidence[${index}]`);
    return {
      document_id: stringValue(item.document_id, `evidence[${index}].document_id`, 256),
      document_name: stringValue(item.document_name, `evidence[${index}].document_name`, 500),
      page_number: integer(item.page_number, `evidence[${index}].page_number`, 1, 10_000),
      excerpt: stringValue(item.excerpt, `evidence[${index}].excerpt`, 4_000),
      candidate_value: nullableString(item.candidate_value, `evidence[${index}].candidate_value`, 20_000),
      confidence: numberValue(item.confidence, `evidence[${index}].confidence`, 0, 1),
      status: enumValue(
        item.status,
        ["accepted", "needs_review", "candidate"] as const,
        `evidence[${index}].status`,
      ),
    };
  });
  if (evidence.length > limit) throw new Error("Clinical evidence response exceeds its declared page size.");
  return {
    ...parseMetadata(row),
    canonical_client_id: stringValue(row.canonical_client_id, "canonical_client_id", 256),
    fact: parseClientFact(row.fact, "fact"),
    evidence,
    total: integer(row.total, "total", 0, 100_000),
    limit,
    next_cursor: nullableString(row.next_cursor, "next_cursor", 2048),
  };
}

export function parseClinicalClientDocumentSearchResponse(
  value: unknown,
): ClinicalClientDocumentSearchResponse {
  const row = record(value, "clinical client document search response");
  const limit = integer(row.limit, "limit", 1, 50);
  const results = array(row.results, "results").map((value, index) => {
    const item = record(value, `results[${index}]`);
    return {
      document_id: stringValue(item.document_id, `results[${index}].document_id`, 256),
      document_name: stringValue(item.document_name, `results[${index}].document_name`, 500),
      page_number: integer(item.page_number, `results[${index}].page_number`, 1, 10_000),
      section: nullableString(item.section, `results[${index}].section`, 256),
      snippet: stringValue(item.snippet, `results[${index}].snippet`, 420),
    };
  });
  if (results.length > limit) throw new Error("Clinical document search response exceeds its declared page size.");
  return {
    ...parseMetadata(row),
    canonical_client_id: stringValue(row.canonical_client_id, "canonical_client_id", 256),
    query: stringValue(row.query, "query", 128),
    document_id: nullableString(row.document_id, "document_id", 256),
    results,
    total: integer(row.total, "total", 0, 1_000_000),
    limit,
    next_cursor: nullableString(row.next_cursor, "next_cursor", 2048),
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

export function toClinicalResidentDirectoryResult(resident: ClinicalResident): ClinicalResidentDirectoryResult {
  return {
    ...toClinicalResidentSearchResult(resident),
    admit_date: resident.admit_date,
    care_level: resident.care_level,
    length_of_stay_days: resident.length_of_stay_days,
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
    canonical_client_id: row.canonical_client_id === undefined
      ? null
      : nullableString(row.canonical_client_id, "canonical_client_id", 256),
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

function parseClientDirectoryItem(value: unknown, label: string): ClinicalClientDirectoryItem {
  const row = record(value, label);
  return {
    canonical_client_id: stringValue(row.canonical_client_id, `${label}.canonical_client_id`, 256),
    display_name: stringValue(row.display_name, `${label}.display_name`, 400),
    gender: row.gender === undefined ? null : nullableString(row.gender, `${label}.gender`, 200),
    resident_numbers: boundedStringArray(row.resident_numbers, `${label}.resident_numbers`, 100, 128),
    current_resident: booleanValue(row.current_resident, `${label}.current_resident`),
    community_names: boundedStringArray(row.community_names, `${label}.community_names`, 25, 200),
    current_community: nullableString(row.current_community, `${label}.current_community`, 200),
    unit: nullableString(row.unit, `${label}.unit`, 200),
    admit_date: nullableDate(row.admit_date, `${label}.admit_date`),
    care_level: nullableString(row.care_level, `${label}.care_level`, 500),
    episode_count: integer(row.episode_count, `${label}.episode_count`, 0, 10000),
  };
}

function parseClientSourceDocument(value: unknown, label: string): ClinicalClientSourceDocument {
  const row = record(value, label);
  const contentType = stringValue(row.content_type, `${label}.content_type`, 128).toLowerCase();
  if (!contentType.startsWith("application/pdf") && !contentType.startsWith("image/")) {
    throw new Error(`Clinical response has an invalid ${label}.content_type.`);
  }
  return {
    document_id: stringValue(row.document_id, `${label}.document_id`, 256),
    display_name: stringValue(row.display_name, `${label}.display_name`, 500),
    content_type: contentType,
    page_count: nullableInteger(row.page_count, `${label}.page_count`, 1, 10_000),
    linked_at: row.linked_at === null || row.linked_at === undefined
      ? null
      : timestamp(row.linked_at, `${label}.linked_at`),
    link_source: nullableString(row.link_source, `${label}.link_source`, 128),
    thumbnail_available: booleanValue(row.thumbnail_available, `${label}.thumbnail_available`),
    preview_available: booleanValue(row.preview_available, `${label}.preview_available`),
  };
}

function parseClientFact(value: unknown, label: string): ClinicalClientFact {
  const row = record(value, label);
  return {
    field_name: stringValue(row.field_name, `${label}.field_name`, 128),
    value: stringValue(row.value, `${label}.value`, 20_000),
    completion_status: enumValue(
      row.completion_status,
      ["verified", "needs_review", "not_documented", "no_source_documents"] as const,
      `${label}.completion_status`,
    ),
    evidence_count: integer(row.evidence_count, `${label}.evidence_count`, 0, 100_000),
    confidence: nullableNumber(row.confidence, `${label}.confidence`, 0, 1),
  };
}

function parseClientDatabaseSummary(
  value: unknown,
  includeFields: false,
): ClinicalClientDatabaseSummary;
function parseClientDatabaseSummary(
  value: unknown,
  includeFields: true,
): ClinicalClientDatabaseDetail;
function parseClientDatabaseSummary(
  value: unknown,
  includeFields: boolean,
): ClinicalClientDatabaseSummary | ClinicalClientDatabaseDetail {
  const row = record(value, "client_database");
  const version = typeof row.version === "number"
    ? numberValue(row.version, "client_database.version", 0)
    : stringValue(row.version, "client_database.version", 128);
  const summary: ClinicalClientDatabaseSummary = {
    dataset: stringValue(row.dataset, "client_database.dataset", 256),
    version,
    baseline_date: date(row.baseline_date, "client_database.baseline_date"),
    generated_at: timestamp(row.generated_at, "client_database.generated_at"),
    client_count: integer(row.client_count, "client_database.client_count", 0, 1_000_000),
    field_count: integer(row.field_count, "client_database.field_count", 0, 1000),
  };
  if (!includeFields) return summary;
  const fields = boundedStringArray(row.fields, "client_database.fields", 1000, 256);
  if (fields.length !== summary.field_count) {
    throw new Error("Clinical client database field metadata is inconsistent.");
  }
  return { ...summary, fields };
}

function parseClinicalRecord(value: unknown, label: string): ClinicalClientRecord {
  return parseClinicalJsonValue(value, label, 0, true) as ClinicalClientRecord;
}

function parseClinicalJsonValue(
  value: unknown,
  label: string,
  depth: number,
  requireObject = false,
): ClinicalJsonValue {
  if (depth > 4) throw new Error(`Clinical response has an invalid ${label}.`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 20_000) throw new Error(`Clinical response has an invalid ${label}.`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Clinical response has an invalid ${label}.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (requireObject || value.length > 200) throw new Error(`Clinical response has an invalid ${label}.`);
    return value.map((entry, index) => parseClinicalJsonValue(entry, `${label}[${index}]`, depth + 1));
  }
  if (!value || typeof value !== "object") throw new Error(`Clinical response has an invalid ${label}.`);
  const entries = Object.entries(value);
  if (entries.length > 1000) throw new Error(`Clinical response has an invalid ${label}.`);
  const parsed: ClinicalClientRecord = {};
  for (const [key, entry] of entries) {
    if (!key || key.length > 256 || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error(`Clinical response has an invalid ${label}.`);
    }
    parsed[key] = parseClinicalJsonValue(entry, `${label}.${key}`, depth + 1);
  }
  return parsed;
}

function boundedStringArray(
  value: unknown,
  label: string,
  maximumItems: number,
  maximumLength: number,
) {
  const values = array(value, label);
  if (values.length > maximumItems) throw new Error(`Clinical response has an invalid ${label}.`);
  return values.map((entry, index) => stringValue(entry, `${label}[${index}]`, maximumLength));
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

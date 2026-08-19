import "server-only";

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  parseClinicalCensusResponse,
  parseClinicalHealthResponse,
  parseClinicalResidentResponse,
  parseClinicalRosterResponse,
} from "./clinical-contracts";
import type {
  ClinicalCensusResponse,
  ClinicalHealthResponse,
  ClinicalResident,
  ClinicalResidentResponse,
  ClinicalRosterResponse,
} from "./clinical-contracts";

const DEFAULT_SNAPSHOT_PATH = ".data/demo-clinical-snapshot.json";
const DEFAULT_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_RESIDENTS = 10_000;

type DemoClinicalSnapshot = {
  schema_version: 1;
  snapshot_id: string;
  generated_at: string;
  data_as_of: string;
  qa: {
    reconciled: true;
    roster_count: number;
    community_count: number;
  };
  communities: Array<{
    community_id: string;
    community_name: string;
    city: string;
    state: string;
    current_census: number;
    roster_count: number;
  }>;
  residents: ClinicalResident[];
};

export class DemoClinicalDataError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: { matching_resident_keys: string[] } | null = null,
  ) {
    super(message);
    this.name = "DemoClinicalDataError";
  }
}

let snapshotCache: {
  filePath: string;
  mtimeMs: number;
  size: number;
  snapshot: DemoClinicalSnapshot;
} | null = null;

export function demoClinicalSnapshotExists() {
  return existsSync(getDemoClinicalSnapshotPath());
}

export function getDemoClinicalSnapshotPath() {
  const configured = process.env.PIPELINE_CLINICAL_DEMO_SNAPSHOT_PATH?.trim();
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured || DEFAULT_SNAPSHOT_PATH);
}

export async function getDemoClinicalHealth(): Promise<ClinicalHealthResponse> {
  const snapshot = await loadSnapshot();
  return parseClinicalHealthResponse({
    ...metadata(snapshot),
    ready: false,
    status: "degraded",
    contract_version: "pipeline-clinical-demo-snapshot.v1",
    checks: {
      snapshot_available: true,
      qa_approved: true,
      census_ready: true,
      roster_ready: true,
      client_database_ready: false,
      medication_summary_ready: false,
    },
  });
}

export async function getDemoClinicalCensus(): Promise<ClinicalCensusResponse> {
  const snapshot = await loadSnapshot();
  const rosterCount = snapshot.residents.length;
  return parseClinicalCensusResponse({
    ...metadata(snapshot),
    communities: snapshot.communities.map((community) => ({
      ...community,
      reconciliation_status: "matched",
      delta: 0,
    })),
    portfolio_census_total: rosterCount,
    roster_count: rosterCount,
    reconciliation_status: "matched",
    delta: 0,
  });
}

export async function getDemoClinicalRoster(options: {
  query: string;
  community: string;
  limit: number;
  cursor: string;
}): Promise<ClinicalRosterResponse> {
  const snapshot = await loadSnapshot();
  const query = normalizeSearch(options.query);
  const community = normalizeSearch(options.community);
  const queryTokens = query.split(" ").filter(Boolean);
  const residents = snapshot.residents.filter((resident) => {
    if (community) {
      const communityText = normalizeSearch(`${resident.community_id} ${resident.community_name}`);
      if (!communityText.includes(community)) return false;
    }
    if (queryTokens.length === 0) return true;
    const haystack = normalizeSearch([
      resident.display_name,
      resident.resident_number,
      resident.resident_id,
      resident.resident_key,
      resident.community_name,
      resident.unit,
    ].filter(Boolean).join(" "));
    return queryTokens.every((token) => haystack.includes(token));
  });
  const offset = options.cursor
    ? decodeCursor(options.cursor, snapshot.snapshot_id, query, community, residents.length)
    : 0;
  const page = residents.slice(offset, offset + options.limit);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < residents.length
    ? encodeCursor({ snapshot: snapshot.snapshot_id, offset: nextOffset, query, community })
    : null;

  return parseClinicalRosterResponse({
    ...metadata(snapshot),
    residents: page,
    total: residents.length,
    limit: options.limit,
    next_cursor: nextCursor,
    query: options.query,
    community: options.community || null,
  });
}

export async function getDemoClinicalResident(identifier: string): Promise<ClinicalResidentResponse> {
  const snapshot = await loadSnapshot();
  const exact = snapshot.residents.find((resident) => resident.resident_key === identifier);
  const matches = exact
    ? [exact]
    : snapshot.residents.filter((resident) =>
      resident.resident_id === identifier || resident.resident_number === identifier,
    );
  if (matches.length === 0) {
    throw new DemoClinicalDataError(404, "resident_not_found", "Resident was not found in the current governed roster.");
  }
  if (matches.length > 1) {
    throw new DemoClinicalDataError(
      409,
      "resident_identifier_ambiguous",
      "More than one resident matched that identifier. Use a community-qualified resident key.",
      { matching_resident_keys: matches.map((resident) => resident.resident_key).slice(0, 200) },
    );
  }
  return parseClinicalResidentResponse({
    ...metadata(snapshot),
    resident: matches[0],
  });
}

export function demoMedicationSummaryUnavailable(): never {
  throw new DemoClinicalDataError(
    503,
    "clinical_medication_summary_unavailable",
    "Medication summary data is not included in the one-time clinical snapshot.",
  );
}

async function loadSnapshot() {
  const filePath = getDemoClinicalSnapshotPath();
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new DemoClinicalDataError(
      503,
      "clinical_demo_snapshot_unavailable",
      "The one-time clinical snapshot is not available on this server.",
    );
  }
  const maximumBytes = boundedIntegerEnvironment(
    "PIPELINE_CLINICAL_MAX_RESPONSE_BYTES",
    DEFAULT_MAX_SNAPSHOT_BYTES,
    64 * 1024,
    8 * 1024 * 1024,
  );
  if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > maximumBytes) {
    throw new DemoClinicalDataError(
      503,
      "clinical_demo_snapshot_storage_invalid",
      "The one-time clinical snapshot failed its storage validation.",
    );
  }
  if (
    snapshotCache?.filePath === filePath &&
    snapshotCache.mtimeMs === fileStat.mtimeMs &&
    snapshotCache.size === fileStat.size
  ) {
    return snapshotCache.snapshot;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new DemoClinicalDataError(
      503,
      "clinical_demo_snapshot_json_invalid",
      "The one-time clinical snapshot could not be read safely.",
    );
  }
  const snapshot = validateSnapshot(raw);
  snapshotCache = {
    filePath,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    snapshot,
  };
  return snapshot;
}

function validateSnapshot(value: unknown): DemoClinicalSnapshot {
  if (!isRecord(value) || value.schema_version !== 1 || value.qa === null || !isRecord(value.qa)) {
    throw invalidSnapshot();
  }
  if (!Array.isArray(value.residents) || !Array.isArray(value.communities)) throw invalidSnapshot();
  if (value.residents.length === 0 || value.residents.length > MAX_RESIDENTS) throw invalidSnapshot();
  const base = {
    source: "alamo_platform",
    snapshot_id: value.snapshot_id,
    generated_at: value.generated_at,
    data_as_of: value.data_as_of,
    retrieved_at: new Date().toISOString(),
    freshness: demoFreshness(),
  };
  const residents = value.residents.map((resident) =>
    parseClinicalResidentResponse({ ...base, resident }).resident,
  );
  const keys = new Set<string>();
  for (const resident of residents) {
    if (!resident.resident_number || keys.has(resident.resident_key)) throw invalidSnapshot();
    keys.add(resident.resident_key);
  }
  const communityRows = value.communities.map((community) => {
    if (!isRecord(community)) throw invalidSnapshot();
    return {
      community_id: community.community_id,
      community_name: community.community_name,
      city: community.city,
      state: community.state,
      current_census: community.current_census,
      roster_count: community.roster_count,
      reconciliation_status: "matched",
      delta: 0,
    };
  });
  const census = parseClinicalCensusResponse({
    ...base,
    communities: communityRows,
    portfolio_census_total: residents.length,
    roster_count: residents.length,
    reconciliation_status: "matched",
    delta: 0,
  });
  const actualCounts = new Map<string, number>();
  residents.forEach((resident) => {
    actualCounts.set(resident.community_id, (actualCounts.get(resident.community_id) ?? 0) + 1);
  });
  const communitiesMatch = census.communities.every((community) =>
    actualCounts.get(community.community_id) === community.roster_count &&
    community.roster_count === community.current_census,
  );
  if (
    value.qa.reconciled !== true ||
    value.qa.roster_count !== residents.length ||
    value.qa.community_count !== census.communities.length ||
    actualCounts.size !== census.communities.length ||
    !communitiesMatch
  ) throw invalidSnapshot();

  return {
    schema_version: 1,
    snapshot_id: census.snapshot_id,
    generated_at: census.generated_at,
    data_as_of: census.data_as_of,
    qa: {
      reconciled: true,
      roster_count: residents.length,
      community_count: census.communities.length,
    },
    communities: census.communities.map((community) => ({
      community_id: community.community_id,
      community_name: community.community_name,
      city: community.city,
      state: community.state,
      current_census: community.current_census ?? 0,
      roster_count: community.roster_count,
    })),
    residents: residents.sort(compareResidents),
  };
}

function metadata(snapshot: DemoClinicalSnapshot) {
  return {
    source: "alamo_platform" as const,
    snapshot_id: snapshot.snapshot_id,
    generated_at: snapshot.generated_at,
    data_as_of: snapshot.data_as_of,
    retrieved_at: new Date().toISOString(),
    freshness: demoFreshness(),
  };
}

function demoFreshness() {
  return {
    status: "unknown" as const,
    age_hours: null,
    max_age_hours: 24,
    warning: "One-time demo snapshot. It does not refresh automatically.",
  };
}

function compareResidents(left: ClinicalResident, right: ClinicalResident) {
  return left.display_name.localeCompare(right.display_name, "en", { sensitivity: "base" })
    || left.community_name.localeCompare(right.community_name, "en", { sensitivity: "base" })
    || left.resident_key.localeCompare(right.resident_key);
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function encodeCursor(value: { snapshot: string; offset: number; query: string; community: string }) {
  return Buffer.from(JSON.stringify({ v: 1, ...value }), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  snapshot: string,
  query: string,
  community: string,
  maximumOffset: number,
) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (!isRecord(decoded) || decoded.v !== 1) throw invalidCursor();
  if (decoded.snapshot !== snapshot) {
    throw new DemoClinicalDataError(
      409,
      "clinical_cursor_snapshot_changed",
      "The clinical snapshot changed. Restart roster pagination.",
    );
  }
  if (
    decoded.query !== query ||
    decoded.community !== community ||
    !Number.isInteger(decoded.offset) ||
    Number(decoded.offset) < 0 ||
    Number(decoded.offset) > maximumOffset
  ) throw invalidCursor();
  return Number(decoded.offset);
}

function invalidCursor() {
  return new DemoClinicalDataError(400, "clinical_cursor_invalid", "The clinical roster cursor is invalid.");
}

function invalidSnapshot() {
  return new DemoClinicalDataError(
    503,
    "clinical_demo_snapshot_contract_invalid",
    "The one-time clinical snapshot does not match the approved contract.",
  );
}

function boundedIntegerEnvironment(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

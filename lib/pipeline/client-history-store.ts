import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  ClientHistoryEpisode,
  ClientHistoryProjection,
} from "./client-history-contracts";

const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_EPISODES = 10_000;
const DEFAULT_SNAPSHOT_PATH = ".data/master-client-history.json";

type StoredEpisode = ClientHistoryEpisode & {
  resident_number: string;
  resident_name: string;
  date_of_birth: string | null;
  source_file: string | null;
  match_confidence: string | null;
};

type ClientHistorySnapshot = {
  schema_version: 1;
  data_class: "user_supplied_real";
  contract_version: "pipeline-client-history.v1";
  snapshot_id: string;
  imported_at: string;
  data_as_of: string;
  episodes: StoredEpisode[];
};

type CachedSnapshot = {
  signature: string;
  snapshot: ClientHistorySnapshot;
  byResidentNumber: Map<string, StoredEpisode[]>;
};

let cached: CachedSnapshot | null = null;

export function getClientHistoryReadiness() {
  const mode = getMode();
  if (mode === "disconnected") {
    return {
      mode,
      ready: false,
      warning: "Longitudinal client history is not configured on this server.",
    } as const;
  }
  if (process.env.NODE_ENV === "production") {
    return {
      mode,
      ready: false,
      warning: "Production client history must come from the governed Alamo API, not a local snapshot.",
    } as const;
  }
  return {
    mode,
    ready: true,
    warning: "Using a one-time private client-history extract that does not refresh automatically.",
  } as const;
}

export async function getClientHistoryForResident(
  residentNumber: string | null,
  dateOfBirth: string | null,
): Promise<ClientHistoryProjection> {
  const readiness = getClientHistoryReadiness();
  if (!readiness.ready || !residentNumber?.trim()) return emptyProjection("unavailable", readiness.warning);

  let loaded: CachedSnapshot;
  try {
    loaded = await loadSnapshot();
  } catch {
    return emptyProjection(
      "unavailable",
      "The private client-history snapshot is missing or failed validation. Current Alamo data remains available.",
    );
  }

  const stored = loaded.byResidentNumber.get(residentNumber.trim()) ?? [];
  if (stored.length === 0) {
    return {
      ...emptyProjection(
        "not_found",
        `No episode history was present in the one-time extract through ${formatDate(loaded.snapshot.data_as_of)}.`,
      ),
      source: "master_client_datasheet",
      data_as_of: loaded.snapshot.data_as_of,
      imported_at: loaded.snapshot.imported_at,
    };
  }

  const knownDatesOfBirth = new Set(
    stored.map((episode) => episode.date_of_birth).filter((value): value is string => Boolean(value)),
  );
  if (dateOfBirth && [...knownDatesOfBirth].some((value) => value !== dateOfBirth)) {
    return {
      ...emptyProjection(
        "identity_conflict",
        "The resident number matched, but DOB did not. History is withheld until the source identity is reviewed.",
      ),
      source: "master_client_datasheet",
      data_as_of: loaded.snapshot.data_as_of,
      imported_at: loaded.snapshot.imported_at,
      quality_flags: ["date_of_birth_conflict"],
    };
  }

  const episodes = stored.map(stripPrivateFields).sort((left, right) =>
    right.admit_date.localeCompare(left.admit_date) ||
    right.resident_status.localeCompare(left.resident_status),
  );
  const qualityFlags = [...new Set(episodes.flatMap((episode) => episode.quality_flags))];
  return {
    status: "available",
    source: "master_client_datasheet",
    data_as_of: loaded.snapshot.data_as_of,
    imported_at: loaded.snapshot.imported_at,
    warning: `Episode history comes from a one-time extract through ${formatDate(loaded.snapshot.data_as_of)}; the current census remains authoritative in Alamo.`,
    episode_count: episodes.length,
    current_episode_count: episodes.filter((episode) => episode.resident_status === "Current").length,
    discharged_episode_count: episodes.filter((episode) => episode.resident_status === "Discharged").length,
    first_admit_date: episodes.at(-1)?.admit_date ?? null,
    latest_admit_date: episodes[0]?.admit_date ?? null,
    quality_flags: qualityFlags,
    episodes,
  };
}

async function loadSnapshot() {
  const snapshotPath = resolveSnapshotPath();
  const metadata = await stat(snapshotPath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_SNAPSHOT_BYTES) {
    throw new Error("Client history snapshot is outside the approved storage bounds.");
  }
  const signature = `${metadata.mtimeMs}:${metadata.size}`;
  if (cached?.signature === signature) return cached;
  const parsed = JSON.parse(await readFile(snapshotPath, "utf8"));
  const snapshot = validateSnapshot(parsed);
  const byResidentNumber = new Map<string, StoredEpisode[]>();
  for (const episode of snapshot.episodes) {
    const list = byResidentNumber.get(episode.resident_number) ?? [];
    list.push(episode);
    byResidentNumber.set(episode.resident_number, list);
  }
  cached = { signature, snapshot, byResidentNumber };
  return cached;
}

function validateSnapshot(value: unknown): ClientHistorySnapshot {
  if (!isRecord(value)) throw new Error("Client history snapshot is invalid.");
  if (
    value.schema_version !== 1 ||
    value.data_class !== "user_supplied_real" ||
    value.contract_version !== "pipeline-client-history.v1" ||
    !isBoundedString(value.snapshot_id, 256) ||
    !isIsoTimestamp(value.imported_at) ||
    !isIsoDate(value.data_as_of) ||
    !Array.isArray(value.episodes) ||
    value.episodes.length === 0 ||
    value.episodes.length > MAX_EPISODES
  ) {
    throw new Error("Client history snapshot does not match the approved contract.");
  }
  return {
    schema_version: 1,
    data_class: "user_supplied_real",
    contract_version: "pipeline-client-history.v1",
    snapshot_id: value.snapshot_id,
    imported_at: value.imported_at,
    data_as_of: value.data_as_of,
    episodes: value.episodes.map(validateEpisode),
  };
}

function validateEpisode(value: unknown): StoredEpisode {
  if (!isRecord(value)) throw new Error("Client history contains an invalid episode.");
  if (
    !isBoundedString(value.resident_number, 128) ||
    !isBoundedString(value.resident_name, 400) ||
    !nullableDate(value.date_of_birth) ||
    !isBoundedString(value.community, 400) ||
    !isIsoDate(value.admit_date) ||
    !nullableDate(value.discharge_date) ||
    !["Current", "Discharged"].includes(String(value.resident_status)) ||
    !Number.isInteger(value.episode_days) ||
    Number(value.episode_days) < 0 ||
    Number(value.episode_days) > 50_000 ||
    !nullableBoundedString(value.discharge_reason, 2_000) ||
    !nullableBoundedString(value.referring_facility, 1_000) ||
    !nullableBoundedString(value.facility_canonical, 1_000) ||
    !nullableBoundedString(value.prior_setting_bucket, 200) ||
    !nullableBoundedString(value.primary_diagnosis, 2_000) ||
    !stringList(value.secondary_diagnoses) ||
    !nullableBoundedString(value.conservatorship, 2_000) ||
    !stringList(value.substance_use) ||
    !nullableBoundedString(value.county, 200) ||
    !nullableBoundedString(value.source_file, 1_000) ||
    !nullableBoundedString(value.match_confidence, 200) ||
    !stringList(value.quality_flags, 64, 200)
  ) {
    throw new Error("Client history contains an invalid episode.");
  }
  return value as StoredEpisode;
}

function stripPrivateFields(episode: StoredEpisode): ClientHistoryEpisode {
  return {
    community: episode.community,
    admit_date: episode.admit_date,
    discharge_date: episode.discharge_date,
    resident_status: episode.resident_status,
    discharge_reason: episode.discharge_reason,
    episode_days: episode.episode_days,
    referring_facility: episode.referring_facility,
    facility_canonical: episode.facility_canonical,
    prior_setting_bucket: episode.prior_setting_bucket,
    primary_diagnosis: episode.primary_diagnosis,
    secondary_diagnoses: episode.secondary_diagnoses,
    conservatorship: episode.conservatorship,
    substance_use: episode.substance_use,
    county: episode.county,
    quality_flags: episode.quality_flags,
  };
}

function emptyProjection(
  status: ClientHistoryProjection["status"],
  warning: string,
): ClientHistoryProjection {
  return {
    status,
    source: null,
    data_as_of: null,
    imported_at: null,
    warning,
    episode_count: 0,
    current_episode_count: 0,
    discharged_episode_count: 0,
    first_admit_date: null,
    latest_admit_date: null,
    quality_flags: [],
    episodes: [],
  };
}

function getMode() {
  const configured = process.env.PIPELINE_CLIENT_HISTORY_MODE?.trim();
  if (configured === "disconnected" || configured === "local_snapshot") return configured;
  return process.env.NODE_ENV === "production" ? "disconnected" : "local_snapshot";
}

function resolveSnapshotPath() {
  const configured = process.env.PIPELINE_CLIENT_HISTORY_SNAPSHOT_PATH?.trim();
  return configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(/* turbopackIgnore: true */ process.cwd(), DEFAULT_SNAPSHOT_PATH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= maximum;
}

function nullableBoundedString(value: unknown, maximum: number) {
  return value === null || (typeof value === "string" && value.length <= maximum);
}

function stringList(value: unknown, maximumItems = 128, maximumLength = 2_000): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every((item) =>
    typeof item === "string" && Boolean(item.trim()) && item.length <= maximumLength,
  );
}

function nullableDate(value: unknown) {
  return value === null || isIsoDate(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

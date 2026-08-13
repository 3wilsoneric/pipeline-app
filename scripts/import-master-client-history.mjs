#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { readBoundedCsvRecords } from "./lib/bounded-csv.mjs";

const CONFIRMATION = "IMPORT-USER-SUPPLIED-REAL-CLIENT-HISTORY";
const DEFAULT_OUTPUT = ".data/master-client-history.json";
const DEFAULT_CLINICAL_SNAPSHOT = ".data/demo-clinical-snapshot.json";
const DEFAULT_ARCHIVE_ROOT = ".data/imports/client-history";
const DEFAULT_AUDIT_PATH = ".data/local-real-client-history-import-events.jsonl";
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 10_000;
const requiredHeaders = [
  "resident_number",
  "resident_name",
  "date_of_birth",
  "community",
  "admit_date",
  "discharge_date",
  "resident_status",
  "discharge_reason",
  "episode_days",
  "referring_facility",
  "facility_canonical",
  "prior_setting_bucket",
  "primary_diagnosis",
  "secondary_diagnoses",
  "conservatorship",
  "substance_use",
  "county",
  "source_file",
  "match_confidence",
];

export async function importMasterClientHistory(options) {
  const inputStat = await stat(options.inputPath);
  if (!inputStat.isFile() || inputStat.size <= 0 || inputStat.size > MAX_INPUT_BYTES) {
    throw new Error("The master client CSV is empty, not a file, or exceeds the 8 MB import limit.");
  }
  const sourceBytes = await readFile(options.inputPath);
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  const rows = await readBoundedCsvRecords(options.inputPath, {
    requiredHeaders,
    label: "master client history",
    maxInputBytes: MAX_INPUT_BYTES,
    maxRows: MAX_ROWS,
    maxCellCharacters: 20_000,
  });
  const normalized = normalizeRows(rows);
  const clinicalReconciliation = await reconcileClinicalSnapshot(
    normalized.episodes,
    options.clinicalSnapshotPath,
  );
  const importedAt = new Date().toISOString();
  const snapshot = {
    schema_version: 1,
    data_class: "user_supplied_real",
    contract_version: "pipeline-client-history.v1",
    snapshot_id: `client-history-${sourceHash.slice(0, 16)}-${randomUUID()}`,
    imported_at: importedAt,
    data_as_of: normalized.dataAsOf,
    source: {
      label: "Master Client Datasheet.csv",
      sha256: sourceHash,
    },
    qa: {
      episode_count: normalized.episodes.length,
      unique_resident_count: normalized.uniqueResidentCount,
      current_episode_count: normalized.currentEpisodeCount,
      discharged_episode_count: normalized.dischargedEpisodeCount,
      duplicate_episode_key_groups: normalized.duplicateEpisodeKeyGroups,
      missing_date_of_birth_count: normalized.missingDateOfBirthCount,
      clinical_reconciliation: clinicalReconciliation,
    },
    episodes: normalized.episodes,
  };

  if (!options.validateOnly) {
    if (options.confirm !== CONFIRMATION) {
      throw new Error(`Writing real client history requires --confirm=${CONFIRMATION}.`);
    }
    await archiveSource(sourceBytes, sourceHash, options.archiveRoot);
    await writePrivateJson(options.outputPath, snapshot);
    await appendAggregateAudit(options.auditPath, {
      imported_at: importedAt,
      data_class: snapshot.data_class,
      episode_count: snapshot.qa.episode_count,
      unique_resident_count: snapshot.qa.unique_resident_count,
      current_episode_count: snapshot.qa.current_episode_count,
      data_as_of: snapshot.data_as_of,
      source_sha256: sourceHash,
    });
  }

  return {
    ok: true,
    written: !options.validateOnly,
    data_class: snapshot.data_class,
    data_as_of: snapshot.data_as_of,
    episodes: snapshot.qa.episode_count,
    unique_residents: snapshot.qa.unique_resident_count,
    current_episodes: snapshot.qa.current_episode_count,
    discharged_episodes: snapshot.qa.discharged_episode_count,
    duplicate_episode_key_groups: snapshot.qa.duplicate_episode_key_groups,
    clinical_reconciliation: snapshot.qa.clinical_reconciliation,
  };
}

function normalizeRows(rows) {
  const episodes = rows.map((row, index) => normalizeEpisode(row, index + 2));
  const currentDataDates = new Set(
    episodes
      .filter((episode) => episode.resident_status === "Current")
      .map((episode) => addDays(episode.admit_date, episode.episode_days)),
  );
  if (currentDataDates.size !== 1) {
    throw new Error("Current episodes do not reconcile to exactly one derived data-as-of date.");
  }
  const dataAsOf = [...currentDataDates][0];
  for (const [index, episode] of episodes.entries()) {
    if (episode.admit_date > dataAsOf || (episode.discharge_date && episode.discharge_date > dataAsOf)) {
      throw new Error(`Master client history row ${index + 2} extends beyond the derived data-as-of date.`);
    }
    if (episode.date_of_birth && episode.date_of_birth > episode.admit_date) {
      throw new Error(`Master client history row ${index + 2} has a DOB after admission.`);
    }
    if (episode.resident_status === "Current" && episode.discharge_date) {
      throw new Error(`Master client history row ${index + 2} marks a current episode as discharged.`);
    }
    if (episode.resident_status === "Discharged" && !episode.discharge_date) {
      throw new Error(`Master client history row ${index + 2} is discharged without a discharge date.`);
    }
    if (
      episode.discharge_date &&
      daysBetween(episode.admit_date, episode.discharge_date) !== episode.episode_days
    ) {
      throw new Error(`Master client history row ${index + 2} has an inconsistent episode duration.`);
    }
  }

  const episodeGroups = new Map();
  for (const episode of episodes) {
    const key = [episode.resident_number, episode.community, episode.admit_date].join("\u0000");
    const group = episodeGroups.get(key) ?? [];
    group.push(episode);
    episodeGroups.set(key, group);
  }
  let duplicateEpisodeKeyGroups = 0;
  for (const group of episodeGroups.values()) {
    if (group.length < 2) continue;
    duplicateEpisodeKeyGroups += 1;
    for (const episode of group) episode.quality_flags.push("duplicate_episode_key");
  }

  episodes.sort((left, right) =>
    left.resident_number.localeCompare(right.resident_number) ||
    right.admit_date.localeCompare(left.admit_date) ||
    right.resident_status.localeCompare(left.resident_status),
  );
  return {
    episodes,
    dataAsOf,
    uniqueResidentCount: new Set(episodes.map((episode) => episode.resident_number)).size,
    currentEpisodeCount: episodes.filter((episode) => episode.resident_status === "Current").length,
    dischargedEpisodeCount: episodes.filter((episode) => episode.resident_status === "Discharged").length,
    duplicateEpisodeKeyGroups,
    missingDateOfBirthCount: episodes.filter((episode) => !episode.date_of_birth).length,
  };
}

function normalizeEpisode(row, rowNumber) {
  const status = requiredText(row.resident_status, "resident_status", rowNumber, 32);
  if (!new Set(["Current", "Discharged"]).has(status)) {
    throw new Error(`Master client history row ${rowNumber} has an invalid resident_status.`);
  }
  return {
    resident_number: requiredText(row.resident_number, "resident_number", rowNumber, 128),
    resident_name: requiredText(row.resident_name, "resident_name", rowNumber, 400),
    date_of_birth: nullableDate(row.date_of_birth, "date_of_birth", rowNumber),
    community: requiredText(row.community, "community", rowNumber, 400),
    admit_date: requiredDate(row.admit_date, "admit_date", rowNumber),
    discharge_date: nullableDate(row.discharge_date, "discharge_date", rowNumber),
    resident_status: status,
    discharge_reason: nullableText(row.discharge_reason, 2_000),
    episode_days: requiredInteger(row.episode_days, "episode_days", rowNumber, 0, 50_000),
    referring_facility: nullableText(row.referring_facility, 1_000),
    facility_canonical: nullableText(row.facility_canonical, 1_000),
    prior_setting_bucket: nullableText(row.prior_setting_bucket, 200),
    primary_diagnosis: nullableText(row.primary_diagnosis, 2_000),
    secondary_diagnoses: nullableStringList(row.secondary_diagnoses, "secondary_diagnoses", rowNumber),
    conservatorship: nullableText(row.conservatorship, 2_000),
    substance_use: nullableStringList(row.substance_use, "substance_use", rowNumber),
    county: nullableText(row.county, 200),
    source_file: nullableText(row.source_file, 1_000),
    match_confidence: nullableText(row.match_confidence, 200),
    quality_flags: [],
  };
}

async function reconcileClinicalSnapshot(episodes, snapshotPath) {
  try {
    const source = JSON.parse(await readFile(snapshotPath, "utf8"));
    const residents = Array.isArray(source?.residents) ? source.residents : [];
    const currentByNumber = new Map(
      episodes
        .filter((episode) => episode.resident_status === "Current")
        .map((episode) => [episode.resident_number, episode]),
    );
    const clinicalByNumber = new Map(
      residents
        .filter((resident) => typeof resident?.resident_number === "string" && resident.resident_number.trim())
        .map((resident) => [resident.resident_number.trim(), resident]),
    );
    const exactNumbers = [...currentByNumber.keys()].filter((number) => clinicalByNumber.has(number));
    const identityConflictCount = exactNumbers.filter((number) => {
      const episode = currentByNumber.get(number);
      const resident = clinicalByNumber.get(number);
      return Boolean(episode?.date_of_birth && resident?.date_of_birth && episode.date_of_birth !== resident.date_of_birth);
    }).length;
    return {
      clinical_data_as_of: nullableText(source?.data_as_of, 10),
      clinical_resident_count: residents.length,
      current_exact_resident_number_matches: exactNumbers.length,
      current_history_only_count: [...currentByNumber.keys()].filter((number) => !clinicalByNumber.has(number)).length,
      clinical_only_count: [...clinicalByNumber.keys()].filter((number) => !currentByNumber.has(number)).length,
      identity_conflict_count: identityConflictCount,
    };
  } catch {
    return {
      clinical_data_as_of: null,
      clinical_resident_count: null,
      current_exact_resident_number_matches: null,
      current_history_only_count: null,
      clinical_only_count: null,
      identity_conflict_count: null,
    };
  }
}

async function archiveSource(bytes, sourceHash, archiveRoot) {
  const directory = path.join(archiveRoot, sourceHash);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const sourcePath = path.join(directory, "source.csv");
  await writeFile(sourcePath, bytes, { mode: 0o600 });
  await chmod(sourcePath, 0o600);
}

async function writePrivateJson(outputPath, value) {
  const directory = path.dirname(outputPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, outputPath);
  await chmod(outputPath, 0o600);
}

async function appendAggregateAudit(auditPath, event) {
  await mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  await appendFile(auditPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  await chmod(auditPath, 0o600);
}

function requiredText(value, field, rowNumber, maximum) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Master client history row ${rowNumber} has an invalid ${field}.`);
  }
  return normalized;
}

function nullableText(value, maximum) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new Error("Master client history contains text beyond the approved limit.");
  return normalized;
}

function requiredInteger(value, field, rowNumber, minimum, maximum) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Master client history row ${rowNumber} has an invalid ${field}.`);
  }
  return parsed;
}

function requiredDate(value, field, rowNumber) {
  const normalized = requiredText(value, field, rowNumber, 10);
  if (!isIsoDate(normalized)) throw new Error(`Master client history row ${rowNumber} has an invalid ${field}.`);
  return normalized;
}

function nullableDate(value, field, rowNumber) {
  const normalized = String(value ?? "").trim();
  return normalized ? requiredDate(normalized, field, rowNumber) : null;
}

function nullableStringList(value, field, rowNumber) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return [];
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(`Master client history row ${rowNumber} has invalid structured ${field}.`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 128 ||
    parsed.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 2_000)
  ) {
    throw new Error(`Master client history row ${rowNumber} has invalid structured ${field}.`);
  }
  return parsed.map((item) => item.trim());
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000);
}

function addDays(start, days) {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseArguments(args) {
  const values = new Map();
  let validateOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--validate-only") {
      validateOnly = true;
      continue;
    }
    if (!["--input", "--output", "--clinical-snapshot", "--archive-root", "--audit", "--confirm"].includes(argument)) {
      throw new Error("Usage: --input <csv> [--output <json>] [--clinical-snapshot <json>] [--archive-root <dir>] [--audit <jsonl>] [--confirm <phrase>] [--validate-only]");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    values.set(argument, value);
    index += 1;
  }
  if (!values.get("--input")) throw new Error("--input is required.");
  return {
    inputPath: path.resolve(values.get("--input")),
    outputPath: path.resolve(values.get("--output") || DEFAULT_OUTPUT),
    clinicalSnapshotPath: path.resolve(values.get("--clinical-snapshot") || DEFAULT_CLINICAL_SNAPSHOT),
    archiveRoot: path.resolve(values.get("--archive-root") || DEFAULT_ARCHIVE_ROOT),
    auditPath: path.resolve(values.get("--audit") || DEFAULT_AUDIT_PATH),
    confirm: values.get("--confirm") || "",
    validateOnly,
  };
}

async function main() {
  try {
    console.log(JSON.stringify(await importMasterClientHistory(parseArguments(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "The master client history import failed.",
    }));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(new URL(import.meta.url).pathname)) await main();

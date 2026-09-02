#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { readBoundedCsvRecords } from "./lib/bounded-csv.mjs";
import { normalizeClientName } from "../lib/pipeline/client-identity-presentation.mjs";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 10_000;
const DEFAULT_OUTPUT = ".data/demo-clinical-snapshot.json";

const rosterHeaders = [
  "resident_id",
  "resident_key",
  "resident_number",
  "display_name",
  "first_name",
  "last_name",
  "date_of_birth",
  "community_id",
  "community_name",
  "unit",
  "age",
  "admit_date",
  "length_of_stay_days",
  "status",
  "care_level",
  "payor",
  "primary_diagnosis",
  "physician",
  "diet",
  "data_as_of",
];
const reconciliationHeaders = ["community", "roster_rows", "unique_residents"];

export async function importDemoClinicalRoster(options) {
  const rosterRows = await readBoundedCsvRecords(options.rosterPath, {
    requiredHeaders: rosterHeaders,
    label: "roster",
    maxInputBytes: MAX_INPUT_BYTES,
    maxRows: MAX_ROWS,
  });
  const reconciliationRows = await readBoundedCsvRecords(options.reconciliationPath, {
    requiredHeaders: reconciliationHeaders,
    label: "reconciliation",
    maxInputBytes: MAX_INPUT_BYTES,
    maxRows: MAX_ROWS,
  });
  const normalized = validateRoster(rosterRows, reconciliationRows, options.state || "CA");
  const generatedAt = new Date().toISOString();
  const snapshot = {
    schema_version: 1,
    snapshot_id: `demo-alamo-${normalized.dataAsOf}-${randomUUID()}`,
    generated_at: generatedAt,
    data_as_of: normalized.dataAsOf,
    qa: {
      reconciled: true,
      roster_count: normalized.residents.length,
      community_count: normalized.communities.length,
    },
    communities: normalized.communities,
    residents: normalized.residents,
  };

  if (!options.validateOnly) {
    const outputPath = path.resolve(options.outputPath || DEFAULT_OUTPUT);
    const outputDirectory = path.dirname(outputPath);
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(outputDirectory, `.${path.basename(outputPath)}.${process.pid}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
  }

  return {
    ok: true,
    residents: normalized.residents.length,
    communities: normalized.communities.length,
    data_as_of: normalized.dataAsOf,
    reconciled: true,
    written: !options.validateOnly,
  };
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await importDemoClinicalRoster(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "The roster import failed.",
    }));
    process.exitCode = 1;
  }
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
    if (!["--roster", "--reconciliation", "--output", "--state"].includes(argument)) {
      throw new Error("Usage: --roster <csv> --reconciliation <csv> [--output <json>] [--state <code>] [--validate-only]");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    values.set(argument, value);
    index += 1;
  }
  if (!values.get("--roster") || !values.get("--reconciliation")) {
    throw new Error("Both --roster and --reconciliation CSV files are required.");
  }
  const state = String(values.get("--state") || "CA").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("--state must be a two-letter code.");
  return {
    rosterPath: path.resolve(values.get("--roster")),
    reconciliationPath: path.resolve(values.get("--reconciliation")),
    outputPath: path.resolve(values.get("--output") || DEFAULT_OUTPUT),
    state,
    validateOnly,
  };
}

function validateRoster(rows, reconciliationRows, state) {
  const residents = rows.map((row, index) => normalizeResident(row, index + 2));
  const keys = new Set();
  const communityNames = new Map();
  const communityCounts = new Map();
  const dataAsOfValues = new Set();
  for (const resident of residents) {
    if (keys.has(resident.resident_key)) throw new Error("Roster contains duplicate community-qualified resident keys.");
    keys.add(resident.resident_key);
    const knownName = communityNames.get(resident.community_id);
    if (knownName && knownName !== resident.community_name) {
      throw new Error("One community identifier maps to more than one community name.");
    }
    communityNames.set(resident.community_id, resident.community_name);
    communityCounts.set(resident.community_name, (communityCounts.get(resident.community_name) || 0) + 1);
    dataAsOfValues.add(resident.data_as_of);
  }
  if (dataAsOfValues.size !== 1) throw new Error("Roster rows do not share one governed data_as_of date.");

  const reconciliation = new Map();
  for (const [index, row] of reconciliationRows.entries()) {
    const community = requiredText(row.community, "community", index + 2, 400);
    if (reconciliation.has(community)) throw new Error("Reconciliation CSV contains a duplicate community.");
    reconciliation.set(community, {
      rosterRows: requiredInteger(row.roster_rows, "roster_rows", index + 2, 0, MAX_ROWS),
      uniqueResidents: requiredInteger(row.unique_residents, "unique_residents", index + 2, 0, MAX_ROWS),
    });
  }
  if (reconciliation.size !== communityCounts.size) {
    throw new Error("Roster and reconciliation CSVs contain different community sets.");
  }
  for (const [community, count] of communityCounts) {
    const check = reconciliation.get(community);
    if (!check || check.rosterRows !== count || check.uniqueResidents !== count) {
      throw new Error("Roster and reconciliation counts do not match.");
    }
  }

  const communities = [...communityNames.entries()].map(([communityId, communityName]) => {
    const count = communityCounts.get(communityName);
    if (!count) throw new Error("A roster community has no reconciled residents.");
    return {
      community_id: communityId,
      community_name: communityName,
      city: communityName,
      state,
      current_census: count,
      roster_count: count,
    };
  }).sort((left, right) => left.community_name.localeCompare(right.community_name));

  return {
    dataAsOf: [...dataAsOfValues][0],
    communities,
    residents: residents.sort((left, right) =>
      left.display_name.localeCompare(right.display_name, "en", { sensitivity: "base" })
      || left.community_name.localeCompare(right.community_name, "en", { sensitivity: "base" })
      || left.resident_key.localeCompare(right.resident_key),
    ),
  };
}

function normalizeResident(row, rowNumber) {
  const residentId = requiredText(row.resident_id, "resident_id", rowNumber, 128);
  const residentNumber = requiredText(row.resident_number, "resident_number", rowNumber, 128);
  const communityId = requiredText(row.community_id, "community_id", rowNumber, 64);
  const residentKey = requiredText(row.resident_key, "resident_key", rowNumber, 256);
  if (residentKey !== `${communityId}:${residentId}`) {
    throw new Error(`Roster row ${rowNumber} has an invalid community-qualified resident key.`);
  }
  if (residentId !== residentNumber) {
    throw new Error(`Roster row ${rowNumber} does not preserve the ElderMark resident number.`);
  }
  const dataAsOf = requiredDate(row.data_as_of, "data_as_of", rowNumber);
  const dateOfBirth = requiredDate(row.date_of_birth, "date_of_birth", rowNumber);
  const admitDate = requiredDate(row.admit_date, "admit_date", rowNumber);
  if (dateOfBirth > dataAsOf || admitDate > dataAsOf) {
    throw new Error(`Roster row ${rowNumber} contains a future identity or admission date.`);
  }
  if (requiredText(row.status, "status", rowNumber, 32).toLowerCase() !== "active") {
    throw new Error(`Roster row ${rowNumber} is not part of the active governed census.`);
  }
  const firstName = nullableText(row.first_name, 200);
  const lastName = nullableText(row.last_name, 200);
  const displayName = normalizeClientName(row.display_name, { firstName, lastName });
  if (!displayName) throw new Error(`Roster row ${rowNumber} has an invalid display_name.`);
  return {
    resident_id: residentId,
    resident_key: residentKey,
    resident_number: residentNumber,
    display_name: displayName,
    first_name: firstName,
    last_name: lastName,
    date_of_birth: dateOfBirth,
    community_id: communityId,
    community_name: requiredText(row.community_name, "community_name", rowNumber, 400),
    unit: nullableText(row.unit, 200),
    age: nullableInteger(row.age, "age", rowNumber, 0, 125),
    admit_date: admitDate,
    length_of_stay_days: nullableInteger(row.length_of_stay_days, "length_of_stay_days", rowNumber, 0, 36_500),
    care_level: nullableText(row.care_level, 1000),
    payor: nullableText(row.payor, 1000),
    primary_diagnosis: nullableText(row.primary_diagnosis, 2000),
    physician: nullableText(row.physician, 1000),
    diet: nullableText(row.diet, 2000),
    data_as_of: dataAsOf,
  };
}

function requiredText(value, field, rowNumber, maximum) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`CSV row ${rowNumber} has an invalid ${field}.`);
  }
  return normalized;
}

function nullableText(value, maximum) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new Error("CSV contains a text value that exceeds the approved contract.");
  return normalized;
}

function requiredInteger(value, field, rowNumber, minimum, maximum) {
  const parsed = Number(String(value || "").trim());
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`CSV row ${rowNumber} has an invalid ${field}.`);
  }
  return parsed;
}

function nullableInteger(value, field, rowNumber, minimum, maximum) {
  if (!String(value || "").trim()) return null;
  return requiredInteger(value, field, rowNumber, minimum, maximum);
}

function requiredDate(value, field, rowNumber) {
  const normalized = requiredText(value, field, rowNumber, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`CSV row ${rowNumber} has an invalid ${field}.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`CSV row ${rowNumber} has an invalid ${field}.`);
  }
  return normalized;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(new URL(import.meta.url).pathname)) await main();

#!/usr/bin/env node

import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeClientName } from "../lib/pipeline/client-identity-presentation.mjs";

const writeChanges = process.argv.slice(2).includes("--write");
const root = process.cwd();
const sources = [
  {
    key: "referral_workspaces",
    file: path.resolve(root, process.env.PIPELINE_REFERRAL_STORE_PATH?.trim() || ".data/referrals.json"),
    rows: "referrals",
    normalize(row) {
      return {
        ...row,
        name: normalizeClientName(row.name, { gender: row.gender, community: row.community }),
      };
    },
  },
  {
    key: "current_residents",
    file: path.resolve(root, process.env.PIPELINE_CLINICAL_DEMO_SNAPSHOT_PATH?.trim() || ".data/demo-clinical-snapshot.json"),
    rows: "residents",
    normalize(row) {
      return {
        ...row,
        display_name: normalizeClientName(row.display_name, {
          firstName: row.first_name,
          lastName: row.last_name,
        }),
      };
    },
  },
  {
    key: "historical_episodes",
    file: path.resolve(
      root,
      process.env.PIPELINE_CLIENT_HISTORY_PATH?.trim()
        || process.env.PIPELINE_CLIENT_HISTORY_SNAPSHOT_PATH?.trim()
        || ".data/master-client-history.json",
    ),
    rows: "episodes",
    normalize(row) {
      return {
        ...row,
        resident_name: normalizeClientName(row.resident_name, {
          community: row.community || row.facility_canonical,
        }),
      };
    },
  },
];

const prepared = [];
for (const source of sources) {
  const original = await readFile(source.file, "utf8");
  const document = JSON.parse(original);
  const rows = Array.isArray(document?.[source.rows]) ? document[source.rows] : [];
  const normalizedRows = rows.map(source.normalize);
  const changed = normalizedRows.filter((row, index) => JSON.stringify(row) !== JSON.stringify(rows[index])).length;
  const invalid = normalizedRows.filter((row) => {
    const value = source.key === "referral_workspaces"
      ? row.name
      : source.key === "current_residents"
        ? row.display_name
        : row.resident_name;
    return !value
      || value.split(/\s+/).filter(Boolean).length !== 2
      || /\d/.test(value)
      || /\s+·\s+/.test(value)
      || /\s+(?:gender|sex|community|facility)\s*[:=]/i.test(value);
  }).length;
  prepared.push({
    ...source,
    changed,
    invalid,
    original,
    output: `${JSON.stringify({ ...document, [source.rows]: normalizedRows })}\n`,
  });
}

if (prepared.some((source) => source.invalid > 0)) {
  console.error(JSON.stringify({
    ok: false,
    error: "Client-name normalization left invalid name values.",
    sources: Object.fromEntries(prepared.map((source) => [source.key, { changed: source.changed, invalid: source.invalid }])),
  }, null, 2));
  process.exit(1);
}

let backupDirectory = null;
if (writeChanges && prepared.some((source) => source.changed > 0)) {
  backupDirectory = path.resolve(root, ".data/name-normalization-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  for (const source of prepared.filter((candidate) => candidate.changed > 0)) {
    const backupPath = path.join(backupDirectory, path.basename(source.file));
    await copyFile(source.file, backupPath);
    await chmod(backupPath, 0o600);
    const temporaryPath = `${source.file}.${process.pid}.name-normalization.tmp`;
    await writeFile(temporaryPath, source.output, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, source.file);
    await chmod(source.file, 0o600);
  }
}

console.log(JSON.stringify({
  ok: true,
  mode: writeChanges ? "write" : "dry_run",
  changed: prepared.reduce((total, source) => total + source.changed, 0),
  backup_created: Boolean(backupDirectory),
  sources: Object.fromEntries(prepared.map((source) => [source.key, { changed: source.changed, invalid: source.invalid }])),
}, null, 2));

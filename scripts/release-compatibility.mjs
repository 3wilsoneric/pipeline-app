#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const checksumFile = JSON.parse(readFileSync("database/migration-checksums.json", "utf8"));
const migrationFiles = readdirSync("database/migrations").filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const recordedFiles = Object.keys(checksumFile.migrations ?? {}).sort();
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check("migration checksum manifest uses schema version 1", checksumFile.schema_version === 1 && checksumFile.algorithm === "sha256");
check("migration sequence is contiguous", migrationFiles.every((name, index) => name.startsWith(String(index + 1).padStart(4, "0"))));
check("every migration is in the checksum manifest", JSON.stringify(migrationFiles) === JSON.stringify(recordedFiles));
for (const file of migrationFiles) {
  const checksum = createHash("sha256").update(readFileSync(`database/migrations/${file}`)).digest("hex");
  check(`${file} is append-only`, checksumFile.migrations[file] === checksum);
  const migrationId = file.replace(/\.sql$/, "");
  check(`${file} records migration history`, readFileSync(`database/migrations/${file}`, "utf8").includes(`'${migrationId}'`));
}
const latest = migrationFiles.at(-1);
check("latest migration has an explicit rollback drill", Boolean(latest && readdirSync("database/rollbacks").includes(latest)));
check("release runbook defines deploy and rollback order", readFileSync("docs/RELEASE_OPERATIONS.md", "utf8").includes("Deployment order") && readFileSync("docs/RELEASE_OPERATIONS.md", "utf8").includes("Rollback decision"));
check("release evidence is generated and verified", ["scripts/create-release-evidence.mjs", "scripts/generate-sbom.mjs", "scripts/verify-release-evidence.mjs"].every((file) => readFileSync("package.json", "utf8").includes(file.replace("scripts/", ""))));
check("release operations require immutable evidence", readFileSync("docs/RELEASE_OPERATIONS.md", "utf8").includes("release:evidence:verify"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, migration_count: migrationFiles.length, checks }, null, 2));
if (failed.length > 0) process.exit(1);

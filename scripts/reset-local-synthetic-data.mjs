#!/usr/bin/env node

import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const confirmation = process.argv.find((argument) => argument.startsWith("--confirm="))?.slice("--confirm=".length);
const expectedConfirmation = "DELETE-LOCAL-SYNTHETIC";
const dataDirectory = path.resolve(process.cwd(), ".data");
const referralPath = path.join(dataDirectory, "referrals.json");
const assessmentPath = path.join(dataDirectory, "assessments.json");
const auditPath = path.join(dataDirectory, "local-reset-events.jsonl");

const referrals = readStore(referralPath, "referrals");
const assessments = readStore(assessmentPath, "assessments");
const summary = {
  referral_count: referrals.referrals.length,
  assessment_count: assessments.assessments.length,
  clinical_snapshot_preserved: true,
};

if (confirmation !== expectedConfirmation) {
  console.log(JSON.stringify({
    ok: true,
    dry_run: true,
    ...summary,
    required_confirmation: `--confirm=${expectedConfirmation}`,
  }, null, 2));
  process.exit(0);
}

writePrivateJson(referralPath, {
  version: 1,
  revision: boundedRevision(referrals.revision) + 1,
  next_id: 1,
  create_mutations: {},
  referrals: [],
});
writePrivateJson(assessmentPath, {
  version: 1,
  revision: boundedRevision(assessments.revision) + 1,
  create_mutations: {},
  import_mutations: {},
  assessments: [],
});
appendFileSync(auditPath, `${JSON.stringify({
  event: "local_synthetic_data_reset",
  occurred_at: new Date().toISOString(),
  actor: "local_operator",
  ...summary,
})}\n`, { encoding: "utf8", mode: 0o600 });
if (process.platform !== "win32") chmodSync(auditPath, 0o600);

console.log(JSON.stringify({ ok: true, dry_run: false, ...summary }, null, 2));

function readStore(filePath, collection) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`Refusing reset because ${path.basename(filePath)} could not be parsed.`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed[collection])) {
    throw new Error(`Refusing reset because ${path.basename(filePath)} has an unexpected contract.`);
  }
  return parsed;
}

function boundedRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function writePrivateJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
}

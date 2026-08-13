#!/usr/bin/env node

import { readFileSync } from "node:fs";

const backup = readFileSync("scripts/database-backup.mjs", "utf8");
const restore = readFileSync("scripts/database-restore-verify.mjs", "utf8");
const runbook = readFileSync("docs/DATABASE_RECOVERY.md", "utf8");
const checks = [
  ["backup is scoped to the Pipeline schema", backup.includes('"--schema=pipeline"')],
  ["backup credentials stay out of command arguments", backup.includes("PGPASSWORD") && !backup.includes("--dbname=${databaseUrl}")],
  ["backup produces a SHA-256 manifest", backup.includes('createHash("sha256")') && backup.includes("manifest.json")],
  ["restore requires explicit disposable confirmation", restore.includes("PIPELINE_ALLOW_RESTORE_DRILL") && restore.includes("--confirm-disposable")],
  ["restore refuses the production URL", restore.includes("databaseUrl === process.env.PIPELINE_DATABASE_URL")],
  ["restore verifies checksum and migration history", restore.includes("checksum_verified") && restore.includes("migration_history_verified")],
  ["recovery runbook defines cadence and ownership", runbook.includes("Backup cadence") && runbook.includes("Restore drill") && runbook.includes("Recovery owner")],
].map(([name, ok]) => ({ name, ok: Boolean(ok) }));
const failed = checks.filter((check) => !check.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);

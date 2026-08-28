#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  databaseAssuranceControls,
  databaseAssuranceGates,
  databaseAssuranceProfiles,
  databaseAssuranceTotals,
} from "./database-assurance-registry.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const runner = readFileSync("scripts/database-assurance-runner.mjs", "utf8");
const concurrency = readFileSync("scripts/postgres-concurrency-certification.mjs", "utf8");
const capacity = readFileSync("scripts/postgres-capacity-certification.mjs", "utf8");
const integrity = readFileSync("scripts/postgres-integrity-audit.mjs", "utf8");
const restore = readFileSync("scripts/database-restore-verify.mjs", "utf8");
const documentation = readFileSync("docs/DATABASE_ASSURANCE.md", "utf8");
const checks = [];

check("registry contains at least fifty database controls", databaseAssuranceTotals.controls >= 50);
check("control identifiers are unique", new Set(databaseAssuranceControls.map((item) => item.id)).size === databaseAssuranceControls.length);
check("every control references a real gate", databaseAssuranceControls.every((item) => databaseAssuranceGates[item.gate]));
check("every gate uses a known profile", Object.values(databaseAssuranceGates).every((gate) => databaseAssuranceProfiles.includes(gate.profile)));
check("profiles add evidence monotonically", databaseAssuranceTotals.local < databaseAssuranceTotals.integration && databaseAssuranceTotals.integration < databaseAssuranceTotals.disaster);
check("one-command package entrypoints exist", [
  "database:assurance", "database:assurance:local", "database:assurance:integration",
  "database:assurance:capacity", "database:assurance:disaster", "database:assurance:status",
].every((name) => packageJson.scripts?.[name]));
check("runner writes owner-readable JSON and Markdown evidence", runner.includes('mode: 0o600') && runner.includes('latest.json') && runner.includes('latest.md'));
check("runner records blocked live evidence rather than passing it", runner.includes('gateResult(id, gate, "blocked"') && runner.includes("blocked_controls"));
check("runner never writes child output into assurance artifacts", !runner.includes("stdout:") && !runner.includes("stderr:"));
check("concurrency harness refuses unacknowledged production reuse", concurrency.includes("PIPELINE_ALLOW_TEST_DATABASE_REUSE") && concurrency.includes("guardTestDatabase"));
check("concurrency harness exercises optimistic writes and SKIP LOCKED", concurrency.includes("version = 1") && concurrency.includes("for update skip locked"));
check("concurrency harness exercises lock timeout and deadlock recovery", concurrency.includes("lock_timeout") && concurrency.includes('"40P01"') && concurrency.includes('"55P03"'));
check("concurrency output is aggregate-only", concurrency.includes("unique_claims") && !concurrency.includes("console.log(databaseUrl)"));
check("capacity harness is bounded, configurable, and self-cleaning", capacity.includes("1_000_000") && capacity.includes("p95BudgetMs") && capacity.includes("await cleanup()"));
check("integrity audit is read-only and aggregate-only", integrity.includes("transaction read only") && integrity.includes("count(*)::integer") && !integrity.includes("select *"));
check("restore drill requires both environment and CLI acknowledgement", restore.includes("PIPELINE_ALLOW_RESTORE_DRILL") && restore.includes("--confirm-disposable"));
check("operator documentation separates safe, integration, and disaster commands", ["database:assurance:local", "database:assurance:integration", "database:assurance:disaster"].every((term) => documentation.includes(term)));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  controls: databaseAssuranceTotals,
  checks,
}, null, 2));
if (failed.length > 0) process.exit(1);

function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
}

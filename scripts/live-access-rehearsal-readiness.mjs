#!/usr/bin/env node

import { readFileSync } from "node:fs";

const script = readFileSync("scripts/live-access-rehearsal.mjs", "utf8");
const runbook = readFileSync("docs/LIVE_ACCESS_REHEARSAL.md", "utf8");
const checks = [
  ["rehearsal requires four role-specific token files", ["VIEWER", "ASSESSOR", "SUPERVISOR", "ADMIN"].every((role) => script.includes(`PIPELINE_ACCESS_SMOKE_${role}_TOKEN_FILE`))],
  ["rehearsal checks ordinary and supervisor reads", script.includes("/api/referrals?limit=1") && script.includes("/api/operations/supervisor-queue")],
  ["rehearsal rejects anonymous and invalid tokens", script.includes("anonymous access is rejected") && script.includes("invalid bearer tokens are rejected")],
  ["rehearsal never emits response bodies or principals", script.includes("No token, principal, response body") && !script.includes("console.log(await response")],
  ["runbook requires a disposable non-PHI rehearsal record", /non-PHI\s+rehearsal/.test(runbook) && /Do not use a\s+production client/.test(runbook)],
  ["runbook defines role cleanup", runbook.includes("Remove the four temporary assignments")],
].map(([name, ok]) => ({ name, ok: Boolean(ok) }));

console.log(JSON.stringify({ ok: checks.every((item) => item.ok), checks }, null, 2));
if (checks.some((item) => !item.ok)) process.exit(1);

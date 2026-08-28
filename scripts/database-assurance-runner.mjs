#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";

import {
  databaseAssuranceControls,
  databaseAssuranceGates,
  databaseAssuranceProfiles,
  databaseAssuranceTotals,
  profileIncludesGate,
} from "./database-assurance-registry.mjs";

loadLocalEnvironment();

const options = parseArgs(process.argv.slice(2));
const profile = options.profile ?? (process.env.PIPELINE_TEST_DATABASE_URL?.trim() ? "integration" : "local");
if (!databaseAssuranceProfiles.includes(profile)) fail(`Unknown database assurance profile: ${profile}.`);
if (options.list) {
  printList();
  process.exit(0);
}

const startedAt = Date.now();
const startedAtIso = new Date(startedAt).toISOString();
const selectedGates = Object.entries(databaseAssuranceGates)
  .filter(([, gate]) => profileIncludesGate(profile, gate));
const gateResults = [];
let stop = false;

console.log(`Pipeline database assurance: ${profile}`);
console.log(`Selected gates: ${selectedGates.length}; controls: ${databaseAssuranceTotals[profile]}`);

for (const [id, gate] of selectedGates) {
  if (stop) {
    gateResults.push(gateResult(id, gate, "not_run", 0, { reason: "fail_fast" }));
    continue;
  }
  const missingEnv = (gate.requiredEnv ?? []).filter((name) => !process.env[name]?.trim());
  if (missingEnv.length > 0) {
    console.log(`\n[BLOCKED] ${gate.name}`);
    console.log(`  Missing: ${missingEnv.join(", ")}`);
    gateResults.push(gateResult(id, gate, "blocked", 0, { missing_env: missingEnv }));
    if (options.failFast) stop = true;
    continue;
  }

  console.log(`\n[RUN] ${gate.name}`);
  const gateStartedAt = Date.now();
  const childEnv = { ...process.env, ...(gate.env ?? {}) };
  if (gate.useTestDatabaseAsPrimary) childEnv.PIPELINE_DATABASE_URL = childEnv.PIPELINE_TEST_DATABASE_URL;
  const args = typeof gate.args === "function" ? gate.args(childEnv) : gate.args;
  const result = spawnSync(gate.command, args, {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: gate.timeoutMs ?? 10 * 60_000,
  });
  const durationMs = Date.now() - gateStartedAt;
  if (result.stdout?.trim()) process.stdout.write(`${result.stdout.trim()}\n`);
  if (result.stderr?.trim()) process.stderr.write(`${result.stderr.trim()}\n`);
  if (result.status === 0) {
    console.log(`[PASS] ${gate.name} (${formatDuration(durationMs)})`);
    gateResults.push(gateResult(id, gate, "passed", durationMs));
  } else {
    console.error(`[FAIL] ${gate.name} (${formatDuration(durationMs)})`);
    gateResults.push(gateResult(id, gate, "failed", durationMs, {
      exit_code: result.status ?? 1,
      signal: result.signal ?? undefined,
      timed_out: result.error?.code === "ETIMEDOUT",
    }));
    if (options.failFast) stop = true;
  }
}

const gateById = new Map(gateResults.map((item) => [item.id, item]));
const controls = databaseAssuranceControls.map((item) => {
  const selected = profileIncludesGate(profile, databaseAssuranceGates[item.gate]);
  const gate = gateById.get(item.gate);
  const status = !selected
    ? "pending_profile"
    : gate?.status === "passed"
      ? "verified"
      : gate?.status === "blocked"
        ? "blocked"
        : gate?.status === "failed"
          ? "failed"
          : "not_run";
  return { ...item, status };
});
const selectedControls = controls.filter((item) => item.status !== "pending_profile");
const verified = selectedControls.filter((item) => item.status === "verified").length;
const failed = selectedControls.filter((item) => item.status === "failed").length;
const blocked = selectedControls.filter((item) => item.status === "blocked").length;
const notRun = selectedControls.filter((item) => item.status === "not_run").length;
const payload = {
  ok: failed === 0 && blocked === 0 && notRun === 0 && verified === selectedControls.length,
  model: "pipeline-database-assurance-v1",
  profile,
  started_at: startedAtIso,
  completed_at: new Date().toISOString(),
  duration_ms: Date.now() - startedAt,
  score: `${verified}/${selectedControls.length}`,
  verified_controls: verified,
  selected_controls: selectedControls.length,
  total_controls: databaseAssuranceTotals.controls,
  failed_controls: failed,
  blocked_controls: blocked,
  not_run_controls: notRun,
  gates: gateResults,
  controls,
  configuration_present: {
    PIPELINE_TEST_DATABASE_URL: Boolean(process.env.PIPELINE_TEST_DATABASE_URL?.trim()),
    PIPELINE_RESTORE_BACKUP_PATH: Boolean(process.env.PIPELINE_RESTORE_BACKUP_PATH?.trim()),
  },
  note: "Results contain control status and aggregate metrics only. Connection strings and database rows are never written to assurance artifacts.",
};

const artifact = options.noArtifact ? null : writeArtifacts(payload);
console.log(`\nDATABASE ASSURANCE ${payload.ok ? "PASSED" : "DID NOT PASS"}: ${payload.score}`);
console.log(`Duration: ${formatDuration(payload.duration_ms)}`);
if (artifact) console.log(`Report: ${artifact.markdown}`);
if (!payload.ok) process.exitCode = 1;

function parseArgs(args) {
  const parsed = { profile: null, noArtifact: false, failFast: false, list: false };
  for (const value of args) {
    if (value.startsWith("--profile=")) parsed.profile = value.slice("--profile=".length);
    else if (value === "--no-artifact") parsed.noArtifact = true;
    else if (value === "--fail-fast") parsed.failFast = true;
    else if (value === "--list") parsed.list = true;
    else if (value === "--help") {
      console.log("Usage: node scripts/database-assurance-runner.mjs [--profile=local|integration|disaster] [--fail-fast] [--no-artifact] [--list]");
      process.exit(0);
    } else fail(`Unknown argument: ${value}.`);
  }
  return parsed;
}

function loadLocalEnvironment() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  try {
    loadEnvFile(envPath);
  } catch {
    fail("Unable to load .env.local. Fix its environment-file syntax before certification.");
  }
}

function gateResult(id, gate, status, durationMs, extra = {}) {
  return { id, name: gate.name, profile: gate.profile, status, duration_ms: durationMs, ...extra };
}

function writeArtifacts(payload) {
  const directory = path.join(process.cwd(), "outputs", "database-assurance");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = payload.completed_at.replace(/[:.]/g, "-");
  const json = path.join(directory, `${payload.profile}-${stamp}.json`);
  const markdown = path.join(directory, `${payload.profile}-${stamp}.md`);
  const latestJson = path.join(directory, "latest.json");
  const latestMarkdown = path.join(directory, "latest.md");
  const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
  const markdownText = renderMarkdown(payload);
  for (const [target, content] of [[json, jsonText], [markdown, markdownText], [latestJson, jsonText], [latestMarkdown, markdownText]]) {
    writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
  }
  return { json, markdown };
}

function renderMarkdown(payload) {
  const lines = [
    "# Pipeline Database Assurance",
    "",
    `- Result: **${payload.ok ? "PASS" : "NOT PASSED"}**`,
    `- Profile: \`${payload.profile}\``,
    `- Score: **${payload.score}** selected controls`,
    `- Duration: ${formatDuration(payload.duration_ms)}`,
    `- Completed: ${payload.completed_at}`,
    "",
    "## Gates",
    "",
    "| Gate | Required profile | Status | Duration |",
    "|---|---:|---:|---:|",
  ];
  for (const gate of payload.gates) {
    lines.push(`| ${gate.name} | ${gate.profile} | ${gate.status} | ${formatDuration(gate.duration_ms)} |`);
  }
  lines.push("", "## Controls", "", "| ID | Domain | Control | Status |", "|---|---|---|---:|");
  for (const control of payload.controls) {
    lines.push(`| ${control.id} | ${control.domainName} | ${control.title} | ${control.status} |`);
  }
  const blockedGates = payload.gates.filter((item) => item.status === "blocked");
  if (blockedGates.length > 0) {
    lines.push("", "## Blocked Evidence", "");
    for (const gate of blockedGates) lines.push(`- ${gate.name}: missing ${gate.missing_env.join(", ")}`);
  }
  lines.push("", `> ${payload.note}`, "");
  return lines.join("\n");
}

function printList() {
  for (const [id, gate] of Object.entries(databaseAssuranceGates)) {
    console.log(`${id.padEnd(22)} ${gate.profile.padEnd(12)} ${gate.name}`);
  }
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${(milliseconds / 60_000).toFixed(1)}m`;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

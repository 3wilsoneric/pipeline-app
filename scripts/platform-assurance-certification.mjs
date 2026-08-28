#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  assuranceControls,
  assuranceGates,
  assuranceTotals,
} from "./platform-assurance-registry.mjs";

const args = new Set(process.argv.slice(2));
const profile = valueFor("--profile") ?? "local";
const noArtifact = args.has("--no-artifact");
const startedAt = Date.now();
if (!["local", "live"].includes(profile)) fail(`Unknown assurance profile: ${profile}.`);

run("Assurance registry audit", "npm", ["run", "check:assurance"]);

const selectedControls = assuranceControls.filter((item) => profile === "live" || item.level === "local");
const selectedGateIds = new Set(selectedControls.map((item) => item.gate));
const gateOrder = [
  "deterministic",
  "production_build",
  "artifact_audit",
  "core_browser",
  "operational_browser",
  "desktop_browser",
  "cross_browser",
  "visual_browser",
  "live_access",
  "live_database",
  "live_packet",
  "live_collaboration",
  "live_load",
  "live_performance",
  "live_capacity",
  "live_restore",
];
const gateIds = gateOrder.filter((gateId) => selectedGateIds.has(gateId));
const gateResults = [];
let stopped = false;

for (const gateId of gateIds) {
  const gate = assuranceGates[gateId];
  const requiredEnv = gate.requiredEnv ?? [];
  const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
  if (missingEnv.length > 0) {
    gateResults.push({
      id: gateId,
      name: gate.name,
      ok: false,
      skipped: true,
      duration_ms: 0,
      missing_env: missingEnv,
    });
    stopped = true;
    break;
  }

  const commandArgs = typeof gate.args === "function" ? gate.args(process.env) : gate.args;
  const checkStartedAt = Date.now();
  process.stdout.write(`\n==> ${gate.name}\n`);
  try {
    execFileSync(gate.command, commandArgs, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, ...(gate.env ?? {}) },
    });
    gateResults.push({
      id: gateId,
      name: gate.name,
      ok: true,
      skipped: false,
      duration_ms: Date.now() - checkStartedAt,
    });
  } catch (error) {
    gateResults.push({
      id: gateId,
      name: gate.name,
      ok: false,
      skipped: false,
      duration_ms: Date.now() - checkStartedAt,
      exit_code: Number.isInteger(error.status) ? error.status : 1,
    });
    stopped = true;
    break;
  }
}

const gateById = new Map(gateResults.map((item) => [item.id, item]));
const controlResults = assuranceControls.map((item) => {
  const gate = gateById.get(item.gate);
  const selected = profile === "live" || item.level === "local";
  return {
    id: item.id,
    domain: item.domainName,
    title: item.title,
    level: item.level,
    points: item.points,
    status: !selected ? "pending_live" : gate?.ok ? "verified" : gate ? "failed" : "not_run",
  };
});
const verifiedPoints = controlResults
  .filter((item) => item.status === "verified")
  .reduce((sum, item) => sum + item.points, 0);
const localVerifiedPoints = controlResults
  .filter((item) => item.level === "local" && item.status === "verified")
  .reduce((sum, item) => sum + item.points, 0);
const liveVerifiedPoints = controlResults
  .filter((item) => item.level === "live" && item.status === "verified")
  .reduce((sum, item) => sum + item.points, 0);
const targetPoints = profile === "live" ? assuranceTotals.points : assuranceTotals.local;
const ok = !stopped && verifiedPoints === targetPoints;
const payload = {
  ok,
  profile,
  model: "pipeline-assurance-v1",
  score: `${verifiedPoints}/100`,
  verified_points: verifiedPoints,
  local_verified_points: localVerifiedPoints,
  live_verified_points: liveVerifiedPoints,
  target_points: targetPoints,
  production_certified_100: verifiedPoints === 100,
  duration_ms: Date.now() - startedAt,
  gates: gateResults,
  controls: controlResults,
  pending_live_controls: controlResults.filter((item) => item.status === "pending_live").map((item) => item.id),
  note: profile === "local"
    ? "A passing local profile proves 90/100. The remaining 10 points require explicit live infrastructure rehearsals."
    : "A passing live profile proves all 100 controls against deterministic, browser, and configured live infrastructure evidence.",
};

if (!noArtifact) writeArtifact(payload);
console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exit(1);

function run(name, command, commandArgs) {
  process.stdout.write(`\n==> ${name}\n`);
  try {
    execFileSync(command, commandArgs, { cwd: process.cwd(), stdio: "inherit", env: process.env });
  } catch (error) {
    fail(`${name} failed with exit code ${Number.isInteger(error.status) ? error.status : 1}.`);
  }
}

function valueFor(prefix) {
  const exact = [...args].find((item) => item.startsWith(`${prefix}=`));
  return exact ? exact.slice(prefix.length + 1) : null;
}

function writeArtifact(payload) {
  const directory = path.join(process.cwd(), "outputs", "platform-assurance");
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(path.join(directory, `${payload.profile}-${stamp}.json`), JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, profile, error: message }, null, 2));
  process.exit(1);
}

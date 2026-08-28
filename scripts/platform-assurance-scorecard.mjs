#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

import {
  assuranceControls,
  assuranceDomains,
  assuranceGates,
  assuranceTotals,
} from "./platform-assurance-registry.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const errors = [];
const ids = new Set();

if (assuranceDomains.length !== 10) errors.push(`Expected 10 assurance domains, found ${assuranceDomains.length}.`);
if (assuranceControls.length !== 100) errors.push(`Expected 100 assurance controls, found ${assuranceControls.length}.`);
if (assuranceTotals.points !== 100 || assuranceTotals.local !== 90 || assuranceTotals.live !== 10) {
  errors.push(`Expected a 90 local + 10 live point model, found ${JSON.stringify(assuranceTotals)}.`);
}

for (const domain of assuranceDomains) {
  if (domain.controls.length !== 10) errors.push(`${domain.name} must contain exactly 10 controls.`);
}

for (const item of assuranceControls) {
  if (ids.has(item.id)) errors.push(`Duplicate control id: ${item.id}.`);
  ids.add(item.id);
  if (!Object.hasOwn(assuranceGates, item.gate)) errors.push(`${item.id} references unknown gate ${item.gate}.`);
  for (const file of item.evidence) {
    if (!existsSync(file)) errors.push(`${item.id} evidence does not exist: ${file}.`);
  }
}

for (const [gateId, gate] of Object.entries(assuranceGates)) {
  if (!packageJson.scripts?.[gate.packageScript]) {
    errors.push(`${gateId} references missing package script ${gate.packageScript}.`);
  }
}

const domains = assuranceDomains.map((domain) => ({
  id: domain.id,
  name: domain.name,
  coverage_points: domain.controls.length,
  local_points: domain.controls.filter((item) => item.level === "local").length,
  live_points: domain.controls.filter((item) => item.level === "live").length,
}));
const payload = {
  ok: errors.length === 0,
  model: "pipeline-assurance-v1",
  control_coverage_score: errors.length === 0 ? assuranceTotals.points : 0,
  control_coverage_possible: 100,
  locally_verifiable_points: assuranceTotals.local,
  live_environment_points: assuranceTotals.live,
  domains,
  live_controls: assuranceControls
    .filter((item) => item.level === "live")
    .map((item) => ({ id: item.id, domain: item.domainName, title: item.title, gate: item.gate })),
  errors,
  interpretation: "100/100 means every control has executable evidence. Runtime certification is separate and cannot award live points when infrastructure proofs are missing.",
};

console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exit(1);

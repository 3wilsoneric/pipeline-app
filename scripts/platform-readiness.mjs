#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");

const checks = [
  {
    name: "Tracked repository hygiene",
    command: "node",
    args: ["scripts/code-hygiene-audit.mjs"],
  },
  {
    name: "Alamo Admissions zone contracts",
    command: "node",
    args: ["scripts/admissions-zone-contracts.mjs"],
  },
  {
    name: "Release compatibility",
    command: "node",
    args: ["scripts/release-compatibility.mjs"],
  },
  {
    name: "Generated property contracts",
    command: "node",
    args: ["scripts/property-contracts.mjs"],
  },
  {
    name: "Extraction quality score",
    command: "node",
    args: ["scripts/extraction-quality-score.mjs"],
  },
  {
    name: "12,000-page backlog orchestration rehearsal",
    command: "node",
    args: ["scripts/backlog-rehearsal.mjs"],
  },
  {
    name: "Database recovery safeguards",
    command: "node",
    args: ["scripts/recovery-readiness.mjs"],
  },
  {
    name: "Workspace-state retention safeguards",
    command: "node",
    args: ["scripts/workspace-retention-readiness.mjs"],
  },
  {
    name: "PHI-safe storage capacity inventory",
    command: "node",
    args: ["scripts/storage-capacity-readiness.mjs"],
  },
  {
    name: "Referral reliability replays",
    command: "node",
    args: ["scripts/referral-reliability-replay.mjs"],
  },
  {
    name: "Failure and recovery contracts",
    command: "node",
    args: ["scripts/failure-recovery-readiness.mjs"],
  },
  {
    name: "Deterministic chaos recovery replays",
    command: "node",
    args: ["scripts/chaos-recovery-replay.mjs"],
  },
  {
    name: "API behavior fixtures",
    command: "node",
    args: ["scripts/api-behavior-fixtures.mjs"],
  },
  {
    name: "Clinical integration contracts",
    command: "node",
    args: ["scripts/clinical-data-contracts.mjs"],
  },
  {
    name: "One-time clinical snapshot contracts",
    command: "node",
    args: ["scripts/demo-clinical-snapshot-contracts.mjs"],
  },
  {
    name: "One-time client history contracts",
    command: "node",
    args: ["scripts/client-history-contracts.mjs"],
  },
  {
    name: "Security boundary",
    command: "node",
    args: ["scripts/security-boundary-check.mjs"],
  },
  {
    name: "API method authorization matrix",
    command: "node",
    args: ["scripts/api-route-policy-audit.mjs"],
  },
  {
    name: "Live Entra access rehearsal safeguards",
    command: "node",
    args: ["scripts/live-access-rehearsal-readiness.mjs"],
  },
  {
    name: "Dependency license and integrity policy",
    command: "node",
    args: ["scripts/license-policy-audit.mjs"],
  },
  {
    name: "Supply-chain workflow readiness",
    command: "node",
    args: ["scripts/supply-chain-readiness.mjs"],
  },
  {
    name: "Path-aware CI impact behavior",
    command: "node",
    args: ["scripts/ci-change-impact-fixtures.mjs"],
  },
  {
    name: "Desktop distribution boundary",
    command: "node",
    args: ["scripts/desktop-readiness.mjs"],
  },
  {
    name: "Database and identity-link readiness",
    command: "node",
    args: ["scripts/database-readiness.mjs"],
  },
  {
    name: "Document processing state machine",
    command: "node",
    args: ["scripts/extraction-state-machine-replay.mjs"],
  },
  {
    name: "Databricks extraction worker contracts",
    command: "node",
    args: ["scripts/pipeline-extraction-worker-contracts.mjs"],
  },
  {
    name: "High-volume query audit",
    command: "node",
    args: ["scripts/query-plan-audit.mjs"],
  },
  {
    name: "Azure deployment scaffold",
    command: "node",
    args: ["scripts/infrastructure-readiness.mjs"],
  },
  {
    name: "Synthetic scale benchmark",
    command: "node",
    args: ["scripts/synthetic-scale-benchmark.mjs"],
  },
  {
    name: "Referral journey replays",
    command: "node",
    args: ["scripts/referral-journey-replay.mjs"],
  },
  {
    name: "Operational metric contracts",
    command: "node",
    args: ["scripts/operational-metrics-readiness.mjs"],
  },
  {
    name: "Synthetic operational metric workload",
    command: "node",
    args: ["scripts/operational-metric-fixtures.mjs"],
  },
  {
    name: "Azure operational alert contracts",
    command: "node",
    args: ["scripts/alerting-readiness.mjs"],
  },
  {
    name: "TypeScript",
    command: "node",
    args: [
      "./node_modules/typescript/bin/tsc",
      "--noEmit",
      "--pretty",
      "false",
      "--incremental",
      "false",
    ],
  },
  {
    name: "ESLint",
    command: "node",
    args: [
      "./node_modules/eslint/bin/eslint.js",
      "app",
      "components",
      "lib",
      "scripts",
      "--max-warnings=0",
    ],
  },
];

if (!skipBuild) {
  checks.push({
    name: "Production build",
    command: "npm",
    args: ["run", "build"],
  });
  checks.push({
    name: "Production browser artifact audit",
    command: "node",
    args: ["scripts/build-artifact-audit.mjs"],
  });
}

const startedAt = Date.now();
const results = [];

for (const check of checks) {
  const checkStartedAt = Date.now();
  process.stdout.write(`\n==> ${check.name}\n`);

  try {
    execFileSync(check.command, check.args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    results.push({
      name: check.name,
      ok: true,
      duration_ms: Date.now() - checkStartedAt,
    });
  } catch (error) {
    results.push({
      name: check.name,
      ok: false,
      duration_ms: Date.now() - checkStartedAt,
    });

    console.error(`\nReadiness failed at: ${check.name}`);
    console.error(JSON.stringify({ ok: false, results }, null, 2));
    process.exit(error.status ?? 1);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      duration_ms: Date.now() - startedAt,
      results,
    },
    null,
    2,
  ),
);

#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const tier = normalizeTier(valueFor("--tier") ?? process.env.PIPELINE_CERTIFICATION_TIER ?? "quick");
const strict = args.has("--strict");
const noArtifact = args.has("--no-artifact");
const startedAt = Date.now();

const tierChecks = {
  quick: [
    check("Platform deterministic readiness", "npm", ["run", "check:platform:fast"]),
  ],
  operator: [
    check("Platform deterministic readiness", "npm", ["run", "check:platform:fast"]),
    check("Operational role/workflow Playwright suite", "npm", ["run", "test:e2e:operational"]),
  ],
  release: [
    check("Full platform readiness with build", "npm", ["run", "check:platform"]),
    check("Core browser QA", "npm", ["run", "test:e2e"]),
    check("Operational role/workflow Playwright suite", "npm", ["run", "test:e2e:operational"]),
    check("Production browser artifact audit", "npm", ["run", "check:artifacts"]),
    check("Supply-chain readiness", "npm", ["run", "check:supply-chain"]),
  ],
  high_assurance: [
    check("Full platform readiness with build", "npm", ["run", "check:platform"]),
    check("Core browser QA", "npm", ["run", "test:e2e"]),
    check("Operational role/workflow Playwright suite", "npm", ["run", "test:e2e:operational"]),
    check("High-assurance operational Playwright suite", "npm", ["run", "test:e2e:operational:high"]),
    check("10x operational capacity model", "npm", ["run", "check:operations:capacity-model"]),
    check("Synthetic 100GB-class metadata scale benchmark", "npm", ["run", "check:scale"]),
    check("High-volume query audit", "npm", ["run", "check:queries"]),
    check("PHI-safe storage capacity inventory", "npm", ["run", "check:storage"]),
    check("Failure and recovery contracts", "npm", ["run", "check:failures"]),
    check("Deterministic chaos recovery replays", "npm", ["run", "check:chaos"]),
    check("Azure operational alert contracts", "npm", ["run", "check:alerts"]),
    check("Operational metric contracts", "npm", ["run", "check:metrics"]),
    check("Synthetic operational metric workload", "npm", ["run", "check:metrics:fixtures"]),
    check("API method authorization matrix", "npm", ["run", "check:route-policy"]),
    check("Security boundary", "npm", ["run", "check:security"]),
    check("Deployment readiness", "npm", ["run", "check:deployment"]),
    check("Production browser artifact audit", "npm", ["run", "check:artifacts"]),
    check("Supply-chain readiness", "npm", ["run", "check:supply-chain"]),
  ],
  capacity: [
    check("10x operational capacity model", "npm", ["run", "check:operations:capacity-model"]),
    check("Synthetic 100GB-class metadata scale benchmark", "npm", ["run", "check:scale"]),
    check("High-volume query audit", "npm", ["run", "check:queries"]),
    check("PHI-safe storage capacity inventory", "npm", ["run", "check:storage"]),
    gatedCheck(
      "HTTP capacity smoke",
      "node",
      ["scripts/http-capacity-smoke.mjs", ...remoteFlagFor("PIPELINE_CAPACITY_BASE_URL")],
      ["PIPELINE_CAPACITY_BASE_URL"],
    ),
  ],
  load: [
    gatedCheck(
      "HTTP load smoke",
      "node",
      ["scripts/http-load-smoke.mjs", ...remoteFlagFor("PIPELINE_LOAD_BASE_URL")],
      ["PIPELINE_LOAD_BASE_URL"],
    ),
    gatedCheck(
      "Collaboration contention smoke",
      "node",
      ["scripts/collaboration-load-smoke.mjs", ...remoteFlagFor("PIPELINE_COLLABORATION_BASE_URL")],
      ["PIPELINE_COLLABORATION_BASE_URL"],
    ),
    check("Synthetic 100GB-class metadata scale benchmark", "npm", ["run", "check:scale"]),
  ],
  live: [
    gatedCheck("Live Entra access rehearsal", "npm", ["run", "check:access:live"], ["PIPELINE_LIVE_CERTIFICATION"]),
    gatedCheck("Live PostgreSQL smoke", "npm", ["run", "check:database:live"], ["PIPELINE_LIVE_CERTIFICATION"]),
    gatedCheck("Live sample packet smoke", "npm", ["run", "check:sample-packet"], ["PIPELINE_LIVE_CERTIFICATION", "PIPELINE_SAMPLE_PACKET_PATH"]),
  ],
};

if (!Object.hasOwn(tierChecks, tier)) {
  console.error(JSON.stringify({
    ok: false,
    error: `Unknown operational certification tier: ${tier}`,
    allowed_tiers: Object.keys(tierChecks),
  }, null, 2));
  process.exit(1);
}

const results = [];
for (const item of tierChecks[tier]) {
  const missingEnv = item.requiredEnv.filter((name) => !process.env[name]?.trim());
  if (missingEnv.length > 0) {
    const result = {
      name: item.name,
      command: commandString(item),
      ok: !strict,
      skipped: true,
      duration_ms: 0,
      missing_env: missingEnv,
    };
    results.push(result);
    if (strict) break;
    continue;
  }

  const checkStartedAt = Date.now();
  process.stdout.write(`\n==> ${item.name}\n`);
  try {
    execFileSync(item.command, item.args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        PIPELINE_CERTIFICATION_TIER: tier,
      },
    });
    results.push({
      name: item.name,
      command: commandString(item),
      ok: true,
      skipped: false,
      duration_ms: Date.now() - checkStartedAt,
    });
  } catch (error) {
    results.push({
      name: item.name,
      command: commandString(item),
      ok: false,
      skipped: false,
      duration_ms: Date.now() - checkStartedAt,
      exit_code: Number.isInteger(error.status) ? error.status : 1,
    });
    break;
  }
}

const failed = results.filter((result) => !result.ok);
const payload = {
  ok: failed.length === 0,
  tier,
  strict,
  duration_ms: Date.now() - startedAt,
  results,
  skipped: results.filter((result) => result.skipped),
  failed,
  note: "Operational certification emits command names, statuses, durations, and env readiness only. It must not write PHI values to logs or artifacts.",
};

if (!noArtifact) writeArtifact(payload);
console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exit(1);

function check(name, command, commandArgs) {
  return {
    name,
    command,
    args: commandArgs,
    requiredEnv: [],
  };
}

function gatedCheck(name, command, commandArgs, requiredEnv) {
  return {
    name,
    command,
    args: commandArgs,
    requiredEnv,
  };
}

function valueFor(prefix) {
  const exact = [...args].find((arg) => arg.startsWith(`${prefix}=`));
  return exact ? exact.slice(prefix.length + 1) : null;
}

function normalizeTier(value) {
  if (value === "high" || value === "critical" || value === "enterprise") return "high_assurance";
  return value;
}

function commandString(item) {
  return [item.command, ...item.args].join(" ");
}

function remoteFlagFor(envName) {
  const value = process.env[envName]?.trim();
  if (!value) return [];
  try {
    const hostname = new URL(value).hostname;
    return ["localhost", "127.0.0.1", "::1"].includes(hostname) ? [] : ["--allow-remote"];
  } catch {
    return [];
  }
}

function writeArtifact(payload) {
  const outputDirectory = path.join(process.cwd(), "outputs", "operational-certification");
  mkdirSync(outputDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(outputDirectory, `${payload.tier}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
}

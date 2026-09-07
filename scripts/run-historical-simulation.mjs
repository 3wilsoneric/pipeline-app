#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertVerifiedTruthPacks,
  runConfirmation,
  summarizeHistoricalSimulation,
  validateHistoricalSimulationPlan,
} from "../lib/simulation/historical-simulation-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateSimulationRoot = path.join(repositoryRoot, ".data", "simulations");
const args = parseArgs(process.argv.slice(2));
const manifestPath = resolvePrivatePath(args.manifest ?? "", "--manifest");
const phase = oneOf(args.phase ?? "files", ["files", "full"], "--phase");
const mode = oneOf(args.mode ?? "busy_day", ["historical_replay", "busy_day", "interrupted", "chaos", "soak"], "--mode");
const execute = args.execute === true;
const inspect = args.inspect === true;
const port = integer(args.port ?? 3201, "--port", 1024, 65_535);

if (execute && args.confirm !== runConfirmation) fail(`Execution requires --confirm=${runConfirmation}.`);
if (!execute && args.confirm) fail("--confirm is accepted only with --execute.");
if (inspect && !execute) fail("--inspect requires --execute because it opens the populated isolated application.");

const plan = JSON.parse(await readFile(manifestPath, "utf8"));
validateHistoricalSimulationPlan(plan);
const corpusRoot = path.dirname(manifestPath);
await verifyMaterializedCorpus(plan, corpusRoot);

const truthPackPath = path.join(corpusRoot, "truth-packs.private.json");
if (phase === "full") {
  const truthPacks = JSON.parse(await readFile(truthPackPath, "utf8"));
  assertVerifiedTruthPacks(plan, truthPacks);
  for (const item of truthPacks.cases) {
    if (item.recommendation.outcome !== "accept" || item.supervisor_decision.outcome !== "accepted") {
      fail("The current full-lifecycle runner requires verified accept/accepted truth-pack outcomes.");
    }
  }
}

const preflight = {
  mode: execute ? "execute" : "dry_run",
  phase,
  simulation_mode: mode,
  interactive_inspection: inspect,
  materialized_corpus_verified: true,
  truth_packs_verified: phase === "full",
  summary: summarizeHistoricalSimulation(plan),
};

if (!execute) {
  process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
  process.exit(0);
}

const runId = `${plan.simulation_id}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const runRoot = path.join(privateSimulationRoot, "runs", runId);
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const commandArgs = [
  "playwright",
  "test",
  "-c",
  "playwright.operational.config.ts",
  "tests/e2e/operational/historical-corpus.scaffold.spec.ts",
];
if (inspect) commandArgs.push("--headed");

process.stdout.write(`${JSON.stringify({ ...preflight, run_id: runId }, null, 2)}\n`);
const exitCode = await run(command, commandArgs, {
  ...process.env,
  PORT: String(port),
  PIPELINE_NEXT_DIST_DIR: `.next-historical-simulation-${port}`,
  PIPELINE_HISTORICAL_SIMULATION: "true",
  PIPELINE_HISTORICAL_SIMULATION_MANIFEST: manifestPath,
  PIPELINE_HISTORICAL_TRUTH_PACKS: truthPackPath,
  PIPELINE_HISTORICAL_SIMULATION_PHASE: phase,
  PIPELINE_HISTORICAL_SIMULATION_MODE: mode,
  PIPELINE_HISTORICAL_INSPECT: inspect ? "true" : "false",
  PIPELINE_HISTORICAL_RUN_ROOT: runRoot,
});
process.exit(exitCode);

async function verifyMaterializedCorpus(plan, corpusRoot) {
  const expected = new Map();
  const materials = plan.cases.flatMap((item) => item.materials);
  for (const material of materials) registerExpectedObject(expected, corpusRoot, material);
  for (const [objectPath, expectation] of expected) {
    await verifyMaterializedObject(objectPath, expectation);
  }
}

function registerExpectedObject(expected, corpusRoot, material) {
  if (!material.source_available) return;
  if (!material.object_relpath) fail(`Materialized manifest has no object locator for ${material.material_id}.`);
  if (material.source_path) fail(`Materialized manifest retains a source path for ${material.material_id}.`);
  const objectPath = path.resolve(corpusRoot, material.object_relpath);
  if (!isChildPath(corpusRoot, objectPath)) fail(`Object path escapes the corpus root for ${material.material_id}.`);
  const current = expected.get(objectPath);
  if (current?.sha256 !== undefined && current.sha256 !== material.source_sha256) {
    fail(`Conflicting object digest for ${material.material_id}.`);
  }
  if (current?.size !== undefined && current.size !== material.source_byte_size) {
    fail(`Conflicting object size for ${material.material_id}.`);
  }
  expected.set(objectPath, { sha256: material.source_sha256, size: material.source_byte_size });
}

async function verifyMaterializedObject(objectPath, expectation) {
  const details = await stat(objectPath);
  if (!details.isFile()) fail(`Materialized object is not a file: ${objectPath}`);
  if (details.size !== expectation.size) fail(`Materialized object size is invalid: ${objectPath}`);
  if (!expectation.sha256) fail(`Materialized object digest is missing: ${objectPath}`);
  if (await sha256File(objectPath) !== expectation.sha256) fail(`Materialized object digest is invalid: ${objectPath}`);
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

function run(command, commandArgs, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repositoryRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`Historical simulation runner terminated by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

function resolvePrivatePath(value, flag) {
  if (!value) fail(`${flag} is required and must point to simulation.private.json.`);
  const resolved = path.resolve(repositoryRoot, value);
  if (!isChildPath(privateSimulationRoot, resolved)) fail(`${flag} must be inside ${privateSimulationRoot}.`);
  return resolved;
}

function isChildPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (value === "--execute") parsed.execute = true;
    else if (value === "--dry-run") parsed.execute = false;
    else if (value === "--inspect") parsed.inspect = true;
    else if (value.startsWith("--manifest=")) parsed.manifest = value.slice("--manifest=".length);
    else if (value.startsWith("--phase=")) parsed.phase = value.slice("--phase=".length);
    else if (value.startsWith("--mode=")) parsed.mode = value.slice("--mode=".length);
    else if (value.startsWith("--port=")) parsed.port = Number(value.slice("--port=".length));
    else if (value.startsWith("--confirm=")) parsed.confirm = value.slice("--confirm=".length);
    else fail(`Unknown argument: ${value}`);
  }
  return parsed;
}

function oneOf(value, allowed, flag) {
  if (!allowed.includes(value)) fail(`${flag} must be one of ${allowed.join(", ")}.`);
  return value;
}

function integer(value, flag, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    fail(`${flag} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

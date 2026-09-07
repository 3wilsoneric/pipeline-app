#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildHistoricalSimulationPlan,
  materializeConfirmation,
  summarizeHistoricalSimulation,
  truthPackTemplate,
  validateHistoricalSimulationPlan,
} from "../lib/simulation/historical-simulation-core.mjs";
import {
  hasVerifiedCleanScan,
  validateCloudManifest,
  validateLocalManifest,
} from "./allo-workspace-import-common.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const sourcePath = resolvePath(args.source ?? ".data/private-allo-workspace-import.json");
const scanPath = resolvePath(args.scan ?? ".data/private-allo-scanned-import.json");
const requestedOutput = args.output ? resolvePath(args.output) : null;
const execute = args.execute === true;

if (execute && args.confirm !== materializeConfirmation) {
  fail(`Materialization requires --confirm=${materializeConfirmation}.`);
}
if (!execute && args.confirm) fail("--confirm is accepted only with --execute.");

const localManifest = await readJson(sourcePath, "local ALLO manifest");
validateLocalManifest(localManifest);
const scannedManifest = await readJson(scanPath, "malware-scanned ALLO manifest");
validateCloudManifest(scannedManifest);
if (!hasVerifiedCleanScan(scannedManifest)) fail("The scan manifest does not contain a valid clean malware attestation.");

const plan = buildHistoricalSimulationPlan(localManifest, {
  count: args.count ?? 100,
  seed: args.seed,
});
validateHistoricalSimulationPlan(plan);
verifySelectedFilesAgainstScan(plan, scannedManifest);

if (!execute) {
  process.stdout.write(`${JSON.stringify({
    mode: "dry_run",
    source_verified: true,
    malware_scan_verified: true,
    would_materialize: summarizeHistoricalSimulation(plan),
  }, null, 2)}\n`);
  process.exit(0);
}

const outputPath = requestedOutput ?? path.join(repositoryRoot, ".data", "simulations", plan.simulation_id);
assertPrivateOutput(outputPath);
const materialized = await materializePlan(plan, outputPath);
process.stdout.write(`${JSON.stringify({
  mode: "materialized",
  output: path.relative(repositoryRoot, outputPath),
  malware_scan_verified: true,
  summary: summarizeHistoricalSimulation(materialized),
}, null, 2)}\n`);

async function materializePlan(sourcePlan, outputPath) {
  const parent = path.dirname(outputPath);
  const temporary = path.join(parent, `.${path.basename(outputPath)}.tmp-${randomUUID()}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await requireAbsent(outputPath);
  const planCopy = structuredClone(sourcePlan);
  await mkdir(temporary, { recursive: false, mode: 0o700 });
  try {
    const copiedObjects = new Set();
    await materializeMaterials(planCopy.cases.flatMap((item) => item.materials), temporary, copiedObjects);
    return await finalizeMaterializedPlan(planCopy, temporary, outputPath, copiedObjects.size);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function requireAbsent(outputPath) {
  try {
    await stat(outputPath);
    throw new Error(`Refusing to overwrite existing simulation directory: ${outputPath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function materializeMaterials(materials, temporary, copiedObjects) {
  for (const material of materials) await materializeMaterial(material, temporary, copiedObjects);
}

async function materializeMaterial(material, temporary, copiedObjects) {
  if (!material.source_available) return;
  if (!material.source_path) throw new Error(`Source path is missing for ${material.material_id}.`);
  const sourceStats = await stat(material.source_path);
  if (!sourceStats.isFile()) throw new Error(`Source material is not a file for ${material.material_id}.`);
  if (sourceStats.size !== material.source_byte_size) throw new Error(`Source material size changed for ${material.material_id}.`);
  const digest = await sha256File(material.source_path);
  if (material.source_sha256 && material.source_sha256 !== digest) {
    throw new Error(`Source material digest changed for ${material.material_id}.`);
  }
  material.source_sha256 = digest;
  material.object_relpath = `objects/sha256/${digest.slice(0, 2)}/${digest}`;
  await copyMaterialObject(material, temporary, copiedObjects);
}

async function copyMaterialObject(material, temporary, copiedObjects) {
  if (copiedObjects.has(material.source_sha256)) return;
  const destination = path.join(temporary, material.object_relpath);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const tempFile = `${destination}.tmp-${randomUUID()}`;
  await copyFile(material.source_path, tempFile);
  await chmod(tempFile, 0o600);
  if (await sha256File(tempFile) !== material.source_sha256) {
    throw new Error(`Staged digest mismatch for ${material.material_id}.`);
  }
  await rename(tempFile, destination);
  copiedObjects.add(material.source_sha256);
}

async function finalizeMaterializedPlan(plan, temporary, outputPath, objectCount) {
  materializedPathsOnly(plan);
  plan.materialized_at = new Date().toISOString();
  plan.materialized_object_count = objectCount;
  plan.summary = summarizeHistoricalSimulation(plan);
  await privateJson(path.join(temporary, "simulation.private.json"), plan);
  await privateJson(path.join(temporary, "simulation.summary.json"), plan.summary);
  await privateJson(path.join(temporary, "truth-packs.template.json"), truthPackTemplate(plan));
  await privateJson(path.join(temporary, "truth-packs.private.json"), truthPackTemplate(plan));
  await rename(temporary, outputPath);
  await chmod(outputPath, 0o700);
  return plan;
}

function materializedPathsOnly(plan) {
  for (const item of plan.cases) {
    for (const material of item.materials) {
      if (!material.object_relpath) continue;
      material.source_path = null;
    }
  }
}

function verifySelectedFilesAgainstScan(plan, scanManifest) {
  const scanned = new Map();
  for (const workspace of scanManifest.workspaces) {
    for (const file of workspace.files) {
      scanned.set(`${workspace.source_workspace_id}\u0000${file.source_item_id}`, file);
    }
  }
  for (const item of plan.cases) {
    for (const material of item.materials) {
      if (!material.source_available) continue;
      const match = scanned.get(`${item.source_workspace_id}\u0000${material.source_item_id}`);
      if (!match || match.source_byte_size !== material.source_byte_size) {
        throw new Error(`Selected source material is not covered by the clean scan attestation (${material.material_id}).`);
      }
      if (material.source_sha256 && match.source_sha256 !== material.source_sha256) {
        throw new Error(`Selected source material digest conflicts with the clean scan attestation (${material.material_id}).`);
      }
      material.source_sha256 = match.source_sha256;
      material.object_relpath = `objects/sha256/${match.source_sha256.slice(0, 2)}/${match.source_sha256}`;
    }
  }
}

async function privateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(filePath, 0o600);
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertPrivateOutput(outputPath) {
  const privateRoot = path.join(repositoryRoot, ".data", "simulations");
  const relative = path.relative(privateRoot, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`Simulation output must be a new child directory of ${privateRoot}.`);
  }
}

function resolvePath(value) {
  return path.resolve(repositoryRoot, String(value));
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (value === "--execute") parsed.execute = true;
    else if (value === "--dry-run") parsed.execute = false;
    else if (value.startsWith("--source=")) parsed.source = value.slice("--source=".length);
    else if (value.startsWith("--scan=")) parsed.scan = value.slice("--scan=".length);
    else if (value.startsWith("--output=")) parsed.output = value.slice("--output=".length);
    else if (value.startsWith("--count=")) parsed.count = Number(value.slice("--count=".length));
    else if (value.startsWith("--seed=")) parsed.seed = value.slice("--seed=".length);
    else if (value.startsWith("--confirm=")) parsed.confirm = value.slice("--confirm=".length);
    else fail(`Unknown argument: ${value}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

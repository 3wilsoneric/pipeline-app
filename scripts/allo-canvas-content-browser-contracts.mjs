#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateManifest } from "./allo-canvas-content-common.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "pipeline-allo-browser-contract-"));
const inventoryPath = path.join(directory, "inventory.csv");
const storageStatePath = path.join(directory, "storage-state.json");
const outputPath = path.join(directory, "capture.json");
const fixtureUrl = pathToFileURL(path.resolve("scripts/fixtures/allo-canvas-content/canvas.html")).href;
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

try {
  await writeFile(inventoryPath, `canvas_id,canvas_name,project_id,project_name,canvas_url\nsynthetic-canvas-1,Synthetic training canvas,synthetic-project,Synthetic project,${fixtureUrl}\n`, { mode: 0o600 });
  await writeFile(storageStatePath, `${JSON.stringify({ cookies: [], origins: [] })}\n`, { mode: 0o600 });
  execFileSync(process.execPath, [
    "scripts/capture-allo-canvas-content.mjs",
    `--inventory=${inventoryPath}`,
    `--output=${outputPath}`,
    `--storage-state=${storageStatePath}`,
    "--confirm=CAPTURE-AUTHORIZED-ALLO-CANVAS-CONTENT",
  ], { cwd: process.cwd(), stdio: "ignore" });
  const manifest = validateManifest(JSON.parse(await readFile(outputPath, "utf8")));
  const snapshot = manifest.snapshots[0];
  const allText = snapshot.blocks.map((block) => block.text).join("\n");
  const candidateText = snapshot.candidates.map((candidate) => candidate.proposed_value).join("\n");
  check("Playwright captures native DOM text into a canonical snapshot", manifest.canvas_count === 1 && manifest.block_count >= 7);
  check("application headers are excluded from capture", !allText.includes("Application header should not be captured"));
  check("headings deterministically produce a pending note candidate", manifest.candidate_count === 1 && candidateText.includes("[ALLO Summary]"));
  check("checkbox state is retained as structured evidence", snapshot.blocks.some((block) => block.block_type === "checkbox" && block.structured_value?.checked === true));
  check("captured content remains private on disk", ((await stat(outputPath)).mode & 0o777) === 0o600);
} finally {
  await rm(directory, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, scenarios: checks.length, checks }, null, 2));
if (failed.length) process.exit(1);

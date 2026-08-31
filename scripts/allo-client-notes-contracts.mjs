#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildManifest, finalizeSnapshot, manifestBytes } from "./allo-canvas-content-common.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "pipeline-client-notes-"));
const manifestPath = path.join(directory, "manifest.json");
const historyPath = path.join(directory, "history.json");
const crosswalkPath = path.join(directory, "crosswalk.csv");
const outputPath = path.join(directory, "combined.json");
const unresolvedPath = path.join(directory, "unresolved.json");
const summaryPath = path.join(directory, "summary.csv");

const matched = finalizeSnapshot({
  source_canvas_id: "canvas-matched",
  source_canvas_name: "Synthetic Person",
  source_project_id: "project-1",
  source_project_name: "Synthetic admissions",
  source_locator: "https://allo.invalid/canvas-matched",
  capture_method: "native_export",
  captured_at: "2026-08-01T00:00:00.000Z",
  blocks: [
    { block_type: "heading", text: "Summary" },
    { block_type: "paragraph", text: "Synthetic note requiring review." },
  ],
});
Object.assign(matched, {
  record_link_status: "exact",
  canonical_client_id: "canonical-1",
  canonical_link_status: "confirmed",
  canonical_match_method: "exact_name_dob",
});
const unmatched = finalizeSnapshot({
  source_canvas_id: "canvas-unmatched",
  source_canvas_name: "Unresolved Synthetic Person",
  source_project_id: "project-1",
  source_project_name: "Synthetic admissions",
  source_locator: "https://allo.invalid/canvas-unmatched",
  capture_method: "native_export",
  captured_at: "2026-08-02T00:00:00.000Z",
  blocks: [{ block_type: "paragraph", text: "Unscoped unresolved evidence." }],
});
Object.assign(unmatched, {
  record_link_status: "missing",
  canonical_client_id: null,
  canonical_link_status: "unmatched",
  canonical_match_method: null,
});

await writeFile(manifestPath, manifestBytes(buildManifest([matched, unmatched])), { mode: 0o600 });
await writeFile(historyPath, manifestBytes({
  episodes: [{
    resident_number: "resident-1",
    resident_name: "Synthetic Person",
    date_of_birth: "1980-02-03",
    admit_date: "2026-01-01",
  }],
}), { mode: 0o600 });
await writeFile(crosswalkPath,
  "resident_number,resident_name,date_of_birth,canonical_client_id,canonical_resident_name,identity_rule,identity_review_status\n"
    + "resident-1,Synthetic Person,1980-02-03,canonical-1,Synthetic Person,exact_name_dob,confirmed\n",
  { mode: 0o600 });

execFileSync(process.execPath, [
  "scripts/combine-allo-client-notes.mjs",
  `--manifest=${manifestPath}`,
  `--history=${historyPath}`,
  `--identity-crosswalk=${crosswalkPath}`,
  `--output=${outputPath}`,
  `--unresolved=${unresolvedPath}`,
  `--summary=${summaryPath}`,
], { cwd: process.cwd(), stdio: "ignore" });

const combined = JSON.parse(await readFile(outputPath, "utf8"));
const unresolved = JSON.parse(await readFile(unresolvedPath, "utf8"));
const summary = await readFile(summaryPath, "utf8");
const modes = await Promise.all([outputPath, unresolvedPath, summaryPath]
  .map(async (filePath) => (await stat(filePath)).mode & 0o777));
const client = combined.clients[0];
const checks = [
  ["exact canvas content is grouped under its canonical client", combined.counts.matched_canvas_count === 1
    && client.canonical_client_id === "canonical-1" && client.allo_content.canvas_count === 1],
  ["existing client episodes remain attached", client.existing_history.episode_count === 1],
  ["note candidates remain pending and retain source blocks",
    client.allo_content.canvases[0].note_candidates[0].review_status === "pending"
      && client.allo_content.canvases[0].source_content.block_count === 2],
  ["unresolved canvases are quarantined outside client records",
    unresolved.unresolved_canvas_count === 1 && unresolved.canvases[0].source_canvas_id === "canvas-unmatched"],
  ["summary output is keyed by canonical client ID", summary.includes("canonical_client_id")
    && summary.includes("canonical-1")],
  ["all client merge artifacts are owner-readable only", modes.every((mode) => mode === 0o600)],
];
const results = checks.map(([name, ok]) => ({ name, ok: Boolean(ok) }));
console.log(JSON.stringify({ ok: results.every((result) => result.ok), scenarios: results.length, checks: results }, null, 2));
if (results.some((result) => !result.ok)) process.exit(1);

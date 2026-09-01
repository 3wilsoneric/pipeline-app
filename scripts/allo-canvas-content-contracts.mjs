#!/usr/bin/env node

import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  buildManifest,
  finalizeSnapshot,
  manifestBytes,
  validateManifest,
} from "./allo-canvas-content-common.mjs";
import { createCanvasRecordLinker } from "./allo-canvas-record-linking.mjs";

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });
const snapshotInput = {
  source_canvas_id: "synthetic-canvas-1",
  source_canvas_name: "Synthetic training canvas",
  source_project_id: "synthetic-project",
  source_project_name: "Synthetic project",
  source_locator: "https://allo.io/home?task=synthetic-canvas-1",
  capture_method: "native_export",
  blocks: [
    { block_type: "heading", text: "Summary" },
    { block_type: "paragraph", text: "Client denies current safety concerns; historical concern remains unverified." },
    { block_type: "text", text: "Open canvas" },
    { block_type: "heading", text: "Interview" },
    { block_type: "list_item", text: "Reports sleeping well." },
    { block_type: "heading", text: "Medication" },
    { block_type: "paragraph", text: "Medication details require human confirmation." },
  ],
};
const first = finalizeSnapshot({ ...snapshotInput, captured_at: "2026-01-01T00:00:00.000Z" });
const second = finalizeSnapshot({ ...snapshotInput, captured_at: "2026-02-01T00:00:00.000Z" });
const manifest = buildManifest([first], { created_at: "2026-01-01T00:00:00.000Z" });

check("native content produces one conservative assessment-note candidate",
  first.candidates.length === 1 && first.candidates[0].target_field_key === "assessment_notes");
check("negation and uncertainty are preserved verbatim",
  first.candidates[0].proposed_value.includes("denies current safety concerns")
    && first.candidates[0].proposed_value.includes("remains unverified"));
check("application chrome is excluded from the candidate", !first.candidates[0].proposed_value.includes("Open canvas"));
check("medication narrative is preserved as a note rather than inferred into medication fields",
  first.candidates[0].proposed_value.includes("[ALLO Medication]")
    && first.candidates.every((candidate) => candidate.target_field_key !== "medications_at_intake"));
check("capture time does not create a false content revision", first.source_sha256 === second.source_sha256);
check("manifest validation accepts canonical snapshots", validateManifest(manifest) === manifest);

const recordLinker = createCanvasRecordLinker([
  {
    source_workspace_id: "synthetic-canvas-1",
    profile_candidates: [{ resident_name: "Synthetic Person", date_of_birth: "1980-02-03" }],
  },
], [{
  resident_name: "Synthetic Person",
  date_of_birth: "02/03/1980",
  canonical_client_id: "canonical-synthetic-1",
}]);
const confirmedLink = recordLinker.resolve("synthetic-canvas-1");
const missingLink = recordLinker.resolve("synthetic-canvas-missing");
check("canvas identity links through exact workspace ID and exact name plus DOB",
  confirmedLink.record_link_status === "exact"
    && confirmedLink.canonical_client_id === "canonical-synthetic-1"
    && confirmedLink.canonical_match_method === "exact_name_dob");
check("missing workspace identities remain explicitly unmatched",
  missingLink.record_link_status === "missing"
    && missingLink.canonical_client_id === null
    && missingLink.canonical_link_status === "unmatched");
const formLinked = recordLinker.resolve("synthetic-canvas-missing", {
  blocks: ["NAME", "GENDER", "AGE", "DOB", "Synthetic Person", "Female", "46", "02/03/1980"]
    .map((text) => ({ text })),
});
check("captured referral forms link by exact name plus DOB without requiring an older file record",
  formLinked.record_link_status === "missing"
    && formLinked.canonical_client_id === "canonical-synthetic-1"
    && formLinked.canonical_link_status === "confirmed");
const disagreementLinker = createCanvasRecordLinker([
  {
    source_workspace_id: "synthetic-canvas-conflict",
    profile_candidates: [{ resident_name: "Synthetic Person", date_of_birth: "1980-02-03" }],
  },
], [
  { resident_name: "Synthetic Person", date_of_birth: "02/03/1980", canonical_client_id: "canonical-synthetic-1" },
  { resident_name: "Different Person", date_of_birth: "02/03/1980", canonical_client_id: "canonical-synthetic-2" },
]);
const disagreement = disagreementLinker.resolve("synthetic-canvas-conflict", {
  blocks: ["NAME", "GENDER", "AGE", "DOB", "Different Person", "Female", "46", "02/03/1980"]
    .map((text) => ({ text })),
});
check("conflicting exact identity evidence is quarantined instead of merged",
  disagreement.canonical_link_status === "ambiguous" && disagreement.canonical_client_id === null);

const tampered = structuredClone(manifest);
tampered.snapshots[0].blocks[1].text = "tampered";
let tamperingRejected = false;
try {
  validateManifest(tampered);
} catch {
  tamperingRejected = true;
}
check("content tampering invalidates the block or snapshot digest", tamperingRejected);

const noHeading = finalizeSnapshot({
  ...snapshotInput,
  source_canvas_id: "synthetic-canvas-2",
  blocks: [{ block_type: "paragraph", text: "Unscoped text is preserved but not mapped." }],
});
check("unscoped text is not silently classified", noHeading.block_count === 1 && noHeading.candidates.length === 0);

const legacyRenderedForm = finalizeSnapshot({
  ...snapshotInput,
  source_canvas_id: "synthetic-canvas-legacy-form",
  blocks: [
    { block_type: "paragraph", text: "Responsible Person:" },
    { block_type: "paragraph", text: "Synthetic coordinator" },
    { block_type: "paragraph", text: "Client is alert and oriented, reports sleeping six hours, and denies current AH or VH." },
    { block_type: "heading", text: "Summary" },
    { block_type: "heading", text: "Interview" },
    { block_type: "heading", text: "Instructions" },
  ],
});
check("legacy rendered forms recover narrative placed before the visual Summary heading",
  legacyRenderedForm.candidates.length === 1
    && legacyRenderedForm.candidates[0].proposed_value.includes("alert and oriented")
    && !legacyRenderedForm.candidates[0].proposed_value.includes("Instructions"));

const directory = await mkdtemp(path.join(tmpdir(), "pipeline-allo-content-"));
const markdownPath = path.join(directory, "content.md");
const csvPath = path.join(directory, "index.csv");
const outputPath = path.join(directory, "manifest.json");
await writeFile(markdownPath, "# Summary\n- Synthetic observation\n# Interview\nSynthetic answer\n", { mode: 0o600 });
await writeFile(csvPath, `canvas_id,canvas_name,project_id,project_name,canvas_url,content_path,capture_method\nsynthetic-3,Synthetic canvas,,,https://allo.io/home?task=synthetic-3,${markdownPath},copy_as_markdown\n`, { mode: 0o600 });
execFileSync(process.execPath, ["scripts/prepare-allo-canvas-content.mjs", `--input=${csvPath}`, `--output=${outputPath}`], {
  cwd: process.cwd(),
  stdio: "ignore",
});
const prepared = validateManifest(JSON.parse(await readFile(outputPath, "utf8")));
const mode = (await stat(outputPath)).mode & 0o777;
check("operator-supplied Markdown normalizes into the same manifest contract",
  prepared.canvas_count === 1 && prepared.block_count === 4 && prepared.candidate_count === 1);
check("private manifests are owner-readable only", mode === 0o600);

const importer = readFileSync("scripts/import-allo-canvas-content.mjs", "utf8");
const migration = readFileSync("database/migrations/0020_allo_canvas_content.sql", "utf8");
check("database linkage uses exact ALLO canvas identity and never a person name",
  importer.includes("source_workspace_id = ${snapshot.source_canvas_id}")
    && !/display_name\s*=|source_canvas_name\s*=/.test(importer));
check("canonical identity is stored as corroborating evidence rather than a name join",
  migration.includes("canonical_client_id text")
    && migration.includes("canonical_match_method")
    && importer.includes("canonical_identity_conflict")
    && importer.includes("snapshot.canonical_client_id"));
check("assessment candidates remain review-gated",
  migration.includes("review_status text not null default 'pending'")
    && migration.includes("review_status in ('pending', 'accepted', 'edited', 'rejected', 'applied')")
    && !importer.includes("insert into pipeline.assessments")
    && !importer.includes("update pipeline.assessments"));
check("immutable snapshots can participate in more than one retry batch",
  migration.includes("canvas_content_import_batch_snapshots")
    && importer.includes("on conflict (canvas_content_import_batch_id, canvas_content_snapshot_id) do nothing"));
check("manifest bytes are stable JSON with a terminal newline", manifestBytes(manifest).at(-1) === 10);

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, scenarios: checks.length, checks }, null, 2));
if (failed.length) process.exit(1);

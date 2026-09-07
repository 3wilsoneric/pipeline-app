#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertVerifiedTruthPacks,
  buildHistoricalSimulationPlan,
  summarizeHistoricalSimulation,
  truthPackTemplate,
  validateHistoricalSimulationPlan,
} from "../lib/simulation/historical-simulation-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = fixtureManifest();
const first = buildHistoricalSimulationPlan(manifest, { count: 4, seed: "contract-seed" });
const second = buildHistoricalSimulationPlan(manifest, { count: 4, seed: "contract-seed" });

run("selection and action plans are deterministic", () => {
  assert.deepEqual(first, second);
  assert.equal(first.cases.length, 4);
  assert.equal(new Set(first.cases.map((item) => item.case_id)).size, 4);
});

run("community selection is proportional and retains coverage", () => {
  assert.deepEqual(first.summary.community_counts, { "Community A": 3, "Community B": 1 });
});

run("all source materials receive an explicit disposition", () => {
  const dispositions = new Set(first.cases.flatMap((item) => item.materials.map((file) => file.disposition)));
  assert(dispositions.has("upload"));
  assert(dispositions.has("unsupported_type"));
  assert(dispositions.has("over_limit"));
  assert(dispositions.has("missing_source"));
});

run("historical action times preserve workflow order", () => {
  validateHistoricalSimulationPlan(first);
  for (const item of first.cases) {
    const times = item.actions.map((action) => Date.parse(action.logical_time));
    for (let index = 1; index < times.length; index += 1) {
      assert(times[index] >= times[index - 1], `${item.case_id} action ${index} is out of order`);
    }
  }
});

run("aggregate summaries contain no names or source paths", () => {
  const summaryText = JSON.stringify(summarizeHistoricalSimulation(first));
  assert.equal(summaryText.includes("Historical Person"), false);
  assert.equal(summaryText.includes("Owner One"), false);
  assert.equal(summaryText.includes("/private/"), false);
  assert.equal(first.summary.contains_names_or_source_paths, false);
});

run("full lifecycle remains blocked until every truth pack is verified", () => {
  const packs = truthPackTemplate(first);
  assert.throws(() => assertVerifiedTruthPacks(first, packs), /not human-verified/);
  for (const item of packs.cases) {
    item.review_status = "verified";
    item.assessment_data = { resident_name: "Source-reviewed fixture" };
    item.recommendation = { outcome: "accept", reason_code: "clinical_fit", reason_note: "Reviewed fixture" };
    item.supervisor_decision = { outcome: "accepted", reason_code: "", reason_note: "" };
    item.provenance = [{ material_id: "fixture", page: 1, reviewed_by: "human" }];
  }
  assert.doesNotThrow(() => assertVerifiedTruthPacks(first, packs));
});

const uploadSource = await readFile(path.join(repositoryRoot, "lib/pipeline/referral-packet-upload.ts"), "utf8");
run("supporting files persist real bytes through the isolated local backend", () => {
  const supportingBranch = uploadSource.slice(uploadSource.indexOf("export async function uploadReferralSupportingDocument"));
  assert.match(supportingBranch, /isMockUploadUrl\(target\.signed_url\)/);
  assert.match(supportingBranch, /writeLocalReservedFile\(reservation\.packet_id, fileId, file\)/);
});

process.stdout.write("Historical simulation contracts passed.\n");

function fixtureManifest() {
  const workspaces = Array.from({ length: 6 }, (_, index) => ({
    source_workspace_id: `workspace-${index + 1}`,
    source_workspace_name: `Historical Person ${index + 1}`,
    display_name: `Historical Person ${index + 1}`,
    community: index < 4 ? "Community A" : "Community B",
    historical_stage: "Admitted",
    primary_owner: index === 5 ? null : index % 2 === 0 ? "Owner One" : "Owner Two",
    profile_candidates: [{
      resident_name: `Historical Person ${index + 1}`,
      resident_number: `R-${index + 1}`,
      date_of_birth: "1980-01-01",
      admit_date: `2025-0${(index % 6) + 1}-15`,
      discharge_date: null,
      community: index < 4 ? "Community A" : "Community B",
      resident_status: "Active",
    }],
    first_material_at: `2025-0${(index % 6) + 1}-01T12:00:00.000Z`,
    material_count: 4,
    files: [
      fixtureFile(index, "packet.pdf", "application/pdf", 1_024, true),
      fixtureFile(index, "legacy.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 2_048, true),
      fixtureFile(index, "oversized.pdf", "application/pdf", 100 * 1024 * 1024 + 1, true),
      fixtureFile(index, "missing.png", "image/png", 512, false),
    ],
  }));
  return {
    version: 1,
    data_class: "user_supplied_real",
    source_system: "allo",
    workspace_count: workspaces.length,
    material_count: workspaces.reduce((sum, item) => sum + item.files.length, 0),
    workspaces,
  };
}

function fixtureFile(index, name, contentType, size, available) {
  return {
    source_item_id: `${index}-${name}`,
    source_file_name: name,
    source_content_type: contentType,
    source_byte_size: size,
    source_sha256: String(index + 1).padStart(64, "0"),
    source_created_at: "2025-01-01T12:00:00.000Z",
    document_category: name === "packet.pdf" ? "referral_packet" : "other",
    source_available: available,
    source_path: available ? `/private/${index}/${name}` : null,
  };
}

function run(name, callback) {
  try {
    callback();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n`);
    throw error;
  }
}

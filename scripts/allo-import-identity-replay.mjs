#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  classifySourceRevision,
  cloudManifest,
  isPinnedManifestCurrent,
  manifestBytes,
  sha256,
  stableBlobKey,
} from "./allo-workspace-import-common.mjs";

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

check("different documents with identical filenames remain distinct",
  stableBlobKey("workspace", "item-a", "packet.pdf") !== stableBlobKey("workspace", "item-b", "packet.pdf")
    && classifySourceRevision(
      { source_item_id: "item-a", source_file_name: "packet.pdf", source_sha256: digestA },
      { source_item_id: "item-b", source_file_name: "packet.pdf", source_sha256: digestB },
    ) === "distinct_source_item");
check("a rescan of the same source item cannot silently overwrite prior bytes",
  classifySourceRevision(
    { source_item_id: "item-a", source_file_name: "packet.pdf", source_sha256: digestA },
    { source_item_id: "item-a", source_file_name: "packet.pdf", source_sha256: digestB },
  ) === "source_revision_review");
check("identical bytes under different source ids require duplicate-content review",
  classifySourceRevision(
    { source_item_id: "item-a", source_file_name: "first.pdf", source_sha256: digestA },
    { source_item_id: "item-b", source_file_name: "second.pdf", source_sha256: digestA },
  ) === "duplicate_content_review");
check("same source id and digest is restart-idempotent",
  classifySourceRevision(
    { source_item_id: "item-a", source_file_name: "first.pdf", source_sha256: digestA },
    { source_item_id: "item-a", source_file_name: "renamed.pdf", source_sha256: digestA },
  ) === "unchanged");

const local = {
  version: 1,
  data_class: "user_supplied_real",
  source_system: "allo",
  workspace_count: 1,
  material_count: 1,
  available_file_count: 1,
  missing_file_count: 0,
  workspaces: [{
    source_workspace_id: "workspace",
    source_workspace_name: "Synthetic workspace",
    project_id: null,
    project_name: null,
    community: "San Pablo",
    display_name: "Synthetic person",
    primary_owner: null,
    owner_candidates: [],
    profile_candidates: [],
    material_count: 1,
    available_file_count: 1,
    missing_file_count: 0,
    first_material_at: null,
    files: [{
      source_item_id: "item-a",
      source_file_name: "packet.pdf",
      source_content_type: "application/pdf",
      source_byte_size: 100,
      source_sha256: digestA,
      source_created_at: null,
      source_page: null,
      source_page_title: null,
      source_file_category: null,
      document_category: "referral_packet",
      source_path: "/synthetic/packet.pdf",
      source_available: true,
    }],
  }],
};
const manifest = cloudManifest(local, "raw");
const pinned = sha256(manifestBytes(manifest));
check("an unchanged manifest remains pinned during a job", isPinnedManifestCurrent(pinned, manifest));
const repulled = structuredClone(manifest);
repulled.workspaces[0].files[0].source_sha256 = digestB;
check("a re-pull that changes bytes invalidates the in-flight manifest pin", !isPinnedManifestCurrent(pinned, repulled));

const uploader = readFileSync("scripts/upload-allo-workspace-materials.mjs", "utf8");
const importer = readFileSync("scripts/import-allo-material-workspaces.mjs", "utf8");
check("existing Blob bytes are verified against size and digest", uploader.includes("existing_blob_mismatch")
  && uploader.includes("sourceSha256"));
check("import batches are idempotent on the complete manifest digest", importer.includes("on conflict (source_system, manifest_sha256)"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, scenarios: checks.length, checks }, null, 2));
if (failed.length) process.exit(1);

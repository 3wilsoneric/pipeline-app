import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateCanvasRecordLink } from "./allo-canvas-record-linking.mjs";

export const alloCanvasContentVersion = 1;
export const captureConfirmation = "CAPTURE-AUTHORIZED-ALLO-CANVAS-CONTENT";
export const uploadConfirmation = "UPLOAD-ALLO-CANVAS-CONTENT";
export const importConfirmation = "IMPORT-ALLO-CANVAS-CONTENT";
export const reviewConfirmation = "REVIEW-ALLO-CANVAS-CONTENT";

const blockTypes = new Set([
  "checkbox",
  "heading",
  "input",
  "list_item",
  "paragraph",
  "table_cell",
  "text",
]);
const captureMethods = new Set(["browser_dom", "copy_as_markdown", "native_export"]);
const headingAliases = new Map([
  ["assessment", "assessment"],
  ["assessment notes", "assessment"],
  ["assessment note", "assessment"],
  ["assessment questionnaire", "assessment"],
  ["interview", "interview"],
  ["interview notes", "interview"],
  ["medication", "medication"],
  ["medications", "medication"],
  ["medication list", "medication"],
  ["meds", "medication"],
  ["post assessment", "post_assessment"],
  ["post-assessment", "post_assessment"],
  ["post assessment questionnaire", "post_assessment"],
  ["pre assessment", "pre_assessment"],
  ["pre-assessment", "pre_assessment"],
  ["pre assessment questionnaire", "pre_assessment"],
  ["referral information", "referral"],
  ["referral info", "referral"],
  ["summary", "summary"],
]);
const candidateSections = new Set([
  "assessment",
  "interview",
  "medication",
  "post_assessment",
  "pre_assessment",
  "summary",
]);
const ignoredText = new Set([
  "activity",
  "add a subtask",
  "add due date",
  "back to",
  "canvas",
  "collaborators",
  "connected",
  "created by",
  "due date",
  "google docs",
  "open canvas",
  "related links",
  "section",
  "subtasks",
  "tags",
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function manifestBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function normalizeHeading(value) {
  return normalizeText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[.:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stableBlockId(canvasId, block) {
  const identity = [
    canvasId,
    block.page_number ?? "",
    block.locator ?? "",
    block.ordinal,
    block.block_type,
    normalizeText(block.text),
    JSON.stringify(block.structured_value ?? null),
  ].join("\u0000");
  return `block_${sha256(identity).slice(0, 32)}`;
}

export function finalizeSnapshot(input) {
  const blocks = input.blocks.map((block, index) => {
    const normalized = {
      source_block_id: "",
      page_number: positiveIntegerOrNull(block.page_number),
      page_title: nullableText(block.page_title, 500),
      ordinal: index + 1,
      block_type: blockTypes.has(block.block_type) ? block.block_type : "text",
      semantic_role: nullableText(block.semantic_role, 100),
      heading_path: Array.isArray(block.heading_path)
        ? block.heading_path.map((item) => normalizeText(item)).filter(Boolean).slice(0, 12)
        : [],
      text: normalizeText(block.text),
      structured_value: block.structured_value ?? null,
      locator: nullableText(block.locator, 2_000),
      bounding_box: validBoundingBox(block.bounding_box),
    };
    normalized.source_block_id = stableBlockId(input.source_canvas_id, normalized);
    return normalized;
  }).filter((block) => block.text || block.structured_value !== null);

  const sourcePayload = {
    source_canvas_id: input.source_canvas_id,
    source_canvas_name: input.source_canvas_name,
    source_project_id: input.source_project_id ?? null,
    source_project_name: input.source_project_name ?? null,
    source_locator: input.source_locator,
    capture_method: input.capture_method,
    blocks,
  };
  const sourceSha256 = sha256(manifestBytes(sourcePayload));
  const snapshot = {
    ...sourcePayload,
    captured_at: input.captured_at ?? new Date().toISOString(),
    source_sha256: sourceSha256,
    block_count: blocks.length,
    raw_blob_container: input.raw_blob_container ?? null,
    raw_blob_key: input.raw_blob_key ?? null,
    blocks,
  };
  snapshot.candidates = deriveAssessmentCandidates(snapshot);
  return snapshot;
}

export function deriveAssessmentCandidates(snapshot) {
  const sections = sectionedBlocks(snapshot.blocks);
  if (sections.length === 0) return [];
  const note = groupSections(sections).map(renderSection).filter(Boolean).join("\n\n");
  if (!note) return [];

  return [{
    target_field_key: "assessment_notes",
    proposed_value: note,
    mapping_confidence: 0.95,
    source_block_ids: sections.map((item) => item.block.source_block_id),
    review_status: "pending",
  }];
}

function sectionedBlocks(blocks) {
  const sections = [];
  let currentSection = null;
  let currentLabel = null;
  for (const block of blocks) {
    const text = normalizeText(block.text);
    if (!text) continue;
    const heading = recognizedHeading(text);
    if (heading) {
      currentSection = heading.section;
      currentLabel = heading.label;
      continue;
    }
    if (block.block_type === "heading") {
      currentSection = null;
      currentLabel = null;
      continue;
    }
    if (!currentSection || !candidateSections.has(currentSection)) continue;
    if (isIgnoredText(text) || block.block_type === "input") continue;
    sections.push({ section: currentSection, label: currentLabel, block });
  }
  return sections;
}

function groupSections(sections) {
  const grouped = [];
  for (const item of sections) {
    const previous = grouped.at(-1);
    if (!previous || previous.section !== item.section || previous.label !== item.label) {
      grouped.push({ section: item.section, label: item.label, blocks: [item.block] });
    } else {
      previous.blocks.push(item.block);
    }
  }
  return grouped;
}

function renderSection(group) {
  const body = group.blocks.map((block) => blockText(block)).filter(Boolean).join("\n");
  return body ? `[ALLO ${group.label}]\n${body}` : "";
}

export function buildManifest(snapshots, metadata = {}) {
  const ordered = [...snapshots].sort((left, right) =>
    left.source_canvas_id.localeCompare(right.source_canvas_id, "en")
      || left.source_sha256.localeCompare(right.source_sha256, "en"));
  return {
    version: alloCanvasContentVersion,
    data_class: "user_supplied_real",
    source_system: "allo",
    created_at: metadata.created_at ?? new Date().toISOString(),
    capture_scope: metadata.capture_scope ?? "authorized_workspace",
    canvas_count: ordered.length,
    block_count: ordered.reduce((sum, snapshot) => sum + snapshot.block_count, 0),
    candidate_count: ordered.reduce((sum, snapshot) => sum + snapshot.candidates.length, 0),
    record_link_count: ordered.filter((snapshot) => snapshot.record_link_status === "exact").length,
    canonical_client_count: ordered.filter((snapshot) => snapshot.canonical_link_status === "confirmed").length,
    identity_exception_count: ordered.filter((snapshot) =>
      new Set(["ambiguous", "unmatched"]).has(snapshot.canonical_link_status)).length,
    snapshots: ordered,
  };
}

export function validateManifest(value, options = {}) {
  validateManifestHeader(value);
  validateSnapshotCollection(value);
  const totals = validateManifestSnapshots(value.snapshots, options);
  if (totals.blocks !== value.block_count) fail("manifest_count_mismatch");
  if (totals.candidates !== value.candidate_count) fail("manifest_count_mismatch");
  return value;
}

function validateManifestHeader(value) {
  if (!value || typeof value !== "object") fail("manifest_invalid");
  if (Array.isArray(value)) fail("manifest_invalid");
  if (value.version !== alloCanvasContentVersion) fail("manifest_invalid");
  if (value.data_class !== "user_supplied_real") fail("manifest_invalid");
  if (value.source_system !== "allo") fail("manifest_invalid");
}

function validateSnapshotCollection(value) {
  if (!Array.isArray(value.snapshots)) fail("canvas_count_mismatch");
  if (value.snapshots.length !== value.canvas_count) fail("canvas_count_mismatch");
}

function validateManifestSnapshots(snapshots, options) {
  const canvasIds = new Set();
  let blockCount = 0;
  let candidateCount = 0;
  for (const snapshot of snapshots) {
    validateSnapshot(snapshot, options);
    const key = `${snapshot.source_canvas_id}\u0000${snapshot.source_sha256}`;
    if (canvasIds.has(key)) fail("duplicate_snapshot");
    canvasIds.add(key);
    blockCount += snapshot.block_count;
    candidateCount += snapshot.candidates.length;
  }
  return { blocks: blockCount, candidates: candidateCount };
}

export function validateSnapshot(snapshot, options = {}) {
  validateSnapshotHeader(snapshot, options);
  validateCanvasRecordLink(snapshot);
  const ids = validateBlocks(snapshot);
  validateCandidates(snapshot.candidates, ids);
  validateSnapshotDigest(snapshot);
  return snapshot;
}

function validateSnapshotHeader(snapshot, options) {
  if (!snapshot || typeof snapshot !== "object") fail("snapshot_invalid");
  if (Array.isArray(snapshot)) fail("snapshot_invalid");
  validateSnapshotIdentity(snapshot);
  validateSnapshotCollections(snapshot);
  validateSnapshotStorage(snapshot, options);
}

function validateSnapshotIdentity(snapshot) {
  requiredText(snapshot.source_canvas_id, 500, "canvas_identity_invalid");
  requiredText(snapshot.source_canvas_name, 1_000, "canvas_identity_invalid");
  requiredText(snapshot.source_locator, 4_000, "canvas_locator_invalid");
  if (!captureMethods.has(snapshot.capture_method)) fail("capture_method_invalid");
  if (!/^[a-f0-9]{64}$/.test(snapshot.source_sha256 ?? "")) fail("snapshot_digest_invalid");
}

function validateSnapshotCollections(snapshot) {
  if (!Array.isArray(snapshot.blocks)) fail("block_count_mismatch");
  if (snapshot.blocks.length !== snapshot.block_count) fail("block_count_mismatch");
  if (!Array.isArray(snapshot.candidates)) fail("candidate_invalid");
}

function validateSnapshotStorage(snapshot, options) {
  if (options.requireBlob && !snapshot.raw_blob_container) fail("snapshot_blob_missing");
  if (options.requireBlob && !snapshot.raw_blob_key) fail("snapshot_blob_missing");
}

function validateBlocks(snapshot) {
  const ids = new Set();
  for (const block of snapshot.blocks) {
    requiredText(block.source_block_id, 100, "block_invalid");
    if (ids.has(block.source_block_id)) fail("duplicate_block");
    ids.add(block.source_block_id);
    if (!Number.isInteger(block.ordinal) || block.ordinal < 1) fail("block_invalid");
    if (!blockTypes.has(block.block_type)) fail("block_invalid");
    if (typeof block.text !== "string" || block.text.length > 100_000) fail("block_invalid");
    if (stableBlockId(snapshot.source_canvas_id, block) !== block.source_block_id) fail("block_digest_invalid");
  }
  return ids;
}

function validateCandidates(candidates, ids) {
  for (const candidate of candidates) validateCandidate(candidate, ids);
}

function validateCandidate(candidate, ids) {
  if (candidate.target_field_key !== "assessment_notes") fail("candidate_invalid");
  if (typeof candidate.proposed_value !== "string") fail("candidate_invalid");
  if (candidate.proposed_value.length > 500_000) fail("candidate_invalid");
  if (!Array.isArray(candidate.source_block_ids)) fail("candidate_invalid");
  if (candidate.source_block_ids.some((id) => !ids.has(id))) fail("candidate_invalid");
  if (candidate.review_status !== "pending") fail("candidate_invalid");
  if (typeof candidate.mapping_confidence !== "number") fail("candidate_invalid");
  if (candidate.mapping_confidence < 0) fail("candidate_invalid");
  if (candidate.mapping_confidence > 1) fail("candidate_invalid");
}

function validateSnapshotDigest(snapshot) {
  const sourcePayload = {
    source_canvas_id: snapshot.source_canvas_id,
    source_canvas_name: snapshot.source_canvas_name,
    source_project_id: snapshot.source_project_id ?? null,
    source_project_name: snapshot.source_project_name ?? null,
    source_locator: snapshot.source_locator,
    capture_method: snapshot.capture_method,
    blocks: snapshot.blocks,
  };
  if (sha256(manifestBytes(sourcePayload)) !== snapshot.source_sha256) fail("snapshot_digest_mismatch");
}

export async function loadManifest(filePath, options = {}) {
  if (!path.isAbsolute(filePath)) throw new Error("manifest_path_not_absolute");
  return validateManifest(JSON.parse(await readFile(filePath, "utf8")), options);
}

export function contentBlobKey(snapshot) {
  const canvasKey = sha256(snapshot.source_canvas_id).slice(0, 24);
  return `allo-content/v1/canvases/${canvasKey}/${snapshot.source_sha256}.json`;
}

function recognizedHeading(text) {
  const normalized = normalizeHeading(text);
  const exact = headingAliases.get(normalized);
  if (exact) return { section: exact, label: titleForSection(exact) };
  for (const [alias, section] of headingAliases) {
    if (normalized.startsWith(`${alias} `) && normalized.length <= alias.length + 12) {
      return { section, label: titleForSection(section) };
    }
  }
  return null;
}

function titleForSection(section) {
  return {
    assessment: "Assessment notes",
    interview: "Interview",
    medication: "Medication",
    post_assessment: "Post-assessment",
    pre_assessment: "Pre-assessment",
    referral: "Referral information",
    summary: "Summary",
  }[section] ?? "Notes";
}

function blockText(block) {
  if (block.block_type === "checkbox" && block.structured_value && typeof block.structured_value === "object") {
    return `${block.structured_value.checked ? "[x]" : "[ ]"} ${block.text}`;
  }
  if (block.block_type === "list_item") return `- ${block.text}`;
  return block.text;
}

function isIgnoredText(text) {
  const normalized = normalizeHeading(text);
  return ignoredText.has(normalized) || normalized.length < 2;
}

function nullableText(value, maximum) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, maximum) : null;
}

function requiredText(value, maximum, code) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length > maximum) fail(code);
}

function positiveIntegerOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validBoundingBox(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = ["x", "y", "width", "height"].map((key) => Number(value[key]));
  if (entries.some((item) => !Number.isFinite(item))) return null;
  return Object.fromEntries(["x", "y", "width", "height"].map((key, index) => [key, Math.round(entries[index] * 100) / 100]));
}

function fail(code) {
  throw new Error(code);
}

#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildManifest,
  finalizeSnapshot,
  manifestBytes,
  normalizeText,
  validateManifest,
} from "./allo-canvas-content-common.mjs";
import { loadCanvasRecordLinker } from "./allo-canvas-record-linking.mjs";

const renderedHeadingLabels = new Set([
  "activity",
  "admission documentation",
  "assessment",
  "assessment note",
  "assessment notes",
  "assessment questionnaire",
  "assignee",
  "collaborators",
  "created by",
  "due date",
  "instructions",
  "interview",
  "interview notes",
  "medication",
  "medication list",
  "medications",
  "modified by",
  "post assessment",
  "post assessment questionnaire",
  "post-assessment",
  "pre assessment",
  "pre assessment questionnaire",
  "pre-assessment",
  "referral info",
  "referral information",
  "section",
  "signed medication list",
  "subtasks",
  "summary",
  "tags",
]);

const args = argumentMap();
const inputPath = absoluteArgument("--input");
const outputPath = absoluteArgument("--output");
const exceptionsPath = optionalAbsoluteArgument("--exceptions");
const linkIndexPath = optionalAbsoluteArgument("--link-index");
const workspaceRecordsPath = optionalAbsoluteArgument("--workspace-records");
const identityCrosswalkPath = optionalAbsoluteArgument("--identity-crosswalk");
const recordLinker = await loadCanvasRecordLinker(workspaceRecordsPath, identityCrosswalkPath).catch((error) => {
  fail(error instanceof Error ? error.message : "record_link_source_invalid");
});
const input = await readFile(inputPath, "utf8");
const snapshots = [];
const exceptions = [];

if (/\.(jsonl|ndjson)$/i.test(inputPath)) {
  const result = extensionSnapshots(parseJsonLines(input));
  snapshots.push(...result.snapshots);
  exceptions.push(...result.exceptions);
} else {
  snapshots.push(...await indexedSnapshots(input));
}

const manifest = buildManifest(snapshots, { capture_scope: "operator_supplied_exports" });
if (recordLinker) {
  for (const snapshot of manifest.snapshots) {
    Object.assign(snapshot, recordLinker.resolve(snapshot.source_canvas_id, snapshot));
  }
  manifest.record_link_count = manifest.snapshots.filter((snapshot) => snapshot.record_link_status === "exact").length;
  manifest.canonical_client_count = manifest.snapshots.filter((snapshot) => snapshot.canonical_link_status === "confirmed").length;
  manifest.identity_exception_count = manifest.snapshots.filter((snapshot) =>
    new Set(["ambiguous", "unmatched"]).has(snapshot.canonical_link_status)).length;
}
validateManifest(manifest);
await writeFile(outputPath, manifestBytes(manifest), { mode: 0o600 });
await chmod(outputPath, 0o600);
if (linkIndexPath) {
  const linkRows = manifest.snapshots.map((snapshot) => ({
    source_record_id: snapshot.source_canvas_id,
    source_canvas_id: snapshot.source_canvas_id,
    source_sha256: snapshot.source_sha256,
    record_link_status: snapshot.record_link_status ?? "not_evaluated",
    canonical_client_id: snapshot.canonical_client_id ?? null,
    canonical_link_status: snapshot.canonical_link_status ?? "not_evaluated",
    canonical_match_method: snapshot.canonical_match_method ?? null,
    pipeline_lookup: {
      workspace_origin: "allo",
      source_workspace_id: snapshot.source_canvas_id,
    },
  }));
  await writeFile(linkIndexPath, `${linkRows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
  await chmod(linkIndexPath, 0o600);
}
if (exceptionsPath) {
  await writeFile(exceptionsPath, manifestBytes({
    version: 1,
    source_system: "allo",
    created_at: new Date().toISOString(),
    exception_count: exceptions.length,
    exceptions,
  }), { mode: 0o600 });
  await chmod(exceptionsPath, 0o600);
}
console.log(JSON.stringify({
  ok: true,
  canvas_count: manifest.canvas_count,
  block_count: manifest.block_count,
  candidate_count: manifest.candidate_count,
  record_link_count: manifest.record_link_count,
  canonical_client_count: manifest.canonical_client_count,
  identity_exception_count: manifest.identity_exception_count,
  link_index_written: Boolean(linkIndexPath),
  exception_count: exceptions.length,
  exceptions_written: Boolean(exceptionsPath),
  output_written: true,
}));

async function indexedSnapshots(input) {
  const snapshots = [];
  const rows = parseCommentedCsv(input);
  for (const row of rows) {
    const sourcePath = resolveSourcePath(inputPath, row.content_path);
    const content = await readFile(sourcePath, "utf8");
    const captureMethod = normalizedValue(row.capture_method) || "copy_as_markdown";
    const blocks = sourcePath.toLocaleLowerCase("en-US").endsWith(".json")
      ? jsonBlocks(JSON.parse(content))
      : markdownBlocks(content);
    snapshots.push(finalizeSnapshot({
      source_canvas_id: requiredValue(row.canvas_id, "canvas_id"),
      source_canvas_name: requiredValue(row.canvas_name, "canvas_name"),
      source_project_id: normalizedValue(row.project_id),
      source_project_name: normalizedValue(row.project_name),
      source_locator: normalizedValue(row.canvas_url) || `allo://canvas/${requiredValue(row.canvas_id, "canvas_id")}`,
      capture_method: captureMethod,
      captured_at: normalizedValue(row.captured_at) || new Date().toISOString(),
      blocks,
    }));
  }
  return snapshots;
}

function extensionSnapshots(records) {
  const metadataFormat = records.find((record) => record?.metadata)?.metadata?.format;
  if (metadataFormat !== "allo-canvas-native-content-v1") fail("Unsupported ALLO canvas text extension export.");
  const snapshots = [];
  const exceptions = [];
  for (const record of records.filter((item) => !item.metadata)) {
    const outcome = extensionSnapshot(record, metadataFormat);
    if (outcome.snapshot) snapshots.push(outcome.snapshot);
    if (outcome.exception) exceptions.push(outcome.exception);
  }
  return { snapshots, exceptions };
}

function extensionSnapshot(record, metadataFormat) {
  if (record.schema_version && record.schema_version !== metadataFormat) fail("Unsupported ALLO canvas text extension record.");
  const canvasId = requiredValue(record.canvas?.id, "canvas.id");
  const canvasName = requiredValue(record.canvas?.name, "canvas.name");
  const blocks = normalizeExtensionBlocks(record.blocks, record.plain_text);
  const shared = {
    source_canvas_id: canvasId,
    source_canvas_name: canvasName,
    source_project_id: normalizedValue(record.canvas?.project_id || record.project?.id),
    source_project_name: normalizedValue(record.project?.name),
  };
  if (blocks.length === 0) return { snapshot: null, exception: emptyExtensionSnapshot(record, shared) };
  return {
    exception: null,
    snapshot: finalizeSnapshot({
      ...shared,
      source_locator: normalizedValue(record.canvas?.url) || `https://allo.io/home?task=${encodeURIComponent(canvasId)}`,
      capture_method: "native_export",
      captured_at: normalizedValue(record.captured_at) || new Date().toISOString(),
      blocks,
    }),
  };
}

function emptyExtensionSnapshot(record, shared) {
  return {
    ...shared,
    reason_code: "no_rendered_content",
    source_errors: Array.isArray(record.errors)
      ? record.errors.map((error) => normalizeText(error)).filter(Boolean).slice(0, 20)
      : [],
  };
}

function normalizeExtensionBlocks(blocks, fallbackText) {
  if (!Array.isArray(blocks) || blocks.length === 0) return renderedTextBlocks(fallbackText || "", "rendered-dom", null);
  if (blocks.length === 1 && (blocks[0]?.kind === "rendered_canvas" || normalizeText(blocks[0]?.text).includes("\n"))) {
    return renderedTextBlocks(blocks[0]?.text || fallbackText || "", blocks[0]?.source_method, blocks[0]?.source_path);
  }
  let headingPath = [];
  return blocks.map((block) => {
    const text = normalizeText(block.text);
    const kind = normalizedValue(block.kind) || "text";
    if (kind === "heading" && text) headingPath = [text];
    const checkbox = kind === "checklist" ? /^\[([ xX])\]\s+(.+)$/.exec(text) : null;
    return {
      block_type: kind === "heading" ? "heading" : checkbox ? "checkbox" : kind === "table_cell" ? "table_cell" : "text",
      text: checkbox ? checkbox[2] : text,
      heading_path: [...headingPath],
      semantic_role: normalizedValue(block.source_method),
      structured_value: checkbox ? { checked: checkbox[1].toLocaleLowerCase("en-US") === "x" } : null,
      locator: normalizedValue(block.source_path),
    };
  });
}

function renderedTextBlocks(content, sourceMethod, sourcePath) {
  const lines = normalizeText(content).split("\n").map((line) => normalizeText(line)).filter(Boolean);
  let headingPath = [];
  return lines.map((line, index) => {
    const normalized = line.toLocaleLowerCase("en-US")
      .replace(/[❗!.:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const heading = renderedHeadingLabels.has(normalized);
    if (heading) headingPath = [line];
    const checkbox = /^\[([ xX])\]\s+(.+)$/.exec(line);
    const list = /^[•*-]\s+(.+)$/.exec(line);
    return {
      block_type: heading ? "heading" : checkbox ? "checkbox" : list ? "list_item" : "paragraph",
      text: checkbox ? checkbox[2] : list ? list[1] : line,
      heading_path: [...headingPath],
      semantic_role: normalizedValue(sourceMethod) || "rendered-dom",
      structured_value: checkbox ? { checked: checkbox[1].toLocaleLowerCase("en-US") === "x" } : null,
      locator: `${normalizedValue(sourcePath) || "rendered-dom"}:line:${index + 1}`,
    };
  });
}

function parseJsonLines(source) {
  return source.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      fail(`Invalid JSONL at line ${index + 1}.`);
    }
  });
}

function markdownBlocks(content) {
  const blocks = [];
  let headingPath = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = normalizeText(rawLine);
    if (!line) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = normalizeText(heading[2]);
      headingPath = [...headingPath.slice(0, level - 1), text];
      blocks.push({ block_type: "heading", text, heading_path: [...headingPath] });
      continue;
    }
    const checkbox = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (checkbox) {
      blocks.push({
        block_type: "checkbox",
        text: checkbox[2],
        heading_path: [...headingPath],
        structured_value: { checked: checkbox[1].toLocaleLowerCase("en-US") === "x" },
      });
      continue;
    }
    const list = /^[-*+]\s+(.+)$/.exec(line);
    blocks.push({
      block_type: list ? "list_item" : "paragraph",
      text: list ? list[1] : line,
      heading_path: [...headingPath],
    });
  }
  return blocks;
}

function jsonBlocks(value) {
  const blocks = Array.isArray(value) ? value : value?.blocks;
  if (!Array.isArray(blocks)) fail("JSON content must be an array or contain a blocks array.");
  return blocks;
}

function parseCommentedCsv(source) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, parseCsvLine(line)[index] ?? ""])));
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}

function resolveSourcePath(csvPath, value) {
  const candidate = normalizedValue(value);
  if (!candidate) fail("Every row requires content_path.");
  return path.isAbsolute(candidate) ? candidate : path.resolve(path.dirname(csvPath), candidate);
}

function argumentMap() {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.split("=");
    return [key, rest.join("=")];
  }));
}

function absoluteArgument(name) {
  const value = args.get(name);
  if (!value || !path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  return value;
}

function optionalAbsoluteArgument(name) {
  const value = args.get(name);
  if (!value) return null;
  if (!path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  return value;
}

function normalizedValue(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function requiredValue(value, label) {
  const normalized = normalizedValue(value);
  if (!normalized) fail(`Every row requires ${label}.`);
  return normalized;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

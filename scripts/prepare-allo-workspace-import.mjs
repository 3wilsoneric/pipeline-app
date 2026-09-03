#!/usr/bin/env node

import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { workspaceMonthFromProjectName } from "../lib/pipeline/workspace-month.mjs";
import { resolveImportedWorkspaceCommunity } from "./allo-admission-evidence.mjs";

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.split("=");
  return [key, rest.join("=")];
}));
const inventoryPath = requiredAbsolute("--inventory");
const ownersPath = requiredAbsolute("--owners");
const profilesPath = optionalAbsolute("--profiles");
const outputPath = requiredAbsolute("--output");

const inventoryRows = parseCommentedCsv(await readFile(inventoryPath, "utf8"));
const ownerRows = JSON.parse(await readFile(ownersPath, "utf8"));
if (!Array.isArray(ownerRows)) fail("The private owner evidence must be an array.");
const profileRows = profilesPath ? parseCommentedCsv(await readFile(profilesPath, "utf8")) : [];

const ownersByCanvas = new Map();
for (const row of ownerRows) {
  const key = normalize(row.canvas_name);
  if (!key) continue;
  const values = String(row.owner ?? "").split(/[;,]/).map((value) => value.trim()).filter(Boolean);
  const current = ownersByCanvas.get(key) ?? [];
  current.push(...values);
  ownersByCanvas.set(key, current);
}

const profilesByName = new Map();
for (const row of profileRows) {
  const key = normalize(row.resident_name);
  if (!key) continue;
  const current = profilesByName.get(key) ?? [];
  current.push({
    resident_number: value(row.resident_number),
    resident_name: value(row.resident_name),
    date_of_birth: value(row.date_of_birth),
    community: value(row.community),
    admit_date: value(row.admit_date),
    discharge_date: value(row.discharge_date),
    resident_status: value(row.resident_status),
  });
  profilesByName.set(key, current);
}

const workspaces = new Map();
for (const row of inventoryRows) {
  const canvasId = value(row.canvas_id);
  const canvasName = value(row.canvas_name);
  if (!canvasId || !canvasName) continue;
  const workspace = workspaces.get(canvasId) ?? {
    source_system: "allo",
    source_workspace_id: canvasId,
    source_workspace_name: canvasName,
    project_id: value(row.project_id),
    project_name: value(row.project_name),
    community: communityFor(value(row.project_name)),
    display_name: displayNameFor(canvasName, profilesByName),
    owner_candidates: ownerCandidates(ownersByCanvas.get(normalize(canvasName)) ?? []),
    profile_candidates: profileCandidates(canvasName, profilesByName),
    files: [],
  };
  const source = await resolveSource(inventoryPath, value(row.physical_path));
  const exportedHash = value(row.hash);
  workspace.files.push({
    source_item_id: value(row.object_id) || value(row.hash),
    source_file_name: value(row.display_name) || path.basename(source?.path ?? "file"),
    source_content_type: value(row.mime_type) || "application/octet-stream",
    source_byte_size: source?.size ?? integer(row.size_bytes),
    source_sha256: /^[a-f0-9]{64}$/.test(exportedHash ?? "") ? exportedHash : null,
    source_legacy_hash: exportedHash,
    source_created_at: epochIso(row.created_at_ms),
    source_page: integer(row.page),
    source_page_title: value(row.page_title),
    source_file_category: value(row.file_category),
    document_category: categoryFor(value(row.display_name), value(row.file_category)),
    source_path: source?.path ?? null,
    source_available: Boolean(source),
  });
  workspaces.set(canvasId, workspace);
}

const workspaceValues = [...workspaces.values()].map((workspace) => {
  const workspaceMonth = workspaceMonthFromProjectName(workspace.project_name);
  return {
    ...workspace,
    community: resolveImportedWorkspaceCommunity(workspace),
    workspace_month: workspaceMonth,
    workspace_month_basis: workspaceMonth ? "source_project_name" : "unknown",
    primary_owner: workspace.owner_candidates[0]?.name ?? null,
    material_count: workspace.files.length,
    available_file_count: workspace.files.filter((file) => file.source_available).length,
    missing_file_count: workspace.files.filter((file) => !file.source_available).length,
    first_material_at: workspace.files.map((file) => file.source_created_at).filter(Boolean).sort()[0] ?? null,
  };
}).sort((left, right) => left.source_workspace_name.localeCompare(right.source_workspace_name, "en")
  || left.source_workspace_id.localeCompare(right.source_workspace_id, "en"));

const payload = {
  version: 1,
  data_class: "user_supplied_real",
  source_system: "allo",
  created_at: new Date().toISOString(),
  inventory_path: inventoryPath,
  owner_evidence_path: ownersPath,
  profile_source_path: profilesPath,
  workspace_count: workspaceValues.length,
  material_count: workspaceValues.reduce((sum, workspace) => sum + workspace.material_count, 0),
  available_file_count: workspaceValues.reduce((sum, workspace) => sum + workspace.available_file_count, 0),
  missing_file_count: workspaceValues.reduce((sum, workspace) => sum + workspace.missing_file_count, 0),
  owner_assigned_workspace_count: workspaceValues.filter((workspace) => workspace.primary_owner).length,
  owner_unresolved_workspace_count: workspaceValues.filter((workspace) => !workspace.primary_owner).length,
  unique_profile_candidate_workspace_count: workspaceValues.filter((workspace) => workspace.profile_candidates.length === 1).length,
  workspaces: workspaceValues,
};

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
await chmod(outputPath, 0o600);
console.log(JSON.stringify({
  ok: true,
  workspace_count: payload.workspace_count,
  material_count: payload.material_count,
  available_file_count: payload.available_file_count,
  missing_file_count: payload.missing_file_count,
  owner_assigned_workspace_count: payload.owner_assigned_workspace_count,
  owner_unresolved_workspace_count: payload.owner_unresolved_workspace_count,
  unique_profile_candidate_workspace_count: payload.unique_profile_candidate_workspace_count,
  output_written: true,
}));

function ownerCandidates(values) {
  const counts = new Map();
  const order = [];
  for (const name of values) {
    const key = normalize(name);
    if (!key) continue;
    if (!counts.has(key)) order.push(key);
    const current = counts.get(key) ?? { name, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.entries()].map(([key, candidate]) => ({ ...candidate, first_seen: order.indexOf(key) }))
    .sort((left, right) => right.count - left.count || left.first_seen - right.first_seen || left.name.localeCompare(right.name));
}

function profileCandidates(canvasName, index) {
  const keys = new Set([normalize(canvasName), normalize(stripCanvasSuffix(canvasName))]);
  const candidates = [];
  const seen = new Set();
  for (const key of keys) {
    for (const candidate of index.get(key) ?? []) {
      const identity = `${candidate.resident_number ?? ""}|${candidate.date_of_birth ?? ""}|${candidate.resident_name ?? ""}`;
      if (!seen.has(identity)) candidates.push(candidate);
      seen.add(identity);
    }
  }
  return candidates;
}

function displayNameFor(canvasName, index) {
  const candidates = profileCandidates(canvasName, index);
  if (candidates.length === 1 && candidates[0].resident_name) return candidates[0].resident_name;
  const cleaned = stripCanvasSuffix(canvasName)
    .replace(/\b(?:accepted|admitted|admission|rejected|declined|pending|interview|yes|no)\b/gi, " ")
    .replace(/\s*[-|]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || canvasName.trim();
}

function categoryFor(fileName, sourceCategory) {
  const input = normalize(`${fileName} ${sourceCategory}`);
  if (input.includes("face sheet") || input.includes("facesheet")) return "face_sheet";
  if (input.includes("assessment tool") || input.includes("assessment")) return "assessment";
  if ((input.includes("med") && input.includes("list")) || input.includes("mar")) return "medication_list";
  if (/\btb\b/.test(input) || input.includes("tuberculosis")) return "tb_test";
  if (input.includes("admission agreement") || input.includes("lic forms")) return "signed_admission_agreement";
  if (input.includes("conservator") || input.includes("letters of")) return "conservatorship_document";
  if (/\b602\b/.test(input)) return "lic_602";
  if (/\b60[13]\b/.test(input)) return "lic_601_603";
  if (input.includes("provider form")) return "provider_form";
  if (input.includes("payer") || input.includes("medi cal") || input.includes("medicaid")) return "payer_verification";
  return "other";
}

function stripCanvasSuffix(input) {
  return input
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?\b/g, " ")
    .replace(/\b(?:admitted|admission|rejected|declined|pending|interview|yes|no)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveSource(manifestPath, physicalPath) {
  if (!physicalPath) return null;
  const candidates = [
    path.resolve(path.dirname(manifestPath), physicalPath),
    path.resolve(path.dirname(path.dirname(manifestPath)), physicalPath),
    path.resolve(physicalPath),
  ];
  for (const candidate of candidates) {
    const metadata = await stat(candidate).catch(() => null);
    if (metadata?.isFile()) return { path: candidate, size: metadata.size };
  }
  return null;
}

function communityFor(projectName) {
  const normalized = normalize(projectName);
  if (normalized.includes("san pablo")) return "San Pablo";
  if (normalized.includes("santa clarita") || normalized.includes("ahmsc")) return "Santa Clarita";
  if (normalized.includes("turlock")) return "Turlock";
  if (normalized.includes("victoria")) return "Victoria's House";
  if (normalized.includes("jcwh") || normalized.includes("jc wallace")) return "JC Wallace";
  return "";
}

function parseCommentedCsv(input) {
  const value = input.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#")).join("\n");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) fail("A CSV source contains an unterminated quoted field.");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => normalizeHeader(header));
  return rows.slice(1).filter((values) => values.some((item) => item.trim())).map((values) =>
    Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? ""])),
  );
}

function normalizeHeader(input) {
  return String(input ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalize(input) {
  return String(input ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function value(input) {
  const normalized = String(input ?? "").trim();
  return normalized || null;
}

function integer(input) {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function epochIso(input) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

function requiredAbsolute(key) {
  const value = args.get(key);
  if (!value || !path.isAbsolute(value)) fail(`${key} must be an absolute path.`);
  return value;
}

function optionalAbsolute(key) {
  const value = args.get(key);
  if (!value) return null;
  if (!path.isAbsolute(value)) fail(`${key} must be an absolute path.`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

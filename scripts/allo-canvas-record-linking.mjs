import { readFile } from "node:fs/promises";

const recordLinkStatuses = new Set(["exact", "missing", "not_evaluated"]);
const canonicalLinkStatuses = new Set(["ambiguous", "confirmed", "not_evaluated", "unmatched"]);

export async function loadCanvasRecordLinker(workspaceRecordsPath, identityCrosswalkPath) {
  if (!workspaceRecordsPath && !identityCrosswalkPath) return null;
  if (!workspaceRecordsPath || !identityCrosswalkPath) {
    throw new Error("workspace_records_and_identity_crosswalk_required");
  }
  const workspaceEnvelope = JSON.parse(await readFile(workspaceRecordsPath, "utf8"));
  const crosswalkRows = parseCsv(await readFile(identityCrosswalkPath, "utf8"));
  return createCanvasRecordLinker(workspaceEnvelope?.workspaces, crosswalkRows);
}

export function createCanvasRecordLinker(workspaces, crosswalkRows) {
  if (!Array.isArray(workspaces) || !Array.isArray(crosswalkRows)) throw new Error("record_link_source_invalid");
  const workspacesByCanvas = indexWorkspacesByCanvas(workspaces);
  const canonicalIdsByIdentity = indexCanonicalIdsByIdentity(crosswalkRows);
  return {
    resolve: (sourceCanvasId, snapshot = null) => resolveCanvasRecord(
      sourceCanvasId,
      snapshot,
      workspacesByCanvas,
      canonicalIdsByIdentity,
    ),
  };
}

function indexWorkspacesByCanvas(workspaces) {
  const workspacesByCanvas = new Map();
  for (const workspace of workspaces) {
    const canvasId = normalizedValue(workspace?.source_workspace_id);
    if (!canvasId) continue;
    if (workspacesByCanvas.has(canvasId)) throw new Error("duplicate_source_workspace_id");
    workspacesByCanvas.set(canvasId, workspace);
  }
  return workspacesByCanvas;
}

function indexCanonicalIdsByIdentity(crosswalkRows) {
  const canonicalIdsByIdentity = new Map();
  for (const row of crosswalkRows) {
    const name = normalizeIdentityName(row.resident_name);
    const dateOfBirth = normalizeDate(row.date_of_birth);
    const canonicalClientId = normalizedValue(row.canonical_client_id);
    if (!name || !dateOfBirth || !canonicalClientId) continue;
    const key = identityKey(name, dateOfBirth);
    const ids = canonicalIdsByIdentity.get(key) ?? new Set();
    ids.add(canonicalClientId);
    canonicalIdsByIdentity.set(key, ids);
  }
  return canonicalIdsByIdentity;
}

function resolveCanvasRecord(sourceCanvasId, snapshot, workspacesByCanvas, canonicalIdsByIdentity) {
  const workspace = workspacesByCanvas.get(String(sourceCanvasId));
  const recordLinkStatus = workspace ? "exact" : "missing";
  const evidence = collectCanvasIdentityEvidence(workspace, snapshot);
  const matches = resolveCanonicalIdentityMatches(evidence.identities, canonicalIdsByIdentity);
  if (evidence.ambiguous || matches.ambiguous || matches.ids.size > 1) return unresolvedLink(recordLinkStatus, "ambiguous");
  if (matches.ids.size === 0) return unresolvedLink(recordLinkStatus, "unmatched");
  return {
    record_link_status: recordLinkStatus,
    canonical_client_id: [...matches.ids][0],
    canonical_link_status: "confirmed",
    canonical_match_method: "exact_name_dob",
  };
}

function collectCanvasIdentityEvidence(workspace, snapshot) {
  const profiles = Array.isArray(workspace?.profile_candidates) ? workspace.profile_candidates : [];
  const identities = profiles.length === 1 ? [identityFromProfile(profiles[0])] : [];
  const canvasIdentity = extractCanvasIdentity(snapshot);
  if (canvasIdentity) identities.push(canvasIdentity);
  return { identities: identities.filter(Boolean), ambiguous: profiles.length > 1 };
}

function resolveCanonicalIdentityMatches(identities, canonicalIdsByIdentity) {
  const ids = new Set();
  let ambiguous = false;
  for (const identity of identities) {
    const matches = canonicalIdsByIdentity.get(identityKey(identity.name, identity.dateOfBirth)) ?? new Set();
    if (matches.size > 1) ambiguous = true;
    for (const canonicalId of matches) ids.add(canonicalId);
  }
  return { ids, ambiguous };
}

export function extractCanvasIdentity(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.blocks)) return null;
  const lines = snapshot.blocks.map((block) => normalizedValue(block?.text)).filter(Boolean);
  for (let index = 0; index <= lines.length - 8; index += 1) {
    if (normalizeLabel(lines[index]) !== "name"
      || normalizeLabel(lines[index + 1]) !== "gender"
      || normalizeLabel(lines[index + 2]) !== "age"
      || normalizeLabel(lines[index + 3]) !== "dob") continue;
    const name = normalizeIdentityName(lines[index + 4]);
    const dateOfBirth = normalizeDate(lines[index + 7]);
    if (name && dateOfBirth) return { name, dateOfBirth };
  }
  return null;
}

export function validateCanvasRecordLink(snapshot) {
  const recordStatus = snapshot.record_link_status ?? "not_evaluated";
  const canonicalStatus = snapshot.canonical_link_status ?? "not_evaluated";
  if (!recordLinkStatuses.has(recordStatus) || !canonicalLinkStatuses.has(canonicalStatus)) {
    throw new Error("record_link_invalid");
  }
  const canonicalClientId = normalizedValue(snapshot.canonical_client_id);
  if ((canonicalStatus === "confirmed") !== Boolean(canonicalClientId)) throw new Error("record_link_invalid");
  if (canonicalClientId && canonicalClientId.length > 256) throw new Error("record_link_invalid");
  if (canonicalStatus === "confirmed" && snapshot.canonical_match_method !== "exact_name_dob") {
    throw new Error("record_link_invalid");
  }
}

function unresolvedLink(recordLinkStatus, canonicalLinkStatus) {
  return {
    record_link_status: recordLinkStatus,
    canonical_client_id: null,
    canonical_link_status: canonicalLinkStatus,
    canonical_match_method: null,
  };
}

function identityKey(name, dateOfBirth) {
  return `${name}\u0000${dateOfBirth}`;
}

function identityFromProfile(profile) {
  const name = normalizeIdentityName(profile?.resident_name);
  const dateOfBirth = normalizeDate(profile?.date_of_birth);
  return name && dateOfBirth ? { name, dateOfBirth } : null;
}

function normalizeLabel(value) {
  return String(value ?? "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "").trim();
}

function normalizeIdentityName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const input = normalizedValue(value);
  if (!input) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  const local = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(input);
  const parts = iso ? [iso[1], iso[2], iso[3]] : local ? [local[3], local[1], local[2]] : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = source.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#")).join("\n");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
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
  if (quoted) throw new Error("identity_crosswalk_csv_invalid");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const populated = rows.filter((values) => values.some((item) => item.trim()));
  if (populated.length < 2) return [];
  const headers = populated[0].map((header) => normalizeHeader(header));
  return populated.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])),
  );
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizedValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

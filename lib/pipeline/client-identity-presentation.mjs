const missingIdentityValue = /^(?:n\/?a|none|not (?:available|documented|provided|recorded|reported)|null|undefined|unknown)$/i;

export const missingClientIdentityLabels = Object.freeze({
  name: "Name not recorded",
  gender: "Gender not recorded",
  community: "Community not recorded",
});

export function presentClientName(value) {
  return normalizeClientName(value) || missingClientIdentityLabels.name;
}

export function presentClientGender(value) {
  return readableIdentityValue(value) ?? missingClientIdentityLabels.gender;
}

export function presentClientCommunity(value) {
  const readable = readableIdentityValue(value);
  return readable && readable.toLowerCase() !== "unassigned"
    ? readable
    : missingClientIdentityLabels.community;
}

export function formatClientIdentityTitle({ name, gender, community }) {
  void gender;
  return normalizeClientName(name, { community }) || missingClientIdentityLabels.name;
}

export function normalizeClientName(value, options = {}) {
  let name = readableIdentityValue(value);
  if (!name) return "";

  name = name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const firstName = cleanNameComponent(options.firstName);
  const lastName = cleanNameComponent(options.lastName);
  if (firstName && lastName) name = `${firstName} ${lastName}`;

  const identitySegments = name.split(/\s+·\s+/).map((segment) => segment.trim()).filter(Boolean);
  if (identitySegments.length > 1) name = identitySegments[0];

  const importedIdentity = splitImportedClientIdentity(name);
  if (importedIdentity) name = importedIdentity.name;

  name = stripDatedImportSuffix(name);
  name = stripImportedProgramCode(name);

  name = name.replace(/\s+(?:gender|sex|community|facility)\s*[:=].*$/i, "").trim();
  name = stripMetadataSuffix(name, options.community);
  name = stripMetadataSuffix(name, options.gender);

  const tokens = name.split(/\s+/).filter(Boolean);
  const firstNumericToken = tokens.findIndex((token) => /\d/.test(token));
  if (firstNumericToken >= 2) name = trimIdentitySeparator(tokens.slice(0, firstNumericToken).join(" "));

  return name
    .replace(/^[\s·|,;:]+|[\s·|,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveClientGender(...sources) {
  for (const source of sources) {
    const value = readableIdentityValue(source);
    if (value) return value;
  }
  return null;
}

export function extractImportedClientMetadata(value) {
  const name = readableIdentityValue(value);
  return name ? splitImportedClientIdentity(name)?.metadata ?? null : null;
}

function readableIdentityValue(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return null;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed || missingIdentityValue.test(trimmed)) return null;
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return readableIdentityValue(JSON.parse(trimmed), depth + 1);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const readable = readableIdentityValue(item, depth + 1);
      if (readable) return readable;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value;
    for (const key of ["display_value", "normalized_value", "fact_value", "gender", "gender_identity", "sex", "value", "text", "label", "name"]) {
      if (!(key in record)) continue;
      const readable = readableIdentityValue(record[key], depth + 1);
      if (readable) return readable;
    }
  }
  return null;
}

function cleanNameComponent(value) {
  const readable = readableIdentityValue(value);
  return readable
    ? readable
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function splitImportedClientIdentity(value) {
  const match = value.match(/^(.*?)\s+(?:-{2,}|-\s+-|[–—])\s+(.+)$/);
  if (!match) return null;
  const name = match[1].trim();
  const metadata = match[2].trim();
  return name.split(/\s+/).filter(Boolean).length >= 2 && metadata
    ? { name, metadata }
    : null;
}

function stripDatedImportSuffix(name) {
  const match = name.match(/^(.*?)(?:\s*[-–—]\s*|\s+)(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)(?:\s|[-–—]|$).*/);
  if (!match) return name;
  const candidate = trimIdentitySeparator(match[1]);
  return candidate.split(/\s+/).filter(Boolean).length >= 2 ? candidate : name;
}

function stripImportedProgramCode(name) {
  const match = name.match(/^(.*?)\s+\(([A-Z][A-Z0-9&/. -]{1,11})\)$/);
  if (!match || /^(?:JR|SR|II|III|IV|V)$/i.test(match[2].trim())) return name;
  const candidate = trimIdentitySeparator(match[1]);
  return candidate.split(/\s+/).filter(Boolean).length >= 2 ? candidate : name;
}

function stripMetadataSuffix(name, value) {
  const suffix = readableIdentityValue(value);
  if (!suffix) return name;
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidate = name.replace(new RegExp(`(?:\\s*\\(${escaped}\\)|\\s+[·|–—-]\\s*${escaped}|\\s+${escaped})$`, "i"), "").trim();
  return candidate.split(/\s+/).filter(Boolean).length >= 2 ? candidate : name;
}

function trimIdentitySeparator(value) {
  return value.replace(/[\s·|,;:–—-]+$/g, "").trim();
}

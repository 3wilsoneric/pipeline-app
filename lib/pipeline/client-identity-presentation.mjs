const missingIdentityValue = /^(?:n\/?a|none|not (?:available|documented|provided|recorded|reported)|null|undefined|unknown)$/i;
const operationalNameToken = /^(?:assessment|client|community|county|demo|facility|gender|intake|jail|male|female|nonbinary|pending|pre-assessment|recorded|referral|resident|synthetic|test|unknown|unnamed|waitlist|wl|workspace)$/i;

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

  name = name
    .replace(/^[\s·|,;:]+|[\s·|,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return firstAndLastName(name);
}

export function isPersonOnlyClientName(value) {
  const tokens = nameTokens(normalizeClientName(value));
  return tokens.length === 2
    && tokens.every((token) => token.length > 1 && !operationalNameToken.test(token));
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
    const trimmed = value
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
      .trim()
      .replace(/\s+/g, " ");
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
  const match = value.match(/^(.*?)(?:\s*--+\s*|\s*-\s+|\s*[–—]\s*)(.+)$/);
  if (!match) return null;
  const name = match[1].trim();
  const metadata = match[2].replace(/^[\s–—-]+/, "").trim();
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

function firstAndLastName(value) {
  const withoutSuffix = value
    .replace(/(?:,\s*|\s+)\(?(?:jr|sr|ii|iii|iv|v)\.?\)?$/i, "")
    .trim();
  const commaName = withoutSuffix.match(/^([^,]+),\s*(.+)$/);
  if (commaName) {
    const family = nameTokens(commaName[1]);
    const given = nameTokens(commaName[2]);
    if (given.length && family.length) return `${given[0]} ${family.at(-1)}`;
  }

  const tokens = nameTokens(withoutSuffix);
  while (tokens.length > 1 && /^(?:mr|mrs|ms|miss|mx|dr)$/i.test(tokens[0])) tokens.shift();
  while (tokens.length > 1 && /^(?:jr|sr|ii|iii|iv|v)$/i.test(tokens.at(-1))) tokens.pop();
  if (tokens.length < 2) return tokens[0] ?? "";
  return `${tokens[0]} ${tokens.at(-1)}`;
}

function nameTokens(value) {
  return value
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))
    .filter((token) => /\p{L}/u.test(token));
}

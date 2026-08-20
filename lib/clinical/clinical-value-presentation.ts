import type { ClinicalJsonValue } from "./clinical-contracts";

export type ClinicalValuePresentation =
  | { kind: "missing"; text: "Not reported" }
  | { kind: "scalar"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "record"; entries: Array<{ label: string; value: string }> };

const missingTokens = new Set(["", "[]", "{}", "null", "none", "nan", "n/a", "not available"]);
const listFieldPattern = /(values_json|diagnos|substance|communit|resident_numbers?|document_ids?|source_files?|allerg|medications?|prior_setting|referring_facilit)/i;

const labelTerms: Record<string, string> = {
  adl: "ADL",
  dob: "date of birth",
  ed: "ED",
  ehr: "EHR",
  er: "ER",
  id: "ID",
  ids: "IDs",
  lai: "LAI",
  los: "length of stay",
  mar: "MAR",
  mri: "MRI",
  pct: "percent",
  phi: "PHI",
  prn: "PRN",
  qa: "QA",
  si: "SI",
  hi: "HI",
};

export function humanizeClinicalField(value: string) {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\bjson\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => labelTerms[word.toLowerCase()] ?? word.toLowerCase());

  if (words.length === 0) return "Field";
  const label = words.join(" ");
  return label.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

export function presentClinicalValue(
  value: ClinicalJsonValue | undefined,
  fieldKey = "",
): ClinicalValuePresentation {
  const normalized = normalizeClinicalValue(value, fieldKey);
  if (normalized === null || normalized === undefined) {
    return { kind: "missing", text: "Not reported" };
  }
  if (Array.isArray(normalized)) {
    const items = uniqueReadableValues(normalized.map((item) => readableValue(item, fieldKey)));
    return items.length > 0
      ? { kind: "list", items }
      : { kind: "missing", text: "Not reported" };
  }
  if (typeof normalized === "object") {
    const entries = Object.entries(normalized).flatMap(([key, entry]) => {
      const readable = readableValue(entry, key);
      return readable ? [{ label: humanizeClinicalField(key), value: readable }] : [];
    });
    return entries.length > 0
      ? { kind: "record", entries }
      : { kind: "missing", text: "Not reported" };
  }
  if (typeof normalized === "boolean") {
    return { kind: "scalar", text: normalized ? "Yes" : "No" };
  }
  return { kind: "scalar", text: readableScalar(normalized) };
}

export function formatClinicalValue(
  value: ClinicalJsonValue | undefined,
  fieldKey = "",
) {
  const presentation = presentClinicalValue(value, fieldKey);
  if (presentation.kind === "list") return presentation.items.join("; ");
  if (presentation.kind === "record") {
    return presentation.entries.map((entry) => `${entry.label}: ${entry.value}`).join("; ");
  }
  return presentation.text;
}

export function hasReadableClinicalValue(
  value: ClinicalJsonValue | undefined,
  fieldKey = "",
) {
  return presentClinicalValue(value, fieldKey).kind !== "missing";
}

function normalizeClinicalValue(
  value: ClinicalJsonValue | undefined,
  fieldKey: string,
): ClinicalJsonValue | undefined {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return dedupeJsonValues(value.map((item) => normalizeClinicalValue(item, fieldKey)));
  }
  if (typeof value === "object") {
    const entries: Array<[string, ClinicalJsonValue]> = [];
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizeClinicalValue(entry, key);
      if (normalized !== null && normalized !== undefined) entries.push([key, normalized]);
    }
    return Object.fromEntries(entries);
  }
  if (typeof value !== "string") return value;

  const text = cleanText(value);
  if (missingTokens.has(text.toLowerCase())) return null;

  const collection = parseEncodedCollection(text);
  if (collection !== undefined) return normalizeClinicalValue(collection, fieldKey);

  if (listFieldPattern.test(fieldKey) && /\s\|\s/.test(text)) {
    return dedupeJsonValues(text.split(/\s+\|\s+/).map((item) => cleanText(item)));
  }
  return normalizeStatusText(text);
}

function parseEncodedCollection(text: string): ClinicalJsonValue | undefined {
  const isList = text.startsWith("[") && text.endsWith("]");
  const isRecord = text.startsWith("{") && text.endsWith("}");
  if (!isList && !isRecord) return undefined;

  try {
    return JSON.parse(text) as ClinicalJsonValue;
  } catch {
    const body = text.slice(1, -1).trim();
    if (!body) return isList ? [] : {};
    if (isList) {
      return splitTopLevel(body, ",").map(parseLooseToken);
    }
    const entries = splitTopLevel(body, ",").flatMap((pair) => {
      const [rawKey, ...rawValue] = splitTopLevel(pair, ":");
      if (!rawKey || rawValue.length === 0) return [];
      const key = String(parseLooseToken(rawKey)).trim();
      return key ? [[key, parseLooseToken(rawValue.join(":"))] as const] : [];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
}

function parseLooseToken(value: string): ClinicalJsonValue {
  const token = value.trim();
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
    return cleanText(token.slice(1, -1).replace(/\\(['"\\])/g, "$1"));
  }
  if (/^(true|false)$/i.test(token)) return token.toLowerCase() === "true";
  if (/^(none|null)$/i.test(token)) return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  const nested = parseEncodedCollection(token);
  return nested === undefined ? cleanText(token) : nested;
}

function splitTopLevel(value: string, delimiter: string) {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  let depth = 0;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      current += character;
      escaped = true;
      continue;
    }
    if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote ? "" : character;
      current += character;
      continue;
    }
    if (!quote && "[({".includes(character)) depth += 1;
    if (!quote && "])}".includes(character)) depth = Math.max(0, depth - 1);
    if (!quote && depth === 0 && character === delimiter) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function readableValue(value: ClinicalJsonValue | undefined, fieldKey: string): string {
  const normalized = normalizeClinicalValue(value, fieldKey);
  if (normalized === null || normalized === undefined) return "";
  if (Array.isArray(normalized)) {
    return uniqueReadableValues(normalized.map((item) => readableValue(item, fieldKey))).join("; ");
  }
  if (typeof normalized === "object") {
    return Object.entries(normalized)
      .flatMap(([key, entry]) => {
        const readable = readableValue(entry, key);
        return readable ? [`${humanizeClinicalField(key)}: ${readable}`] : [];
      })
      .join("; ");
  }
  if (typeof normalized === "boolean") return normalized ? "Yes" : "No";
  return readableScalar(normalized);
}

function readableScalar(value: string | number) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  return normalizeStatusText(cleanText(value));
}

function cleanText(value: string) {
  return value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function normalizeStatusText(value: string) {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(value)) return value;
  const sentence = value.replaceAll("_", " ");
  return sentence.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function uniqueReadableValues(values: string[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const cleaned = cleanText(value);
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) return [];
    seen.add(key);
    return [cleaned];
  });
}

function dedupeJsonValues(values: Array<ClinicalJsonValue | undefined>): ClinicalJsonValue[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (value === null || value === undefined) return [];
    const key = typeof value === "string"
      ? `string:${cleanText(value).toLocaleLowerCase()}`
      : JSON.stringify(value);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

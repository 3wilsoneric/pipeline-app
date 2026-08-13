import {
  assessmentToolFieldDefinitions,
  type AssessmentExtractionField,
} from "./assessment-tool-schema";

export type ParsedAssessmentFile = {
  fields: AssessmentExtractionField[];
  matchConfidence: number;
  format: "csv" | "json";
};

const maxLocalImportBytes = 5 * 1024 * 1024;
const maxRows = 10_000;
const maxColumns = 300;

const targetByHeader = new Map<string, string>();
for (const definition of assessmentToolFieldDefinitions) {
  for (const header of [
    definition.key,
    definition.label,
    `assessment_tool.${definition.key}`,
    `assessment.${definition.key}`,
    ...definition.extraction_aliases,
  ]) {
    targetByHeader.set(normalizeHeader(header), `assessment_tool.${definition.key}`);
  }
}

export async function parseAssessmentFile(file: File): Promise<ParsedAssessmentFile> {
  if (file.size > maxLocalImportBytes) {
    throw new Error("Local assessment imports must be 5 MB or smaller. Larger files require the Azure extraction worker.");
  }
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "xlsx" || extension === "xls") {
    throw new Error("Excel workbook extraction is waiting for the Azure worker. Export this workbook as CSV to verify the workflow locally.");
  }

  const text = await file.text();
  if (extension === "json" || file.type === "application/json") {
    return parseJsonAssessment(text);
  }
  if (extension === "csv" || extension === "tsv" || file.type.includes("csv") || file.type.includes("tab-separated")) {
    return parseDelimitedAssessment(text, extension === "tsv" ? "\t" : undefined);
  }
  throw new Error("Upload CSV or JSON for local extraction. XLSX will use the Azure extraction worker when connected.");
}

function parseJsonAssessment(source: string): ParsedAssessmentFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("The JSON assessment file could not be read.");
  }

  const fields: AssessmentExtractionField[] = [];
  if (Array.isArray(parsed)) {
    for (const [index, entry] of parsed.entries()) {
      if (!isRecord(entry)) continue;
      const rawKey = stringValue(entry.field_key) || stringValue(entry.field) || stringValue(entry.key);
      if (!rawKey) continue;
      const rawValue = entry.value ?? entry.final_value ?? entry.proposed_value;
      appendField(fields, rawKey, rawValue, index + 1);
    }
  } else if (isRecord(parsed)) {
    for (const [key, value] of Object.entries(parsed)) appendField(fields, key, value, 1);
  } else {
    throw new Error("The JSON assessment must be an object or a list of field/value rows.");
  }

  return finish(fields, "json");
}

function parseDelimitedAssessment(source: string, delimiter?: string): ParsedAssessmentFile {
  const selectedDelimiter = delimiter ?? detectDelimiter(source);
  const rows = parseDelimitedRows(source, selectedDelimiter);
  if (rows.length < 2) throw new Error("The assessment file needs a header row and at least one value row.");
  if (rows.length > maxRows) throw new Error(`The assessment file contains more than ${maxRows.toLocaleString()} rows.`);
  if (rows.some((row) => row.length > maxColumns)) throw new Error(`The assessment file contains more than ${maxColumns} columns.`);

  const headers = rows[0].map((header) => header.trim());
  const normalizedHeaders = headers.map(normalizeHeader);
  const fieldColumn = normalizedHeaders.findIndex((header) => ["field", "field key", "key", "data point", "label"].includes(header));
  const valueColumn = normalizedHeaders.findIndex((header) => ["value", "answer", "response", "result", "final value"].includes(header));
  const fields: AssessmentExtractionField[] = [];

  if (fieldColumn >= 0 && valueColumn >= 0) {
    rows.slice(1).forEach((row, index) => {
      appendField(fields, row[fieldColumn] ?? "", row[valueColumn] ?? "", index + 2);
    });
  } else {
    rows.slice(1).forEach((row, rowIndex) => {
      headers.forEach((header, columnIndex) => {
        appendField(fields, header, row[columnIndex] ?? "", rowIndex + 2);
      });
    });
  }

  return finish(fields, "csv");
}

function appendField(
  fields: AssessmentExtractionField[],
  rawKey: string,
  rawValue: unknown,
  sourceRow: number,
) {
  const key = rawKey.trim();
  const value = serializeValue(rawValue);
  if (!key || value === null || !value.trim()) return;
  const matched = targetByHeader.get(normalizeHeader(key));
  fields.push({
    field_key: matched ?? `assessment_import.${safeUnknownKey(key)}`,
    proposed_value: value,
    confidence: matched ? 0.9 : 0.5,
    review_status: "pending",
    source_page_no: sourceRow,
  });
}

function finish(fields: AssessmentExtractionField[], format: "csv" | "json"): ParsedAssessmentFile {
  if (fields.length === 0) throw new Error("No assessment values were found in this file.");
  if (fields.length > 300) throw new Error("This local import produced more than 300 values. Split the file or use the extraction worker.");
  const matched = fields.filter((field) => field.field_key.startsWith("assessment_tool.")).length;
  return {
    fields,
    format,
    matchConfidence: Number((matched / fields.length).toFixed(3)),
  };
}

function parseDelimitedRows(source: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(value);
      value = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += character;
  }

  if (quoted) throw new Error("The assessment file contains an unclosed quoted value.");
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function detectDelimiter(source: string) {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  return countUnquoted(firstLine, "\t") > countUnquoted(firstLine, ",") ? "\t" : ",";
}

function countUnquoted(value: string, character: string) {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (!quoted && value[index] === character) count += 1;
  }
  return count;
}

function serializeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => String(item)));
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_./-]+/g, " ").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ");
}

function safeUnknownKey(value: string) {
  return normalizeHeader(value).replace(/\s+/g, "_").slice(0, 180) || "unknown";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

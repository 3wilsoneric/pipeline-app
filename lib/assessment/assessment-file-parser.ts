import {
  assessmentToolFieldDefinitions,
  type AssessmentExtractionField,
} from "./assessment-tool-schema";
import {
  assessmentWorkbookDataHeaders,
  assessmentWorkbookDataSheet,
  assessmentWorkbookSchemaVersion,
} from "./assessment-workbook-contract";
import { strFromU8, unzipSync } from "fflate";

export type ParsedAssessmentFile = {
  fields: AssessmentExtractionField[];
  matchConfidence: number;
  format: "csv" | "json" | "xlsx";
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
  if (extension === "xlsx") {
    return parsePipelineWorkbook(new Uint8Array(await file.arrayBuffer()));
  }
  if (extension === "xls") {
    throw new Error("Legacy .xls files are not supported. Save the workbook as .xlsx and try again.");
  }

  const text = await file.text();
  if (extension === "json" || file.type === "application/json") {
    return parseJsonAssessment(text);
  }
  if (extension === "csv" || extension === "tsv" || file.type.includes("csv") || file.type.includes("tab-separated")) {
    return parseDelimitedAssessment(text, extension === "tsv" ? "\t" : undefined);
  }
  throw new Error("Upload the Pipeline XLSX workbook, CSV, TSV, or JSON.");
}

function parsePipelineWorkbook(bytes: Uint8Array): ParsedAssessmentFile {
  let archive: ReturnType<typeof unzipSync>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new Error("The Excel workbook is damaged or is not a valid .xlsx file.");
  }

  const workbookXml = xmlFile(archive, "xl/workbook.xml");
  const relationshipsXml = xmlFile(archive, "xl/_rels/workbook.xml.rels");
  const sharedStrings = readSharedStrings(archive);
  const relationshipTargets = new Map<string, string>();
  for (const relationship of xmlElements(relationshipsXml, "Relationship")) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) relationshipTargets.set(id, normalizeWorkbookTarget(target));
  }

  const sheetFiles = new Map<string, string>();
  for (const sheet of xmlElements(workbookXml, "sheet")) {
    const name = sheet.getAttribute("name")?.trim();
    const relationshipId = sheet.getAttribute("r:id") ?? sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = relationshipId ? relationshipTargets.get(relationshipId) : undefined;
    if (name && target) sheetFiles.set(name, target);
  }

  const dataSheetPath = sheetFiles.get(assessmentWorkbookDataSheet);
  if (!dataSheetPath) {
    throw new Error(`This is not the Pipeline assessment workbook. The ${assessmentWorkbookDataSheet} sheet is missing.`);
  }

  const sheetCache = new Map<string, Map<string, string | number | boolean>>();
  const readSheet = (name: string) => {
    const cached = sheetCache.get(name);
    if (cached) return cached;
    const path = sheetFiles.get(name);
    if (!path) throw new Error(`The workbook source sheet “${name}” is missing.`);
    const cells = readWorksheet(xmlFile(archive, path), sharedStrings);
    sheetCache.set(name, cells);
    return cells;
  };

  const dataCells = readWorksheet(xmlFile(archive, dataSheetPath), sharedStrings);
  const headerRow = findWorkbookHeaderRow(dataCells);
  const headerColumns = new Map<string, string>();
  for (const [cell, value] of dataCells) {
    if (cellRow(cell) === headerRow) headerColumns.set(String(value).trim(), cellColumn(cell));
  }
  for (const header of assessmentWorkbookDataHeaders) {
    if (!headerColumns.has(header)) throw new Error(`The ${assessmentWorkbookDataSheet} sheet is missing the “${header}” column.`);
  }

  const knownFields = new Set(assessmentToolFieldDefinitions.map((definition) => definition.key));
  const fields: AssessmentExtractionField[] = [];
  for (let row = headerRow + 1; row <= headerRow + 300; row += 1) {
    const fieldKey = workbookCellString(dataCells, `${headerColumns.get("field_key")}${row}`);
    if (!fieldKey) continue;
    if (!knownFields.has(fieldKey as never)) throw new Error(`The workbook contains an unknown Pipeline field: ${fieldKey}.`);
    const schemaVersion = workbookCellString(dataCells, `${headerColumns.get("schema_version")}${row}`);
    if (schemaVersion !== assessmentWorkbookSchemaVersion) {
      throw new Error("This assessment workbook uses an unsupported schema version. Download a fresh workbook from Pipeline.");
    }
    const sourceSheet = workbookCellString(dataCells, `${headerColumns.get("source_sheet")}${row}`);
    const sourceCell = workbookCellString(dataCells, `${headerColumns.get("source_cell")}${row}`).toUpperCase();
    if (!sourceSheet || !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(sourceCell)) {
      throw new Error(`The workbook mapping for ${fieldKey} is incomplete.`);
    }
    const definition = assessmentToolFieldDefinitions.find((item) => item.key === fieldKey);
    const rawValue = readSheet(sourceSheet).get(sourceCell);
    const value = serializeWorkbookValue(rawValue, definition?.value_type);
    if (value === null || !value.trim()) continue;
    fields.push({
      field_key: `assessment_tool.${fieldKey}`,
      proposed_value: value,
      confidence: 1,
      review_status: "pending",
      source_page_no: row,
      evidence_url: `workbook://${encodeURIComponent(sourceSheet)}!${sourceCell}`,
    });
  }

  return finish(fields, "xlsx");
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

function finish(fields: AssessmentExtractionField[], format: "csv" | "json" | "xlsx"): ParsedAssessmentFile {
  if (fields.length === 0) throw new Error("No assessment values were found in this file.");
  if (fields.length > 300) throw new Error("This local import produced more than 300 values. Split the file or use the extraction worker.");
  const matched = fields.filter((field) => field.field_key.startsWith("assessment_tool.")).length;
  return {
    fields,
    format,
    matchConfidence: Number((matched / fields.length).toFixed(3)),
  };
}

function xmlFile(archive: ReturnType<typeof unzipSync>, path: string) {
  const file = archive[path];
  if (!file) throw new Error(`The Excel workbook is missing ${path}.`);
  const document = new DOMParser().parseFromString(strFromU8(file), "application/xml");
  if (xmlElements(document, "parsererror").length) throw new Error(`The Excel workbook contains invalid XML in ${path}.`);
  return document;
}

function normalizeWorkbookTarget(target: string) {
  const normalized = target.replace(/^\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized.replace(/^\.\.\//, "")}`;
}

function readSharedStrings(archive: ReturnType<typeof unzipSync>) {
  const file = archive["xl/sharedStrings.xml"];
  if (!file) return [] as string[];
  const document = new DOMParser().parseFromString(strFromU8(file), "application/xml");
  return xmlElements(document, "si").map((item) =>
    xmlElements(item, "t").map((text) => text.textContent ?? "").join(""),
  );
}

function readWorksheet(document: Document, sharedStrings: readonly string[]) {
  const cells = new Map<string, string | number | boolean>();
  for (const cell of xmlElements(document, "c")) {
    const reference = cell.getAttribute("r")?.toUpperCase();
    if (!reference) continue;
    const type = cell.getAttribute("t") ?? "n";
    const raw = xmlElements(cell, "v")[0]?.textContent ?? "";
    if (type === "inlineStr") {
      cells.set(reference, xmlElements(cell, "t").map((text) => text.textContent ?? "").join(""));
    } else if (type === "s") {
      cells.set(reference, sharedStrings[Number(raw)] ?? "");
    } else if (type === "b") {
      cells.set(reference, raw === "1");
    } else if (type === "str" || type === "d") {
      cells.set(reference, raw);
    } else if (raw !== "") {
      const numeric = Number(raw);
      cells.set(reference, Number.isFinite(numeric) ? numeric : raw);
    }
  }
  return cells;
}

function xmlElements(root: Document | Element, localName: string) {
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

function findWorkbookHeaderRow(cells: ReadonlyMap<string, string | number | boolean>) {
  for (let row = 1; row <= 25; row += 1) {
    const values = Array.from(cells).filter(([cell]) => cellRow(cell) === row).map(([, value]) => String(value));
    if (assessmentWorkbookDataHeaders.every((header) => values.includes(header))) return row;
  }
  throw new Error(`The ${assessmentWorkbookDataSheet} header row could not be found.`);
}

function workbookCellString(cells: ReadonlyMap<string, string | number | boolean>, cell: string) {
  const value = cells.get(cell.toUpperCase());
  return value === undefined || value === null ? "" : String(value).trim();
}

function cellRow(cell: string) {
  return Number(cell.match(/[0-9]+$/)?.[0] ?? 0);
}

function cellColumn(cell: string) {
  return cell.match(/^[A-Z]+/)?.[0] ?? "";
}

function serializeWorkbookValue(value: unknown, valueType?: string) {
  if (value === undefined || value === null || value === "") return null;
  if ((valueType === "date" || valueType === "timestamp") && typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
    return valueType === "date" ? date.toISOString().slice(0, 10) : date.toISOString();
  }
  if (valueType === "string_list") {
    const items = String(value).split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
    return JSON.stringify(items);
  }
  if (valueType === "reason_map") {
    try {
      return JSON.stringify(JSON.parse(String(value)));
    } catch {
      return String(value);
    }
  }
  return String(value);
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

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { assessmentBackupVersion, assessmentWorkbookFields, assessmentWorkbookFingerprint, assessmentWorkbookLayout, workbookChunkLength, workbookReadOnlyFields } from "./assessment-workbook-contract";
import { createEmptyAssessmentToolData, validateAssessmentToolData, type AssessmentToolData, type AssessmentToolFieldKey } from "./assessment-tool-schema";
import { validateAssessmentPatchRequest } from "./assessment-validation";

export type WorkbookIdentity = { assessmentId: string; referralId: number; origin: string };
export type AssessmentWorkbookCopy = WorkbookIdentity & { exportId: string; exportedAt: string; baseline: AssessmentToolData; answers: AssessmentToolData };
export type WorkbookChange = { field: AssessmentToolFieldKey; label: string; before: unknown; value: unknown; conflict: boolean; clearing: boolean };
type Archive = Record<string, Uint8Array>;
type WorkbookField = typeof assessmentWorkbookFields[number];
type CellValue = string | number | boolean;
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export function openAssessmentWorkbook(bytes: Uint8Array) {
  if (bytes.length > 5 * 1024 * 1024) throw new Error("Use a Pipeline workbook smaller than 5 MB.");
  let total = 0;
  let entries = 0;
  const archive = unzipSync(bytes, { filter: (file) => {
    total += file.originalSize;
    if (++entries > 300 || total > 24 * 1024 * 1024) throw new Error("This workbook is too large to restore safely.");
    return true;
  } });
  if (Object.keys(archive).some((p) => /vbaProject|externalLinks|embeddings/i.test(p))) throw new Error("Macros, embedded files and external workbook links are not supported.");
  return archive;
}

function xml(archive: Archive, path: string) {
  if (!archive[path]) throw new Error("The workbook is incomplete. Download a new copy.");
  const source = strFromU8(archive[path]);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("Unsupported workbook XML.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagNameNS("*", "parsererror").length) throw new Error("The workbook contains damaged XML.");
  return doc;
}

function elements(root: Document | Element, name: string) { return Array.from(root.getElementsByTagNameNS("*", name)); }
function saveXml(archive: Archive, path: string, doc: Document) { archive[path] = strToU8(new XMLSerializer().serializeToString(doc)); }
function sheetPaths(archive: Archive) {
  const workbook = xml(archive, "xl/workbook.xml");
  if (elements(workbook, "workbookPr").some((e) => ["1", "true"].includes(e.getAttribute("date1904") ?? ""))) throw new Error("Use the workbook's original date system. Download a new copy.");
  const rels = new Map(elements(xml(archive, "xl/_rels/workbook.xml.rels"), "Relationship").map((e) => [e.getAttribute("Id"), e.getAttribute("Target") ?? ""]));
  return new Map(elements(workbook, "sheet").map((s) => {
    const target = (rels.get(s.getAttribute("r:id") ?? s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")) ?? "").replace(/^\//, "");
    return [s.getAttribute("name")!, target.startsWith("xl/") ? target : `xl/${target}`];
  }));
}

function reader(archive: Archive) {
  const paths = sheetPaths(archive);
  const strings = archive["xl/sharedStrings.xml"] ? elements(xml(archive, "xl/sharedStrings.xml"), "si").map((e) => elements(e, "t").map((t) => t.textContent ?? "").join("")) : [];
  const cache = new Map<string, Map<string, Element>>();
  return (sheet: string, address: string): CellValue => {
    if (!cache.has(sheet)) {
      const path = paths.get(sheet);
      if (!path) throw new Error(`Missing worksheet: ${sheet}.`);
      cache.set(sheet, worksheetCells(xml(archive, path)));
    }
    const cell = cache.get(sheet)!.get(address);
    if (!cell) return "";
    if (elements(cell, "f").length) throw new Error(`Replace the formula in ${sheet}!${address} with an answer.`);
    return readCell(cell, strings, `${sheet}!${address}`);
  };
}

function worksheetCells(doc: Document) {
  const cells = new Map<string, Element>();
  for (const cell of elements(doc, "c")) {
    const ref = cell.getAttribute("r") ?? "";
    if (cells.has(ref)) throw new Error("Duplicate cells found in the workbook.");
    cells.set(ref, cell);
  }
  return cells;
}

function readCell(cell: Element, strings: string[], address: string): CellValue {
  const raw = elements(cell, "v")[0]?.textContent ?? "";
  switch (cell.getAttribute("t")) {
    case "inlineStr": return elements(cell, "t").map((e) => e.textContent ?? "").join("");
    case "s": return strings[Number(raw)] ?? "";
    case "b": return raw === "1";
    case "e": throw new Error(`Fix the Excel error in ${address}.`);
    case "str": case "d": return raw;
    default: return raw === "" ? "" : Number(raw);
  }
}

function setCell(doc: Document, address: string, value: string | number) {
  const cell = elements(doc, "c").find((c) => c.getAttribute("r") === address);
  if (!cell) throw new Error(`The template is missing cell ${address}. Regenerate the workbook.`);
  cell.replaceChildren();
  if (typeof value === "number") {
    cell.setAttribute("t", "n");
    const v = doc.createElementNS(ns, "v"); v.textContent = String(value); cell.append(v);
  } else {
    cell.setAttribute("t", "inlineStr");
    const inline = doc.createElementNS(ns, "is");
    const t = doc.createElementNS(ns, "t"); t.setAttribute("xml:space", "preserve"); t.textContent = value;
    inline.append(t); cell.append(inline);
  }
}

function displayValue(field: typeof assessmentWorkbookFields[number], value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (value === null || value === undefined) return "";
  if (field.value_type === "reason_map") return "Explanations are beside their questions.";
  const label = (v: string) => field.question?.options?.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) return value.map(label).join("\n");
  return typeof value === "string" ? label(value) : String(value);
}

export async function exportAssessmentWorkbook(template: Uint8Array, identity: WorkbookIdentity, data: AssessmentToolData) {
  const archive = openAssessmentWorkbook(template);
  const read = reader(archive);
  const fingerprint = await assessmentWorkbookFingerprint();
  if (read("Pipeline_Data", "B1") !== assessmentBackupVersion || read("Pipeline_Data", "B2") !== fingerprint) throw new Error("The Excel template is out of date. Regenerate it before exporting.");
  const meta = { ...identity, exportId: crypto.randomUUID(), exportedAt: new Date().toISOString() };
  const paths = sheetPaths(archive);
  const metadata = xml(archive, paths.get("Pipeline_Data")!);
  setCell(metadata, "B3", JSON.stringify(meta));
  assessmentWorkbookFields.forEach((field, index) => {
    const baseline = JSON.stringify(data[field.key]);
    if (baseline.length > 16 * workbookChunkLength) throw new Error(`${field.label} exceeds this workbook's recovery capacity. Your answer has not been truncated.`);
    for (let c = 0; c < 16; c++) setCell(metadata, `${String.fromCharCode(67 + c)}${index + 6}`, baseline.slice(c * workbookChunkLength, (c + 1) * workbookChunkLength));
  });
  saveXml(archive, paths.get("Pipeline_Data")!, metadata);
  for (const section of assessmentWorkbookLayout) {
    const doc = xml(archive, paths.get(section.sheet)!);
    setCell(doc, "B2", data.resident_name || "Assessment");
    setCell(doc, "C2", `Copy saved ${meta.exportedAt.replace("T", " ").slice(0, 19)} UTC`);
    for (const field of section.fields) writeAnswer(doc, { ...field, sheet: section.sheet }, data);
    saveXml(archive, paths.get(section.sheet)!, doc);
  }
  const start = xml(archive, paths.get("Start Here")!);
  setCell(start, "B2", data.resident_name || "Assessment");
  setCell(start, "B3", `Saved ${meta.exportedAt.replace("T", " ").slice(0, 19)} UTC. Includes current answers, even if not yet synced.`);
  saveXml(archive, paths.get("Start Here")!, start);
  return { bytes: zipSync(archive), ...meta };
}

function writeAnswer(doc: Document, field: WorkbookField, data: AssessmentToolData) {
  const value = displayValue(field, data[field.key]);
  if (value.length > field.chunks * workbookChunkLength) throw new Error(`${field.label} is too long for this workbook. Your answer has not been truncated.`);
  for (let c = 0; c < field.chunks; c++) {
    const chunk = answerChunk(field, data[field.key], value, c);
    setCell(doc, `C${field.row + c}`, chunk);
    sizeAnswerRow(doc, field.row + c, chunk, c > 0);
  }
  setCell(doc, `D${field.row}`, data.unable_to_assess_reasons[field.key] ?? "");
}

function answerChunk(field: WorkbookField, raw: AssessmentToolData[AssessmentToolFieldKey], value: string, index: number) {
  if (index === 0 && field.value_type === "date" && value) return Math.round((Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);
  if (index === 0 && typeof raw === "number") return raw;
  return value.slice(index * workbookChunkLength, (index + 1) * workbookChunkLength);
}

function sizeAnswerRow(doc: Document, rowNumber: number, chunk: string | number, continuation: boolean) {
  const row = elements(doc, "row").find((r) => r.getAttribute("r") === String(rowNumber));
  if (!row) return;
  if (continuation) row.setAttribute("hidden", chunk ? "0" : "1");
  const lines = Math.max(String(chunk).split("\n").length, Math.ceil(String(chunk).length / 65));
  row.setAttribute("ht", String(Math.min(409, Math.max(Number(row.getAttribute("ht") ?? 60), lines * 16 + 12))));
}

function parseChoice(field: WorkbookField, value: string) {
  const options = field.question?.options;
  if (!options) return value;
  const match = options.find((o) => o.label.toLowerCase() === value.toLowerCase() || o.value === value);
  if (!match) throw new Error(`Choose a listed answer for ${field.label}.`);
  return match.value;
}

function parseNumber(field: WorkbookField, raw: CellValue) {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Enter a number for ${field.label}.`);
  if (field.question?.min !== undefined && n < field.question.min || field.question?.max !== undefined && n > field.question.max) throw new Error(`${field.label} is outside its allowed range.`);
  return n;
}

function parseAnswer(field: WorkbookField, raw: CellValue, baseline: AssessmentToolData[AssessmentToolFieldKey]) {
  // Preserve unchanged legacy wording and list items exactly, including embedded newlines.
  if (String(raw) === displayValue(field, baseline)) return baseline;
  if (raw === "") return createEmptyAssessmentToolData()[field.key];
  const choice = (v: string) => parseChoice(field, v);
  if (field.value_type === "string_list") return String(raw).split(/\r?\n/).map((v) => v.trim()).filter(Boolean).map(choice);
  if (field.value_type === "integer" || field.value_type === "confidence") {
    return parseNumber(field, raw);
  }
  if (field.value_type === "date" && typeof raw === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000).toISOString().slice(0, 10);
  return choice(String(raw));
}

export async function importAssessmentWorkbook(bytes: Uint8Array, identity: WorkbookIdentity): Promise<AssessmentWorkbookCopy> {
  const read = reader(openAssessmentWorkbook(bytes));
  if (read("Pipeline_Data", "B1") !== assessmentBackupVersion || read("Pipeline_Data", "B2") !== await assessmentWorkbookFingerprint()) throw new Error("This workbook uses an older or different assessment. Keep it safe and download the current version; no answers were changed.");
  const meta = readCopyIdentity(read, identity);
  const baseline = createEmptyAssessmentToolData();
  const answers = createEmptyAssessmentToolData();
  for (const [index, field] of assessmentWorkbookFields.entries()) readAnswer(read, field, index, baseline, answers);
  for (const data of [baseline, answers]) {
    const issues = validateAssessmentToolData(data);
    if (issues.length) throw new Error(issues[0].message);
  }
  const patch = Object.fromEntries(Object.entries(answers).filter(([k]) => !workbookReadOnlyFields.has(k as AssessmentToolFieldKey)));
  const checked = validateAssessmentPatchRequest({ if_match: 1, patch: { data: patch } });
  if (!checked.ok) throw new Error(checked.message);
  return { ...identity, ...meta, baseline, answers };
}

function readCopyIdentity(read: ReturnType<typeof reader>, identity: WorkbookIdentity) {
  const meta = JSON.parse(String(read("Pipeline_Data", "B3"))) as Partial<AssessmentWorkbookCopy>;
  if (meta.assessmentId !== identity.assessmentId || meta.referralId !== identity.referralId || meta.origin !== identity.origin) throw new Error("This workbook belongs to a different assessment or site. No answers were changed.");
  if (typeof meta.exportId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meta.exportId) || typeof meta.exportedAt !== "string" || meta.exportedAt.length > 40 || !Number.isFinite(Date.parse(meta.exportedAt))) throw new Error("The workbook identification is damaged.");
  return { exportId: meta.exportId, exportedAt: meta.exportedAt };
}

function readAnswer(read: ReturnType<typeof reader>, field: WorkbookField, index: number, baseline: AssessmentToolData, answers: AssessmentToolData) {
  if (read("Pipeline_Data", `A${index + 6}`) !== field.key || read(field.sheet, `A${field.row}`) !== field.key) throw new Error("The workbook rows or mappings changed. No answers were imported.");
  const serialized = Array.from({ length: 16 }, (_, c) => read("Pipeline_Data", `${String.fromCharCode(67 + c)}${index + 6}`)).join("");
  const original = JSON.parse(serialized);
  baseline[field.key] = original as never;
  if (field.value_type === "reason_map") return;
  const cells = Array.from({ length: field.chunks }, (_, i) => read(field.sheet, `C${field.row + i}`));
  const raw = field.chunks === 1 ? cells[0] : cells.join("");
  answers[field.key] = parseAnswer(field, raw, original) as never;
  if (workbookReadOnlyFields.has(field.key) && JSON.stringify(answers[field.key]) !== JSON.stringify(original)) throw new Error(`${field.label} is managed by Pipeline and cannot be changed in Excel.`);
  const reason = String(read(field.sheet, `D${field.row}`)).trim();
  if (reason) answers.unable_to_assess_reasons[field.key] = reason;
}

export function assessmentWorkbookChanges(copy: AssessmentWorkbookCopy, current: AssessmentToolData): WorkbookChange[] {
  return assessmentWorkbookFields.filter((f) => !workbookReadOnlyFields.has(f.key)).flatMap((field) => {
    const original = copy.baseline[field.key], value = copy.answers[field.key], before = current[field.key];
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (same(original, value) || same(value, before)) return [];
    return [{ field: field.key, label: field.label, value, before, conflict: !same(original, before), clearing: value === null || value === "" || Array.isArray(value) && value.length === 0 || field.value_type === "reason_map" && Object.keys(value ?? {}).length === 0 }];
  });
}

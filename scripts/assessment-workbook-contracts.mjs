#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

const workbookPath = "public/templates/pipeline-assessment-workbook.xlsx";
const archive = unzipSync(new Uint8Array(readFileSync(workbookPath)));
const workbookXml = stripNamespaces(text("xl/workbook.xml"));
const relationshipsXml = text("xl/_rels/workbook.xml.rels");
const sharedStrings = readSharedStrings();
const schemaSource = readFileSync("lib/assessment/assessment-tool-schema.ts", "utf8");
const expectedKeys = Array.from(schemaSource.matchAll(/\bfield\("([a-z0-9_]+)"/g), (match) => match[1]);

const relationships = new Map(Array.from(relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g), (match) => {
  const attributes = attrs(match[1]);
  return [attributes.Id, normalizeTarget(attributes.Target)];
}));
const sheets = new Map(Array.from(workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g), (match) => {
  const attributes = attrs(match[1]);
  return [decodeXml(attributes.name), relationships.get(attributes["r:id"])];
}));

const dataSheet = sheets.get("Pipeline_Data");
if (!dataSheet) fail("Pipeline_Data sheet is missing.");
const cells = readCells(stripNamespaces(text(dataSheet)));
const headerRow = findHeaderRow(cells);
const headerColumns = new Map(Array.from(cells).filter(([cell]) => rowNumber(cell) === headerRow).map(([cell, record]) => [String(record.value), columnName(cell)]));
const fields = [];
for (let row = headerRow + 1; row <= headerRow + 300; row += 1) {
  const key = stringCell(cells, `${headerColumns.get("field_key")}${row}`);
  if (!key) continue;
  fields.push({
    key,
    version: stringCell(cells, `${headerColumns.get("schema_version")}${row}`),
    sourceSheet: stringCell(cells, `${headerColumns.get("source_sheet")}${row}`),
    sourceCell: stringCell(cells, `${headerColumns.get("source_cell")}${row}`),
    formula: cells.get(`I${row}`)?.formula ?? "",
  });
}

const checks = [
  ["workbook is a non-empty XLSX", statSync(workbookPath).size > 100_000],
  ["workbook has Start Here, 12 clinical tabs, Pipeline_Data, and Codebook", sheets.size === 15 && sheets.has("Start Here") && sheets.has("Codebook")],
  ["Pipeline_Data contains every canonical field exactly once", fields.length === expectedKeys.length && new Set(fields.map((field) => field.key)).size === expectedKeys.length],
  ["Pipeline_Data keys match the application schema", expectedKeys.every((key) => fields.some((field) => field.key === key))],
  ["every row uses the supported schema version", fields.every((field) => field.version === "PIPELINE_ASSESSMENT_WORKBOOK_V1")],
  ["every field maps to a real fixed source cell", fields.every((field) => sheets.has(field.sourceSheet) && /^[A-Z]{1,3}[1-9][0-9]*$/.test(field.sourceCell))],
  ["every consolidated value is formula-linked to its declared source cell", fields.every((field) => field.formula.includes(`'${field.sourceSheet}'!${field.sourceCell}`))],
];

const failed = checks.filter(([, ok]) => !ok);
console.log(JSON.stringify({ ok: failed.length === 0, workbook: workbookPath, field_count: fields.length, checks: checks.map(([name, ok]) => ({ name, ok })) }, null, 2));
if (failed.length) process.exit(1);

function text(path) {
  const file = archive[path];
  if (!file) fail(`XLSX member is missing: ${path}`);
  return strFromU8(file);
}

function readSharedStrings() {
  const source = archive["xl/sharedStrings.xml"] ? stripNamespaces(text("xl/sharedStrings.xml")) : "";
  return Array.from(source.matchAll(/<si>([\s\S]*?)<\/si>/g), (match) =>
    decodeXml(Array.from(match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (part) => part[1]).join("")),
  );
}

function readCells(source) {
  const cells = new Map();
  const populatedCells = source.replace(/<c\b[^>]*\/>/g, "");
  for (const match of populatedCells.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attributes = attrs(match[1]);
    const reference = attributes.r;
    if (!reference) continue;
    const body = match[2];
    const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
    const inline = Array.from(body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (part) => part[1]).join("");
    const formula = decodeXml(body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/)?.[1] ?? "");
    let value;
    if (attributes.t === "s") value = sharedStrings[Number(raw)] ?? "";
    else if (attributes.t === "inlineStr") value = decodeXml(inline);
    else if (attributes.t === "b") value = raw === "1";
    else value = raw === "" ? "" : Number.isFinite(Number(raw)) ? Number(raw) : decodeXml(raw);
    cells.set(reference, { value, formula });
  }
  return new Map(Array.from(cells, ([cell, record]) => [cell, record]));
}

function findHeaderRow(cells) {
  for (let row = 1; row <= 25; row += 1) {
    const values = Array.from(cells).filter(([cell]) => rowNumber(cell) === row).map(([, record]) => String(record.value));
    if (["schema_version", "field_key", "source_sheet", "source_cell", "value"].every((header) => values.includes(header))) return row;
  }
  fail("Pipeline_Data header row is missing.");
}

function attrs(source) {
  return Object.fromEntries(Array.from(source.matchAll(/([\w:.-]+)="([^"]*)"/g), (match) => [match[1], decodeXml(match[2])]));
}

function normalizeTarget(target = "") {
  const normalized = target.replace(/^\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized.replace(/^\.\.\//, "")}`;
}

function stringCell(cells, cell) {
  const record = cells.get(cell);
  return record ? String(record.value).trim() : "";
}

function rowNumber(cell) {
  return Number(cell.match(/[0-9]+$/)?.[0] ?? 0);
}

function columnName(cell) {
  return cell.match(/^[A-Z]+/)?.[0] ?? "";
}

function decodeXml(value) {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function stripNamespaces(value) {
  return value.replace(/<(\/?)[a-zA-Z0-9_]+:/g, "<$1");
}

function fail(message) {
  throw new Error(message);
}

#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.split("=");
  return [key, rest.join("=")];
}));
const inputPath = args.get("--input");
const outputPath = args.get("--output");
const sourceSystem = args.get("--source-system") || "allo";

if (!inputPath || !outputPath) fail("Use --input=/absolute/path/export.csv --output=/absolute/path/private-manifest.json.");
if (!path.isAbsolute(inputPath) || !path.isAbsolute(outputPath)) fail("Input and output paths must be absolute.");
if (!new Set(["allo", "import"]).has(sourceSystem)) fail("--source-system must be allo or import.");

const csv = await readFile(inputPath, "utf8");
const rows = parseCsv(csv);
if (rows.length < 2) fail("The export must contain a header and at least one file row.");
const headers = rows[0].map((value) => normalizeHeader(value));
const required = ["client_name", "file_path"];
for (const header of required) if (!headers.includes(header)) fail(`The export is missing the ${header} column.`);
if (rows.length - 1 > 100_000) fail("The export exceeds the 100,000-file safety limit.");

const items = [];
for (let index = 1; index < rows.length; index += 1) {
  if (rows[index].every((value) => !value.trim())) continue;
  const row = Object.fromEntries(headers.map((header, column) => [header, rows[index][column]?.trim() ?? ""]));
  const sourcePath = path.resolve(path.dirname(inputPath), row.file_path);
  const metadata = await stat(sourcePath).catch(() => null);
  if (!metadata?.isFile()) fail(`Row ${index + 1} references a file that does not exist.`);
  if (metadata.size < 1 || metadata.size > 100 * 1024 * 1024) fail(`Row ${index + 1} is outside the 1-byte to 100-MB file limit.`);
  const bytes = await readFile(sourcePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const itemId = row.source_item_id || `${row.source_canvas_id || "file"}:${sha256}`;
  items.push({
    source_item_id: itemId,
    source_canvas_id: nullValue(row.source_canvas_id),
    source_client_name: requiredValue(row.client_name, index, "client_name"),
    source_resident_number: nullValue(row.resident_number),
    source_date_of_birth: dateValue(row.date_of_birth, index),
    source_community: nullValue(row.community),
    source_file_name: path.basename(sourcePath),
    source_content_type: contentTypeFor(sourcePath),
    source_byte_size: metadata.size,
    source_sha256: sha256,
    source_path: sourcePath,
    source_locator: nullValue(row.source_locator || row.canvas_url),
  });
}
if (items.length === 0) fail("The export contains no usable file rows.");

const manifest = {
  version: 1,
  manifest_id: randomUUID(),
  source_system: sourceSystem,
  data_class: "user_supplied_real",
  created_at: new Date().toISOString(),
  item_count: items.length,
  items,
};
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await chmod(outputPath, 0o600);
console.log(JSON.stringify({ ok: true, item_count: items.length, source_system: sourceSystem }));

function parseCsv(value) {
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
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) fail("The CSV contains an unterminated quoted field.");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases = {
    name: "client_name",
    resident_name: "client_name",
    client: "client_name",
    dob: "date_of_birth",
    resident_id: "resident_number",
    filename: "file_path",
    file: "file_path",
    path: "file_path",
    canvas_id: "source_canvas_id",
    document_id: "source_item_id",
  };
  return aliases[normalized] || normalized;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".png") return "image/png";
  if ([".tif", ".tiff"].includes(extension)) return "image/tiff";
  if (extension === ".heic") return "image/heic";
  return "application/octet-stream";
}

function requiredValue(value, index, field) {
  const normalized = value?.trim() ?? "";
  if (!normalized) fail(`Row ${index + 1} is missing ${field}.`);
  return normalized;
}

function dateValue(value, index) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) fail(`Row ${index + 1} date_of_birth must be YYYY-MM-DD.`);
  return normalized;
}

function nullValue(value) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

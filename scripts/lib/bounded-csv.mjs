import { readFile, stat } from "node:fs/promises";

export async function readBoundedCsvRecords(filePath, {
  requiredHeaders,
  label,
  maxInputBytes = 8 * 1024 * 1024,
  maxRows = 10_000,
  maxColumns = 64,
  maxCellCharacters = 10_000,
}) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > maxInputBytes) {
    throw new Error(`${label} CSV is empty, not a file, or exceeds the import limit.`);
  }
  const text = await readFile(filePath, "utf8");
  return recordsFromCsv(text, {
    requiredHeaders,
    label,
    maxRows,
    maxColumns,
    maxCellCharacters,
  });
}

export function recordsFromCsv(text, {
  requiredHeaders,
  label,
  maxRows = 10_000,
  maxColumns = 64,
  maxCellCharacters = 10_000,
}) {
  const table = parseCsv(text, { maxRows, maxColumns, maxCellCharacters });
  if (table.length < 2) throw new Error(`${label} CSV has no data rows.`);
  const headers = table[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  if (new Set(headers).size !== headers.length) throw new Error(`${label} CSV has duplicate headers.`);
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) throw new Error(`${label} CSV is missing required columns: ${missing.join(", ")}.`);

  const records = table
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row, index) => {
      if (row.length !== headers.length) throw new Error(`${label} CSV row ${index + 2} has the wrong column count.`);
      return Object.fromEntries(headers.map((header, column) => [header, row[column]]));
    });
  if (records.length === 0 || records.length > maxRows) {
    throw new Error(`${label} CSV must contain between 1 and ${maxRows} data rows.`);
  }
  return records;
}

function parseCsv(text, { maxRows, maxColumns, maxCellCharacters }) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length > maxRows + 2) throw new Error(`CSV exceeds the ${maxRows}-row import limit.`);
    } else {
      cell += character;
    }
    if (cell.length > maxCellCharacters) throw new Error("CSV contains a field that exceeds the import limit.");
    if (row.length > maxColumns) throw new Error(`CSV exceeds the ${maxColumns}-column import limit.`);
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

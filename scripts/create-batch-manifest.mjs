#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const inputs = options.input.length > 0 ? options.input : options.positionals;

if (inputs.length === 0) {
  printUsageAndExit();
}

const files = inputs.flatMap((input) => collectFiles(resolve(input)));

if (files.length === 0) {
  throw new Error("No packet files found. Pass one or more files or directories.");
}

const now = new Date();
const batchId = options.batchId ?? `backlog-${toDateSlug(now)}`;
const receivedAt = options.receivedAt ?? now.toISOString();
const rows = files.map((filePath) => {
  const contentHash = sha256(filePath);
  const packetId = makePacketId(filePath, contentHash);
  const ext = extname(filePath).toLowerCase();

  return {
    batch_id: batchId,
    packet_id: packetId,
    raw_blob_path: filePath,
    facility: options.facility,
    source_type: options.sourceType,
    received_at: receivedAt,
    page_count_estimate: ext === ".pdf" ? getPdfPageCount(filePath, options.pdfinfo) : "",
    content_hash: contentHash,
    priority: options.priority,
    status: options.status,
  };
});

const csv = toCsv(rows);
writeFileSync(options.out, csv);

console.log(`Wrote ${rows.length} manifest row(s) to ${options.out}`);

function parseArgs(args) {
  const parsed = {
    batchId: undefined,
    facility: "unknown",
    input: [],
    out: "batch_manifest.csv",
    pdfinfo: process.env.PDFINFO_PATH,
    positionals: [],
    priority: "normal",
    receivedAt: undefined,
    sourceType: "backlog",
    status: "queued",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      index += 1;
      if (!args[index]) {
        throw new Error(`${arg} requires a value.`);
      }
      return args[index];
    };

    switch (arg) {
      case "--batch-id":
        parsed.batchId = next();
        break;
      case "--facility":
        parsed.facility = next();
        break;
      case "--input":
        parsed.input.push(next());
        break;
      case "--out":
        parsed.out = next();
        break;
      case "--pdfinfo":
        parsed.pdfinfo = next();
        break;
      case "--priority":
        parsed.priority = next();
        break;
      case "--received-at":
        parsed.receivedAt = next();
        break;
      case "--source-type":
        parsed.sourceType = next();
        break;
      case "--status":
        parsed.status = next();
        break;
      case "--help":
      case "-h":
        printUsageAndExit(0);
        break;
      default:
        parsed.positionals.push(arg);
    }
  }

  return parsed;
}

function collectFiles(inputPath) {
  const stat = statSync(inputPath);

  if (stat.isFile()) {
    return isPacketFile(inputPath) ? [inputPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  return readdirSync(inputPath)
    .flatMap((entry) => collectFiles(join(inputPath, entry)))
    .sort();
}

function isPacketFile(filePath) {
  return [".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"].includes(
    extname(filePath).toLowerCase(),
  );
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function makePacketId(filePath, contentHash) {
  const name = basename(filePath, extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return `${name || "packet"}-${contentHash.slice(0, 12)}`;
}

function getPdfPageCount(filePath, pdfinfoPath) {
  const candidates = [
    pdfinfoPath,
    "pdfinfo",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const output = execFileSync(candidate, [filePath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const match = output.match(/^Pages:\s+(\d+)/m);
      if (match) return match[1];
    } catch {
      continue;
    }
  }

  return "";
}

function toCsv(rows) {
  const headers = [
    "batch_id",
    "packet_id",
    "raw_blob_path",
    "facility",
    "source_type",
    "received_at",
    "page_count_estimate",
    "content_hash",
    "priority",
    "status",
  ];

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
    "",
  ].join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toDateSlug(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function printUsageAndExit(code = 1) {
  console.log(`Usage:
  node scripts/create-batch-manifest.mjs --input /path/to/packets --out batch_manifest.csv

Options:
  --batch-id      Stable batch id. Defaults to backlog-YYYYMMDD.
  --facility      Source facility label. Defaults to unknown.
  --input         File or directory. May be repeated.
  --out           Output CSV path. Defaults to batch_manifest.csv.
  --pdfinfo       Optional pdfinfo executable path.
  --priority      Manifest priority. Defaults to normal.
  --received-at   ISO received timestamp. Defaults to now.
  --source-type   Source type. Defaults to backlog.
  --status        Initial status. Defaults to queued.
`);
  process.exit(code);
}

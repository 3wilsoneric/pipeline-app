#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const distDirectory = process.env.PIPELINE_NEXT_DIST_DIR?.trim() || ".next";
const staticDirectory = path.join(distDirectory, "static");
const budgets = {
  total_static_bytes: boundedInteger("PIPELINE_BUILD_MAX_STATIC_BYTES", 10 * 1024 * 1024),
  largest_javascript_bytes: boundedInteger("PIPELINE_BUILD_MAX_JS_BYTES", 1024 * 1024),
  largest_stylesheet_bytes: boundedInteger("PIPELINE_BUILD_MAX_CSS_BYTES", 512 * 1024),
  total_gzip_code_bytes: boundedInteger("PIPELINE_BUILD_MAX_GZIP_CODE_BYTES", 3 * 1024 * 1024),
};
const forbiddenServerMarkers = [
  "PIPELINE_DATABASE_URL",
  "PIPELINE_ALAMO_CLIENT_SECRET",
  "DATABRICKS_TOKEN",
  "DATABRICKS_CLIENT_SECRET",
  "AZURE_STORAGE_ACCOUNT_KEY",
  "PIPELINE_WORKER_SHARED_SECRET",
  "PIPELINE_ENTRA_SESSION_SECRET",
];

let files;
try {
  files = await listFiles(staticDirectory);
} catch {
  fail("Production build artifacts are missing. Run npm run build first.");
}

const assets = [];
let forbiddenMarkerCount = 0;
for (const file of files) {
  const metadata = await stat(file);
  const extension = path.extname(file).toLowerCase();
  let gzipBytes = 0;
  if (extension === ".js" || extension === ".css") {
    const source = await readFile(file);
    gzipBytes = gzipSync(source, { level: 9 }).byteLength;
    const text = source.toString("utf8");
    forbiddenMarkerCount += forbiddenServerMarkers.filter((marker) => text.includes(marker)).length;
  }
  assets.push({ extension, bytes: metadata.size, gzipBytes });
}

const javascript = assets.filter((asset) => asset.extension === ".js");
const stylesheets = assets.filter((asset) => asset.extension === ".css");
const metrics = {
  asset_count: assets.length,
  javascript_asset_count: javascript.length,
  stylesheet_asset_count: stylesheets.length,
  source_map_count: assets.filter((asset) => asset.extension === ".map").length,
  total_static_bytes: sum(assets, "bytes"),
  largest_javascript_bytes: maximum(javascript, "bytes"),
  largest_stylesheet_bytes: maximum(stylesheets, "bytes"),
  total_gzip_code_bytes: sum([...javascript, ...stylesheets], "gzipBytes"),
  forbidden_server_marker_count: forbiddenMarkerCount,
};
const checks = [
  { name: "static output remains within its aggregate byte budget", ok: metrics.total_static_bytes <= budgets.total_static_bytes },
  { name: "individual JavaScript chunks remain bounded", ok: metrics.largest_javascript_bytes <= budgets.largest_javascript_bytes },
  { name: "individual stylesheets remain bounded", ok: metrics.largest_stylesheet_bytes <= budgets.largest_stylesheet_bytes },
  { name: "compressed browser code remains bounded", ok: metrics.total_gzip_code_bytes <= budgets.total_gzip_code_bytes },
  { name: "production client output contains no source maps", ok: metrics.source_map_count === 0 },
  { name: "production client output contains no server credential markers", ok: metrics.forbidden_server_marker_count === 0 },
];
const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({
  ok,
  dist_directory: distDirectory,
  budgets,
  metrics,
  checks,
  note: "Only aggregate artifact sizes and marker counts are emitted. File names and bundle contents are not logged.",
}, null, 2));
if (!ok) process.exit(1);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const destination = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(destination) : [destination];
  }));
  return nested.flat();
}

function sum(values, key) {
  return values.reduce((total, value) => total + value[key], 0);
}

function maximum(values, key) {
  return values.reduce((largest, value) => Math.max(largest, value[key]), 0);
}

function boundedInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

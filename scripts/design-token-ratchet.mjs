#!/usr/bin/env node

// Ratchet for hardcoded styling: hex colors and pixel radii outside app/design-tokens.css.
// Per-file counts may only go down. Rules: docs/design/PRINCIPLES.md, AGENTS.md "Design".

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const baselinePath = resolve(ROOT, "docs/design/hardcoded-style-baseline.json");
const writeBaseline = process.argv.includes("--write-baseline");
const tokensPath = "app/design-tokens.css";
const scanned = /^(?:app|components|lib)\/.*\.(?:tsx?|css)$/u;
const patterns = {
  hex: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b(?![-\w])/gu,
  radius: /rounded(?:-[trblse]{1,2})?-\[\d+(?:\.\d+)?px\]|border-radius:\s*\d+(?:\.\d+)?px/gu,
};

const paths = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((path) => scanned.test(path) && path !== tokensPath);

const counts = {};
for (const path of paths.sort()) {
  let source;
  try {
    source = readFileSync(resolve(ROOT, path), "utf8");
  } catch {
    continue;
  }
  const entry = {};
  for (const [kind, pattern] of Object.entries(patterns)) {
    const found = source.match(pattern)?.length ?? 0;
    if (found) entry[kind] = found;
  }
  if (Object.keys(entry).length) counts[path] = entry;
}

const totals = (table) =>
  Object.values(table).reduce((sum, entry) => {
    for (const [kind, value] of Object.entries(entry)) sum[kind] = (sum[kind] ?? 0) + value;
    return sum;
  }, {});

if (writeBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify({ totals: totals(counts), files: counts }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ wrote: "docs/design/hardcoded-style-baseline.json", totals: totals(counts) }));
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).files;
const regressions = [];
const improved = [];
for (const path of new Set([...Object.keys(baseline), ...Object.keys(counts)])) {
  for (const kind of Object.keys(patterns)) {
    const before = baseline[path]?.[kind] ?? 0;
    const after = counts[path]?.[kind] ?? 0;
    if (after > before) regressions.push({ path, kind, before, after });
    else if (after < before) improved.push({ path, kind, before, after });
  }
}

console.log(JSON.stringify({ totals: totals(counts), baselineTotals: totals(baseline), regressions, improved: improved.length }, null, 2));
if (regressions.length) {
  console.error("Hardcoded colors or radii increased. Use tokens from app/design-tokens.css instead.");
  process.exit(1);
}
if (improved.length) console.log("Counts dropped. Lock them in with: npm run design:baseline");

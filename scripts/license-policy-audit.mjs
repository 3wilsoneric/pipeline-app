#!/usr/bin/env node

import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const allowed = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
]);
const operators = new Set(["AND", "OR", "WITH"]);
const packages = Object.entries(lock.packages ?? {}).filter(([packagePath]) => packagePath);
const missingLicense = packages.filter(([, entry]) => !entry.license);
const missingIntegrity = packages.filter(([, entry]) => !entry.link && !entry.inBundle && !entry.integrity);
const unapproved = packages.filter(([, entry]) => {
  const identifiers = String(entry.license ?? "").match(/[A-Za-z0-9.+-]+/g) ?? [];
  return identifiers.some((identifier) => !operators.has(identifier) && !allowed.has(identifier));
});
const licenseCounts = new Map();
for (const [, entry] of packages) {
  licenseCounts.set(entry.license, (licenseCounts.get(entry.license) ?? 0) + 1);
}

const checks = [
  { name: "every locked package declares a license", ok: missingLicense.length === 0 },
  { name: "every registry package is integrity pinned", ok: missingIntegrity.length === 0 },
  { name: "every declared license is approved", ok: unapproved.length === 0 },
  { name: "package lock uses the current lockfile format", ok: lock.lockfileVersion === 3 },
];
console.log(JSON.stringify({
  ok: checks.every((item) => item.ok),
  package_count: packages.length,
  license_expression_counts: Object.fromEntries([...licenseCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
  missing_license_count: missingLicense.length,
  missing_integrity_count: missingIntegrity.length,
  unapproved_license_count: unapproved.length,
  checks,
  note: "The audit emits aggregate dependency metadata only. It never emits environment values or application data.",
}, null, 2));
if (checks.some((item) => !item.ok)) process.exit(1);

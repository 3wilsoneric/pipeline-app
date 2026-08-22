#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const sourceRoot = process.argv[2];
const destinationRoot = process.argv[3];
if (!isAbsolute(sourceRoot ?? "") || !isAbsolute(destinationRoot ?? "")) {
  throw new Error("Absolute source and destination module paths are required.");
}

const roots = ["@azure/identity", "@azure/storage-blob", "postgres"];
const packages = new Set();

function includePackage(name) {
  if (packages.has(name)) return;
  const source = join(sourceRoot, name);
  const manifestPath = join(source, "package.json");
  if (!existsSync(manifestPath)) return;
  packages.add(name);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const dependency of Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  })) includePackage(dependency);
}

for (const root of roots) includePackage(root);
for (const name of packages) {
  const destination = join(destinationRoot, name);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(sourceRoot, name), destination, { recursive: true });
}

if (packages.size === 0) throw new Error("No operational runtime dependencies were found.");
console.log(JSON.stringify({ ok: true, package_count: packages.size }));

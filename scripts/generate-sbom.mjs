#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const out = parseArgs(process.argv.slice(2));
const result = spawnSync("npm", ["sbom", "--sbom-format", "cyclonedx"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});
if (result.status !== 0) throw new Error("npm could not generate the software bill of materials.");

const sbom = JSON.parse(result.stdout);
delete sbom.serialNumber;
if (sbom.metadata) delete sbom.metadata.timestamp;
await writeFile(out, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  output: out,
  format: sbom.bomFormat,
  specification_version: sbom.specVersion,
  component_count: Array.isArray(sbom.components) ? sbom.components.length : 0,
  dependency_node_count: Array.isArray(sbom.dependencies) ? sbom.dependencies.length : 0,
  deterministic_metadata: !sbom.serialNumber && !sbom.metadata?.timestamp,
}, null, 2));

function parseArgs(args) {
  const index = args.indexOf("--out");
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || args.length !== 2) throw new Error("Usage: generate-sbom.mjs --out <file>");
  return value;
}

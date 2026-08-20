#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const configuredDistDir = process.env.PIPELINE_NEXT_DIST_DIR?.trim() || ".next";

if (
  isAbsolute(configuredDistDir) ||
  configuredDistDir.split(/[\\/]+/).some((segment) => segment === "..")
) {
  fail("PIPELINE_NEXT_DIST_DIR must be a project-relative path.");
}

const distDir = resolve(projectRoot, configuredDistDir);
const standaloneRoot = resolve(distDir, "standalone");
const serverEntry = resolve(standaloneRoot, "server.js");

if (!existsSync(serverEntry)) {
  fail(`The standalone build is missing. Run npm run build before npm start.`);
}

stageDirectory(
  resolve(distDir, "static"),
  resolve(standaloneRoot, configuredDistDir, "static"),
);
stageDirectory(resolve(projectRoot, "public"), resolve(standaloneRoot, "public"));

// Local browsers commonly resolve localhost to IPv6 first. The generated
// standalone server binds IPv4, so use an explicit loopback default for local
// and E2E runs. Container deployments invoke server.js directly and retain
// their platform-provided bind address.
if (!process.env.HOSTNAME?.trim()) {
  process.env.HOSTNAME = "127.0.0.1";
}

await import(pathToFileURL(serverEntry).href);

function stageDirectory(source, destination) {
  if (!existsSync(source)) return;
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

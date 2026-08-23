#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const browserPatterns = [
  /^(app|components|lib|public|tests\/e2e)\//,
  /^\.github\/workflows\/ci\.yml$/,
  /^(Dockerfile(?:\..+)?|next\.config\.ts|playwright\.config\.ts|postcss\.config\.mjs|proxy\.ts|tsconfig\.json)$/,
  /^package(-lock)?\.json$/,
  /^scripts\/(ci-change-impact|start-standalone|mcmaster-|pipeline-performance|build-artifact)/,
];

const postgresPatterns = [
  /^\.github\/workflows\/ci\.yml$/,
  /^database\//,
  /^lib\/(assessment|database|extraction|pipeline)\//,
  /^app\/api\//,
  /^scripts\/(ci-change-impact|apply-database|database-|postgres-|seed-production|collaboration-load|http-load)/,
  /^package(-lock)?\.json$/,
];

export function classifyChangeImpact(files) {
  const normalized = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
  return {
    browser: normalized.some((file) => browserPatterns.some((pattern) => pattern.test(file))),
    postgres: normalized.some((file) => postgresPatterns.some((pattern) => pattern.test(file))),
    files: normalized,
  };
}

function changedFiles(baseSha, headSha) {
  if (!baseSha || /^0+$/.test(baseSha) || !headSha || baseSha === headSha) return null;
  return execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMRTUXB", baseSha, headSha], {
    encoding: "utf8",
  }).split("\n");
}

function main() {
  const explicitFiles = process.argv.find((argument) => argument.startsWith("--files="));
  const files = explicitFiles
    ? explicitFiles.slice("--files=".length).split(",")
    : changedFiles(process.env.CI_BASE_SHA, process.env.CI_HEAD_SHA);
  const result = files === null
    ? { browser: true, postgres: true, files: [] }
    : classifyChangeImpact(files);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `browser=${result.browser}\npostgres=${result.postgres}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

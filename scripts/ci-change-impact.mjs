#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const browserPatterns = [
  /^(app|components|lib|public|tests\/e2e)\//,
  /^\.github\/workflows\/ci\.yml$/,
  /^(Dockerfile(?:\..+)?|next\.config\.ts|playwright(?:\.operational)?\.config\.ts|postcss\.config\.mjs|proxy\.ts|tsconfig\.json)$/,
  /^package(-lock)?\.json$/,
  /^scripts\/(ci-change-impact|start-standalone|mcmaster-|pipeline-performance|build-artifact)/,
  /^scripts\/platform-assurance/,
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
  const normalized = [...new Set((files ?? []).map((file) => file.trim()).filter(Boolean))];
  if (normalized.length === 0) return { browser: true, postgres: true, files: normalized };
  return {
    browser: normalized.some((file) => browserPatterns.some((pattern) => pattern.test(file))),
    postgres: normalized.some((file) => postgresPatterns.some((pattern) => pattern.test(file))),
    files: normalized,
  };
}

function changedFiles(baseSha, headSha) {
  if (!baseSha || /^0+$/.test(baseSha) || !headSha || baseSha === headSha) return null;
  // Treat renames as delete/add so both the old and new ownership paths count.
  return execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", "--diff-filter=ACDMRTUXB", baseSha, headSha], {
    encoding: "utf8",
  }).split("\0");
}

function main() {
  const explicitFiles = process.argv.find((argument) => argument.startsWith("--files="));
  const files = explicitFiles
    ? explicitFiles.slice("--files=".length).split(",")
    : changedFiles(process.env.CI_BASE_SHA, process.env.CI_HEAD_SHA);
  const result = classifyChangeImpact(files);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `browser=${result.browser}\npostgres=${result.postgres}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

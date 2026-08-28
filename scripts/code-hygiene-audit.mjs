#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import ts from "typescript";

const TEXT_EXTENSIONS = new Set([
  ".bicep",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const GENERATED_PATH_PATTERNS = [
  /(^|\/)\.next(?:-|\/|$)/,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)node_modules\//,
  /(^|\/)out\//,
  /(^|\/)playwright-report\//,
  /(^|\/)test-results\//,
  /(^|\/)tmp\//,
];

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const LARGE_SOURCE_LINE_WARNING = 1_000;
const RUNTIME_SOURCE_PATH = /^(?:app|components|lib)\//u;

function git(...args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isTextFile(path) {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase()) || [
    ".env.example",
    ".gitignore",
    "Dockerfile",
  ].includes(path);
}

function countLines(value) {
  if (!value) return 0;
  return value.split(/\r?\n/u).length;
}

const trackedFiles = git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
  .split("\0")
  .filter(Boolean)
  .filter((path) => existsSync(path))
  .sort();

const failures = [];
const warnings = [];
const contentHashes = new Map();
let trackedBytes = 0;
let textFiles = 0;
let textLines = 0;

for (const path of trackedFiles) {
  const stats = statSync(path);
  trackedBytes += stats.size;

  if (GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    failures.push({ type: "tracked_generated_output", path });
  }

  const bytes = readFileSync(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const duplicate = contentHashes.get(hash);
  if (duplicate && stats.size > 0) {
    failures.push({ type: "identical_tracked_files", paths: [duplicate, path] });
  } else {
    contentHashes.set(hash, path);
  }

  if (!isTextFile(path)) continue;
  textFiles += 1;
  const value = bytes.toString("utf8");
  const lines = countLines(value);
  textLines += lines;

  if (/^(?:<{7}|={7}|>{7})/mu.test(value)) {
    failures.push({ type: "merge_conflict_marker", path });
  }

  if (SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) && lines > LARGE_SOURCE_LINE_WARNING) {
    warnings.push({ type: "large_source_module", path, lines });
  }

  if (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) continue;
  if (!["scripts/code-hygiene-audit.mjs", "scripts/code-quality-readiness.mjs", "scripts/complete-repository-audit.mjs"].includes(path) && /@ts-ignore\b|\bas any\b|:\s*any\b/u.test(value)) {
    failures.push({ type: "unsafe_type_suppression", path });
  }
  if (RUNTIME_SOURCE_PATH.test(path) && /dangerouslySetInnerHTML|\beval\s*\(|new\s+Function\b/u.test(value)) {
    failures.push({ type: "unsafe_runtime_execution", path });
  }
  if (RUNTIME_SOURCE_PATH.test(path) && /^\s*["']use client["'];?/mu.test(value)) {
    const publicSecrets = [...value.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|CONNECTION_STRING|PRIVATE_KEY)[A-Z0-9_]*/gu)]
      .map((match) => match[0]);
    for (const variable of new Set(publicSecrets)) {
      failures.push({ type: "public_secret_environment_variable", path, variable });
    }
  }
  if (
    RUNTIME_SOURCE_PATH.test(path)
    && /console\.(?:log|warn|error|debug)\s*\([\s\S]{0,400}?(?:error\.message|String\s*\(\s*error\s*\))/u.test(value)
  ) {
    failures.push({ type: "raw_runtime_error_logging", path });
  }
}

const sourceFiles = new Set(trackedFiles.filter((path) => SOURCE_EXTENSIONS.has(extname(path).toLowerCase())));
const moduleGraph = new Map([...sourceFiles].map((path) => [path, localRuntimeDependencies(path, sourceFiles)]));
for (const cycle of findModuleCycles(moduleGraph)) {
  failures.push({ type: "runtime_module_cycle", paths: cycle });
}

const gitignoreEntries = readFileSync(".gitignore", "utf8")
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const duplicateIgnoreEntries = gitignoreEntries.filter(
  (entry, index) => gitignoreEntries.indexOf(entry) !== index,
);
for (const entry of new Set(duplicateIgnoreEntries)) {
  failures.push({ type: "duplicate_gitignore_entry", entry });
}

warnings.sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));

const report = {
  ok: failures.length === 0,
  inventory: {
    tracked_files: trackedFiles.length,
    tracked_bytes: trackedBytes,
    text_files: textFiles,
    text_lines: textLines,
  },
  thresholds: {
    large_source_line_warning: LARGE_SOURCE_LINE_WARNING,
  },
  failures,
  warnings,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  process.exit(1);
}

function localRuntimeDependencies(path, sourceFiles) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  const dependencies = new Set();

  function visit(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      addModuleSpecifier(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
      addModuleSpecifier(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node)
      && node.arguments.length === 1
      && ts.isIdentifier(node.expression)
      && node.expression.text === "require"
    ) {
      addModuleSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  function addModuleSpecifier(node) {
    if (!ts.isStringLiteralLike(node)) return;
    const dependency = resolveLocalModule(path, node.text, sourceFiles);
    if (dependency) dependencies.add(dependency);
  }

  visit(source);
  return [...dependencies].sort();
}

function resolveLocalModule(importer, specifier, sourceFiles) {
  let target;
  if (specifier.startsWith("@/")) target = specifier.slice(2);
  else if (specifier.startsWith(".")) target = normalize(join(dirname(importer), specifier));
  else return null;

  const withoutExtension = extname(target) ? target.slice(0, -extname(target).length) : target;
  const candidates = extname(target)
    ? [target]
    : [
        ...MODULE_EXTENSIONS.map((extension) => `${withoutExtension}${extension}`),
        ...MODULE_EXTENSIONS.map((extension) => join(target, `index${extension}`)),
      ];
  return candidates.find((candidate) => sourceFiles.has(normalize(candidate))) ?? null;
}

function findModuleCycles(graph) {
  const state = new Map();
  const stack = [];
  const position = new Map();
  const cycles = new Map();

  function visit(path) {
    state.set(path, "visiting");
    position.set(path, stack.length);
    stack.push(path);
    for (const dependency of graph.get(path) ?? []) {
      if (!graph.has(dependency)) continue;
      if (!state.has(dependency)) visit(dependency);
      else if (state.get(dependency) === "visiting") {
        const cycle = [...stack.slice(position.get(dependency)), dependency];
        const members = cycle.slice(0, -1);
        const start = members.reduce((best, member, index) => member < members[best] ? index : best, 0);
        const canonical = [...members.slice(start), ...members.slice(0, start), members[start]];
        cycles.set(canonical.join(" -> "), canonical);
      }
    }
    stack.pop();
    position.delete(path);
    state.set(path, "visited");
  }

  for (const path of [...graph.keys()].sort()) {
    if (!state.has(path)) visit(path);
  }
  return [...cycles.values()];
}

function scriptKind(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

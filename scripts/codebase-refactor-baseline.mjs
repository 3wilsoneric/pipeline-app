#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = process.cwd();
const REFACTOR_REGISTRY = JSON.parse(readFileSync(join(ROOT, "docs/refactoring/refactor-slices.json"), "utf8"));
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx", ".py", ".sql"]);
const TYPESCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const MODULE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
const SOURCE_ROOTS = ["app", "components", "lib", "scripts", "tests", "databricks", "database"];
const CONTROL_PLANE_PATH = /^(?:app\/api\/|database\/(?:migrations|rollbacks)\/|lib\/(?:auth|database|extraction)\/|lib\/pipeline\/(?:master-record-matching|referral-store|resident-link-store|workflow-store)\.|lib\/assessment\/(?:assessment-lifecycle-validation|assessment-records|assessment-store)\.|databricks\/pipeline_extraction_worker\.py$)/u;
const STATIC_SOURCE_CONTRACT = /source\.(?:includes|match)\s*\(/gu;
const NEXT_CONVENTION_EXPORTS = new Set([
  "default", "dynamic", "dynamicParams", "generateMetadata", "generateStaticParams",
  "maxDuration", "metadata", "preferredRegion", "revalidate", "runtime",
  "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT",
]);

function runGit(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function repositorySourceFiles() {
  return runGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter((path) => SOURCE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`)))
    .filter((path) => SOURCE_EXTENSIONS.has(extname(path).toLowerCase()))
    .sort();
}

function lineCount(value) {
  return value ? value.split(/\r?\n/u).length : 0;
}

function scriptKind(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function declarationNames(name, output = []) {
  if (!name) return output;
  if (ts.isIdentifier(name)) output.push(name.text);
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) declarationNames(element.name, output);
    }
  }
  return output;
}

function analyzeTypeScript(path, value) {
  const sourceFile = ts.createSourceFile(path, value, ts.ScriptTarget.Latest, true, scriptKind(path));
  const exports = new Set();
  const importRecords = [];
  let branches = 0;
  let functions = 0;
  let maxBranchDepth = 0;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const names = new Set();
      let namespace = false;
      const clause = statement.importClause;
      if (clause?.name) names.add("default");
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespace = true;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) names.add(element.propertyName?.text ?? element.name.text);
      }
      importRecords.push({ specifier: statement.moduleSpecifier.text, names, namespace });
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const names = new Set();
      let namespace = !statement.exportClause;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.propertyName?.text ?? element.name.text);
      }
      importRecords.push({ specifier: statement.moduleSpecifier.text, names, namespace });
    }
    if (hasExportModifier(statement)) {
      const isDefault = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      if (isDefault) exports.add("default");
      if (!isDefault && statement.name && ts.isIdentifier(statement.name)) exports.add(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const name of declarationNames(declaration.name)) exports.add(name);
        }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exports.add(element.name.text);
    }
    if (ts.isExportAssignment(statement)) exports.add("default");
  }

  function visit(node, branchDepth) {
    if (
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    ) functions += 1;

    const isBranch = ts.isIfStatement(node)
      || ts.isForStatement(node)
      || ts.isForInStatement(node)
      || ts.isForOfStatement(node)
      || ts.isWhileStatement(node)
      || ts.isDoStatement(node)
      || ts.isCatchClause(node)
      || ts.isConditionalExpression(node)
      || ts.isCaseClause(node)
      || (ts.isBinaryExpression(node) && [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind));
    const nextDepth = isBranch ? branchDepth + 1 : branchDepth;
    if (isBranch) {
      branches += 1;
      maxBranchDepth = Math.max(maxBranchDepth, nextDepth);
    }
    ts.forEachChild(node, (child) => visit(child, nextDepth));
  }
  visit(sourceFile, 0);

  return { branches, exports, functions, importRecords, maxBranchDepth };
}

function analyzePython(value) {
  const branchMatches = value.match(/^\s*(?:async\s+)?(?:if|elif|for|while|except|case)\b/gmu) ?? [];
  const functionMatches = value.match(/^\s*(?:async\s+)?def\s+/gmu) ?? [];
  let maxBranchDepth = 0;
  for (const line of value.split(/\r?\n/u)) {
    if (!/^\s*(?:async\s+)?(?:if|elif|for|while|except|case)\b/u.test(line)) continue;
    const indentation = line.match(/^\s*/u)?.[0].replace(/\t/gu, "    ").length ?? 0;
    maxBranchDepth = Math.max(maxBranchDepth, Math.floor(indentation / 4) + 1);
  }
  return {
    branches: branchMatches.length,
    exports: new Set(),
    functions: functionMatches.length,
    importRecords: [],
    maxBranchDepth,
  };
}

function analyzeSql(value) {
  const branches = (value.match(/\b(?:case|when|if|loop|while)\b/giu) ?? []).length;
  const functions = (value.match(/\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b/giu) ?? []).length;
  return {
    branches,
    exports: new Set(),
    functions,
    importRecords: [],
    maxBranchDepth: 0,
  };
}

function resolveLocalModule(importer, specifier, sourceSet) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const raw = specifier.startsWith("@/")
    ? specifier.slice(2)
    : normalize(join(dirname(importer), specifier)).replaceAll("\\", "/");
  const candidates = extname(raw)
    ? [raw]
    : [raw, ...MODULE_EXTENSIONS.map((extension) => `${raw}${extension}`), ...MODULE_EXTENSIONS.map((extension) => `${raw}/index${extension}`)];
  return candidates.find((candidate) => sourceSet.has(candidate)) ?? null;
}

function canonicalCycle(cycle) {
  const body = cycle.slice(0, -1);
  if (body.length === 0) return "";
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
  rotations.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
  return [...rotations[0], rotations[0][0]].join(" -> ");
}

function findCycles(graph) {
  const found = new Set();
  const active = [];
  const activeSet = new Set();
  const complete = new Set();

  function walk(node) {
    if (activeSet.has(node)) {
      const start = active.indexOf(node);
      found.add(canonicalCycle([...active.slice(start), node]));
      return;
    }
    if (complete.has(node)) return;
    active.push(node);
    activeSet.add(node);
    for (const dependency of graph.get(node) ?? []) walk(dependency);
    active.pop();
    activeSet.delete(node);
    complete.add(node);
  }

  for (const node of graph.keys()) walk(node);
  return [...found].filter(Boolean).sort();
}

function tokenFingerprints(path, value) {
  if (!TYPESCRIPT_EXTENSIONS.has(extname(path))) return pythonFingerprints(path, value);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, value);
  const lineStarts = [0];
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  function lineAtPosition(position) {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= position) low = middle;
      else high = middle;
    }
    return low + 1;
  }
  const tokens = [];
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const text = scanner.getTokenText();
    const normalizedToken = token === ts.SyntaxKind.StringLiteral || token === ts.SyntaxKind.NumericLiteral
      ? ts.SyntaxKind[token]
      : text;
    tokens.push({ line: lineAtPosition(scanner.getTokenPos()), value: normalizedToken });
    token = scanner.scan();
  }
  const output = [];
  const windowSize = 60;
  const step = 20;
  for (let index = 0; index + windowSize <= tokens.length; index += step) {
    const body = tokens.slice(index, index + windowSize).map((item) => item.value).join("\u001f");
    output.push({ hash: createHash("sha256").update(body).digest("hex"), line: tokens[index].line });
  }
  return output;
}

function pythonFingerprints(path, value) {
  const lines = value.split(/\r?\n/u)
    .map((line, index) => ({ line: index + 1, value: line.trim() }))
    .filter((item) => item.value && !item.value.startsWith("#"));
  const output = [];
  for (let index = 0; index + 8 <= lines.length; index += 4) {
    const body = lines.slice(index, index + 8).map((item) => item.value.replace(/(['"])[^'"]*\1/gu, "<string>")).join("\n");
    output.push({ hash: createHash("sha256").update(body).digest("hex"), line: lines[index].line, path });
  }
  return output;
}

function churnByPath() {
  const output = runGit([
    "log", "--since=90 days ago", "--numstat", "--format=commit:%H", "--",
    ...SOURCE_ROOTS,
  ]);
  const result = new Map();
  let commit = "unknown";
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("commit:")) {
      commit = line.slice("commit:".length);
      continue;
    }
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/u);
    if (!match) continue;
    const path = match[3].includes(" => ") ? match[3].split(" => ").at(-1).replace(/[{}]/gu, "") : match[3];
    const current = result.get(path) ?? { changedLines: 0, commits: new Set() };
    current.changedLines += (Number(match[1]) || 0) + (Number(match[2]) || 0);
    current.commits.add(commit);
    result.set(path, current);
  }
  return result;
}

function rank(files, key, count = 10) {
  return [...files]
    .sort((left, right) => right[key] - left[key] || right.lines - left.lines || left.path.localeCompare(right.path))
    .slice(0, count)
    .map((item) => ({ path: item.path, value: item[key] }));
}

function sliceForPath(path) {
  return (REFACTOR_REGISTRY.slices ?? []).find((slice) => (slice.paths ?? []).some((scope) => path === scope || path.startsWith(`${scope.replace(/\/$/u, "")}/`)))?.id ?? null;
}

function riskSignals(file) {
  const signals = [];
  if (file.controlPlane) signals.push("control_plane");
  if (file.refactorSliceId) signals.push(`planned_slice:${file.refactorSliceId}`);
  if (file.complexity >= 100) signals.push("complexity>=100");
  if (file.churnLines90d >= 1000) signals.push("churn_lines_90d>=1000");
  if (file.fanIn >= 10) signals.push("fan_in>=10");
  if (file.dependencies.length >= 10) signals.push("dependencies>=10");
  if (file.maxBranchDepth >= 8) signals.push("branch_depth>=8");
  if (file.duplicateBlocks >= 5) signals.push("duplicate_blocks>=5");
  if (file.staticSourceContracts > 0) signals.push("static_source_contracts>0");
  return signals;
}

function riskBand(file) {
  const structuralSignals = file.riskSignals.filter((signal) => !signal.startsWith("planned_slice:") && signal !== "control_plane").length;
  const safetyCritical = file.controlPlane || Boolean(file.refactorSliceId);
  if (safetyCritical && structuralSignals >= 2) return "critical_review";
  if ((safetyCritical && structuralSignals >= 1) || structuralSignals >= 3) return "high_review";
  if (safetyCritical || structuralSignals >= 2) return "medium_review";
  return structuralSignals === 1 ? "watch" : "baseline";
}

function markdownTable(items, valueLabel) {
  const rows = items.map((item, index) => `| ${index + 1} | \`${item.path}\` | ${item.value} |`);
  return [`| Rank | File | ${valueLabel} |`, "| ---: | --- | ---: |", ...rows].join("\n");
}

function parseArgument(name, fallback) {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : fallback;
}

function analyzeRepository(paths, sourceSet, churn) {
  const files = [];
  const usageByTarget = new Map();
  const graph = new Map();
  const fingerprintOccurrences = new Map();
  for (const path of paths) analyzeRepositoryFile(path, sourceSet, churn, files, usageByTarget, graph, fingerprintOccurrences);
  return { files, usageByTarget, graph, fingerprintOccurrences };
}

function analyzeRepositoryFile(path, sourceSet, churn, files, usageByTarget, graph, fingerprintOccurrences) {
  const value = readFileSync(join(ROOT, path), "utf8");
  const analysis = TYPESCRIPT_EXTENSIONS.has(extname(path))
    ? analyzeTypeScript(path, value)
    : path.endsWith(".py")
      ? analyzePython(value)
      : analyzeSql(value);
  const dependencies = collectDependencies(path, analysis.importRecords, sourceSet, usageByTarget);
  graph.set(path, dependencies);
  collectFingerprints(path, value, fingerprintOccurrences);
  const pathChurn = churn.get(path);
  files.push({
    path,
    lines: lineCount(value),
    branches: analysis.branches,
    functions: analysis.functions,
    maxBranchDepth: analysis.maxBranchDepth,
    complexity: analysis.branches + analysis.functions,
    exports: [...analysis.exports].sort(),
    dependencies: [...dependencies].sort(),
    fanIn: 0,
    duplicateBlocks: 0,
    churnLines90d: pathChurn?.changedLines ?? 0,
    churnCommits90d: pathChurn?.commits.size ?? 0,
    staticSourceContracts: (value.match(STATIC_SOURCE_CONTRACT) ?? []).length,
    controlPlane: CONTROL_PLANE_PATH.test(path),
    refactorSliceId: sliceForPath(path),
  });
}

function collectDependencies(path, importRecords, sourceSet, usageByTarget) {
  const dependencies = new Set();
  for (const record of importRecords) {
    const target = resolveLocalModule(path, record.specifier, sourceSet);
    if (!target) continue;
    dependencies.add(target);
    const usage = usageByTarget.get(target) ?? { names: new Set(), namespace: false };
    for (const name of record.names) usage.names.add(name);
    usage.namespace ||= record.namespace;
    usageByTarget.set(target, usage);
  }
  return dependencies;
}

function collectFingerprints(path, value, fingerprintOccurrences) {
  for (const occurrence of tokenFingerprints(path, value)) {
    const occurrences = fingerprintOccurrences.get(occurrence.hash) ?? [];
    occurrences.push({ path, line: occurrence.line });
    fingerprintOccurrences.set(occurrence.hash, occurrences);
  }
}

function applyFanIn(files, graph) {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  for (const dependencies of graph.values()) {
    for (const dependency of dependencies) {
      const target = fileByPath.get(dependency);
      if (target) target.fanIn += 1;
    }
  }
}

function applyDuplicateCounts(files, fingerprintOccurrences) {
  const duplicates = [];
  const duplicateCountByPath = new Map();
  for (const [hash, occurrences] of fingerprintOccurrences) {
    const distinctFiles = new Set(occurrences.map((item) => item.path));
    if (distinctFiles.size < 2) continue;
    const representative = [...distinctFiles].map((path) => occurrences.find((item) => item.path === path));
    duplicates.push({ hash, occurrences: representative });
    for (const path of distinctFiles) duplicateCountByPath.set(path, (duplicateCountByPath.get(path) ?? 0) + 1);
  }
  for (const file of files) file.duplicateBlocks = duplicateCountByPath.get(file.path) ?? 0;
  return duplicates;
}

function findDeadExportCandidates(files, usageByTarget) {
  const candidates = [];
  for (const file of files) {
    if (!TYPESCRIPT_EXTENSIONS.has(extname(file.path)) || file.path.startsWith("app/")) continue;
    const usage = usageByTarget.get(file.path);
    if (usage?.namespace) continue;
    for (const name of file.exports) {
      if (NEXT_CONVENTION_EXPORTS.has(name) || usage?.names.has(name)) continue;
      candidates.push({ path: file.path, export: name });
    }
  }
  return candidates;
}

function buildRiskInventory(files) {
  const riskOrder = new Map(["critical_review", "high_review", "medium_review", "watch", "baseline"].map((band, index) => [band, index]));
  return files
    .filter((file) => file.riskBand !== "baseline")
    .sort((left, right) => riskOrder.get(left.riskBand) - riskOrder.get(right.riskBand)
      || right.riskSignals.length - left.riskSignals.length
      || right.churnLines90d - left.churnLines90d
      || left.path.localeCompare(right.path))
    .map((file) => ({
      path: file.path,
      band: file.riskBand,
      sliceId: file.refactorSliceId,
      signals: file.riskSignals,
      metrics: {
        lines: file.lines,
        complexity: file.complexity,
        churnLines90d: file.churnLines90d,
        churnCommits90d: file.churnCommits90d,
        fanIn: file.fanIn,
        dependencies: file.dependencies.length,
        maxBranchDepth: file.maxBranchDepth,
        duplicateBlocks: file.duplicateBlocks,
        staticSourceContracts: file.staticSourceContracts,
      },
    }));
}

function main() {
  const generatedAt = new Date();
  const label = parseArgument("label", generatedAt.toISOString().slice(0, 10));
  const outDir = resolve(ROOT, parseArgument("out-dir", "outputs/refactor-baseline"));
  const paths = repositorySourceFiles();
  const sourceSet = new Set(paths);
  const churn = churnByPath();
  const { files, usageByTarget, graph, fingerprintOccurrences } = analyzeRepository(paths, sourceSet, churn);
  applyFanIn(files, graph);
  const duplicates = applyDuplicateCounts(files, fingerprintOccurrences);
  for (const file of files) {
    file.riskSignals = riskSignals(file);
    file.riskBand = riskBand(file);
  }
  const deadExportCandidates = findDeadExportCandidates(files, usageByTarget);

  const rankings = {
    lines: rank(files, "lines"),
    complexity: rank(files, "complexity"),
    churn: rank(files, "churnLines90d"),
    fanIn: rank(files, "fanIn"),
    duplication: rank(files, "duplicateBlocks"),
  };
  const appearances = new Map();
  for (const list of Object.values(rankings)) {
    for (const item of list) appearances.set(item.path, (appearances.get(item.path) ?? 0) + 1);
  }
  const overlappingHotspots = [...appearances]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([path, measures]) => ({ path, measures }));
  const riskInventory = buildRiskInventory(files);

  const report = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    windowDays: 90,
    scope: SOURCE_ROOTS,
    interpretation: {
      complexity: "AST branch count plus function count; use for ranking, not as a correctness score.",
      duplication: "Shared normalized 60-token TypeScript/JavaScript windows or 8-line Python windows across distinct files.",
      deadExports: "Conservative static candidates. Dynamic imports, framework conventions, and external consumers require human confirmation before deletion.",
      staticSourceContracts: "Assertions about source text are inventory only; behavioral tests must protect runtime invariants.",
      riskInventory: "Risk bands expose independent review signals and planned slice membership. They rank investigation pressure; they are not defect counts or an aggregate quality score.",
    },
    totals: {
      files: files.length,
      lines: files.reduce((sum, file) => sum + file.lines, 0),
      cycles: findCycles(graph).length,
      duplicateGroups: duplicates.length,
      controlPlaneDuplicateGroups: duplicates.filter((group) => group.occurrences.some((item) => CONTROL_PLANE_PATH.test(item.path))).length,
      deadExportCandidates: deadExportCandidates.length,
      staticSourceContracts: files.reduce((sum, file) => sum + file.staticSourceContracts, 0),
      controlPlaneFiles: files.filter((file) => file.controlPlane).length,
      criticalReviewFiles: files.filter((file) => file.riskBand === "critical_review").length,
      highReviewFiles: files.filter((file) => file.riskBand === "high_review").length,
    },
    rankings,
    riskInventory,
    overlappingHotspots,
    cycles: findCycles(graph),
    largestDuplicateGroups: duplicates
      .sort((left, right) => right.occurrences.length - left.occurrences.length || left.hash.localeCompare(right.hash))
      .slice(0, 30),
    deadExportCandidates,
    staticSourceContractFiles: files
      .filter((file) => file.staticSourceContracts > 0)
      .sort((left, right) => right.staticSourceContracts - left.staticSourceContracts)
      .map((file) => ({ path: file.path, count: file.staticSourceContracts })),
    files,
  };

  const markdown = [
    `# Pipeline Refactor Baseline - ${label}`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "This report ranks maintainability pressure. It does not prove defects and must not be used as permission to delete code without characterization tests.",
    "",
    "## Summary",
    "",
    `- Source files: ${report.totals.files}`,
    `- Source lines: ${report.totals.lines}`,
    `- Local module cycles, including type-only imports: ${report.totals.cycles}`,
    `- Cross-file duplicate groups: ${report.totals.duplicateGroups}`,
    `- Duplicate groups touching control-plane code: ${report.totals.controlPlaneDuplicateGroups}`,
    `- Dead-export candidates requiring review: ${report.totals.deadExportCandidates}`,
    `- Static source-string contracts: ${report.totals.staticSourceContracts}`,
    `- Control-plane files: ${report.totals.controlPlaneFiles}`,
    `- Critical-review risk files: ${report.totals.criticalReviewFiles}`,
    `- High-review risk files: ${report.totals.highReviewFiles}`,
    "",
    "## Overlapping Hotspots",
    "",
    "Files appearing in at least two independent top-ten lists:",
    "",
    ...(overlappingHotspots.length > 0
      ? overlappingHotspots.map((item) => `- \`${item.path}\` (${item.measures} measures)`)
      : ["- None"]),
    "",
    "## Risk-Signal Inventory",
    "",
    "Bands combine independent review signals without collapsing them into a correctness score:",
    "",
    ...(riskInventory.length > 0
      ? riskInventory.slice(0, 30).map((item) => `- **${item.band}** \`${item.path}\`: ${item.signals.join(", ")}`)
      : ["- No review signals exceeded the configured thresholds."]),
    "",
    "## Size",
    "",
    markdownTable(rankings.lines, "Lines"),
    "",
    "## Complexity Proxy",
    "",
    markdownTable(rankings.complexity, "Branches + functions"),
    "",
    "## 90-Day Churn",
    "",
    markdownTable(rankings.churn, "Changed lines"),
    "",
    "## Cross-File Duplication",
    "",
    markdownTable(rankings.duplication, "Shared token windows"),
    "",
    "## Fan-In",
    "",
    markdownTable(rankings.fanIn, "Direct local importers"),
    "",
    "## Cycles",
    "",
    ...(report.cycles.length > 0 ? report.cycles.map((cycle) => `- ${cycle}`) : ["- None detected"]),
    "",
    "## Test-Power Warning",
    "",
    `The baseline found ${report.totals.staticSourceContracts} source-string assertions. Keep them only as architecture-presence checks; pair every operational invariant with an executable behavior, database, or browser test.`,
    "",
    "## Interpretation",
    "",
    "- Complexity and duplication are ranking proxies, not quality scores.",
    "- Risk bands are triage aids. They do not prove a defect and cannot authorize a refactor.",
    "- Dead exports are candidates only. Confirm framework, dynamic-import, and external use before deletion.",
    "- Control-plane duplication has a zero-tolerance target; ordinary UI duplication can wait until a third occurrence.",
    "- Re-run after each bounded refactor slice and compare the JSON, behavior gates, performance, and visual output.",
    "",
  ].join("\n");

  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `refactor-baseline-${label}.json`);
  const markdownPath = join(outDir, `refactor-baseline-${label}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown, "utf8");
  console.log(JSON.stringify({
    ok: true,
    json: relative(ROOT, jsonPath),
    markdown: relative(ROOT, markdownPath),
    totals: report.totals,
    overlappingHotspots,
    highestRisk: riskInventory.slice(0, 10),
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

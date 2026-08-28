#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

import ts from "typescript";

const ROOT = process.cwd();
const baselinePath = resolve(ROOT, "docs/reliability/cyclomatic-complexity-baseline.json");
const reportPath = resolve(ROOT, "outputs/complexity/cyclomatic-complexity-latest.json");
const writeBaseline = process.argv.includes("--write-baseline");
const thresholds = {
  warning: 11,
  critical: 16,
  newFunctionMaximum: 15,
  newControlPlaneMaximum: 10,
};
const sourceRoots = ["app/", "components/", "lib/", "scripts/", "tests/", "databricks/"];
const supportedTypeScriptExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const controlPlanePath = /^(?:app\/api\/|lib\/(?:assessment|auth|database|extraction|integration|observability|persistence|reliability)\/|lib\/pipeline\/(?:referral-access|referral-retention|referral-store|referral-validation|referral-workflow|resident-link|workflow)|database\/|databricks\/)/u;

const paths = repositoryPaths();
const typeScriptPaths = paths.filter((path) => supportedTypeScriptExtensions.has(extname(path)));
const pythonPaths = paths.filter((path) => path.endsWith(".py"));
const functions = [
  ...typeScriptPaths.flatMap(analyzeTypeScript),
  ...analyzePython(pythonPaths),
]
  .map((item) => ({ ...item, controlPlane: controlPlanePath.test(item.path) }))
  .sort(compareFunctions);

assignStableKeys(functions);

const report = createReport(functions);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (writeBaseline) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: "Per-function modified cyclomatic complexity. Nested functions are measured independently.",
    thresholds,
    totals: report.totals,
    functions: functions.map(baselineFunction),
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    baseline: relative(ROOT, baselinePath),
    report: relative(ROOT, reportPath),
    totals: report.totals,
    topHotspots: report.topHotspots,
    warning: "Baseline regeneration requires human review and is not ordinary failure recovery.",
  }, null, 2)}\n`);
  process.exit(0);
}

const baseline = readBaseline();
const result = compareWithBaseline(report, baseline);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;

function repositoryPaths() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((path) => sourceRoots.some((root) => path.startsWith(root)))
    .filter((path) => supportedTypeScriptExtensions.has(extname(path)) || path.endsWith(".py"));
}

function analyzeTypeScript(path) {
  const value = readFileSync(join(ROOT, path), "utf8");
  const source = ts.createSourceFile(
    path,
    value,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  const records = [];

  function walk(node, context) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const className = node.name?.text || "<class>";
      ts.forEachChild(node, (child) => walk(child, [...context, className]));
      return;
    }

    if (isMeasuredFunction(node) && node.body) {
      const line = lineFor(source, node);
      const name = functionName(node, source);
      const analysis = countTypeScriptDecisions(node.body);
      records.push({
        path,
        name: [...context, name].join("."),
        line,
        complexity: analysis.branches + 1,
        branches: analysis.branches,
        maxBranchDepth: analysis.maxBranchDepth,
        language: "typescript",
      });
      ts.forEachChild(node, (child) => walk(child, [...context, name]));
      return;
    }

    ts.forEachChild(node, (child) => walk(child, context));
  }

  walk(source, []);
  return records;
}

function countTypeScriptDecisions(body) {
  let branches = 0;
  let maxBranchDepth = 0;

  function visit(node, depth) {
    if (node !== body && isMeasuredFunction(node)) return;
    const increment = isTypeScriptDecision(node) ? 1 : 0;
    const nextDepth = depth + increment;
    if (increment) {
      branches += 1;
      maxBranchDepth = Math.max(maxBranchDepth, nextDepth);
    }
    ts.forEachChild(node, (child) => visit(child, nextDepth));
  }

  visit(body, 0);
  return { branches, maxBranchDepth };
}

function isTypeScriptDecision(node) {
  if (
    ts.isIfStatement(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
    || ts.isWhileStatement(node)
    || ts.isDoStatement(node)
    || ts.isCaseClause(node)
    || ts.isCatchClause(node)
    || ts.isConditionalExpression(node)
  ) return true;

  return ts.isBinaryExpression(node) && [
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ].includes(node.operatorToken.kind);
}

function isMeasuredFunction(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node);
}

function functionName(node, source) {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (node.name) return node.name.getText(source);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.name) return parent.name.getText(source);
  if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) return parent.name.getText(source);
  if (ts.isCallExpression(parent)) {
    const argumentIndex = parent.arguments.findIndex((argument) => argument === node);
    const callee = parent.expression.getText(source).slice(0, 80);
    return `<callback:${callee}:${argumentIndex}>`;
  }
  return "<anonymous>";
}

function scriptKind(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function lineFor(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function analyzePython(paths) {
  if (paths.length === 0) return [];
  try {
    const value = execFileSync("python3", ["scripts/cyclomatic-complexity-python.py", ...paths], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(value).functions ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown Python analysis failure";
    throw new Error(`Python complexity analysis failed: ${message}`);
  }
}

function assignStableKeys(records) {
  const ordinals = new Map();
  for (const record of records) {
    const base = `${record.path}::${record.name}`;
    const ordinal = (ordinals.get(base) ?? 0) + 1;
    ordinals.set(base, ordinal);
    record.key = `${base}::${ordinal}`;
  }
}

function createReport(records) {
  const hotspots = records.filter((item) => item.complexity >= thresholds.warning);
  const critical = records.filter((item) => item.complexity >= thresholds.critical);
  const controlPlaneHotspots = hotspots.filter((item) => item.controlPlane);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    thresholds,
    totals: {
      sourceFiles: new Set(records.map((item) => item.path)).size,
      functions: records.length,
      hotspots: hotspots.length,
      criticalHotspots: critical.length,
      controlPlaneHotspots: controlPlaneHotspots.length,
      maximum: records.reduce((maximum, item) => Math.max(maximum, item.complexity), 0),
    },
    topHotspots: [...records]
      .sort((left, right) => right.complexity - left.complexity || compareFunctions(left, right))
      .slice(0, 30)
      .map(baselineFunction),
    functions: records,
  };
}

function compareWithBaseline(report, baseline) {
  const errors = [];
  const warnings = [];
  if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.functions)) {
    errors.push("Complexity baseline is missing or uses an unsupported schema.");
  }
  const baselineByKey = new Map((baseline.functions ?? []).map((item) => [item.key, item]));

  for (const item of report.functions) {
    const previous = baselineByKey.get(item.key);
    if (!previous) {
      const maximum = item.controlPlane ? thresholds.newControlPlaneMaximum : thresholds.newFunctionMaximum;
      if (item.complexity > maximum) {
        errors.push(`New function ${item.key} has complexity ${item.complexity}; maximum is ${maximum}.`);
      }
      continue;
    }
    if (
      item.complexity > previous.complexity
      && (item.complexity >= thresholds.warning || previous.complexity >= thresholds.warning)
    ) {
      errors.push(`Function ${item.key} grew from ${previous.complexity} to ${item.complexity}.`);
    }
  }

  for (const metric of ["hotspots", "criticalHotspots", "controlPlaneHotspots"]) {
    const previous = Number(baseline.totals?.[metric] ?? 0);
    const current = report.totals[metric];
    if (current > previous) errors.push(`${metric} increased from ${previous} to ${current}.`);
  }

  for (const item of report.topHotspots.slice(0, 15)) {
    warnings.push(`${item.path}:${item.line} ${item.name} has complexity ${item.complexity}.`);
  }

  return {
    ok: errors.length === 0,
    baseline: relative(ROOT, baselinePath),
    report: relative(ROOT, reportPath),
    totals: report.totals,
    baselineTotals: baseline.totals,
    errors,
    warnings,
    interpretation: errors.length === 0
      ? "No new high-complexity function or hotspot growth was detected. Existing hotspots remain refactor candidates, not approved patterns."
      : "Complexity exceeded the reviewed ratchet. Characterize behavior and reduce the changed function; do not regenerate the baseline to hide growth.",
  };
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return { schemaVersion: 0, totals: {}, functions: [] };
  }
}

function baselineFunction(item) {
  return {
    key: item.key,
    path: item.path,
    name: item.name,
    line: item.line,
    language: item.language,
    complexity: item.complexity,
    branches: item.branches,
    maxBranchDepth: item.maxBranchDepth,
    controlPlane: item.controlPlane,
  };
}

function compareFunctions(left, right) {
  return left.path.localeCompare(right.path) || left.line - right.line || left.name.localeCompare(right.name);
}

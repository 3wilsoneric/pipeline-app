#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const baselinePath = "docs/refactoring/characterization/test-suite-assertion-inventory-e5d0584.json";
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedStatement(node, sourceFile) {
  let statement = node;
  while (statement.parent && !ts.isExpressionStatement(statement)) statement = statement.parent;
  return statement.getText(sourceFile).replace(/\s+/g, " ").trim();
}

function directCalleeName(call) {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression)) {
    return call.expression.expression.text;
  }
  return null;
}

function collectCases(sourceFiles, runnerName, assertionNames) {
  const cases = [];
  const hooks = [];

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    );

    function visit(node) {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === runnerName
        && ["beforeAll", "afterAll", "beforeEach", "afterEach"].includes(node.expression.name.text)
        && !hooks.includes(node.expression.name.text)
      ) {
        hooks.push(node.expression.name.text);
      }

      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === runnerName
        && node.arguments.length >= 2
        && ts.isStringLiteralLike(node.arguments[0])
      ) {
        const assertions = [];
        const callback = node.arguments[1];
        function collectAssertions(candidate) {
          if (ts.isCallExpression(candidate) && assertionNames.has(directCalleeName(candidate))) {
            assertions.push(normalizedStatement(candidate, sourceFile));
          }
          ts.forEachChild(candidate, collectAssertions);
        }
        collectAssertions(callback);
        cases.push({
          id: node.arguments[0].text,
          assertionCount: assertions.length,
          assertionDigest: digest(assertions.join("\n")),
        });
        return;
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return { cases, hooks };
}

function summarize(sourceFiles, runnerName, assertionNames) {
  const { cases, hooks } = collectCases(sourceFiles, runnerName, assertionNames);
  return {
    sourceFiles,
    caseCount: cases.length,
    assertionCount: cases.reduce((total, item) => total + item.assertionCount, 0),
    caseManifestDigest: digest(JSON.stringify(cases)),
    titleDigest: digest(cases.map((item) => item.id).join("\n")),
    hooks,
    cases,
  };
}

function comparable(summary) {
  const { cases: _cases, ...result } = summary;
  return result;
}

const playwright = summarize(
  ["tests/e2e/pipeline-smoke.spec.ts", "tests/e2e/pipeline-home.spec.ts"],
  "test",
  new Set(["expect"]),
);
const apiBehavior = summarize(
  ["scripts/api-behavior-fixtures.mjs"],
  "run",
  new Set(["assert", "assertValid", "assertInvalid", "assertThrows"]),
);

const criticalJourney = playwright.cases.find((item) => item.id === baseline.criticalJourneyTrace.id);
const duplicateCases = [...playwright.cases, ...apiBehavior.cases]
  .map((item) => item.id)
  .filter((id, index, all) => all.indexOf(id) !== index);
const checks = [
  {
    name: "Playwright journeys retain their ordered case and assertion manifest",
    ok: JSON.stringify(comparable(playwright)) === JSON.stringify({
      ...baseline.playwright,
      sourceFiles: playwright.sourceFiles,
    }),
  },
  {
    name: "API behavior cases retain their ordered case and assertion manifest",
    ok: JSON.stringify(comparable(apiBehavior)) === JSON.stringify(baseline.apiBehavior),
  },
  {
    name: "critical multi-session conflict journey retains every direct assertion",
    ok: criticalJourney?.assertionCount === baseline.criticalJourneyTrace.assertionCount
      && criticalJourney?.assertionDigest === baseline.criticalJourneyTrace.assertionDigest,
  },
  {
    name: "test case identifiers remain unique",
    ok: duplicateCases.length === 0,
  },
];

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  checks,
  current: {
    playwright: comparable(playwright),
    apiBehavior: comparable(apiBehavior),
    criticalJourney,
  },
}, null, 2));
if (failed.length > 0) process.exit(1);

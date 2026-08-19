#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file) => readFileSync(path.join(process.cwd(), file), "utf8");
const workflows = [read(".github/workflows/ci.yml"), read(".github/workflows/security.yml")].join("\n");
const dependabot = read(".github/dependabot.yml");
const dependencyReview = read(".github/dependency-review-config.yml");
const packageJson = JSON.parse(read("package.json"));
const uses = [...workflows.matchAll(/uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map((match) => match[1]);
const checks = [
  { name: "every GitHub Action is pinned to an immutable SHA", ok: uses.length > 0 && uses.every((item) => /@[a-f0-9]{40}$/.test(item)) },
  { name: "browser CI uses a digest-pinned Playwright image", ok: /mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}/.test(workflows) },
  { name: "Dependabot covers npm and GitHub Actions", ok: dependabot.includes("package-ecosystem: npm") && dependabot.includes("package-ecosystem: github-actions") },
  { name: "dependency review blocks high-severity changes", ok: dependencyReview.includes("fail-on-severity: high") && dependencyReview.includes("warn-only: false") },
  { name: "CodeQL scans JavaScript and TypeScript", ok: workflows.includes("javascript-typescript") && workflows.includes("security-extended") },
  { name: "CI runs audit, license, and route-policy gates", ok: ["npm audit --audit-level=high", "npm run check:licenses", "npm run check:route-policy"].every((item) => workflows.includes(item)) },
  { name: "release evidence contains an SBOM and checksums", ok: packageJson.scripts["release:evidence"]?.includes("create-release-evidence") && packageJson.scripts["release:evidence:verify"]?.includes("verify-release-evidence") },
];
console.log(JSON.stringify({ ok: checks.every((item) => item.ok), action_reference_count: uses.length, checks }, null, 2));
if (checks.some((item) => !item.ok)) process.exit(1);

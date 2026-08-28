#!/usr/bin/env node

import { classifyChangeImpact } from "./ci-change-impact.mjs";

const cases = [
  {
    name: "documentation does not trigger expensive jobs",
    files: ["docs/PRODUCTION_READINESS.md"],
    expected: { browser: false, postgres: false },
  },
  {
    name: "component changes run browser coverage without a database drill",
    files: ["components/pipeline/ReferralPacketCanvas.tsx"],
    expected: { browser: true, postgres: false },
  },
  {
    name: "database migrations run PostgreSQL coverage",
    files: ["database/migrations/0014_example.sql"],
    expected: { browser: false, postgres: true },
  },
  {
    name: "API and store changes run both integration surfaces",
    files: ["app/api/referrals/route.ts", "lib/pipeline/referral-store.ts"],
    expected: { browser: true, postgres: true },
  },
  {
    name: "dependency changes run both integration surfaces",
    files: ["package-lock.json"],
    expected: { browser: true, postgres: true },
  },
  {
    name: "CI gate changes validate both integration lanes",
    files: [".github/workflows/ci.yml", "scripts/ci-change-impact.mjs"],
    expected: { browser: true, postgres: true },
  },
  {
    name: "proxy changes run browser security journeys",
    files: ["proxy.ts"],
    expected: { browser: true, postgres: false },
  },
  {
    name: "operational Playwright configuration runs browser assurance",
    files: ["playwright.operational.config.ts"],
    expected: { browser: true, postgres: false },
  },
  {
    name: "assurance registry changes run browser assurance",
    files: ["scripts/platform-assurance-registry.mjs"],
    expected: { browser: true, postgres: false },
  },
];

const checks = cases.map((fixture) => {
  const actual = classifyChangeImpact(fixture.files);
  return {
    name: fixture.name,
    ok: actual.browser === fixture.expected.browser && actual.postgres === fixture.expected.postgres,
  };
});

console.log(JSON.stringify({ ok: checks.every((check) => check.ok), checks }, null, 2));
if (checks.some((check) => !check.ok)) process.exit(1);

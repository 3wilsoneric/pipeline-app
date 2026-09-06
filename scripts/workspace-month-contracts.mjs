#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  normalizeWorkspaceMonth,
  resolveWorkspaceMonth,
  workspaceMonthFromProjectName,
  workspaceMonthKey,
} from "../lib/pipeline/workspace-month.mjs";

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const sourceExamples = new Map([
  ["Jan 2024 Admissions", "2024-01"],
  ["2024 JCWH February Admissions", "2024-02"],
  ["2025 March San Pablo Admissions", "2025-03"],
  ["26 April AHMSC", "2026-04"],
  ["26 MayTurlock", "2026-05"],
  ["26 July JCWH", "2026-07"],
  ["Aug 26' Victorias House", "2026-08"],
  ["2026 Septemeber San Pablo Admissions", "2026-09"],
  ["2025 October Turlock Admissions", "2025-10"],
  ["2024 November JCWH Admissions", "2024-11"],
  ["2025 December AHM Santa Clarita", "2025-12"],
]);
check(
  "known Allo project naming patterns produce a month-precision filing date",
  [...sourceExamples].every(([name, expected]) => workspaceMonthFromProjectName(name) === expected),
);
check(
  "a project without a trustworthy month remains unknown",
  workspaceMonthFromProjectName("26 LA/SP County Admissions") === null
    && workspaceMonthKey({
      workspaceOrigin: "allo",
      sourceProjectName: "26 LA/SP County Admissions",
      date: "2024-02-01",
      createdAt: "2024-02-01T00:00:00.000Z",
    }) === "unknown",
);
check(
  "Allo workspace month comes from the project rather than a file timestamp",
  resolveWorkspaceMonth({
    workspaceOrigin: "allo",
    sourceProjectName: "2025 July San Pablo Admissions",
    date: "2024-02-01",
    createdAt: "2024-02-01T00:00:00.000Z",
  }).month === "2025-07",
);
check(
  "an imported manifest cannot override its Allo project month",
  resolveWorkspaceMonth({
    workspaceMonth: "2024-02",
    workspaceMonthBasis: "received_date",
    workspaceOrigin: "allo",
    sourceProjectName: "2025 July San Pablo Admissions",
  }).month === "2025-07",
);
check(
  "Pipeline workspaces use received month with created month as a fallback",
  workspaceMonthKey({ workspaceOrigin: "pipeline", date: "2026-08-25", createdAt: "2026-09-01T00:00:00Z" }) === "2026-08"
    && workspaceMonthKey({ workspaceOrigin: "pipeline", createdAt: "2026-09-01T00:00:00Z" }) === "2026-09",
);
check(
  "only bounded month keys are accepted",
  normalizeWorkspaceMonth("2026-09") === "2026-09"
    && normalizeWorkspaceMonth("2026-13") === null
    && normalizeWorkspaceMonth("26-09") === null,
);

const migration = readFileSync("database/migrations/0024_workspace_month_provenance.sql", "utf8");
const rollback = readFileSync("database/rollbacks/0024_workspace_month_provenance.sql", "utf8");
const store = readFileSync("lib/pipeline/referral-store.ts", "utf8");
const importer = readFileSync("scripts/import-allo-material-workspaces.mjs", "utf8");
const workspacePage = readFileSync("components/pipeline/ReferralHome.tsx", "utf8");

check(
  "migration records month provenance and separates it from received date",
  migration.includes("workspace_month")
    && migration.includes("workspace_month_basis")
    && migration.includes("source_project_name")
    && migration.includes("0024_workspace_month_provenance"),
);
check(
  "month filter and facets use the canonical workspace month",
  store.includes("to_char(r.workspace_month, 'YYYY-MM')")
    && store.includes("workspaceMonthKey(referral)")
    && !store.includes("to_char(r.received_date, 'YYYY-MM')"),
);
check(
  "future Allo imports require and persist the workspace-month migration",
  importer.includes("0024_workspace_month_provenance")
    && importer.includes("workspace_month, workspace_month_basis")
    && importer.includes("workspace_month = excluded.workspace_month"),
);
check(
  "workspace month has a scoped rollback",
  rollback.includes("drop column if exists workspace_month")
    && rollback.includes("0024_workspace_month_provenance")
    && !rollback.includes("drop schema"),
);
check(
  "workspace filter describes month precision without claiming an exact creation date",
  workspacePage.includes('aria-label="Browse workspaces by month and community"')
    && workspacePage.includes("Choose a month, then a community.")
    && !workspacePage.includes("Filter by creation month"),
);

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, scenarios: checks.length, checks }, null, 2));
if (failed.length) process.exit(1);

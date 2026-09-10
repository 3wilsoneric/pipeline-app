#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";

const migrations = readdirSync("database/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`database/migrations/${name}`, "utf8"))
  .join("\n");
const authentication = readFileSync("lib/auth/pipeline-auth.ts", "utf8");
const referralAccess = readFileSync("lib/pipeline/referral-access.ts", "utf8");
const assessmentAccess = readFileSync("lib/assessment/assessment-access.ts", "utf8");
const infrastructure = readFileSync("infra/azure/main.bicep", "utf8");
const strict = process.argv.includes("--require-shared-multitenancy");

const sharedDatabaseChecks = {
  tenant_key_on_core_schema: /\b(?:tenant|organization)_id\b/i.test(migrations),
  company_claim_bound_to_session: /\b(?:company|organization)Id\b/.test(authentication),
  referral_access_scoped_by_company: /\b(?:company|organization)Id\b/.test(referralAccess),
  assessment_access_scoped_by_company: /\b(?:company|organization)Id\b/.test(assessmentAccess),
  company_specific_storage_boundary: /\b(?:company|organization)(?:Container|Prefix|Path)\b/.test(infrastructure),
};
const sharedDatabaseReady = Object.values(sharedDatabaseChecks).every(Boolean);
const currentModeChecks = {
  entra_issuer_is_tenant_bound: authentication.includes("PIPELINE_ENTRA_TENANT_ID") && authentication.includes("issuer"),
  referral_role_and_assignment_checks_exist: referralAccess.includes("canAccessReferral") && referralAccess.includes("scopeReferralListOptions"),
  assessment_role_and_assignment_checks_exist: assessmentAccess.includes("canWorkAssessment") && assessmentAccess.includes("isAssessmentSupervisor"),
  infrastructure_is_one_deployment_boundary: infrastructure.includes("param environment string") && !sharedDatabaseChecks.tenant_key_on_core_schema,
};
const currentSingleCompanyModeSafe = Object.values(currentModeChecks).every(Boolean);
const ok = strict ? sharedDatabaseReady : currentSingleCompanyModeSafe;

console.log(JSON.stringify({
  ok,
  supported_production_model: "single_company_per_deployment",
  current_single_company_mode_safe: currentSingleCompanyModeSafe,
  shared_database_multitenant_ready: sharedDatabaseReady,
  current_mode_checks: currentModeChecks,
  shared_database_checks: sharedDatabaseChecks,
  required_before_shared_multitenancy: [
    "Bind an immutable company identifier from authentication to every request.",
    "Add the company identifier to every tenant-owned table, key, unique constraint, and query.",
    "Partition Blob paths, caches, jobs, exports, audit events, metrics, God Mode, and recovery operations by company.",
    "Enforce database row-level security and prove cross-company denial with negative integration and browser tests.",
  ],
  note: "This audit emits schema and control-plane capability only. It never reads tenant records or identifiers.",
}, null, 2));

if (!ok) process.exit(1);

#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const managedKeys = [
  "NODE_ENV",
  "PIPELINE_DEMO_MODE",
  "PIPELINE_DEMO_DATA_ISOLATED",
  "PIPELINE_DEMO_ENVIRONMENT_LABEL",
  "NEXT_PUBLIC_PIPELINE_DEMO_URL",
  "PIPELINE_DATABASE_MODE",
  "PIPELINE_REFERRAL_STORE_MODE",
  "PIPELINE_ASSESSMENT_STORE_MODE",
  "PIPELINE_DATABASE_URL",
];
const originalEnvironment = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));
const { getPipelineDemoEnvironment } = loadTypeScriptModule(
  process.cwd(),
  "lib/demo/demo-environment.ts",
);
const checks = [];

try {
  verify("local disconnected storage permits rehearsal", {
    NODE_ENV: "development",
  }, (result) => result.enabled && result.writable && result.entryUrl === "/training/demo");

  verify("local PostgreSQL fails closed without isolation", {
    NODE_ENV: "development",
    PIPELINE_DATABASE_MODE: "postgres",
    PIPELINE_DATABASE_URL: "postgresql://demo.invalid/pipeline",
  }, (result) => result.enabled && !result.writable);

  verify("local PostgreSQL permits explicitly isolated demo data", {
    NODE_ENV: "development",
    PIPELINE_DATABASE_MODE: "postgres",
    PIPELINE_DATABASE_URL: "postgresql://demo.invalid/pipeline",
    PIPELINE_DEMO_DATA_ISOLATED: "true",
  }, (result) => result.enabled && result.writable);

  verify("production hides an unconfigured Demo Center", {
    NODE_ENV: "production",
  }, (result) => !result.enabled && !result.writable && result.entryUrl === null);

  verify("production demo mode remains read-only without isolation", {
    NODE_ENV: "production",
    PIPELINE_DEMO_MODE: "true",
  }, (result) => result.enabled && !result.writable);

  verify("production demo mode permits an isolated store", {
    NODE_ENV: "production",
    PIPELINE_DEMO_MODE: "true",
    PIPELINE_DEMO_DATA_ISOLATED: "true",
    PIPELINE_DEMO_ENVIRONMENT_LABEL: "Pipeline UAT",
  }, (result) => result.enabled && result.writable && result.label === "Pipeline UAT");

  verify("production can link to a separate demo deployment", {
    NODE_ENV: "production",
    NEXT_PUBLIC_PIPELINE_DEMO_URL: "https://pipeline-demo.example.org",
  }, (result) => !result.enabled && result.entryUrl === "https://pipeline-demo.example.org");
} finally {
  restoreEnvironment();
}

const ok = checks.every((check) => check.ok);
process.stdout.write(`${JSON.stringify({
  ok,
  checks,
  interpretation: ok
    ? "Demo writes fail closed around durable data and production deployments."
    : "The demo environment boundary has regressed.",
}, null, 2)}\n`);
if (!ok) process.exitCode = 1;

function verify(name, environment, predicate) {
  resetEnvironment(environment);
  const result = getPipelineDemoEnvironment();
  checks.push({ name, ok: Boolean(predicate(result)) });
}

function resetEnvironment(environment) {
  for (const key of managedKeys) delete process.env[key];
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;
}

function restoreEnvironment() {
  for (const key of managedKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

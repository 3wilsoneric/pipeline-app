#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

import { reviewConfirmation } from "./allo-canvas-content-common.mjs";

const args = argumentMap();
const candidateId = uuidArgument("--candidate-id");
const action = args.get("--action");
const expectedVersion = integerArgument("--expected-version", null, 1, Number.MAX_SAFE_INTEGER);
const valueFile = optionalAbsoluteArgument("--value-file");
const reasonCode = normalizedValue(args.get("--reason-code"));
const reviewerId = process.env.PIPELINE_IMPORT_REVIEWER_ID?.trim();
if (!new Set(["accept", "edit", "reject"]).has(action)) fail("--action must be accept, edit, or reject.");
if (action === "edit" && !valueFile) fail("--value-file is required for an edit.");
if (action !== "edit" && valueFile) fail("--value-file is only valid for an edit.");
if (args.get("--confirm") !== reviewConfirmation) fail(`Refusing to review without --confirm=${reviewConfirmation}.`);
if (!reviewerId) fail("PIPELINE_IMPORT_REVIEWER_ID is required.");
const editedValue = valueFile ? (await readFile(valueFile, "utf8")).trim() : null;
if (valueFile && (!editedValue || editedValue.length > 500_000)) fail("The reviewed value is empty or too large.");
const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) fail("PIPELINE_DATABASE_URL is required.");

const sql = postgres(databaseUrl, databaseOptions("pipeline-allo-canvas-content-review"));
try {
  const result = await sql.begin(async (tx) => {
    const rows = await tx`
      select canvas_content_candidate_id::text, review_status, proposed_value,
             final_value, version, referral_id::text
      from pipeline.canvas_content_field_candidates
      where canvas_content_candidate_id = ${candidateId}::uuid
      for update
    `;
    const current = rows[0];
    validateReviewCandidate(current, expectedVersion, action);
    const transition = reviewTransition(action, current.proposed_value, editedValue);
    const previousValue = jsonOrNull(tx, current.final_value);
    const nextValue = jsonOrNull(tx, transition.value);
    await tx`
      update pipeline.canvas_content_field_candidates
      set review_status = ${transition.status}, final_value = ${nextValue},
          reviewed_by = ${reviewerId}, reviewed_at = now(), version = version + 1, updated_at = now()
      where canvas_content_candidate_id = ${candidateId}::uuid
    `;
    await tx`
      insert into pipeline.canvas_content_review_events (
        canvas_content_candidate_id, action, reviewer_id, previous_status, next_status,
        previous_value, next_value, reason_code
      ) values (
        ${candidateId}::uuid, ${action}, ${reviewerId}, ${current.review_status}, ${transition.status},
        ${previousValue}, ${nextValue}, ${reasonCode}
      )
    `;
    await tx`
      update pipeline.store_revisions set revision = revision + 1, updated_at = now()
      where store_name = 'allo_canvas_content'
    `;
    return { status: transition.status, version: current.version + 1 };
  });
  console.log(JSON.stringify({ ok: true, candidate_id: candidateId, review_status: result.status, version: result.version }));
} catch (error) {
  fail(`The review was not applied (${safeFailureCode(error)}).`);
} finally {
  await sql.end({ timeout: 5 });
}

function validateReviewCandidate(current, version, requestedAction) {
  if (!current) throw new Error("candidate_not_found");
  if (current.version !== version) throw new Error("version_conflict");
  if (current.review_status !== "pending") throw new Error("candidate_not_pending");
  if (!current.referral_id && requestedAction !== "reject") throw new Error("candidate_unlinked");
}

function reviewTransition(requestedAction, proposedValue, replacementValue) {
  return {
    accept: { status: "accepted", value: proposedValue },
    edit: { status: "edited", value: replacementValue },
    reject: { status: "rejected", value: null },
  }[requestedAction];
}

function jsonOrNull(tx, value) {
  return value === null ? null : tx.json(value);
}

function databaseOptions(applicationName) {
  return {
    connection: { application_name: applicationName },
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable"
      ? false
      : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
    max: 1,
    connect_timeout: 10,
    idle_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
  };
}

function safeFailureCode(error) {
  const value = error instanceof Error ? error.message : "review_failed";
  return new Set(["candidate_not_found", "version_conflict", "candidate_not_pending", "candidate_unlinked"]).has(value)
    ? value
    : "review_failed";
}

function argumentMap() {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.split("=");
    return [key, rest.join("=")];
  }));
}

function optionalAbsoluteArgument(name) {
  const value = args.get(name);
  if (!value) return null;
  if (!path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  return value;
}

function uuidArgument(name) {
  const value = args.get(name);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value ?? "")) fail(`${name} must be a UUID.`);
  return value;
}

function integerArgument(name, fallback, minimum, maximum) {
  const raw = args.get(name);
  if (!raw) {
    if (fallback === null) fail(`${name} is required.`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`${name} is invalid.`);
  return value;
}

function normalizedValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, 200) : null;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

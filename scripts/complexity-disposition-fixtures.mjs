#!/usr/bin/env node

import assert from "node:assert/strict";

import { evaluateComplexityDisposition } from "./complexity-disposition.mjs";

const failures = [
  { kind: "function", key: "lib/example.ts::work::1", current: 12, message: "function failure" },
  { kind: "total", metric: "hotspots", current: 4, message: "total failure" },
];
const ownerApproved = {
  schemaVersion: 1,
  status: "owner_approved",
  ownerApproval: { approvedBy: "Owner", approvedAt: "2026-09-07T00:00:00Z" },
  independentReview: { reviewedBy: null, reviewedAt: null },
  ceilings: {
    functions: { "lib/example.ts::work::1": 12 },
    totals: { hotspots: 4 },
  },
};

const pending = evaluateComplexityDisposition(failures, ownerApproved);
assert.equal(pending.applied.length, 0);
assert.equal(pending.remaining.length, 2);
assert.equal(pending.validationErrors.length, 0);

const approved = evaluateComplexityDisposition(failures, {
  ...ownerApproved,
  status: "approved",
  independentReview: { reviewedBy: "Reviewer", reviewedAt: "2026-09-07T01:00:00Z" },
});
assert.equal(approved.applied.length, 2);
assert.equal(approved.remaining.length, 0);

const growth = evaluateComplexityDisposition([
  { kind: "function", key: "lib/example.ts::work::1", current: 13, message: "growth" },
], {
  ...ownerApproved,
  status: "approved",
  independentReview: { reviewedBy: "Reviewer", reviewedAt: "2026-09-07T01:00:00Z" },
});
assert.equal(growth.applied.length, 0);
assert.equal(growth.remaining.length, 1);

const unlisted = evaluateComplexityDisposition([
  { kind: "function", key: "lib/example.ts::other::1", current: 12, message: "unlisted" },
], {
  ...ownerApproved,
  status: "approved",
  independentReview: { reviewedBy: "Reviewer", reviewedAt: "2026-09-07T01:00:00Z" },
});
assert.equal(unlisted.applied.length, 0);
assert.equal(unlisted.remaining.length, 1);

const selfReviewed = evaluateComplexityDisposition(failures, {
  ...ownerApproved,
  status: "approved",
  independentReview: { reviewedBy: "Owner", reviewedAt: "2026-09-07T01:00:00Z" },
});
assert.equal(selfReviewed.applied.length, 0);
assert.ok(selfReviewed.validationErrors.some((error) => error.includes("must differ")));

const ownerFastLane = evaluateComplexityDisposition(failures, {
  ...ownerApproved,
  status: "approved",
  approvalMode: "owner_fast_lane",
  ownerApproval: { ...ownerApproved.ownerApproval, directive: "Owner authorized fast lane." },
});
assert.equal(ownerFastLane.applied.length, 2);
assert.equal(ownerFastLane.remaining.length, 0);
assert.equal(ownerFastLane.validationErrors.length, 0);

const missingFastLaneDirective = evaluateComplexityDisposition(failures, {
  ...ownerApproved,
  status: "approved",
  approvalMode: "owner_fast_lane",
});
assert.equal(missingFastLaneDirective.applied.length, 0);
assert.ok(missingFastLaneDirective.validationErrors.some((error) => error.includes("explicit directive")));

console.log(JSON.stringify({ ok: true, fixtures: 7 }, null, 2));

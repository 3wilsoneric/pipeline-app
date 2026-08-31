#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const registry = readJson("docs/refactoring/refactor-slices.json");
const policy = readJson("docs/refactoring/high-assurance-policy.json");
const responsibilityMap = readJson("docs/refactoring/canonical-responsibilities.json");
const probeSet = readJson("docs/refactoring/architecture-comprehension-probes.json");
const proofSet = readJson("docs/refactoring/proof-obligations.json");
const manifest = readJson("package.json");
const errors = [];
const warnings = [];

const sliceIds = new Set((registry.slices ?? []).map((slice) => slice.id));
const assuranceClasses = new Set(policy.assuranceClasses ?? []);
const criticalities = new Set(policy.criticalities ?? []);
const obligationStatuses = new Set(policy.obligationStatuses ?? []);
const fullCommit = /^[0-9a-f]{40}$/u;
const runFixtures = process.argv.includes("--fixtures");

function duplicateIds(items, label) {
  const seen = new Set();
  for (const item of items ?? []) {
    if (!item.id) errors.push(`${label} contains an entry without an id.`);
    else if (seen.has(item.id)) errors.push(`${label} repeats id ${item.id}.`);
    seen.add(item.id);
  }
}

function requirePaths(paths, label) {
  if (!Array.isArray(paths) || paths.length === 0) {
    errors.push(`${label} must cite at least one repository path.`);
    return;
  }
  for (const path of paths) if (!existsSync(path)) errors.push(`${label} references missing path ${path}.`);
}

function requireGates(gates, label) {
  if (!Array.isArray(gates) || gates.length === 0) {
    errors.push(`${label} must cite at least one executable gate.`);
    return;
  }
  for (const gate of gates) if (!manifest.scripts?.[gate]) errors.push(`${label} references missing package script ${gate}.`);
}

function requireSliceIds(ids, label) {
  if (!Array.isArray(ids) || ids.length === 0) {
    errors.push(`${label} must apply to at least one slice.`);
    return;
  }
  for (const id of ids) if (!sliceIds.has(id)) errors.push(`${label} references unknown slice ${id}.`);
}

function requireHumanValidation(item, label) {
  if (item.humanValidated !== true) return false;
  if (!item.validatedBy || !item.validatedAt) errors.push(`${label} claims human validation without validatedBy and validatedAt.`);
  return true;
}

function gitObjectExists(revision) {
  try {
    execFileSync("git", ["cat-file", "-e", `${revision}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function exactSet(actual, expected, label) {
  const actualSet = new Set(actual ?? []);
  const expectedSet = new Set(expected ?? []);
  for (const value of expectedSet) if (!actualSet.has(value)) errors.push(`${label} is missing ${value}.`);
  for (const value of actualSet) if (!expectedSet.has(value)) errors.push(`${label} includes unexpected ${value}.`);
}

function validateComprehension(review, slice, probes, label, expectedCommit) {
  if (!review || typeof review !== "object") {
    errors.push(`${slice.id} assurance record requires ${label}.`);
    return;
  }
  if (review.commit !== expectedCommit) errors.push(`${slice.id} ${label} must bind to ${expectedCommit}.`);
  validateComprehensionMetadata(review, slice.id, label);
  const answers = new Map((review.answers ?? []).map((answer) => [answer.probeId, answer]));
  for (const probe of probes) {
    const answer = answers.get(probe.id);
    if (!answer) {
      errors.push(`${slice.id} ${label} is missing probe ${probe.id}.`);
      continue;
    }
    validateComprehensionAnswer(answer, slice.id, label, probe.id);
  }
}

function validateComprehensionMetadata(review, sliceId, label) {
  if (!review.reviewer || !review.contextId || review.implementationConversationUsed !== false) {
    errors.push(`${sliceId} ${label} requires a fresh context reviewer and implementationConversationUsed false.`);
  }
  if (!review.scoredBy || !review.scoredAt) errors.push(`${sliceId} ${label} requires human scoring metadata.`);
}

function validateComprehensionAnswer(answer, sliceId, label, probeId) {
  if (answer.score !== "correct") errors.push(`${sliceId} ${label} probe ${probeId} must be correct before the slice can advance.`);
  if (!Array.isArray(answer.codeCitations) || answer.codeCitations.length === 0) errors.push(`${sliceId} ${label} probe ${probeId} lacks code citations.`);
  if (!Array.isArray(answer.executedEvidence) || answer.executedEvidence.length === 0) errors.push(`${sliceId} ${label} probe ${probeId} lacks executed evidence.`);
}

function validateStartRecord(record, slice, obligations, probes) {
  if (record.schemaVersion !== 1 || record.sliceId !== slice.id) errors.push(`${slice.id} assurance record has the wrong schemaVersion or sliceId.`);
  if (record.startingCommit !== slice.startingCommit) errors.push(`${slice.id} assurance record must use the registry startingCommit.`);
  if (record.humanOwner !== slice.owner) errors.push(`${slice.id} assurance record humanOwner must match the registry owner.`);
  if (!record.independentHumanReviewer || record.independentHumanReviewer === record.humanOwner) {
    errors.push(`${slice.id} assurance record requires an independent human reviewer.`);
  }
  exactSet(record.approvedObligationIds, obligations.map((item) => item.id), `${slice.id} approvedObligationIds`);
  validateComprehension(record.preChangeComprehension, slice, probes, "preChangeComprehension", slice.startingCommit);
}

function findingIsUnresolved(finding) {
  return ["critical", "high"].includes(finding.severity)
    && !["fixed", "rejected_with_evidence"].includes(finding.disposition);
}

function validateCompletionRecord(record, slice, obligations, probes) {
  const candidate = record.candidateCommit;
  if (!fullCommit.test(candidate ?? "") || !gitObjectExists(candidate)) errors.push(`${slice.id} assurance record requires an existing full candidateCommit.`);

  validateProofResults(record, slice, obligations, candidate);
  validateGateResults(record, slice, candidate);
  const requiredPasses = validateAdversarialPasses(record, slice, candidate);

  validateComprehension(record.postChangeComprehension, slice, probes, "postChangeComprehension", candidate);
  if (!["better", "equal"].includes(record.postChangeComprehension?.comparisonToPreChange)) errors.push(`${slice.id} post-change comprehension regressed.`);

  validateRecovery(record.rollbackAndRecovery, slice.id, candidate);
  validateResidualRisks(record.residualRisks, slice.id);
  validateConvergence(record.convergence, slice.id, candidate, requiredPasses);
}

function validateProofResults(record, slice, obligations, candidate) {
  const proofResults = new Map((record.proofResults ?? []).map((result) => [result.obligationId, result]));
  for (const obligation of obligations) {
    const result = proofResults.get(obligation.id);
    validateProofResult(result, obligation, slice.id, candidate);
  }
}

function validateProofResult(result, obligation, sliceId, candidate) {
  if (!result || result.status !== "verified") {
    errors.push(`${sliceId} lacks a verified proof result for ${obligation.id}.`);
    return;
  }
  if (result.candidateCommit !== candidate) errors.push(`${sliceId}/${obligation.id} proof result is not bound to candidateCommit.`);
  if (!proofMethodsAreValid(result.methods, obligation.assuranceMethods)) {
    errors.push(`${sliceId}/${obligation.id} proof result uses missing or unapproved assurance methods.`);
  }
  if (!proofEvidenceIsValid(result.evidence, result.implementationTrace)) {
    errors.push(`${sliceId}/${obligation.id} proof result lacks evidence or implementation trace.`);
  }
  if (!result.verifiedBy || !result.verifiedAt) errors.push(`${sliceId}/${obligation.id} proof result lacks independent verification metadata.`);
}

function proofMethodsAreValid(methods, allowedMethods) {
  return Array.isArray(methods)
    && methods.length > 0
    && methods.every((method) => allowedMethods.includes(method));
}

function proofEvidenceIsValid(evidence, implementationTrace) {
  return Array.isArray(evidence)
    && evidence.length > 0
    && Array.isArray(implementationTrace)
    && implementationTrace.length > 0;
}

function validateGateResults(record, slice, candidate) {
  const gateResults = new Map((record.gateResults ?? []).map((result) => [result.command, result]));
  for (const gate of [...slice.requiredGates, "certify:refactor"]) {
    const command = `npm run ${gate}`;
    const result = gateResults.get(command);
    if (!result || result.outcome !== "passed" || result.candidateCommit !== candidate || !result.evidence) {
      errors.push(`${slice.id} requires a passing candidate-bound gate result for ${command}.`);
    }
  }
}

function validateAdversarialPasses(record, slice, candidate) {
  const passes = record.adversarialPasses ?? [];
  const requiredPasses = policy.convergence?.requiredConsecutiveAdversarialPasses ?? 2;
  if (passes.length < requiredPasses) errors.push(`${slice.id} requires at least ${requiredPasses} adversarial passes.`);
  const contextIds = new Set();
  for (const pass of passes) {
    validateAdversarialPass(pass, slice.id, candidate);
    if (contextIds.has(pass.contextId)) errors.push(`${slice.id} adversarial passes reuse contextId ${pass.contextId}.`);
    contextIds.add(pass.contextId);
  }
  const finalPasses = passes.slice(-requiredPasses);
  if (finalPasses.some((pass) => pass.materialSimplificationFound || (pass.findings ?? []).some(findingIsUnresolved))) {
    errors.push(`${slice.id} does not have ${requiredPasses} consecutive clean adversarial passes.`);
  }
  return requiredPasses;
}

function validateAdversarialPass(pass, sliceId, candidate) {
  if (pass.candidateCommit !== candidate || !pass.reviewer || !pass.contextId || pass.implementationConversationUsed !== false || !pass.completedAt) {
    errors.push(`${sliceId} has an incomplete or incorrectly bound adversarial pass ${pass.id ?? "unknown"}.`);
  }
  for (const finding of pass.findings ?? []) validateAdversarialFinding(finding, sliceId, pass.id);
}

function validateAdversarialFinding(finding, sliceId, passId) {
  if (!criticalities.has(finding.severity) || !finding.claim || !Array.isArray(finding.evidence) || finding.evidence.length === 0) {
    errors.push(`${sliceId}/${passId} contains an incomplete adversarial finding.`);
  }
  if (!finding.humanDispositionBy || !finding.humanDispositionAt) errors.push(`${sliceId}/${passId} finding lacks human disposition metadata.`);
  if (["critical", "high"].includes(finding.severity) && finding.disposition === "accepted_residual") {
    errors.push(`${sliceId}/${passId} attempts to accept a ${finding.severity} finding as residual.`);
  }
}

function validateRecovery(recovery, sliceId, candidate) {
  if (!recovery || recovery.candidateCommit !== candidate || !recovery.method || !Array.isArray(recovery.exercisedEvidence) || recovery.exercisedEvidence.length === 0 || !recovery.approvedBy || !recovery.approvedAt) {
    errors.push(`${sliceId} lacks candidate-bound, human-approved rollback or recovery evidence.`);
  }
}

function validateResidualRisks(residualRisks, sliceId) {
  for (const risk of residualRisks ?? []) {
    if (!residualRiskIsComplete(risk)) {
      errors.push(`${sliceId} contains an incomplete or impermissible residual risk ${risk.id ?? "unknown"}.`);
    }
  }
}

function residualRiskIsComplete(risk) {
  const operational = risk.uncertainty && risk.detection && risk.containment && risk.recovery && risk.owner;
  const approval = risk.acceptedBy && risk.acceptedAt && risk.reviewBy;
  return ["medium", "low"].includes(risk.severity) && Boolean(operational) && Boolean(approval);
}

function validateConvergence(convergence, sliceId, candidate, requiredPasses) {
  for (const field of ["allObligationsVerified", "requiredGatesPassed", "postComprehensionNoWorse", "rollbackOrRecoveryProven", "noUnresolvedCriticalOrHigh"]) {
    if (convergence?.[field] !== true) errors.push(`${sliceId} convergence requires ${field} true.`);
  }
  if (convergence?.candidateCommit !== candidate || convergence?.consecutiveCleanAdversarialPasses < requiredPasses || !convergence?.acceptedBy || !convergence?.acceptedAt) {
    errors.push(`${sliceId} convergence is incomplete or not human accepted.`);
  }
  if (convergence?.claim !== policy.claimPolicy?.allowed) errors.push(`${sliceId} convergence claim must use the bounded claim defined by policy.`);
}

if (policy.schemaVersion !== 1 || policy.target !== "practical_high_assurance") errors.push("High-assurance policy must use schemaVersion 1 and the practical_high_assurance target.");
if ((policy.convergence?.requiredConsecutiveAdversarialPasses ?? 0) < 2) errors.push("High-assurance convergence requires at least two consecutive adversarial passes.");
for (const claim of ["bug-free", "perfect"]) if (!policy.claimPolicy?.prohibitedClaims?.includes(claim)) errors.push(`High-assurance policy must prohibit the ${claim} claim.`);

if (responsibilityMap.schemaVersion !== 1 || !Array.isArray(responsibilityMap.responsibilities)) errors.push("Canonical responsibility map must use schemaVersion 1.");
if (probeSet.schemaVersion !== 1 || !Array.isArray(probeSet.probes)) errors.push("Architecture comprehension probes must use schemaVersion 1.");
if (proofSet.schemaVersion !== 1 || !Array.isArray(proofSet.obligations)) errors.push("Proof obligations must use schemaVersion 1.");

duplicateIds(responsibilityMap.responsibilities, "Canonical responsibility map");
duplicateIds(probeSet.probes, "Architecture comprehension probes");
duplicateIds(proofSet.obligations, "Proof obligations");

const responsibilitiesById = new Map((responsibilityMap.responsibilities ?? []).map((item) => [item.id, item]));
for (const responsibility of responsibilityMap.responsibilities ?? []) {
  const label = `Responsibility ${responsibility.id}`;
  requireSliceIds(responsibility.sliceIds, label);
  requirePaths(responsibility.canonicalOwnerPaths, label);
  requireGates(responsibility.verificationGates, label);
  if (!responsibility.ownershipKind || !Array.isArray(responsibility.allowedRepresentations) || responsibility.allowedRepresentations.length === 0 || !Array.isArray(responsibility.invariants) || responsibility.invariants.length === 0 || !Array.isArray(responsibility.forbiddenParallelOwners) || responsibility.forbiddenParallelOwners.length === 0) {
    errors.push(`${label} is missing ownership, representation, invariant, or prohibited-owner detail.`);
  }
  requireHumanValidation(responsibility, label);
}

for (const probe of probeSet.probes ?? []) {
  const label = `Comprehension probe ${probe.id}`;
  requireSliceIds(probe.sliceIds, label);
  requirePaths(probe.codePaths, label);
  requireGates(probe.verificationGates, label);
  const responsibility = responsibilitiesById.get(probe.responsibilityId);
  if (!responsibility) errors.push(`${label} references unknown responsibility ${probe.responsibilityId}.`);
  else for (const sliceId of probe.sliceIds) if (!responsibility.sliceIds.includes(sliceId)) errors.push(`${label} applies to ${sliceId}, outside responsibility ${responsibility.id}.`);
  if (!probe.question) errors.push(`${label} has no question.`);
  requireHumanValidation(probe, label);
}

for (const obligation of proofSet.obligations ?? []) {
  const label = `Proof obligation ${obligation.id}`;
  if (!sliceIds.has(obligation.sliceId)) errors.push(`${label} references unknown slice ${obligation.sliceId}.`);
  if (!criticalities.has(obligation.criticality)) errors.push(`${label} has invalid criticality ${obligation.criticality}.`);
  if (!obligationStatuses.has(obligation.status)) errors.push(`${label} has invalid status ${obligation.status}.`);
  if (!obligation.property || !obligation.claimBoundary) errors.push(`${label} lacks a property or claim boundary.`);
  if (!Array.isArray(obligation.assuranceMethods) || obligation.assuranceMethods.length < 2) errors.push(`${label} needs at least two complementary assurance methods.`);
  for (const method of obligation.assuranceMethods ?? []) if (!assuranceClasses.has(method)) errors.push(`${label} uses unknown assurance method ${method}.`);
  requirePaths(obligation.tracePaths, label);
  requireGates(obligation.verificationGates, label);
  requireHumanValidation(obligation, label);
  if (obligation.status === "verified" && (!obligation.verifiedBy || !obligation.verifiedAt)) errors.push(`${label} claims verification without verification metadata.`);
}

const sliceResults = [];
for (const slice of registry.slices ?? []) {
  const responsibilities = (responsibilityMap.responsibilities ?? []).filter((item) => item.sliceIds.includes(slice.id));
  const probes = (probeSet.probes ?? []).filter((item) => item.sliceIds.includes(slice.id));
  const obligations = (proofSet.obligations ?? []).filter((item) => item.sliceId === slice.id);
  if (responsibilities.length === 0) errors.push(`${slice.id} has no canonical responsibility entry.`);
  if (probes.length === 0) errors.push(`${slice.id} has no architecture comprehension probe.`);
  if (obligations.length === 0) errors.push(`${slice.id} has no proof obligation.`);

  const unvalidated = [
    ...responsibilities.filter((item) => item.humanValidated !== true).map((item) => `responsibility:${item.id}`),
    ...probes.filter((item) => item.humanValidated !== true).map((item) => `probe:${item.id}`),
    ...obligations.filter((item) => item.humanValidated !== true).map((item) => `obligation:${item.id}`),
  ];
  const started = slice.status !== "not_started";
  if (started && unvalidated.length > 0) errors.push(`${slice.id} started with unvalidated assurance definitions: ${unvalidated.join(", ")}.`);
  if (!started && unvalidated.length > 0) warnings.push(`${slice.id} assurance model awaits human validation: ${unvalidated.join(", ")}.`);

  let record = null;
  if (started) {
    if (!slice.assuranceRecord || !existsSync(slice.assuranceRecord)) errors.push(`${slice.id} requires an existing assuranceRecord before it starts.`);
    else {
      record = readJson(slice.assuranceRecord);
      validateStartRecord(record, slice, obligations, probes);
      if (["soaking", "complete"].includes(slice.status)) validateCompletionRecord(record, slice, obligations, probes);
    }
  }

  sliceResults.push({
    id: slice.id,
    status: slice.status,
    responsibilities: responsibilities.length,
    probes: probes.length,
    obligations: obligations.length,
    humanValidated: unvalidated.length === 0,
    assuranceRecord: slice.assuranceRecord ?? null,
  });
}

if (runFixtures) {
  assert.equal(errors.length, 0, "Assurance fixtures require structurally valid setup artifacts.");
  const slice = {
    ...registry.slices.find((item) => item.id === "referral-store-boundaries"),
    owner: "Fixture Owner",
    startingCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  };
  const obligations = proofSet.obligations.filter((item) => item.sliceId === slice.id);
  const probes = probeSet.probes.filter((item) => item.sliceIds.includes(slice.id));
  const comprehension = (commit, contextId) => ({
    commit,
    reviewer: "Fresh Reviewer",
    contextId,
    implementationConversationUsed: false,
    answers: probes.map((probe) => ({
      probeId: probe.id,
      score: "correct",
      codeCitations: [`${probe.codePaths[0]}:1`],
      executedEvidence: [`npm run ${probe.verificationGates[0]}`],
      finding: "Fixture answer",
    })),
    scoredBy: "Human Evaluator",
    scoredAt: "2026-08-31T00:00:00.000Z",
  });
  const record = {
    schemaVersion: 1,
    sliceId: slice.id,
    status: "baseline_approved",
    startingCommit: slice.startingCommit,
    candidateCommit: slice.startingCommit,
    humanOwner: slice.owner,
    independentHumanReviewer: "Independent Human",
    approvedObligationIds: obligations.map((item) => item.id),
    preChangeComprehension: comprehension(slice.startingCommit, "pre-context"),
    proofResults: obligations.map((obligation) => ({
      obligationId: obligation.id,
      candidateCommit: slice.startingCommit,
      status: "verified",
      methods: [obligation.assuranceMethods[0]],
      evidence: ["fixture evidence"],
      implementationTrace: [`${obligation.tracePaths[0]}:fixture`],
      verifiedBy: "Independent Human",
      verifiedAt: "2026-08-31T00:00:00.000Z",
    })),
    gateResults: [...slice.requiredGates, "certify:refactor"].map((gate) => ({
      command: `npm run ${gate}`,
      candidateCommit: slice.startingCommit,
      outcome: "passed",
      evidence: "fixture check",
    })),
    adversarialPasses: ["adversarial-context-a", "adversarial-context-b"].map((contextId, index) => ({
      id: `adversarial-00${index + 1}`,
      candidateCommit: slice.startingCommit,
      reviewer: `Critic ${index + 1}`,
      contextId,
      implementationConversationUsed: false,
      findings: [],
      materialSimplificationFound: false,
      completedAt: "2026-08-31T00:00:00.000Z",
    })),
    postChangeComprehension: {
      ...comprehension(slice.startingCommit, "post-context"),
      comparisonToPreChange: "equal",
    },
    rollbackAndRecovery: {
      candidateCommit: slice.startingCommit,
      method: "Fixture revert",
      exercisedEvidence: ["fixture recovery"],
      approvedBy: "Operator",
      approvedAt: "2026-08-31T00:00:00.000Z",
    },
    residualRisks: [],
    convergence: {
      candidateCommit: slice.startingCommit,
      allObligationsVerified: true,
      requiredGatesPassed: true,
      consecutiveCleanAdversarialPasses: 2,
      postComprehensionNoWorse: true,
      rollbackOrRecoveryProven: true,
      noUnresolvedCriticalOrHigh: true,
      acceptedBy: "Independent Human",
      acceptedAt: "2026-08-31T00:00:00.000Z",
      claim: policy.claimPolicy.allowed,
    },
  };
  const beforeValid = errors.length;
  validateStartRecord(record, slice, obligations, probes);
  validateCompletionRecord(record, slice, obligations, probes);
  assert.equal(errors.length, beforeValid, `Valid assurance fixture failed: ${errors.slice(beforeValid).join(" ")}`);

  const invalid = structuredClone(record);
  invalid.adversarialPasses[1].findings.push({
    severity: "critical",
    claim: "Fixture unresolved defect",
    evidence: ["fixture evidence"],
    disposition: "accepted_residual",
    humanDispositionBy: "Human",
    humanDispositionAt: "2026-08-31T00:00:00.000Z",
  });
  const beforeInvalid = errors.length;
  validateCompletionRecord(invalid, slice, obligations, probes);
  assert.ok(errors.length > beforeInvalid, "Critical residual-risk fixture should fail assurance validation.");
  errors.length = beforeInvalid;
  console.log(JSON.stringify({ ok: true, fixtures: 2 }, null, 2));
  process.exit(0);
}

const result = {
  ok: errors.length === 0,
  mode: registry.mode,
  target: policy.target,
  claimBoundary: policy.claimPolicy?.allowed,
  summary: {
    responsibilities: responsibilityMap.responsibilities?.length ?? 0,
    probes: probeSet.probes?.length ?? 0,
    obligations: proofSet.obligations?.length ?? 0,
    humanValidatedSlices: sliceResults.filter((slice) => slice.humanValidated).length,
    startedSlices: sliceResults.filter((slice) => slice.status !== "not_started").length,
  },
  slices: sliceResults,
  errors,
  warnings,
  interpretation: registry.mode === "setup_only"
    ? "The high-assurance model is a draft setup control. Its warnings do not authorize implementation or make whole-application correctness claims."
    : "An active slice must bind human-validated responsibilities, probes, proof obligations, and its assurance record to exact commits.",
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const policyPath = "docs/refactoring/refactor-guidance-evaluation-policy.json";
const scenarioPath = "docs/refactoring/refactor-eval-scenarios.json";
const antiPatternPath = "docs/refactoring/refactor-anti-patterns.json";
const ledgerPath = "docs/refactoring/refactor-correction-ledger.json";
const holdoutExamplePath = "docs/refactoring/refactor-holdout-manifest.example.json";
const registryPath = "docs/refactoring/refactor-slices.json";
const evidencePath = "docs/refactoring/evidence-matrix.json";

const policy = readJson(policyPath);
const scenarioSet = readJson(scenarioPath);
const antiPatternSet = readJson(antiPatternPath);
const ledger = readJson(ledgerPath);
const registry = readJson(registryPath);
const evidenceMatrix = readJson(evidencePath);
const manifest = readJson("package.json");
const errors = [];
const warnings = [];
const fullCommit = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const timestamps = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const sliceIds = new Set((registry.slices ?? []).map((slice) => slice.id));
const scenariosById = new Map((scenarioSet.scenarios ?? []).map((scenario) => [scenario.id, scenario]));
const antiPatternsById = new Map((antiPatternSet.antiPatterns ?? []).map((item) => [item.id, item]));
const allowedDecisions = new Set(policy.allowedDecisions ?? []);
const allowedKinds = new Set(policy.allowedScenarioKinds ?? []);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function scenarioDigest(scenario) {
  return sha256(canonicalJson(scenario));
}

function duplicateIds(items, label, targetErrors = errors) {
  const seen = new Set();
  for (const item of items ?? []) {
    if (!item?.id) targetErrors.push(`${label} contains an entry without an id.`);
    else if (seen.has(item.id)) targetErrors.push(`${label} repeats id ${item.id}.`);
    seen.add(item?.id);
  }
}

function pathIsSafe(path) {
  return typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.split("/").includes("..");
}

function pathMatches(actual, expected) {
  return actual === expected || actual.startsWith(`${expected}:`) || (expected.endsWith("/") && actual.startsWith(expected));
}

function proposedPathAllowed(path, allowedPaths) {
  return allowedPaths.some((allowed) => path === allowed || (allowed.endsWith("/") && path.startsWith(allowed)));
}

function gitCommitExists(commit) {
  if (!fullCommit.test(commit ?? "")) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function gitFileAt(commit, path) {
  try {
    return execFileSync("git", ["show", `${commit}:${path}`]);
  } catch {
    return null;
  }
}

function requireArray(value, label, targetErrors) {
  if (!Array.isArray(value)) {
    targetErrors.push(`${label} must be an array.`);
    return [];
  }
  return value;
}

function sameSet(actual, expected) {
  const left = new Set(actual ?? []);
  const right = new Set(expected ?? []);
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function containsForbiddenHoldoutContent(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenHoldoutContent);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (["prompt", "fixedPrompt", "fixture", "fixedInputs", "expectedAnswer", "mechanicalExpectations"].includes(key)) return true;
    if (containsForbiddenHoldoutContent(child)) return true;
  }
  return false;
}

function validateHoldoutManifest(record, label, targetErrors) {
  if (!isSchemaVersionOne(record)) {
    targetErrors.push(`${label} must use schemaVersion 1.`);
    return [];
  }
  validateHoldoutHeader(record, label, targetErrors);
  const scenarios = requireArray(record.scenarios, `${label}.scenarios`, targetErrors);
  duplicateIds(scenarios, `${label} scenarios`, targetErrors);
  for (const scenario of scenarios) validateHoldoutScenario(scenario, label, targetErrors);
  return scenarios;
}

function isSchemaVersionOne(record) {
  return Boolean(record) && record.schemaVersion === 1;
}

function validateHoldoutHeader(record, label, targetErrors) {
  if (!record.suiteVersion || !record.custodian || !timestamps.test(record.createdAt ?? "")) targetErrors.push(`${label} requires suiteVersion, human custodian, and createdAt.`);
  if (record.promptContentStoredInRepository !== false || containsForbiddenHoldoutContent(record)) targetErrors.push(`${label} must contain commitments only, never holdout prompts, fixtures, or expected answers.`);
}

function validateHoldoutScenario(scenario, label, targetErrors) {
  if (!allowedKinds.has(scenario.kind)) targetErrors.push(`${label}/${scenario.id} has invalid kind ${scenario.kind}.`);
  if (!sha256Pattern.test(scenario.promptSha256 ?? "") || !sha256Pattern.test(scenario.fixtureSha256 ?? "")) targetErrors.push(`${label}/${scenario.id} requires prompt and fixture SHA-256 commitments.`);
}

function validateResponseShape(response, scenario, label, targetErrors) {
  if (!response || response.schemaVersion !== 1 || response.scenarioId !== scenario.id) {
    targetErrors.push(`${label} must use schemaVersion 1 and scenarioId ${scenario.id}.`);
    return;
  }
  validateResponseCollections(response, label, targetErrors);
  validateResponseReferences(response, label, targetErrors);
  if (!allowedDecisions.has(response.decision)) targetErrors.push(`${label} has invalid decision ${response.decision}.`);
  if (response.selectedSliceId !== null && !sliceIds.has(response.selectedSliceId)) targetErrors.push(`${label} references unknown selectedSliceId ${response.selectedSliceId}.`);
  if (!response.rationale || typeof response.rationale !== "string") targetErrors.push(`${label} requires a rationale.`);
}

function validateResponseCollections(response, label, targetErrors) {
  const fields = ["detectedAntiPatternIds", "citedPaths", "proposedChangePaths", "preservedInvariantTags", "requiredGateNames", "blockerCodes"];
  for (const field of fields) requireArray(response[field], `${label}.${field}`, targetErrors);
}

function validateResponseReferences(response, label, targetErrors) {
  for (const id of response.detectedAntiPatternIds ?? []) {
    if (!antiPatternsById.has(id)) targetErrors.push(`${label} references unknown anti-pattern ${id}.`);
  }
  const paths = [...(response.citedPaths ?? []), ...(response.proposedChangePaths ?? [])];
  for (const path of paths) {
    if (!pathIsSafe(path.split(":")[0])) targetErrors.push(`${label} contains unsafe path ${path}.`);
  }
}

function scorePublicResponse(response, scenario) {
  const scoreErrors = [];
  validateResponseShape(response, scenario, `Response ${scenario.id}`, scoreErrors);
  const expected = scenario.mechanicalExpectations;
  const checks = [];
  const add = (id, pass, evidence) => {
    checks.push({ id, pass, evidence });
    if (!pass) scoreErrors.push(`${scenario.id} failed ${id}: ${evidence}`);
  };

  add("decision", response.decision === expected.decision, `expected ${expected.decision}; received ${response.decision}`);
  add("selected_slice", response.selectedSliceId === expected.selectedSliceId, `expected ${expected.selectedSliceId}; received ${response.selectedSliceId}`);
  for (const id of expected.requiredAntiPatternIds) {
    add(`anti_pattern:${id}`, response.detectedAntiPatternIds?.includes(id), `required ${id}`);
  }
  for (const path of expected.requiredCitedPaths) {
    add(`citation:${path}`, response.citedPaths?.some((actual) => pathMatches(actual, path)), `required citation ${path}`);
  }
  const proposedPaths = response.proposedChangePaths ?? [];
  add(
    "proposal_scope",
    proposalScopeMatches(proposedPaths, expected.allowedProposedChangePaths),
    `allowed paths: ${expected.allowedProposedChangePaths.join(", ") || "none"}; received: ${proposedPaths.join(", ") || "none"}`,
  );
  for (const tag of expected.requiredInvariantTags) {
    add(`invariant:${tag}`, response.preservedInvariantTags?.includes(tag), `required invariant tag ${tag}`);
  }
  for (const gate of expected.requiredGateNames) {
    add(`gate:${gate}`, response.requiredGateNames?.includes(gate), `required gate ${gate}`);
  }
  for (const blocker of expected.requiredBlockerCodes) {
    add(`blocker:${blocker}`, response.blockerCodes?.includes(blocker), `required blocker ${blocker}`);
  }
  return { ok: scoreErrors.length === 0, scenarioId: scenario.id, checks, errors: [...new Set(scoreErrors)] };
}

function proposalScopeMatches(proposedPaths, allowedPaths) {
  if (allowedPaths.length === 0) return proposedPaths.length === 0;
  return proposedPaths.length > 0 && proposedPaths.every((path) => proposedPathAllowed(path, allowedPaths));
}

function mechanicalEvaluationFor(content, scenario) {
  let response;
  try {
    response = JSON.parse(content.toString("utf8"));
  } catch {
    return {
      scorerVersion: 1,
      responseContractValid: false,
      passed: false,
      failedCheckIds: ["response_contract"],
    };
  }
  const shapeErrors = [];
  validateResponseShape(response, scenario, `Response ${scenario.id}`, shapeErrors);
  const score = scorePublicResponse(response, scenario);
  return {
    scorerVersion: 1,
    responseContractValid: shapeErrors.length === 0,
    passed: score.ok,
    failedCheckIds: [
      ...(shapeErrors.length > 0 ? ["response_contract"] : []),
      ...score.checks.filter((check) => !check.pass).map((check) => check.id),
    ],
  };
}

function validateHumanReview(review, scenario, label, targetErrors) {
  if (!review?.reviewer || review.variantIdentityVisible !== false || !timestamps.test(review.reviewedAt ?? "")) {
    targetErrors.push(`${label} requires a blind human reviewer and reviewedAt.`);
    return;
  }
  const results = requireArray(review.criterionResults, `${label}.criterionResults`, targetErrors);
  const requiredCriteria = scenario?.humanCriteria?.map((criterion) => criterion.id) ?? [];
  const resultIds = results.map((result) => result.criterionId);
  if (scenario && !sameSet(resultIds, requiredCriteria)) targetErrors.push(`${label} must score every frozen human criterion exactly once.`);
  for (const result of results) validateHumanCriterionResult(result, label, targetErrors);
  requireArray(review.blockingFailures, `${label}.blockingFailures`, targetErrors);
}

function validateHumanCriterionResult(result, label, targetErrors) {
  if (!['pass', 'fail', 'not_applicable'].includes(result.outcome) || !result.evidence) targetErrors.push(`${label}/${result.criterionId} requires an outcome and evidence.`);
}

function validateRunRecord(record, label = "Guidance run") {
  const runErrors = [];
  validateRunHeader(record, label, runErrors);
  const scenario = resolveRunScenario(record, label, runErrors);
  validateRunGuidance(record, label, runErrors);
  validateRunResponseArtifact(record, scenario, label, runErrors);
  validateHumanReview(record.humanReview, scenario, `${label}.humanReview`, runErrors);
  return { ok: runErrors.length === 0, errors: runErrors, record, scenario };
}

function validateRunHeader(record, label, runErrors) {
  validateRunIdentity(record, label, runErrors);
  validateRunExecutionContext(record, label, runErrors);
  validateRunModel(record, label, runErrors);
}

function validateRunIdentity(record, label, runErrors) {
  if (!record || record.schemaVersion !== 1 || !record.runId) runErrors.push(`${label} must use schemaVersion 1 and have a runId.`);
  if (!Number.isInteger(record.trialIndex) || record.trialIndex < 1) runErrors.push(`${label} requires a positive trialIndex.`);
  if (!['baseline', 'candidate'].includes(record.variant)) runErrors.push(`${label} has invalid variant ${record.variant}.`);
  if (!gitCommitExists(record.baseCommit)) runErrors.push(`${label} requires an existing full baseCommit.`);
  if (record.attemptNumber !== 1 || record.rerolled !== false) runErrors.push(`${label} must retain attempt one with rerolled false.`);
}

function validateRunExecutionContext(record, label, runErrors) {
  if (!record.context?.contextId || record.context.fresh !== true || record.context.implementationConversationUsed !== false) {
    runErrors.push(`${label} requires a fresh context that did not use the implementation conversation.`);
  }
  if (!timestamps.test(record.startedAt ?? "") || !timestamps.test(record.completedAt ?? "")) runErrors.push(`${label} requires UTC start and completion timestamps.`);
}

function validateRunModel(record, label, runErrors) {
  if (!record.model?.provider || !record.model?.name || !record.model?.version || typeof record.model.settings !== "object") {
    runErrors.push(`${label} requires pinned provider, model, version, and settings.`);
  }
}

function resolveRunScenario(record, label, runErrors) {
  const ref = record.scenarioRef;
  if (!validScenarioReference(ref)) {
    runErrors.push(`${label} has an invalid scenarioRef.`);
    return null;
  }
  if (ref.kind === "holdout") {
    if (!ref.suiteVersion) runErrors.push(`${label} holdout scenario requires suiteVersion.`);
    return null;
  }
  const scenario = scenariosById.get(ref.id);
  if (!scenario) {
    runErrors.push(`${label} references unknown public scenario ${ref.id}.`);
    return null;
  }
  if (ref.suiteVersion !== scenarioSet.suiteVersion) runErrors.push(`${label} uses the wrong public suite version.`);
  if (ref.scenarioSha256 !== scenarioDigest(scenario)) runErrors.push(`${label} public scenario digest does not match the frozen scenario.`);
  return scenario;
}

function validScenarioReference(ref) {
  return Boolean(ref)
    && ['public', 'holdout'].includes(ref.kind)
    && Boolean(ref.id)
    && sha256Pattern.test(ref.scenarioSha256 ?? "");
}

function validateRunGuidance(record, label, runErrors) {
  if (!gitCommitExists(record.guidance?.commit)) runErrors.push(`${label} requires an existing full guidance commit.`);
  const guidanceFiles = requireArray(record.guidance?.files, `${label}.guidance.files`, runErrors);
  if (guidanceFiles.length === 0) runErrors.push(`${label} must record at least one loaded guidance file.`);
  const guidancePaths = new Set();
  for (const file of guidanceFiles) {
    if (!pathIsSafe(file.path) || !sha256Pattern.test(file.sha256 ?? "")) {
      runErrors.push(`${label} contains an invalid guidance file record.`);
      continue;
    }
    if (guidancePaths.has(file.path)) runErrors.push(`${label} repeats guidance path ${file.path}.`);
    guidancePaths.add(file.path);
    const content = gitFileAt(record.guidance?.commit, file.path);
    if (!content) runErrors.push(`${label} cannot read ${file.path} at guidance commit.`);
    else if (sha256(content) !== file.sha256) runErrors.push(`${label} hash mismatch for ${file.path}.`);
  }
}

function validateRunResponseArtifact(record, scenario, label, runErrors) {
  if (!pathIsSafe(record.responseArtifact ?? "") || !existsSync(record.responseArtifact ?? "")) {
    runErrors.push(`${label} responseArtifact is missing or unsafe.`);
    return;
  }
  const content = readFileSync(record.responseArtifact);
  if (!sha256Pattern.test(record.responseSha256 ?? "") || sha256(content) !== record.responseSha256) {
    runErrors.push(`${label} responseSha256 does not match the artifact.`);
    return;
  }
  if (!scenario) return;
  const computed = mechanicalEvaluationFor(content, scenario);
  const recorded = record.mechanicalEvaluation;
  if (!mechanicalEvaluationMatches(recorded, computed)) runErrors.push(`${label} mechanicalEvaluation does not match the preserved first-attempt response.`);
}

function mechanicalEvaluationMatches(recorded, computed) {
  return Boolean(recorded)
    && recorded.scorerVersion === 1
    && recorded.responseContractValid === computed.responseContractValid
    && recorded.passed === computed.passed
    && sameSet(recorded.failedCheckIds, computed.failedCheckIds);
}

function validateCorrectionEntry(entry, targetErrors) {
  validateCorrectionHeader(entry, targetErrors);
  const observations = validateCorrectionObservations(entry, targetErrors);
  validateCorrectionPromotion(entry, observations, targetErrors);
}

function validateCorrectionHeader(entry, targetErrors) {
  const allowedStates = new Set(["observed", "candidate", "accepted", "rejected", "implemented"]);
  if (!allowedStates.has(entry.state) || !['critical', 'high', 'medium', 'low'].includes(entry.severity)) {
    targetErrors.push(`Correction ${entry.id} has invalid state or severity.`);
  }
}

function validateCorrectionObservations(entry, targetErrors) {
  const observations = requireArray(entry.observations, `Correction ${entry.id}.observations`, targetErrors);
  if (entry.occurrenceCount !== observations.length) targetErrors.push(`Correction ${entry.id} occurrenceCount must equal its observations length.`);
  const contexts = new Set();
  for (const observation of observations) {
    validateCorrectionObservation(entry.id, observation, targetErrors);
    if (contexts.has(observation.contextId)) targetErrors.push(`Correction ${entry.id} repeats observation context ${observation.contextId}.`);
    contexts.add(observation.contextId);
  }
  return observations;
}

function validateCorrectionObservation(entryId, observation, targetErrors) {
  const complete = observation.runId
    && observation.scenarioId
    && observation.model
    && fullCommit.test(observation.guidanceCommit ?? "")
    && observation.reviewer
    && timestamps.test(observation.observedAt ?? "")
    && observation.evidence;
  if (!complete) targetErrors.push(`Correction ${entryId} contains an incomplete observation.`);
}

function validateCorrectionPromotion(entry, observations, targetErrors) {
  if (!["accepted", "implemented"].includes(entry.state)) return;
  const recurrenceMet = observations.length >= policy.correctionPolicy.minimumIndependentOccurrencesForPromotion;
  const criticalEscalation = entry.promotionBasis === "single_critical" && ["critical", "high"].includes(entry.severity) && observations.length >= 1;
  if (!recurrenceMet && !criticalEscalation) targetErrors.push(`Correction ${entry.id} lacks recurrence or a single-critical escalation basis.`);
  if (!validCorrectionDisposition(entry)) {
    targetErrors.push(`Correction ${entry.id} lacks a valid human landing-layer disposition.`);
  }
}

function validCorrectionDisposition(entry) {
  return policy.correctionPolicy.allowedLandingLayers.includes(entry.landingLayer)
    && Boolean(entry.disposition?.decidedBy)
    && timestamps.test(entry.disposition?.decidedAt ?? "")
    && Boolean(entry.disposition?.rationale);
}

function validateComparisonRecord(record, label = "Guidance comparison") {
  const comparisonErrors = [];
  validateComparisonHeader(record, label, comparisonErrors);
  const publicIds = validateComparisonPublicScenarios(record, label, comparisonErrors);
  const holdoutScenarios = loadComparisonHoldouts(record, label, comparisonErrors);
  const runs = loadComparisonRuns(record, label, comparisonErrors);
  validateComparisonRunUniqueness(runs, label, comparisonErrors);
  const scenarioIds = [...new Set([...publicIds, ...holdoutScenarios.map((scenario) => scenario.id)])];
  const deterministicRegressions = validateComparisonCoverage(record, runs, scenarioIds, label, comparisonErrors);
  validateCandidateGuidanceBundles(runs, label, comparisonErrors);
  validateComparisonReviews(record, scenarioIds, label, comparisonErrors);
  validateComparisonDecision(record, deterministicRegressions, label, comparisonErrors);
  return { ok: comparisonErrors.length === 0, errors: comparisonErrors, record, runs, holdoutScenarios };
}

function validateComparisonHeader(record, label, comparisonErrors) {
  if (!record || record.schemaVersion !== 1 || !record.comparisonId || record.status !== "human_decided") comparisonErrors.push(`${label} must be a schemaVersion 1 human_decided record.`);
  if (!['targeted', 'milestone'].includes(record.evaluationType)) comparisonErrors.push(`${label} has invalid evaluationType.`);
  if (record.scenarioSuiteVersion !== scenarioSet.suiteVersion) comparisonErrors.push(`${label} uses the wrong public scenario suite version.`);
  validateComparisonGuidance(record, label, comparisonErrors);
}

function validateComparisonGuidance(record, label, comparisonErrors) {
  if (!gitCommitExists(record.baselineGuidance?.commit) || !gitCommitExists(record.candidateGuidance?.commit)) comparisonErrors.push(`${label} requires existing baseline and candidate guidance commits.`);
  if (!record.baselineGuidance?.label || !record.candidateGuidance?.label || record.baselineGuidance.label === record.candidateGuidance.label) comparisonErrors.push(`${label} requires distinct randomized variant labels.`);
}

function validateComparisonPublicScenarios(record, label, comparisonErrors) {
  const publicIds = requireArray(record.publicScenarioIds, `${label}.publicScenarioIds`, comparisonErrors);
  for (const id of publicIds) {
    if (!scenariosById.has(id)) comparisonErrors.push(`${label} references unknown public scenario ${id}.`);
  }
  if (!publicIds.some((id) => scenariosById.get(id)?.kind === "non_refactor_control")) comparisonErrors.push(`${label} requires a public non-refactor control scenario.`);
  return publicIds;
}

function loadComparisonHoldouts(record, label, comparisonErrors) {
  if (!pathIsSafe(record.holdoutManifest ?? "") || !existsSync(record.holdoutManifest ?? "")) {
    comparisonErrors.push(`${label} requires an existing safe holdoutManifest path.`);
    return [];
  }
  const holdoutScenarios = validateHoldoutManifest(readJson(record.holdoutManifest), `${label} holdout manifest`, comparisonErrors);
  if (holdoutScenarios.length < policy.comparisonPolicy.minimumHoldoutScenarios) comparisonErrors.push(`${label} has too few holdout scenarios.`);
  return holdoutScenarios;
}

function loadComparisonRuns(record, label, comparisonErrors) {
  const runPaths = requireArray(record.runRecords, `${label}.runRecords`, comparisonErrors);
  const runs = [];
  for (const path of runPaths) {
    if (!pathIsSafe(path) || !existsSync(path)) {
      comparisonErrors.push(`${label} references missing or unsafe run record ${path}.`);
      continue;
    }
    const validated = validateRunRecord(readJson(path), `${label} run ${path}`);
    comparisonErrors.push(...validated.errors);
    runs.push(validated.record);
  }
  return runs;
}

function validateComparisonRunUniqueness(runs, label, comparisonErrors) {
  const runIds = runs.map((run) => run.runId);
  if (new Set(runIds).size !== runIds.length) comparisonErrors.push(`${label} repeats a runId.`);
  const contextIds = runs.map((run) => run.context?.contextId);
  if (new Set(contextIds).size !== contextIds.length) comparisonErrors.push(`${label} reuses an agent context.`);
}

function validateComparisonCoverage(record, runs, scenarioIds, label, comparisonErrors) {
  const minimumAttempts = policy.comparisonPolicy.minimumIndependentAttemptsPerVariant;
  const deterministicRegressions = [];
  for (const scenarioId of scenarioIds) {
    for (const variant of ['baseline', 'candidate']) {
      validateVariantCoverage(record, runs, scenarioId, variant, minimumAttempts, label, comparisonErrors);
    }
    for (let trialIndex = 1; trialIndex <= minimumAttempts; trialIndex += 1) {
      validateTrialPair(runs, scenarioId, trialIndex, label, comparisonErrors, deterministicRegressions);
    }
  }
  return deterministicRegressions;
}

function validateVariantCoverage(record, runs, scenarioId, variant, minimumAttempts, label, comparisonErrors) {
  const selected = runs.filter((run) => run.scenarioRef?.id === scenarioId && run.variant === variant);
  if (selected.length < minimumAttempts) comparisonErrors.push(`${label} requires ${minimumAttempts} ${variant} attempts for ${scenarioId}.`);
  const expectedCommit = variant === "baseline" ? record.baselineGuidance?.commit : record.candidateGuidance?.commit;
  for (const run of selected) {
    if (run.guidance?.commit !== expectedCommit) comparisonErrors.push(`${label}/${run.runId} uses the wrong ${variant} guidance commit.`);
  }
}

function validateTrialPair(runs, scenarioId, trialIndex, label, comparisonErrors, deterministicRegressions) {
  const baseline = runs.find((run) => run.scenarioRef?.id === scenarioId && run.variant === "baseline" && run.trialIndex === trialIndex);
  const candidate = runs.find((run) => run.scenarioRef?.id === scenarioId && run.variant === "candidate" && run.trialIndex === trialIndex);
  if (!baseline || !candidate) return;
  validateTrialConsistency(baseline, candidate, scenarioId, trialIndex, label, comparisonErrors);
  collectDeterministicRegressions(baseline, candidate, scenarioId, trialIndex, deterministicRegressions);
}

function validateTrialConsistency(baseline, candidate, scenarioId, trialIndex, label, comparisonErrors) {
  if (baseline.baseCommit !== candidate.baseCommit) comparisonErrors.push(`${label}/${scenarioId}/trial-${trialIndex} base commits differ.`);
  if (baseline.scenarioRef.scenarioSha256 !== candidate.scenarioRef.scenarioSha256) comparisonErrors.push(`${label}/${scenarioId}/trial-${trialIndex} scenario digests differ.`);
  if (canonicalJson(baseline.model) !== canonicalJson(candidate.model)) comparisonErrors.push(`${label}/${scenarioId}/trial-${trialIndex} model settings differ.`);
}

function collectDeterministicRegressions(baseline, candidate, scenarioId, trialIndex, deterministicRegressions) {
  if (baseline.scenarioRef.kind !== "public" || candidate.scenarioRef.kind !== "public") return;
  const baselineFailures = new Set(baseline.mechanicalEvaluation?.failedCheckIds ?? []);
  for (const checkId of candidate.mechanicalEvaluation?.failedCheckIds ?? []) {
    if (!baselineFailures.has(checkId)) deterministicRegressions.push(`${scenarioId}/trial-${trialIndex}/${checkId}`);
  }
}

function validateCandidateGuidanceBundles(runs, label, comparisonErrors) {
  const candidateRuns = runs.filter((run) => run.variant === "candidate");
  for (const run of candidateRuns) {
    if (!sameSet(run.guidance?.files?.map((file) => file.path), policy.guidanceBundlePaths)) {
      comparisonErrors.push(`${label}/${run.runId} candidate does not load the complete declared guidance bundle.`);
    }
  }
}

function validateComparisonReviews(record, scenarioIds, label, comparisonErrors) {
  const reviews = requireArray(record.blindReviews, `${label}.blindReviews`, comparisonErrors);
  if (new Set(reviews.map((review) => review.reviewer)).size < policy.comparisonPolicy.minimumBlindHumanReviewers) comparisonErrors.push(`${label} requires at least ${policy.comparisonPolicy.minimumBlindHumanReviewers} distinct blind human reviewers.`);
  if (new Set(reviews.map((review) => review.contextId)).size !== reviews.length) comparisonErrors.push(`${label} blind reviews must use distinct contexts.`);
  for (const review of reviews) {
    validateComparisonReview(review, scenarioIds, label, comparisonErrors);
  }
}

function validateComparisonReview(review, scenarioIds, label, comparisonErrors) {
  validateReviewIdentity(review, label, comparisonErrors);
  const reviewedIds = new Set((review.scenarioResults ?? []).map((result) => result.scenarioId));
  for (const id of scenarioIds) {
    if (!reviewedIds.has(id)) comparisonErrors.push(`${label}/${review.reviewer} did not score ${id}.`);
  }
  for (const result of review.scenarioResults ?? []) validateComparisonReviewResult(review, result, label, comparisonErrors);
}

function validateReviewIdentity(review, label, comparisonErrors) {
  if (!review.reviewer || !review.contextId || review.variantIdentityVisible !== false || !timestamps.test(review.completedAt ?? "")) comparisonErrors.push(`${label} contains an incomplete or unblinded review.`);
}

function validateComparisonReviewResult(review, result, label, comparisonErrors) {
  const complete = ['A', 'B', 'tie', 'neither'].includes(result.preferredLabel)
    && Number.isInteger(result.criticalRegressions)
    && Number.isInteger(result.highRegressions)
    && result.rationale;
  if (!complete) comparisonErrors.push(`${label}/${review.reviewer}/${result.scenarioId} has an incomplete result.`);
}

function validateComparisonDecision(record, deterministicRegressions, label, comparisonErrors) {
  if (!policy.comparisonPolicy.allowedDecisions.includes(record.decision) || !record.decidedBy || !timestamps.test(record.decidedAt ?? "") || !record.rationale) comparisonErrors.push(`${label} requires a valid human decision and rationale.`);
  if (!Array.isArray(record.aggregate?.knownLimitations) || record.aggregate.knownLimitations.length === 0) comparisonErrors.push(`${label} must record known limitations.`);
  if (record.decision !== "keep") return;
  validateKeepDecision(record, deterministicRegressions, label, comparisonErrors);
}

function validateKeepDecision(record, deterministicRegressions, label, comparisonErrors) {
  if (record.aggregate?.criticalRegressions !== 0 || record.aggregate?.highRegressions !== 0) comparisonErrors.push(`${label} cannot keep guidance with critical or high regressions.`);
  if (deterministicRegressions.length > 0) comparisonErrors.push(`${label} cannot keep guidance with new deterministic public-suite failures: ${deterministicRegressions.join(", ")}.`);
  if (record.aggregate?.materialTargetedImprovementObserved !== true) comparisonErrors.push(`${label} cannot keep guidance without a material targeted improvement.`);
}

function validateStaticSetup() {
  validatePolicySetup();
  const coverage = validateScenarioSetup();
  validateScenarioCoverageCompleteness(coverage);
  validateAntiPatternSetup();
  validateCorrectionLedgerSetup();
  validateHoldoutExampleSetup();
  validateGuidanceScriptSetup();
  const baselineItem = validateGuidanceBaseline();
  validateSliceGuidanceBindings(baselineItem);
}

function validatePolicySetup() {
  validatePolicyIdentity();
  validatePolicyRunRules();
  validatePolicyComparisonRules();
  validatePolicyCorrectionRules();
  validateGuidanceBundlePaths();
}

function validatePolicyIdentity() {
  if (policy.schemaVersion !== 1 || policy.status !== "setup_draft") errors.push("Refactor guidance evaluation policy must be a schemaVersion 1 setup_draft.");
}

function validatePolicyRunRules() {
  if (policy.runPolicy?.firstAttemptOnly !== true || policy.runPolicy?.rerollsForbidden !== true || policy.runPolicy?.freshContextRequired !== true) errors.push("Guidance run policy must require fresh first attempts without rerolls.");
}

function validatePolicyComparisonRules() {
  if ((policy.comparisonPolicy?.minimumIndependentAttemptsPerVariant ?? 0) < 3 || (policy.comparisonPolicy?.minimumBlindHumanReviewers ?? 0) < 2) errors.push("Guidance comparison policy requires at least three attempts per variant and two blind human reviewers.");
  if (policy.comparisonPolicy?.maximumCriticalRegressions !== 0 || policy.comparisonPolicy?.maximumHighRegressions !== 0) errors.push("Guidance adoption must tolerate zero critical and high regressions.");
}

function validatePolicyCorrectionRules() {
  if (policy.correctionPolicy?.automaticPromotionForbidden !== true || policy.correctionPolicy?.humanDispositionRequired !== true) errors.push("Corrections must never promote automatically or without human disposition.");
}

function validateGuidanceBundlePaths() {
  for (const path of policy.guidanceBundlePaths ?? []) {
    if (!existsSync(path)) errors.push(`Guidance bundle references missing path ${path}.`);
  }
}

function validateScenarioSetup() {
  if (scenarioSet.schemaVersion !== 1 || !scenarioSet.suiteVersion || !Array.isArray(scenarioSet.scenarios)) errors.push("Public refactor eval scenarios must define schemaVersion 1 and a suite version.");
  duplicateIds(scenarioSet.scenarios, "Public refactor eval scenarios");
  const observedKinds = new Set();
  const coveredSlices = new Set();
  for (const scenario of scenarioSet.scenarios ?? []) {
    validateScenarioSetupEntry(scenario, observedKinds, coveredSlices);
  }
  return { observedKinds, coveredSlices };
}

function validateScenarioSetupEntry(scenario, observedKinds, coveredSlices) {
  const label = `Scenario ${scenario.id}`;
  if (!allowedKinds.has(scenario.kind)) errors.push(`${label} has invalid kind ${scenario.kind}.`);
  observedKinds.add(scenario.kind);
  if (!scenario.fixedPrompt || typeof scenario.fixedInputs !== "object") errors.push(`${label} requires a fixed prompt and inputs.`);
  const ids = requireArray(scenario.sliceIds, `${label}.sliceIds`, errors);
  for (const id of ids) validateScenarioSlice(id, label, coveredSlices);
  validateScenarioExpectations(scenario.mechanicalExpectations, label);
  validateScenarioCriteria(scenario.humanCriteria, label);
  if (scenario.humanValidated !== true) warnings.push(`${label} awaits human validation.`);
}

function validateScenarioSlice(id, label, coveredSlices) {
  if (!sliceIds.has(id)) errors.push(`${label} references unknown slice ${id}.`);
  coveredSlices.add(id);
}

function validateScenarioExpectations(expected, label) {
  if (!expected || !allowedDecisions.has(expected.decision)) errors.push(`${label} has invalid mechanical decision.`);
  if (expected?.selectedSliceId !== null && !sliceIds.has(expected?.selectedSliceId)) errors.push(`${label} references an unknown expected slice.`);
  validateExpectedAntiPatterns(expected, label);
  validateExpectedPaths(expected, label);
  validateExpectedGates(expected, label);
}

function validateExpectedAntiPatterns(expected, label) {
  for (const id of expected?.requiredAntiPatternIds ?? []) {
    if (!antiPatternsById.has(id)) errors.push(`${label} references unknown anti-pattern ${id}.`);
  }
}

function validateExpectedPaths(expected, label) {
  for (const path of expected?.requiredCitedPaths ?? []) {
    if (!existsSync(path)) errors.push(`${label} requires missing citation path ${path}.`);
  }
  for (const path of expected?.allowedProposedChangePaths ?? []) {
    if (!pathIsSafe(path)) errors.push(`${label} has unsafe allowed proposal path ${path}.`);
  }
}

function validateExpectedGates(expected, label) {
  for (const gate of expected?.requiredGateNames ?? []) {
    if (!manifest.scripts?.[gate]) errors.push(`${label} references missing package script ${gate}.`);
  }
}

function validateScenarioCriteria(value, label) {
  const criteria = requireArray(value, `${label}.humanCriteria`, errors);
  duplicateIds(criteria, `${label} human criteria`);
  for (const criterion of criteria) {
    if (!['critical', 'high', 'medium', 'low'].includes(criterion.criticality) || !criterion.rubric) errors.push(`${label}/${criterion.id} has an invalid human rubric.`);
  }
}

function validateScenarioCoverageCompleteness({ observedKinds, coveredSlices }) {
  for (const kind of allowedKinds) if (!observedKinds.has(kind)) errors.push(`Public suite lacks scenario kind ${kind}.`);
  for (const id of sliceIds) if (!coveredSlices.has(id)) errors.push(`Public suite does not cover slice ${id}.`);
}

function validateAntiPatternSetup() {
  if (antiPatternSet.schemaVersion !== 1 || !Array.isArray(antiPatternSet.antiPatterns)) errors.push("Refactor anti-pattern catalog must use schemaVersion 1.");
  duplicateIds(antiPatternSet.antiPatterns, "Refactor anti-pattern catalog");
  for (const item of antiPatternSet.antiPatterns ?? []) validateAntiPatternSetupEntry(item);
}

function validateAntiPatternSetupEntry(item) {
  if (!antiPatternEntryComplete(item)) errors.push(`Anti-pattern ${item.id} is incomplete.`);
  for (const id of item.sliceIds ?? []) {
    if (!sliceIds.has(id)) errors.push(`Anti-pattern ${item.id} references unknown slice ${id}.`);
  }
  if (item.humanValidated !== true) warnings.push(`Anti-pattern ${item.id} awaits human validation.`);
}

function antiPatternEntryComplete(item) {
  return Boolean(item.name)
    && Boolean(item.description)
    && Array.isArray(item.observableIndicators)
    && item.observableIndicators.length >= 2
    && Boolean(item.requiredResponse)
    && ['guidance', 'machine_control', 'mixed'].includes(item.landingLayer);
}

function validateCorrectionLedgerSetup() {
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries) || ledger.policy?.automaticPromotionForbidden !== true) errors.push("Refactor correction ledger must use schemaVersion 1 and prohibit automatic promotion.");
  duplicateIds(ledger.entries, "Refactor correction ledger");
  for (const entry of ledger.entries ?? []) validateCorrectionEntry(entry, errors);
}

function validateHoldoutExampleSetup() {
  const holdoutExample = readJson(holdoutExamplePath);
  if (containsForbiddenHoldoutContent(holdoutExample) || holdoutExample.promptContentStoredInRepository !== false) errors.push("Holdout manifest example must contain commitments only.");
  if ((holdoutExample.scenarios ?? []).length < policy.comparisonPolicy.minimumHoldoutScenarios) errors.push("Holdout manifest example must demonstrate the minimum scenario count.");
}

function validateGuidanceScriptSetup() {
  if (!manifest.scripts?.["check:refactor-guidance"]?.includes("scripts/refactor-guidance-eval.mjs")) errors.push("package.json must define check:refactor-guidance.");
  if (!manifest.scripts?.["check:refactor-setup"]?.includes("npm run check:refactor-guidance")) errors.push("check:refactor-setup must run check:refactor-guidance.");
}

function validateGuidanceBaseline() {
  const baselineItem = (evidenceMatrix.globalItems ?? []).find((item) => item.id === "evaluated_refactor_guidance_baseline");
  if (!baselineItem) errors.push("Evidence matrix must define evaluated_refactor_guidance_baseline.");
  else if (baselineItem.status === "satisfied") {
    if (!pathIsSafe(baselineItem.adoptionRecord ?? "") || !existsSync(baselineItem.adoptionRecord ?? "")) errors.push("Satisfied evaluated_refactor_guidance_baseline requires an existing adoptionRecord.");
    else {
      const adoption = validateComparisonRecord(readJson(baselineItem.adoptionRecord), "Adopted guidance comparison");
      errors.push(...adoption.errors);
      if (adoption.record?.decision !== "keep") errors.push("Adopted guidance comparison must have decision keep.");
    }
  } else warnings.push("The refactor guidance baseline has not yet passed its initial matched public and holdout comparison.");
  return baselineItem;
}

function validateSliceGuidanceBindings(baselineItem) {
  for (const slice of registry.slices ?? []) {
    validateSliceGuidanceBinding(slice, baselineItem);
  }
}

function validateSliceGuidanceBinding(slice, baselineItem) {
  if (slice.status === "not_started") return;
  if (!slice.assuranceRecord || !existsSync(slice.assuranceRecord)) return;
  const record = readJson(slice.assuranceRecord);
  const binding = record.guidanceEvaluation;
  if (!guidanceBindingComplete(binding)) {
    errors.push(`${slice.id} assurance record lacks an exact adopted guidance evaluation binding.`);
    return;
  }
  validateGuidanceBindingReferences(slice, binding, baselineItem);
}

function guidanceBindingComplete(binding) {
  return Boolean(binding?.adoptionRecord)
    && Boolean(binding.guidanceCommit)
    && Boolean(binding.scenarioSuiteVersion)
    && Boolean(binding.acknowledgedBy)
    && timestamps.test(binding.acknowledgedAt ?? "");
}

function validateGuidanceBindingReferences(slice, binding, baselineItem) {
  if (baselineItem?.adoptionRecord && binding.adoptionRecord !== baselineItem.adoptionRecord) errors.push(`${slice.id} assurance record does not reference the adopted guidance comparison.`);
  if (binding.scenarioSuiteVersion !== scenarioSet.suiteVersion) errors.push(`${slice.id} assurance record uses a stale guidance scenario suite.`);
}

validateStaticSetup();

const fixtureMode = process.argv.includes("--fixtures");
const scoreArg = process.argv.find((argument) => argument.startsWith("--score-response="));
const runArg = process.argv.find((argument) => argument.startsWith("--validate-run="));
const comparisonArg = process.argv.find((argument) => argument.startsWith("--validate-comparison="));
const digestsMode = process.argv.includes("--print-scenario-digests");

if (fixtureMode) {
  assert.equal(errors.length, 0, `Static guidance-eval fixtures require valid setup: ${errors.join(" ")}`);
  const scenario = scenariosById.get("setup-only-general-cleanup");
  const response = {
    schemaVersion: 1,
    scenarioId: scenario.id,
    decision: scenario.mechanicalExpectations.decision,
    selectedSliceId: null,
    detectedAntiPatternIds: [...scenario.mechanicalExpectations.requiredAntiPatternIds],
    citedPaths: [...scenario.mechanicalExpectations.requiredCitedPaths],
    proposedChangePaths: [],
    preservedInvariantTags: [...scenario.mechanicalExpectations.requiredInvariantTags],
    requiredGateNames: [...scenario.mechanicalExpectations.requiredGateNames],
    blockerCodes: [...scenario.mechanicalExpectations.requiredBlockerCodes],
    rationale: "Fixture response",
  };
  assert.equal(scorePublicResponse(response, scenario).ok, true);
  assert.equal(scorePublicResponse({ ...response, decision: "propose_bounded_change" }, scenario).ok, false);
  const correctionErrors = [];
  validateCorrectionEntry({
    id: "fixture-correction",
    state: "accepted",
    severity: "medium",
    occurrenceCount: 1,
    observations: [{ runId: "run", scenarioId: "scenario", model: "model", guidanceCommit: "a".repeat(40), reviewer: "reviewer", contextId: "one", observedAt: "2026-09-01T00:00:00.000Z", evidence: "fixture" }],
    promotionBasis: "recurrence",
    landingLayer: "guidance",
    disposition: { decidedBy: "human", decidedAt: "2026-09-01T00:00:00.000Z", rationale: "fixture" },
  }, correctionErrors);
  assert.ok(correctionErrors.length > 0, "A one-off medium correction must not be promoted.");
  assert.equal(containsForbiddenHoldoutContent(readJson(holdoutExamplePath)), false);
  mkdirSync("outputs", { recursive: true });
  const fixtureDirectory = mkdtempSync("outputs/refactor-guidance-eval-");
  try {
    const responsePath = `${fixtureDirectory}/response.json`;
    const poorResponse = { ...response, decision: "propose_bounded_change" };
    const responseContent = `${JSON.stringify(poorResponse, null, 2)}\n`;
    writeFileSync(responsePath, responseContent);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const guidanceContent = gitFileAt(head, "AGENTS.md");
    const run = {
      schemaVersion: 1,
      runId: "fixture-run",
      trialIndex: 1,
      variant: "baseline",
      scenarioRef: { kind: "public", id: scenario.id, suiteVersion: scenarioSet.suiteVersion, scenarioSha256: scenarioDigest(scenario) },
      baseCommit: head,
      guidance: { commit: head, files: [{ path: "AGENTS.md", sha256: sha256(guidanceContent) }] },
      model: { provider: "fixture", name: "fixture", version: "1", settings: {} },
      context: { contextId: "fixture-context", fresh: true, implementationConversationUsed: false },
      attemptNumber: 1,
      rerolled: false,
      responseArtifact: responsePath,
      responseSha256: sha256(responseContent),
      mechanicalEvaluation: mechanicalEvaluationFor(Buffer.from(responseContent), scenario),
      humanReview: {
        reviewer: "Fixture Human",
        variantIdentityVisible: false,
        criterionResults: scenario.humanCriteria.map((criterion) => ({ criterionId: criterion.id, outcome: "fail", evidence: "Fixture failure" })),
        blockingFailures: ["Fixture failure"],
        reviewedAt: "2026-09-01T00:00:00.000Z",
      },
      startedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-01T00:01:00.000Z",
    };
    assert.equal(validateRunRecord(run).ok, true, "An honestly recorded poor first attempt must remain a valid run.");
    assert.equal(validateRunRecord({ ...run, rerolled: true }).ok, false, "A rerolled run must be invalid.");
    assert.equal(validateComparisonRecord({ schemaVersion: 1 }).ok, false, "An incomplete comparison must be invalid.");
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok: true, fixtures: 7 }, null, 2));
  process.exit(0);
}

if (scoreArg) {
  const path = scoreArg.slice("--score-response=".length);
  if (!pathIsSafe(path) || !existsSync(path)) errors.push(`Response path is missing or unsafe: ${path}.`);
  else {
    const response = readJson(path);
    const scenario = scenariosById.get(response.scenarioId);
    if (!scenario) errors.push(`Response references unknown public scenario ${response.scenarioId}.`);
    else {
      const result = scorePublicResponse(response, scenario);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok || errors.length > 0) process.exit(1);
      process.exit(0);
    }
  }
}

if (runArg) {
  const path = runArg.slice("--validate-run=".length);
  if (!pathIsSafe(path) || !existsSync(path)) errors.push(`Run record path is missing or unsafe: ${path}.`);
  else {
    const result = validateRunRecord(readJson(path));
    console.log(JSON.stringify({ ok: result.ok, runId: result.record?.runId ?? null, errors: result.errors }, null, 2));
    if (!result.ok || errors.length > 0) process.exit(1);
    process.exit(0);
  }
}

if (comparisonArg) {
  const path = comparisonArg.slice("--validate-comparison=".length);
  if (!pathIsSafe(path) || !existsSync(path)) errors.push(`Comparison record path is missing or unsafe: ${path}.`);
  else {
    const result = validateComparisonRecord(readJson(path));
    console.log(JSON.stringify({ ok: result.ok, comparisonId: result.record?.comparisonId ?? null, decision: result.record?.decision ?? null, runs: result.runs.length, errors: result.errors }, null, 2));
    if (!result.ok || errors.length > 0) process.exit(1);
    process.exit(0);
  }
}

if (digestsMode) {
  console.log(JSON.stringify(Object.fromEntries((scenarioSet.scenarios ?? []).map((scenario) => [scenario.id, scenarioDigest(scenario)])), null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
}

const result = {
  ok: errors.length === 0,
  mode: registry.mode,
  status: policy.status,
  suiteVersion: scenarioSet.suiteVersion,
  claimBoundary: policy.claimBoundary,
  summary: {
    publicScenarios: scenarioSet.scenarios?.length ?? 0,
    antiPatterns: antiPatternSet.antiPatterns?.length ?? 0,
    correctionEntries: ledger.entries?.length ?? 0,
    humanValidatedScenarios: (scenarioSet.scenarios ?? []).filter((scenario) => scenario.humanValidated === true).length,
    humanValidatedAntiPatterns: (antiPatternSet.antiPatterns ?? []).filter((item) => item.humanValidated === true).length,
    startedSlices: (registry.slices ?? []).filter((slice) => slice.status !== "not_started").length,
  },
  errors,
  warnings,
  interpretation: "The guidance harness is setup infrastructure. It measures bounded first-attempt decision behavior and cannot certify application correctness or authorize a refactor slice.",
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

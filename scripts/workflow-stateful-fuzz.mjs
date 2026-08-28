#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const workflow = loadTypeScriptModule(root, "lib/pipeline/referral-workflow.ts");
const operatingModel = loadTypeScriptModule(root, "lib/reliability/referral-operating-model.ts");
const seed = 0x46534D31;
const random = mulberry32(seed);
const traces = 2_000;
const stepsPerTrace = 60;
const checks = [];
const failures = [];
let attemptedTransitions = 0;
let acceptedTransitions = 0;
let blockedTransitions = 0;
let acceptedOutcomes = 0;
let declinedOutcomes = 0;
const allowedTargets = {
  New: ["Packet Needed", "Declined"],
  "Packet Needed": ["Packet Review", "Declined"],
  "Packet Review": ["Assessment", "Declined"],
  Assessment: ["Community Review", "Declined"],
  "Community Review": ["Accepted / Admitted", "Declined"],
  "Accepted / Admitted": [],
  Declined: [],
};

for (let trace = 0; trace < traces; trace += 1) {
  const state = initialState(trace);
  let previousAge = 0;

  for (let step = 0; step < stepsPerTrace; step += 1) {
    applyRandomPreparation(state);
    const beforeStage = state.stage;
    const beforeAuditCount = state.audit.length;
    const target = workflow.boardStages[integer(0, workflow.boardStages.length)];
    const referral = toReferral(state);
    const context = toContext(state);
    const actualCodes = workflow
      .getReferralTransitionBlockers(referral, target, context)
      .map((item) => item.code)
      .sort();
    const expectedCodes = expectedBlockerCodes(state, target).sort();
    attemptedTransitions += 1;

    if (!sameValues(actualCodes, expectedCodes)) {
      recordFailure(trace, step, "transition_oracle_mismatch", {
        from: state.stage,
        target,
        actualCodes,
        expectedCodes,
      });
      continue;
    }

    if (actualCodes.length === 0 && target !== state.stage) {
      state.stage = target;
      state.accepted = target === "Accepted / Admitted";
      state.declined = target === "Declined";
      if (state.accepted) acceptedOutcomes += 1;
      if (state.declined) declinedOutcomes += 1;
      state.audit.push(`${trace}:${step}:${beforeStage}->${target}`);
      acceptedTransitions += 1;
    } else if (actualCodes.length > 0) {
      blockedTransitions += 1;
    }

    invariant(
      state.audit.length === beforeAuditCount + (actualCodes.length === 0 && target !== beforeStage ? 1 : 0),
      trace,
      step,
      "transition_audit_exactly_once",
    );
    invariant(
      !isTerminal(beforeStage) || state.stage === beforeStage,
      trace,
      step,
      "terminal_state_is_immutable",
    );
    invariant(
      !state.accepted || !state.declined,
      trace,
      step,
      "terminal_outcomes_are_exclusive",
    );
    invariant(
      state.stage !== "Accepted / Admitted" || (state.decision === "accepted" && state.moveInReady),
      trace,
      step,
      "acceptance_requires_decision_and_move_in_readiness",
    );
    invariant(
      state.stage !== "Declined" || (state.decision === "declined" && state.declineReason),
      trace,
      step,
      "decline_requires_decision_and_reason",
    );

    state.clockMs += integer(0, 18) * 60 * 60 * 1_000;
    const freshness = operatingModel.getReferralFreshness(toOperatingRecord(state), new Date(state.clockMs));
    invariant(freshness.age_hours >= previousAge, trace, step, "aging_clock_is_monotonic");
    previousAge = freshness.age_hours;
  }
}

for (const priority of ["urgent", "high", "standard", "low"]) {
  const threshold = { urgent: 12, high: 24, standard: 48, low: 96 }[priority];
  const receivedAt = "2026-03-08T09:30:00.000Z";
  const record = {
    ...toOperatingRecord(initialState(9_000)),
    priority,
    received_at: receivedAt,
    updated_at: receivedAt,
  };
  const atBoundary = operatingModel.getReferralFreshness(record, new Date(Date.parse(receivedAt) + threshold * 36e5));
  const pastBoundary = operatingModel.getReferralFreshness(record, new Date(Date.parse(receivedAt) + (threshold + 0.1) * 36e5));
  checks.push({
    name: `${priority} SLA changes only after its threshold`,
    ok: atBoundary.is_stale === false && pastBoundary.is_stale === true,
    cases: 2,
  });
}

const future = toOperatingRecord(initialState(9_001));
future.updated_at = "2026-11-01T09:00:00.000Z";
checks.push({
  name: "future and DST-adjacent timestamps never create negative age",
  ok: operatingModel.getReferralFreshness(future, new Date("2026-11-01T08:00:00.000Z")).age_hours === 0,
  cases: 1,
});

checks.unshift(
  {
    name: "stateful transition traces match the independent workflow oracle",
    ok: failures.filter((item) => item.invariant === "transition_oracle_mismatch").length === 0,
    cases: attemptedTransitions,
  },
  {
    name: "workflow invariants survive randomized histories",
    ok: failures.filter((item) => item.invariant !== "transition_oracle_mismatch").length === 0,
    cases: attemptedTransitions * 5,
  },
  {
    name: "fuzzing reaches accepted, declined, and blocked paths",
    ok: acceptedTransitions > 0 && blockedTransitions > 0 && acceptedOutcomes > 0 && declinedOutcomes > 0,
    cases: attemptedTransitions,
  },
);

const failedChecks = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failedChecks.length === 0,
  seed: `0x${seed.toString(16).toUpperCase()}`,
  traces,
  steps_per_trace: stepsPerTrace,
  generated_cases: checks.reduce((sum, item) => sum + item.cases, 0),
  transitions: {
    attempted: attemptedTransitions,
    accepted: acceptedTransitions,
    blocked: blockedTransitions,
    accepted_outcomes: acceptedOutcomes,
    declined_outcomes: declinedOutcomes,
  },
  checks,
  failures: failures.slice(0, 10),
  note: "All histories and identifiers are synthetic; only aggregate outcomes and bounded failure diagnostics are emitted.",
}, null, 2));
if (failedChecks.length > 0) process.exit(1);

function initialState(trace) {
  const receivedMs = Date.parse("2026-01-01T08:00:00.000Z") + trace * 60_000;
  return {
    stage: "New",
    ownerAssigned: false,
    packetAttached: false,
    packetReviewed: false,
    assessmentComplete: false,
    decision: null,
    declineReason: false,
    moveInReady: false,
    accepted: false,
    declined: false,
    audit: [],
    receivedMs,
    clockMs: receivedMs,
  };
}

function applyRandomPreparation(state) {
  if (isTerminal(state.stage)) return;
  switch (integer(0, 8)) {
    case 0:
      state.ownerAssigned = true;
      break;
    case 1:
      state.packetAttached = true;
      break;
    case 2:
      if (state.packetAttached) state.packetReviewed = true;
      break;
    case 3:
      state.assessmentComplete = true;
      break;
    case 4:
      state.decision = "accepted";
      state.declineReason = false;
      break;
    case 5:
      state.decision = "declined";
      break;
    case 6:
      if (state.decision === "declined") state.declineReason = true;
      break;
    case 7:
      state.moveInReady = true;
      break;
  }
}

function expectedBlockerCodes(state, target) {
  if (target === state.stage) return [];
  if (!allowedTargets[state.stage].includes(target)) return ["stage_sequence"];
  if (target === "Packet Needed" && !state.ownerAssigned) return ["owner_required"];
  if (target === "Packet Review" && !state.packetAttached) return ["initial_packet_required"];
  if (target === "Assessment" && !state.packetReviewed) return ["packet_review_required"];
  if (target === "Community Review" && !state.assessmentComplete) return ["assessment_required"];
  if (target === "Accepted / Admitted") {
    const blockers = [];
    if (state.decision !== "accepted") blockers.push("admission_decision_required");
    if (!state.moveInReady) blockers.push("requirement:signed_admission_agreement");
    return blockers;
  }
  if (target === "Declined") {
    if (state.decision !== "declined") return ["decline_decision_required"];
    if (!state.declineReason) return ["decline_reason_required"];
  }
  return [];
}

function toReferral(state) {
  return {
    id: 1,
    name: "Synthetic Person",
    date: "2026-01-01",
    stage: state.stage,
    community: "San Pablo",
    source: "Synthetic",
    priority: "standard",
    documentName: state.packetAttached ? "synthetic.pdf" : "",
    documentStatus: state.packetAttached ? "Ready" : "Missing",
    packetStatus: state.packetReviewed ? "reviewed" : state.packetAttached ? "processing" : undefined,
    owner: state.ownerAssigned ? "Synthetic Assessor" : "Unassigned",
    note: "",
    createdAt: new Date(state.receivedMs).toISOString(),
    admissionDecision: state.decision ? {
      outcome: state.decision,
      reasonNote: state.declineReason ? "Synthetic documented reason" : "",
    } : undefined,
    requirements: [moveInRequirement(state)],
  };
}

function toContext(state) {
  return {
    assessmentComplete: state.assessmentComplete,
    decision: state.decision ? {
      outcome: state.decision,
      reasonNote: state.declineReason ? "Synthetic documented reason" : "",
    } : null,
    requirements: [moveInRequirement(state)],
  };
}

function moveInRequirement(state) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    type: "signed_admission_agreement",
    label: "Signed admission agreement",
    status: state.moveInReady ? "reviewed" : "needed",
    requiredFor: "move_in",
    owner: "Synthetic Assessor",
    dueAt: "2026-02-01T08:00:00.000Z",
    nextStep: "Synthetic next step",
    blocker: true,
    updatedAt: "2026-01-01T08:00:00.000Z",
  };
}

function toOperatingRecord(state) {
  return {
    referral_id: "synthetic-referral",
    full_name: "Synthetic Person",
    date_of_birth: "1980-01-01",
    community: "San Pablo",
    source: "Synthetic",
    status: workflow.stageToWorkflowStatus[state.stage],
    priority: "standard",
    received_at: new Date(state.receivedMs).toISOString(),
    updated_at: new Date(state.receivedMs).toISOString(),
  };
}

function invariant(condition, trace, step, name) {
  if (!condition) recordFailure(trace, step, name);
}

function recordFailure(trace, step, invariant, detail = undefined) {
  failures.push({ trace, step, invariant, ...(detail ? { detail } : {}) });
}

function isTerminal(stage) {
  return stage === "Accepted / Admitted" || stage === "Declined";
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function integer(minimum, maximumExclusive) {
  return minimum + Math.floor(random() * Math.max(1, maximumExclusive - minimum));
}

function mulberry32(value) {
  return () => {
    value |= 0;
    value = value + 0x6D2B79F5 | 0;
    let output = Math.imul(value ^ value >>> 15, 1 | value);
    output = output + Math.imul(output ^ output >>> 7, 61 | output) ^ output;
    return ((output ^ output >>> 14) >>> 0) / 4294967296;
  };
}

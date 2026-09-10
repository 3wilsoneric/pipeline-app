export const historicalChaosPolicyVersion = "pipeline-chaos-lab-v1";

const defaultConcurrency = Object.freeze({
  identities: 20,
  referrals: 20,
  files: 8,
  workflow: 12,
  reads: 40,
  browsers: 6,
});

export function buildHistoricalChaosPlan(historicalPlan, options = {}) {
  validateHistoricalPlanEnvelope(historicalPlan);
  const phase = options.phase === "full" ? "full" : "files";
  const cases = historicalPlan.cases.map((item) => ({
    case_id: String(item.case_id),
    sequence: Number(item.sequence),
    behavior: String(item.behavior),
    material_count: Array.isArray(item.materials) ? item.materials.length : 0,
  }));
  const fullCaseIds = cases.map((item) => item.case_id);
  const staleWriteCaseIds = phase === "full" ? boundedCohort(cases, 10) : [];
  const decisionRaceCaseIds = phase === "full" ? boundedCohort(cases, 20) : [];
  const handoffRecoveryCaseIds = phase === "full" ? boundedCohort(cases, 25) : [];
  const interruptionCaseIds = phase === "full"
    ? cases.filter((item) => ["interrupted_resume", "save_reopen"].includes(item.behavior)).map((item) => item.case_id)
    : [];
  const rescheduleCaseIds = phase === "full"
    ? cases.filter((item) => item.behavior === "reschedule_once").map((item) => item.case_id)
    : [];

  const plan = {
    version: 1,
    policy_version: historicalChaosPolicyVersion,
    kind: "pipeline_historical_chaos_certification",
    environment: "isolated_local_only",
    production_mutation_allowed: false,
    simulation_id: historicalPlan.simulation_id,
    phase,
    seed: historicalPlan.seed,
    concurrency: { ...defaultConcurrency },
    read_repetitions: 3,
    waves: [
      wave("identity_fan_in", "Register every simulated principal concurrently.", historicalPlan.actors.length, defaultConcurrency.identities),
      wave("referral_burst", "Create and assign every referral through the supervisor account.", cases.length, defaultConcurrency.referrals),
      wave("duplicate_delivery", "Replay every create with its original mutation key.", cases.length, defaultConcurrency.referrals),
      wave("attachment_saturation", "Upload all accepted source bytes and exercise every planned rejection.", cases.reduce((sum, item) => sum + item.material_count, 0), defaultConcurrency.files),
      wave("authorization_boundary", "Read every workspace as an unrelated assessor and require a non-disclosing response.", cases.length, defaultConcurrency.reads),
      wave("read_while_write", "Fan out owner reads while workflow state is being reconciled.", cases.length * 3, defaultConcurrency.reads),
      wave("stop_resume_and_reschedule", "Persist, reopen, resume, and reschedule the source-grounded cohort.", interruptionCaseIds.length + rescheduleCaseIds.length, defaultConcurrency.workflow, phase === "full"),
      wave("stale_assessment_save", "Race same-version assessment saves; exactly one may commit.", staleWriteCaseIds.length, defaultConcurrency.workflow, phase === "full"),
      wave("supervisor_decision_race", "Race equivalent supervisor decisions; exactly one decision record may commit.", decisionRaceCaseIds.length, defaultConcurrency.workflow, phase === "full"),
      wave("ehr_failure_retry", "Reject stale handoff state, surface a downstream failure, retry, and finish sent.", handoffRecoveryCaseIds.length, defaultConcurrency.workflow, phase === "full"),
      wave("browser_surface_fan_out", "Open global and workspace surfaces for every owner plus God Mode.", cases.length, defaultConcurrency.browsers),
      wave("immutable_reconciliation", "Re-read the cohort, activity streams, file counts, and terminal state.", cases.length, defaultConcurrency.reads),
    ],
    cohorts: {
      all_case_ids: fullCaseIds,
      stale_write_case_ids: staleWriteCaseIds,
      decision_race_case_ids: decisionRaceCaseIds,
      handoff_recovery_case_ids: handoffRecoveryCaseIds,
      interruption_case_ids: interruptionCaseIds,
      reschedule_case_ids: rescheduleCaseIds,
    },
    invariants: [
      "one_referral_per_case",
      "mutation_replay_returns_original_referral",
      "unrelated_assessor_reads_are_non_disclosing",
      "source_bytes_match_staged_digest_and_size",
      "unsupported_or_invalid_files_fail_at_the_planned_boundary",
      "stale_writes_never_overwrite_the_winner",
      "one_terminal_supervisor_decision_per_case",
      "failed_ehr_handoffs_remain_visible_and_retryable",
      "signed_assessment_values_are_human_verified",
      "every_required_surface_renders_without_application_or_server_error",
      "final_referral_and_activity_counts_match_the_plan",
      "evidence_contains_no_names_or_source_paths",
    ],
    stop_conditions: {
      unexpected_server_errors: 0,
      lost_or_duplicate_referrals: 0,
      unauthorized_disclosures: 0,
      digest_or_byte_mismatches: 0,
      silent_stale_write_overwrites: 0,
      missing_activity_streams: 0,
    },
  };
  validateHistoricalChaosPlan(plan);
  return plan;
}

export function validateHistoricalChaosPlan(plan) {
  if (plan?.policy_version !== historicalChaosPolicyVersion
    || plan.kind !== "pipeline_historical_chaos_certification"
    || plan.environment !== "isolated_local_only"
    || plan.production_mutation_allowed !== false) {
    throw new Error("historical_chaos_plan_invalid");
  }
  if (!Array.isArray(plan.waves) || plan.waves.length < 10 || !Array.isArray(plan.invariants)) {
    throw new Error("historical_chaos_plan_invalid");
  }
  if (!plan.waves.every((item) => item.enabled === false || (item.target_count > 0 && item.concurrency > 0))) {
    throw new Error("historical_chaos_plan_invalid");
  }
  if (!plan.invariants.includes("evidence_contains_no_names_or_source_paths")) {
    throw new Error("historical_chaos_plan_invalid");
  }
  return plan;
}

export function summarizeHistoricalChaosPlan(plan) {
  validateHistoricalChaosPlan(plan);
  return {
    policy_version: plan.policy_version,
    simulation_id: plan.simulation_id,
    phase: plan.phase,
    seed: plan.seed,
    enabled_wave_count: plan.waves.filter((item) => item.enabled).length,
    planned_operation_count: plan.waves.filter((item) => item.enabled).reduce((sum, item) => sum + item.target_count, 0),
    invariant_count: plan.invariants.length,
    concurrency: plan.concurrency,
    cohort_counts: Object.fromEntries(Object.entries(plan.cohorts).map(([key, value]) => [key, value.length])),
    contains_names_or_source_paths: false,
  };
}

function boundedCohort(cases, divisor) {
  const selected = cases.filter((item) => item.sequence % divisor === 0).map((item) => item.case_id);
  return selected.length > 0 ? selected : cases.slice(0, 1).map((item) => item.case_id);
}

function wave(id, objective, targetCount, concurrency, enabled = true) {
  return { id, objective, target_count: targetCount, concurrency, enabled: Boolean(enabled && targetCount > 0) };
}

function validateHistoricalPlanEnvelope(plan) {
  if (plan?.kind !== "pipeline_historical_multi_user_simulation"
    || plan.environment !== "isolated_local_only"
    || plan.production_mutation_allowed !== false
    || typeof plan.simulation_id !== "string"
    || typeof plan.seed !== "string"
    || !Array.isArray(plan.actors)
    || !Array.isArray(plan.cases)
    || plan.cases.length < 1) {
    throw new Error("historical_simulation_plan_invalid");
  }
}

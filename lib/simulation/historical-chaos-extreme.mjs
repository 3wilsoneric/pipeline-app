import { createHash } from "node:crypto";

import { buildHistoricalChaosPlan } from "./historical-chaos-policy.mjs";

export const historicalChaosExtremePolicyVersion = "pipeline-chaos-extreme-v2";
export const historicalChaosExtremeVirtualUserCount = 100;

const roleCounts = Object.freeze({
  admin: 5,
  assessment_coordinator: 10,
  reviewer: 70,
  viewer: 15,
});

const devices = [
  { id: "desktop_chromium", viewport: { width: 1440, height: 900 }, tabs: [1, 2, 3, 5] },
  { id: "laptop_chromium", viewport: { width: 1280, height: 800 }, tabs: [1, 2, 4] },
  { id: "tablet_chromium", viewport: { width: 1024, height: 768 }, tabs: [1, 2, 3] },
  { id: "mobile_chromium", viewport: { width: 390, height: 844 }, tabs: [1, 2] },
];

const networkProfiles = [
  { id: "stable", latency_ms: [10, 35], disconnect_every: 0, duplicate_every: 0, timeout_every: 0 },
  { id: "office_jitter", latency_ms: [20, 450], disconnect_every: 0, duplicate_every: 17, timeout_every: 0 },
  { id: "slow_wifi", latency_ms: [180, 1_800], disconnect_every: 29, duplicate_every: 0, timeout_every: 43 },
  { id: "offline_flap", latency_ms: [40, 900], disconnect_every: 13, duplicate_every: 31, timeout_every: 37 },
  { id: "retry_storm", latency_ms: [5, 140], disconnect_every: 0, duplicate_every: 7, timeout_every: 19 },
];

const timezones = [
  "America/Boise",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Pacific/Honolulu",
];

const scriptActions = [
  "open_home",
  "list_referrals",
  "read_referral",
  "read_activity",
  "read_work_items",
  "open_workspace_tab",
  "refresh_stale_tab",
  "background_poll",
  "navigate_back_forward",
  "retry_last_request",
  "double_click_mutation",
  "lose_response_then_retry",
  "disconnect_reconnect",
  "expire_local_view",
  "probe_unassigned_workspace",
  "cross_role_mutation_probe",
];

export function buildHistoricalChaosExtremePlan(historicalPlan, options = {}) {
  validateHistoricalPlanEnvelope(historicalPlan);
  const phase = options.phase === "full" ? "full" : "files";
  const requestedUsers = options.virtualUsers ?? historicalChaosExtremeVirtualUserCount;
  if (requestedUsers !== historicalChaosExtremeVirtualUserCount) {
    throw new Error("historical_chaos_extreme_requires_exactly_100_virtual_users");
  }

  const seed = String(historicalPlan.seed);
  const base = buildHistoricalChaosPlan(historicalPlan, { phase });
  const virtualUsers = buildVirtualUsers(historicalPlan, seed);
  const mutators = virtualUsers.filter((user) => ["assessment_coordinator", "reviewer"].includes(user.role));
  const caseAssignments = historicalPlan.cases.map((item, index) => ({
    case_id: String(item.case_id),
    source_owner_actor_id: String(item.assigned_actor_id),
    virtual_user_id: mutators[index % mutators.length].virtual_user_id,
  }));
  const assignmentsByUser = countBy(caseAssignments.map((item) => item.virtual_user_id));
  const scripts = virtualUsers.map((user, index) => buildUserScript({
    user,
    userIndex: index,
    seed,
    cases: historicalPlan.cases,
    caseAssignments,
    assignmentsByUser,
  }));
  const scriptedOperationCount = scripts.reduce((sum, script) => sum + script.steps.length, 0);
  const fullOnly = phase === "full";
  const allCases = historicalPlan.cases.map((item) => String(item.case_id));

  const plan = {
    version: 2,
    policy_version: historicalChaosExtremePolicyVersion,
    base_policy_version: base.policy_version,
    kind: "pipeline_historical_chaos_extreme_certification",
    environment: "isolated_local_only",
    production_mutation_allowed: false,
    simulation_id: historicalPlan.simulation_id,
    phase,
    seed,
    virtual_user_count: virtualUsers.length,
    unique_principal_count: new Set(virtualUsers.map((user) => user.principal.id)).size,
    role_counts: { ...roleCounts },
    concurrency: {
      identities: 100,
      referrals: 50,
      files: 16,
      workflow: 32,
      reads: 100,
      browsers: 16,
    },
    read_repetitions: 12,
    operation_budget_per_user: 80,
    scripted_operation_count: scriptedOperationCount,
    control_principals: {
      supervisor_virtual_user_id: virtualUsers.find((user) => user.role === "admin").virtual_user_id,
      recovery_virtual_user_id: virtualUsers.filter((user) => user.role === "admin").at(-1).virtual_user_id,
    },
    virtual_users: virtualUsers,
    case_assignments: caseAssignments,
    scripts,
    waves: [
      wave("boot_100_isolated_sessions", "Start 100 unique principals with independent cookie, tab, cache, retry, device, clock, and network state.", 100, 100),
      wave("identity_fan_in", "Register all principals at one barrier and verify their effective role sets.", 100, 100),
      wave("hundred_referral_burst", "Create and assign the entire corpus while every virtual user is active.", allCases.length, 50),
      wave("same_key_delivery_storm", "Replay create, upload, assessment, and transition mutations after simulated lost responses.", allCases.length * 4, 64),
      wave("same_person_duplicate_collision", "Race same-name and county creates using different mutation keys and require an explicit duplicate decision.", cohortCount(allCases, 5), 20),
      wave("multi_tab_stale_cache", "Leave tabs stale across saves, refreshes, navigation, logout, and reconnect boundaries.", scriptedOperationCount, 100),
      wave("section_merge_collision", "Race disjoint referral sections and same-section edits; preserve safe merges and reject overwrite.", cohortCount(allCases, 4), 32),
      wave("assessment_field_collision", "Race same-field and disjoint-field assessment edits across independent sessions.", cohortCount(allCases, 3), 32, fullOnly),
      wave("schedule_boundary_collision", "Overlap schedule, reschedule, cancel, no-show, and start at clock-skew and DST boundaries.", cohortCount(allCases, 4), 24, fullOnly),
      wave("sign_decision_collision", "Race final save, signature, recommendation, terminal decision, and late retry.", cohortCount(allCases, 5), 24, fullOnly),
      wave("trash_restore_collision", "Race save, trash, list, restore, and idempotent restore without orphaning the workspace.", cohortCount(allCases, 5), 20),
      wave("upload_fault_matrix", "Exercise reservation replay, partial upload, duplicate completion, digest mismatch, timeout, and reconnect.", materialCount(historicalPlan) * 3, 16),
      wave("authorization_probe_storm", "Probe guessed IDs and mutation routes from owner, non-owner assessor, viewer, coordinator, and admin contexts.", allCases.length * 5, 100),
      wave("god_mode_context_switch", "Switch effective identities while other tabs and requests remain in flight, then exit and verify restoration.", 100, 16),
      wave("read_write_pool_saturation", "Mix hot-list reads, workspace reads, activity reads, uploads, and guarded writes at maximum concurrency.", allCases.length * 24, 100),
      wave("worker_retry_dead_letter", "Duplicate, delay, fail, retry, and reorder extraction and EHR handoff events.", cohortCount(allCases, 3), 32, fullOnly),
      wave("browser_surface_maelstrom", "Drive every core surface through a bounded real-browser pool on desktop, tablet, and mobile viewports.", 100, 16),
      wave("crash_restart_recovery", "Abort selected sessions mid-flight, recreate them without local memory, and reconcile durable state.", 100, 50),
      wave("immutable_reconciliation", "Re-read referrals, assessments, files, activity, trash, and terminal state from fresh sessions.", allCases.length * 8, 100),
      wave("replay_capsule", "Write the exact seed, failing wave, user, step, request class, and response class needed for one-command replay.", 1, 1),
    ],
    cohorts: {
      ...base.cohorts,
      duplicate_identity_case_ids: boundedCohort(allCases, 5),
      section_collision_case_ids: boundedCohort(allCases, 4),
      assessment_collision_case_ids: fullOnly ? boundedCohort(allCases, 3) : [],
      schedule_collision_case_ids: fullOnly ? boundedCohort(allCases, 4) : [],
      sign_decision_collision_case_ids: fullOnly ? boundedCohort(allCases, 5) : [],
      trash_restore_case_ids: boundedCohort(allCases, 5),
      upload_fault_case_ids: boundedCohort(allCases, 3),
    },
    fault_model: {
      transport: ["latency", "jitter", "timeout", "disconnect", "lost_response", "duplicate_delivery", "out_of_order_completion"],
      browser: ["multiple_tabs", "stale_cache", "back_forward_cache", "refresh_during_save", "close_during_upload", "session_recreation"],
      concurrency: ["same_record_same_section", "same_record_disjoint_section", "same_field", "disjoint_field", "terminal_action_race", "trash_restore_race"],
      identity: ["unassigned_assessor", "viewer_mutation", "role_change_mid_session", "god_mode_switch", "guessed_identifier"],
      time: ["client_clock_skew", "dst_boundary", "midnight_boundary", "late_retry", "expired_stale_view"],
      workers: ["duplicate_job", "delayed_job", "failed_job", "retry_after_failure", "dead_letter_recovery"],
    },
    invariants: [
      ...base.invariants,
      "100_independent_principals_keep_isolated_session_state",
      "owner_scoped_assessors_never_observe_unassigned_workspaces",
      "unauthorized_mutations_never_change_versions_or_activity",
      "same_mutation_replay_returns_the_original_result",
      "changed_payload_under_same_mutation_key_never_changes_the_original_result",
      "disjoint_section_writes_merge_without_lost_updates",
      "same_section_or_same_field_stale_writes_never_overwrite",
      "trash_and_restore_are_idempotent_audited_and_recoverable",
      "signatures_and_terminal_decisions_are_single_commit_boundaries",
      "in_flight_identity_switches_cannot_cross_account_boundaries",
      "worker_retries_do_not_duplicate_documents_decisions_or_handoffs",
      "crash_restart_recovers_only_durable_committed_state",
      "replay_capsule_reproduces_the_same_user_step_and_fault",
    ],
    stop_conditions: {
      ...base.stop_conditions,
      cross_principal_state_leaks: 0,
      unauthorized_mutations: 0,
      lost_updates: 0,
      duplicate_terminal_records: 0,
      orphaned_uploads: 0,
      unaudited_mutations: 0,
      unrecoverable_deleted_workspaces: 0,
      non_replayable_failures: 0,
    },
  };
  validateHistoricalChaosExtremePlan(plan);
  return plan;
}

export function validateHistoricalChaosExtremePlan(plan) {
  const valid = [
    validPlanEnvelope,
    validPlanUsers,
    validPlanScripts,
    validPlanWaves,
    validPlanInvariants,
  ].every((validator) => validator(plan));
  if (!valid) throw new Error("historical_chaos_extreme_plan_invalid");
  return plan;
}

function validPlanEnvelope(plan) {
  return [
    plan?.policy_version === historicalChaosExtremePolicyVersion,
    plan?.kind === "pipeline_historical_chaos_extreme_certification",
    plan?.environment === "isolated_local_only",
    plan?.production_mutation_allowed === false,
    plan?.virtual_user_count === historicalChaosExtremeVirtualUserCount,
    plan?.unique_principal_count === historicalChaosExtremeVirtualUserCount,
    sameRoleCounts(plan?.role_counts),
  ].every(Boolean);
}

function validPlanUsers(plan) {
  const users = plan?.virtual_users;
  if (!Array.isArray(users)) return false;
  return users.length === 100
    && new Set(users.map((user) => user.virtual_user_id)).size === 100
    && new Set(users.map((user) => user.principal?.id)).size === 100
    && users.every(validVirtualUser);
}

function validPlanScripts(plan) {
  const scripts = plan?.scripts;
  if (!Array.isArray(scripts)) return false;
  return scripts.length === 100
    && scripts.every((script) => script.steps.length === plan.operation_budget_per_user)
    && plan.scripted_operation_count === 100 * plan.operation_budget_per_user;
}

function validPlanWaves(plan) {
  const waves = plan?.waves;
  if (!Array.isArray(waves)) return false;
  return waves.length >= 20
    && waves.every((item) => item.enabled === false || (item.target_count > 0 && item.concurrency > 0));
}

function validPlanInvariants(plan) {
  const invariants = plan?.invariants;
  if (!Array.isArray(invariants)) return false;
  return invariants.includes("100_independent_principals_keep_isolated_session_state")
    && invariants.includes("evidence_contains_no_names_or_source_paths")
    && Object.values(plan.stop_conditions ?? {}).every((value) => value === 0);
}

export function summarizeHistoricalChaosExtremePlan(plan) {
  validateHistoricalChaosExtremePlan(plan);
  return {
    policy_version: plan.policy_version,
    simulation_id: plan.simulation_id,
    phase: plan.phase,
    seed: plan.seed,
    virtual_user_count: plan.virtual_user_count,
    unique_principal_count: plan.unique_principal_count,
    role_counts: plan.role_counts,
    enabled_wave_count: plan.waves.filter((item) => item.enabled).length,
    scripted_operation_count: plan.scripted_operation_count,
    planned_operation_count: plan.waves.filter((item) => item.enabled).reduce((sum, item) => sum + item.target_count, 0),
    fault_family_count: Object.keys(plan.fault_model).length,
    invariant_count: plan.invariants.length,
    concurrency: plan.concurrency,
    contains_names_or_source_paths: false,
  };
}

function buildVirtualUsers(historicalPlan, seed) {
  const sourceOwners = historicalPlan.actors.filter((actor) => actor.role === "reviewer");
  return Array.from({ length: historicalChaosExtremeVirtualUserCount }, (_, index) => {
    const number = index + 1;
    const padded = String(number).padStart(3, "0");
    const role = roleAt(index);
    const device = choose(devices, `${seed}:device:${index}`);
    const network = choose(networkProfiles, `${seed}:network:${index}`);
    const tabCount = choose(device.tabs, `${seed}:tabs:${index}`);
    return {
      virtual_user_id: `vu-${padded}`,
      principal: {
        id: `chaos-extreme-${padded}`,
        email: `chaos-extreme-${padded}@pipeline.local`,
        display_name: `Chaos User ${padded}`,
      },
      role,
      source_owner_actor_id: sourceOwners[index % Math.max(sourceOwners.length, 1)]?.actor_id ?? historicalPlan.supervisor.actor_id,
      session: {
        id: deterministicId(`${seed}:session:${index}`),
        cookie_jar_id: deterministicId(`${seed}:cookies:${index}`),
        cache_epoch: rank(`${seed}:cache:${index}`) % 9,
        retry_budget: 4 + (rank(`${seed}:retry:${index}`) % 5),
      },
      device: { id: device.id, viewport: device.viewport, tab_count: tabCount },
      network: network,
      clock: {
        timezone: choose(timezones, `${seed}:timezone:${index}`),
        skew_ms: (rank(`${seed}:clock:${index}`) % 600_001) - 300_000,
      },
      behavior: {
        think_time_ms: [rank(`${seed}:think-min:${index}`) % 80, 120 + (rank(`${seed}:think-max:${index}`) % 2_881)],
        abandon_every: 17 + (rank(`${seed}:abandon:${index}`) % 37),
        stale_after_steps: 3 + (rank(`${seed}:stale:${index}`) % 11),
      },
    };
  });
}

function buildUserScript({ user, userIndex, seed, cases, caseAssignments, assignmentsByUser }) {
  const assignedCases = caseAssignments.filter((item) => item.virtual_user_id === user.virtual_user_id);
  const steps = Array.from({ length: 80 }, (_, index) => {
    const caseItem = choose(cases, `${seed}:${user.virtual_user_id}:case:${index}`);
    const assigned = assignedCases[index % Math.max(assignedCases.length, 1)];
    const action = scriptActions[(index + rank(`${seed}:action:${userIndex}:${index}`)) % scriptActions.length];
    const targetCaseId = ["probe_unassigned_workspace", "cross_role_mutation_probe"].includes(action)
      ? choose(caseAssignments.filter((item) => item.virtual_user_id !== user.virtual_user_id), `${seed}:probe:${userIndex}:${index}`)?.case_id
      : assigned?.case_id ?? String(caseItem.case_id);
    return {
      step: index + 1,
      tick: Math.floor(index / 4) + (rank(`${seed}:tick:${userIndex}:${index}`) % 3),
      tab: index % user.device.tab_count,
      action,
      target_case_id: targetCaseId,
      expected_access: expectedAccess(user.role, assignedCases.some((item) => item.case_id === targetCaseId)),
      inject_disconnect: user.network.disconnect_every > 0 && (index + 1) % user.network.disconnect_every === 0,
      inject_duplicate: user.network.duplicate_every > 0 && (index + 1) % user.network.duplicate_every === 0,
      inject_timeout: user.network.timeout_every > 0 && (index + 1) % user.network.timeout_every === 0,
    };
  });
  return {
    virtual_user_id: user.virtual_user_id,
    assigned_case_count: assignmentsByUser.get(user.virtual_user_id) ?? 0,
    steps,
  };
}

function expectedAccess(role, isOwner) {
  if (role === "reviewer") return isOwner ? "owner" : "not_found";
  if (role === "viewer") return "read_only";
  return "read_write";
}

function roleAt(index) {
  if (index < roleCounts.admin) return "admin";
  if (index < roleCounts.admin + roleCounts.assessment_coordinator) return "assessment_coordinator";
  if (index < roleCounts.admin + roleCounts.assessment_coordinator + roleCounts.reviewer) return "reviewer";
  return "viewer";
}

function validVirtualUser(user) {
  return Boolean(user?.virtual_user_id
    && user.principal?.id
    && user.session?.id
    && user.session?.cookie_jar_id
    && user.device?.tab_count > 0
    && user.network?.id
    && Number.isInteger(user.clock?.skew_ms));
}

function sameRoleCounts(value) {
  return Object.entries(roleCounts).every(([key, count]) => value?.[key] === count)
    && Object.keys(value ?? {}).length === Object.keys(roleCounts).length;
}

function materialCount(plan) {
  return plan.cases.reduce((sum, item) => sum + (Array.isArray(item.materials) ? item.materials.length : 0), 0);
}

function boundedCohort(caseIds, divisor) {
  const selected = caseIds.filter((_caseId, index) => (index + 1) % divisor === 0);
  return selected.length > 0 ? selected : caseIds.slice(0, 1);
}

function cohortCount(caseIds, divisor) {
  return boundedCohort(caseIds, divisor).length;
}

function wave(id, objective, targetCount, concurrency, enabled = true) {
  return { id, objective, target_count: targetCount, concurrency, enabled: Boolean(enabled && targetCount > 0) };
}

function choose(values, seed) {
  return values[rank(seed) % values.length];
}

function deterministicId(seed) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

function rank(seed) {
  return Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
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

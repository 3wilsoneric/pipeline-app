#!/usr/bin/env node

import {
  buildHistoricalChaosExtremePlan,
  historicalChaosExtremePolicyVersion,
  summarizeHistoricalChaosExtremePlan,
  validateHistoricalChaosExtremePlan,
} from "../lib/simulation/historical-chaos-extreme.mjs";

const source = {
  kind: "pipeline_historical_multi_user_simulation",
  environment: "isolated_local_only",
  production_mutation_allowed: false,
  simulation_id: "chaos_extreme_contract",
  seed: "chaos-extreme-contract-seed",
  supervisor: { actor_id: "source-supervisor" },
  actors: [
    { actor_id: "source-supervisor", role: "admin" },
    ...Array.from({ length: 12 }, (_, index) => ({ actor_id: `source-owner-${index + 1}`, role: "reviewer" })),
  ],
  cases: Array.from({ length: 100 }, (_, index) => ({
    case_id: `case_${String(index + 1).padStart(24, "0")}`,
    sequence: index + 1,
    assigned_actor_id: `source-owner-${(index % 12) + 1}`,
    behavior: index % 7 === 0 ? "interrupted_resume" : index % 11 === 0 ? "reschedule_once" : "straight_through",
    materials: Array.from({ length: (index % 3) + 1 }, (_value, materialIndex) => ({ material_id: `${index}:${materialIndex}` })),
  })),
};

const first = buildHistoricalChaosExtremePlan(source, { phase: "full" });
const second = buildHistoricalChaosExtremePlan(source, { phase: "full" });
const files = buildHistoricalChaosExtremePlan(source, { phase: "files" });
const summary = summarizeHistoricalChaosExtremePlan(first);
const roleTotal = Object.values(first.role_counts).reduce((sum, count) => sum + count, 0);
const principalIds = new Set(first.virtual_users.map((user) => user.principal.id));
const sessionIds = new Set(first.virtual_users.map((user) => user.session.id));
const cookieJarIds = new Set(first.virtual_users.map((user) => user.session.cookie_jar_id));
const assignedUsers = new Set(first.case_assignments.map((item) => item.virtual_user_id));
const scriptActions = new Set(first.scripts.flatMap((script) => script.steps.map((step) => step.action)));
const faultFamilies = Object.values(first.fault_model).flat();

const checks = [
  ["fixed seeds produce byte-identical plans", JSON.stringify(first) === JSON.stringify(second)],
  ["the policy creates exactly 100 unique principals", first.virtual_user_count === 100 && first.unique_principal_count === 100 && principalIds.size === 100],
  ["every virtual user owns independent session and cookie state", sessionIds.size === 100 && cookieJarIds.size === 100],
  ["the role distribution covers administration, coordination, assessment, and read-only work", roleTotal === 100 && first.role_counts.admin === 5 && first.role_counts.assessment_coordinator === 10 && first.role_counts.reviewer === 70 && first.role_counts.viewer === 15],
  ["all 100 corpus cases are reassigned to mutation-capable virtual users", first.case_assignments.length === 100 && assignedUsers.size >= 50 && first.case_assignments.every((item) => first.virtual_users.find((user) => user.virtual_user_id === item.virtual_user_id)?.role !== "viewer")],
  ["every machine has device, network, clock, retry, cache, and multi-tab state", first.virtual_users.every((user) => user.device.viewport.width > 0 && user.device.tab_count > 0 && user.network.latency_ms.length === 2 && user.session.retry_budget >= 4 && Number.isInteger(user.session.cache_epoch) && Number.isInteger(user.clock.skew_ms))],
  ["the event scheduler emits 8,000 deterministic user operations", first.scripted_operation_count === 8_000 && first.scripts.every((script) => script.steps.length === 80)],
  ["scripts include stale tabs, retries, disconnects, duplicate clicks, access probes, and navigation churn", ["refresh_stale_tab", "retry_last_request", "disconnect_reconnect", "double_click_mutation", "probe_unassigned_workspace", "navigate_back_forward"].every((action) => scriptActions.has(action))],
  ["at least twenty coordinated waves cover concurrent product boundaries", first.waves.length >= 20 && first.waves.every((wave) => wave.enabled === false || (wave.target_count > 0 && wave.concurrency > 0))],
  ["files-only runs disable clinical signature, decision, scheduling, and worker lifecycle races", files.waves.filter((wave) => ["assessment_field_collision", "schedule_boundary_collision", "sign_decision_collision", "worker_retry_dead_letter"].includes(wave.id)).every((wave) => !wave.enabled)],
  ["the fault model spans transport, browser, concurrency, identity, time, and workers", Object.keys(first.fault_model).length === 6 && ["lost_response", "multiple_tabs", "terminal_action_race", "god_mode_switch", "dst_boundary", "dead_letter_recovery"].every((fault) => faultFamilies.includes(fault))],
  ["stop conditions have zero tolerance for disclosure, loss, duplicate terminal state, and non-replayable failure", Object.values(first.stop_conditions).every((value) => value === 0)],
  ["evidence summaries disclose neither names nor source paths", summary.contains_names_or_source_paths === false && !Object.values(summary).some((value) => typeof value === "string" && (value.includes("/") || value.includes("\\")))],
  ["production mutation is structurally disabled", first.environment === "isolated_local_only" && first.production_mutation_allowed === false],
  ["the generated plan validates at the expected version", first.policy_version === historicalChaosExtremePolicyVersion && validateHistoricalChaosExtremePlan(first) === first],
];

const failed = checks.filter(([, ok]) => !ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  policy_version: first.policy_version,
  summary,
  checks: checks.map(([name, ok]) => ({ name, ok })),
}, null, 2));
if (failed.length > 0) process.exit(1);

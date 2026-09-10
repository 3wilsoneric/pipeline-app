#!/usr/bin/env node

import {
  buildHistoricalChaosPlan,
  summarizeHistoricalChaosPlan,
  validateHistoricalChaosPlan,
} from "../lib/simulation/historical-chaos-policy.mjs";

const source = {
  kind: "pipeline_historical_multi_user_simulation",
  environment: "isolated_local_only",
  production_mutation_allowed: false,
  simulation_id: "historical_contract",
  seed: "contract-seed",
  actors: Array.from({ length: 20 }, (_, index) => ({ actor_id: `actor-${index + 1}` })),
  cases: Array.from({ length: 100 }, (_, index) => ({
    case_id: `case_${String(index + 1).padStart(24, "0")}`,
    sequence: index + 1,
    behavior: index % 7 === 0 ? "interrupted_resume" : index % 11 === 0 ? "reschedule_once" : "straight_through",
    materials: Array.from({ length: (index % 3) + 1 }, (_value, materialIndex) => ({ material_id: `${index}:${materialIndex}` })),
  })),
};

const first = buildHistoricalChaosPlan(source, { phase: "full" });
const second = buildHistoricalChaosPlan(source, { phase: "full" });
const files = buildHistoricalChaosPlan(source, { phase: "files" });
const summary = summarizeHistoricalChaosPlan(first);
const checks = [
  ["plan is deterministic for a fixed corpus and seed", JSON.stringify(first) === JSON.stringify(second)],
  ["all 100 referral creates are replayed with their mutation keys", first.cohorts.all_case_ids.length === 100 && first.waves.find((item) => item.id === "duplicate_delivery")?.target_count === 100],
  ["extreme mode drives 20 referral writers and 40 readers", first.concurrency.referrals === 20 && first.concurrency.reads === 40],
  ["full mode includes real stale-write, decision-race, and handoff-recovery cohorts", first.cohorts.stale_write_case_ids.length === 10 && first.cohorts.decision_race_case_ids.length === 5 && first.cohorts.handoff_recovery_case_ids.length === 4],
  ["files mode disables clinical and decision fault waves", files.waves.filter((item) => ["stale_assessment_save", "supervisor_decision_race", "ehr_failure_retry"].includes(item.id)).every((item) => !item.enabled)],
  ["the stop policy has zero tolerance for loss, disclosure, and silent overwrite", Object.values(first.stop_conditions).every((value) => value === 0)],
  ["certification evidence is explicitly identifier-free", summary.contains_names_or_source_paths === false && first.invariants.includes("evidence_contains_no_names_or_source_paths")],
  ["the generated plan validates", validateHistoricalChaosPlan(first) === first],
];
const failed = checks.filter(([, ok]) => !ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks: checks.map(([name, ok]) => ({ name, ok })) }, null, 2));
if (failed.length > 0) process.exit(1);

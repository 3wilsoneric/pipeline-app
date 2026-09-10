#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { buildWorkAssessmentGraphSnapshot } from "../lib/pipeline/work-assessment-graph.mjs";

const observedAt = "2026-01-08T12:00:00.000Z";
const training = [
  work(101, "ready-a", { assessment_state: "signed", completion_pct: 96 }),
  work(102, "ready-b", { assessment_state: "ready_to_sign", completion_pct: 91 }),
  work(201, "records-a", { document_state: "none", blocker_count: 3, completion_pct: 35 }),
  work(202, "records-b", { document_state: "attention", blocker_count: 2, completion_pct: 42 }),
  work(301, "assessment-a", { assessment_state: "in_progress", completion_pct: 68 }),
  work(302, "assessment-b", { assessment_state: "waiting_for_information", completion_pct: 64 }),
];
const holdout = [
  work(103, "holdout-ready", { assessment_state: "signed", completion_pct: 94 }),
  work(203, "holdout-records", { document_state: "none", blocker_count: 2, completion_pct: 39 }),
  work(303, "holdout-assessment", { assessment_state: "in_progress", completion_pct: 66 }),
];
const allWork = [...training, ...holdout];
const requirements = allWork.flatMap((item) => item.blocker_count > 0 ? [requirement(item)] : []);
const first = buildWorkAssessmentGraphSnapshot(allWork, requirements, observedAt);
const second = buildWorkAssessmentGraphSnapshot(allWork, requirements, observedAt);
const byId = new Map(first.cases.map((item) => [item.referral_id, item]));
const route = readFileSync("app/api/operations/work-assessment-graph/route.ts", "utf8");
const component = readFileSync("components/pipeline/WorkAssessmentGraph.tsx", "utf8");
const retrievalProjection = first.cases.map((item) => ({
  archetype: item.archetype,
  vector: item.vector,
  similar_work: item.similar_work,
}));

const expectedArchetypes = new Map([
  [103, "decision_ready"],
  [203, "records_blocked"],
  [303, "assessment_active"],
]);
const checks = {
  deterministic_projection: JSON.stringify(first) === JSON.stringify(second),
  every_node_has_provenance: first.graph.nodes.every(hasProvenance),
  every_edge_has_provenance: first.graph.edges.every(hasProvenance),
  bounded_vector_schema: first.cases.every((item) => Object.values(item.vector).length === 5 && Object.values(item.vector).every((value) => value >= 0 && value <= 1)),
  held_out_archetypes_recovered: [...expectedArchetypes].every(([id, archetype]) => byId.get(id)?.archetype === archetype),
  held_out_similarity_recovered: [...expectedArchetypes].every(([id, archetype]) => byId.get(id)?.similar_work[0]?.archetype === archetype),
  retrieval_projection_excludes_direct_identifiers_and_free_text: !/(ready-a|records-a|assessment-a|client_name|inspect_next|why)/i.test(JSON.stringify(retrievalProjection)),
  no_automated_admission_decision: first.assurance.automated_admission_decisions === false && first.graph.nodes.every((node) => node.type !== "admission_decision"),
  collision_unknown_is_explicit: first.cases.every((item) => item.collision_signal === "not_observed" && item.vector.collision_pressure === 0),
  supervisor_route_is_private_and_role_scoped: route.includes("operationsReportRoles") && route.includes('private, no-store, max-age=0'),
  operator_surface_is_actionable: component.includes('aria-label="Work assessment graph"') && component.includes("Inspect next") && component.includes("similar_work"),
};
const ok = Object.values(checks).every(Boolean);

console.log(JSON.stringify({
  ok,
  model: "deterministic_workflow_feature_baseline",
  vector_dimensions: ["intake_completeness", "document_readiness", "assessment_progress", "queue_urgency", "collision_pressure"],
  graph: { nodes: first.graph.nodes.length, edges: first.graph.edges.length, cases: first.cases.length },
  held_out: [...expectedArchetypes].map(([id, expected]) => ({
    id,
    expected,
    actual: byId.get(id)?.archetype,
    nearest: byId.get(id)?.similar_work[0] ?? null,
  })),
  checks,
  note: "Synthetic, deterministic, read-only evaluation. The map explains workflow state; it does not recommend or record an admission decision.",
}, null, 2));

if (!ok) process.exit(1);

function hasProvenance(item) {
  return item.provenance?.source_id
    && item.provenance?.observed_at === observedAt
    && item.provenance?.transformation_version === "work-assessment-graph-v1";
}

function work(id, name, overrides = {}) {
  return {
    referral_id: id,
    client_id: `client-${id}`,
    client_name: name,
    community: "San Pablo",
    stage: "Assessment",
    workflow_status: "assessment_in_progress",
    flow_state: "assessment",
    assignment_state: "assigned",
    assessment_state: "not_started",
    outcome_state: "pending",
    document_state: "complete",
    profile_state: "complete",
    assessment_is_reassessment: false,
    owner_id: "reviewer-1",
    owner: "Synthetic Reviewer",
    priority: "standard",
    blocker_count: 0,
    blockers: [],
    missing_data: [],
    next_action: "Review the synthetic workspace.",
    action_required: true,
    waiting: false,
    age_hours: 4,
    stale: false,
    due_soon: false,
    assignment_due_at: null,
    assignment_overdue: false,
    assessment_complete: false,
    has_decision: false,
    completion_pct: 50,
    ...overrides,
  };
}

function requirement(item) {
  return {
    work_item_id: `requirement-${item.referral_id}`,
    version: 1,
    referral_id: item.referral_id,
    client_name: item.client_name,
    community: item.community,
    label: "Synthetic source record",
    status: "needed",
    owner_id: item.owner_id,
    owner: item.owner,
    due_at: null,
    next_action: "Obtain the synthetic source record.",
    evidence_document_name: null,
    overdue: false,
    due_soon: false,
    unassigned: false,
    type: "face_sheet",
    blocker: true,
  };
}

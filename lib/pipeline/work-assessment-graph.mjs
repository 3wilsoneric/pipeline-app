export const workAssessmentGraphVersion = "work-assessment-graph-v1";

const archetypes = [
  "unassigned",
  "records_blocked",
  "assessment_active",
  "decision_ready",
  "placement_follow_up",
  "intake_incomplete",
  "workflow_active",
];

const dimensionNames = [
  "intake_completeness",
  "document_readiness",
  "assessment_progress",
  "queue_urgency",
  "collision_pressure",
];

export function buildWorkAssessmentGraphSnapshot(work, requirements, generatedAt, options = {}) {
  const limit = boundedLimit(options.limit ?? 250);
  const requirementsByReferral = groupByReferral(requirements);
  const ranked = [...work]
    .sort(compareWork)
    .slice(0, limit)
    .map((item) => projectCase(item, requirementsByReferral.get(item.referral_id) ?? [], generatedAt));
  const cases = ranked.map((item) => ({
    ...item,
    similar_work: nearestCases(item, ranked),
  }));
  const graph = projectGraph(cases);
  const counts = Object.fromEntries(archetypes.map((archetype) => [archetype, 0]));
  for (const item of cases) counts[item.archetype] += 1;

  return {
    schema_version: 1,
    transformation_version: workAssessmentGraphVersion,
    generated_at: generatedAt,
    source: "operational_projection",
    total: work.length,
    truncated: work.length > cases.length,
    summary: {
      archetypes: counts,
      needs_attention: cases.filter((item) => ["unassigned", "records_blocked", "intake_incomplete"].includes(item.archetype)).length,
      ready_for_decision: counts.decision_ready,
    },
    cases,
    graph,
    assurance: {
      projection_only: true,
      retrieval_excludes_direct_identifiers: true,
      retrieval_excludes_free_text: true,
      automated_admission_decisions: false,
    },
  };
}

function projectCase(work, requirements, generatedAt) {
  const vector = featureVector(work);
  const provenance = evidence("operational_work_item", `referral:${work.referral_id}:progress`, generatedAt);
  return {
    referral_id: work.referral_id,
    client_id: work.client_id ?? null,
    client_name: work.client_name,
    community: work.community,
    owner: work.owner,
    workflow_status: work.workflow_status,
    flow_state: work.flow_state,
    archetype: classify(work),
    vector,
    why: explain(work),
    inspect_next: work.next_action?.trim() || "Review the workspace and record the next action.",
    evidence: [
      provenance,
      ...requirements.map((item) => evidence("operational_requirement", `requirement:${item.work_item_id}`, generatedAt)),
    ],
    similar_work: [],
    collision_signal: "not_observed",
  };
}

function featureVector(work) {
  return {
    intake_completeness: rounded(clamp(work.completion_pct / 100)),
    document_readiness: ({ none: 0, attention: 0.2, partial: 0.5, complete: 1 })[work.document_state] ?? 0,
    assessment_progress: ({
      not_started: 0,
      unscheduled: 0.1,
      scheduled: 0.3,
      in_progress: 0.55,
      waiting_for_information: 0.45,
      ready_to_sign: 0.8,
      signed: 1,
    })[work.assessment_state] ?? 0,
    queue_urgency: rounded(queueUrgency(work)),
    // Per-referral collision telemetry is not currently retained. Zero is an
    // explicit unknown baseline, not an inference from unrelated clinical data.
    collision_pressure: 0,
  };
}

function classify(work) {
  if (work.outcome_state === "accepted") return "placement_follow_up";
  if (["ready_to_sign", "signed"].includes(work.assessment_state) && !work.has_decision) return "decision_ready";
  if (work.assignment_state === "unassigned") return "unassigned";
  if (work.document_state === "none" || work.document_state === "attention" || work.blocker_count > 0) return "records_blocked";
  if (["scheduled", "in_progress", "waiting_for_information"].includes(work.assessment_state)) return "assessment_active";
  if (work.profile_state === "incomplete") return "intake_incomplete";
  return "workflow_active";
}

function explain(work) {
  const reasons = [
    ...assignmentReasons(work),
    ...documentReasons(work),
    ...timingReasons(work),
    ...decisionReasons(work),
  ];
  return reasons.length > 0 ? reasons : ["The workflow is active with no derived exception signal."];
}

function assignmentReasons(work) {
  return work.assignment_state === "unassigned" ? ["No accountable owner is assigned."] : [];
}

function documentReasons(work) {
  const documentReason = ({
    none: "Initial source documents are missing.",
    attention: "Source documents require attention.",
    partial: "Document requirements are still incomplete.",
  })[work.document_state];
  return [
    ...(documentReason ? [documentReason] : []),
    ...(work.profile_state === "incomplete" ? ["Required profile information is incomplete."] : []),
    ...(work.blocker_count > 0 ? [`${work.blocker_count} blocking item${work.blocker_count === 1 ? " is" : "s are"} unresolved.`] : []),
  ];
}

function timingReasons(work) {
  if (work.assignment_overdue) return ["The assignment deadline has passed."];
  if (work.due_soon) return ["A scheduled action is due within 72 hours."];
  return work.stale ? ["The workspace has exceeded its activity window."] : [];
}

function decisionReasons(work) {
  return [
    ...(["ready_to_sign", "signed"].includes(work.assessment_state) && !work.has_decision ? ["Assessment evidence is ready for supervisor review."] : []),
    ...(work.outcome_state === "accepted" ? ["Admission is recorded; move-in follow-up remains active."] : []),
  ];
}

function nearestCases(target, cases) {
  return cases
    .filter((candidate) => candidate.referral_id !== target.referral_id)
    .map((candidate) => ({
      referral_id: candidate.referral_id,
      archetype: candidate.archetype,
      score: rounded(cosine(vectorValues(target.vector), vectorValues(candidate.vector))),
    }))
    .sort((left, right) => right.score - left.score || left.referral_id - right.referral_id)
    .slice(0, 2);
}

function projectGraph(cases) {
  const nodes = new Map();
  const edges = [];
  for (const item of cases) {
    const source = item.evidence[0];
    const caseId = `case:${item.referral_id}`;
    const archetypeId = `archetype:${item.archetype}`;
    const ownerId = `owner:${stableToken(item.owner)}`;
    const communityId = `community:${stableToken(item.community)}`;
    nodes.set(caseId, { id: caseId, type: "work_case", label: item.client_name, provenance: source });
    nodes.set(archetypeId, { id: archetypeId, type: "archetype", label: item.archetype, provenance: source });
    nodes.set(ownerId, { id: ownerId, type: "owner", label: item.owner, provenance: source });
    nodes.set(communityId, { id: communityId, type: "community", label: item.community, provenance: source });
    edges.push(
      { from: caseId, to: archetypeId, type: "classified_as", provenance: source },
      { from: caseId, to: ownerId, type: "owned_by", provenance: source },
      { from: caseId, to: communityId, type: "located_at", provenance: source },
    );
  }
  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => `${left.from}:${left.type}:${left.to}`.localeCompare(`${right.from}:${right.type}:${right.to}`)),
  };
}

function evidence(sourceType, sourceId, observedAt) {
  return {
    source_type: sourceType,
    source_id: sourceId,
    observed_at: observedAt,
    transformation_version: workAssessmentGraphVersion,
  };
}

function groupByReferral(requirements) {
  const grouped = new Map();
  for (const item of requirements) grouped.set(item.referral_id, [...(grouped.get(item.referral_id) ?? []), item]);
  return grouped;
}

function compareWork(left, right) {
  return queueUrgency(right) - queueUrgency(left)
    || right.blocker_count - left.blocker_count
    || right.age_hours - left.age_hours
    || left.client_name.localeCompare(right.client_name)
    || left.referral_id - right.referral_id;
}

function queueUrgency(work) {
  if (work.assignment_overdue) return 1;
  if (work.blocker_count > 0) return 0.85;
  if (work.due_soon) return 0.7;
  if (work.stale) return 0.55;
  if (work.priority === "urgent") return 0.45;
  if (work.priority === "high") return 0.3;
  return 0.1;
}

function vectorValues(vector) {
  return dimensionNames.map((name) => vector[name]);
}

function cosine(left, right) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const leftMagnitude = Math.sqrt(left.reduce((sum, value) => sum + value ** 2, 0));
  const rightMagnitude = Math.sqrt(right.reduce((sum, value) => sum + value ** 2, 0));
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (leftMagnitude * rightMagnitude);
}

function stableToken(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function boundedLimit(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return 250;
  return Math.max(1, Math.min(500, numeric));
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000;
}

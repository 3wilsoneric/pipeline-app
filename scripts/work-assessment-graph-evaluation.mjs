#!/usr/bin/env node

const training = [
  fixture("ready-a", "ready_for_decision", [1, 1, 1, 0.1, 0]),
  fixture("ready-b", "ready_for_decision", [0.95, 1, 0.9, 0.15, 0]),
  fixture("records-a", "records_blocked", [0.8, 0.15, 0.25, 0.8, 0.1]),
  fixture("records-b", "records_blocked", [0.7, 0.2, 0.2, 0.9, 0]),
  fixture("assessment-a", "assessment_active", [0.9, 0.85, 0.5, 0.45, 0.1]),
  fixture("assessment-b", "assessment_active", [0.85, 0.9, 0.55, 0.4, 0]),
];
const holdout = [
  fixture("holdout-ready", "ready_for_decision", [0.98, 1, 0.95, 0.12, 0]),
  fixture("holdout-records", "records_blocked", [0.75, 0.1, 0.2, 0.85, 0.05]),
  fixture("holdout-assessment", "assessment_active", [0.88, 0.88, 0.52, 0.42, 0.05]),
];

const graph = projectGraph([...training, ...holdout]);
const predictions = holdout.map((item) => {
  const nearest = training
    .map((candidate) => ({ candidate, similarity: cosine(item.vector, candidate.vector) }))
    .sort((left, right) => right.similarity - left.similarity || left.candidate.id.localeCompare(right.candidate.id))[0];
  return {
    holdout: item.id,
    expected_archetype: item.archetype,
    nearest_archetype: nearest.candidate.archetype,
    similarity: rounded(nearest.similarity),
  };
});
const checks = {
  deterministic_projection: JSON.stringify(graph) === JSON.stringify(projectGraph([...training, ...holdout])),
  every_edge_has_provenance: graph.edges.every((edge) => edge.provenance.event_id && edge.provenance.occurred_at),
  bounded_vector_schema: [...training, ...holdout].every((item) => item.vector.length === 5 && item.vector.every((value) => value >= 0 && value <= 1)),
  holdout_archetypes_recovered: predictions.every((item) => item.expected_archetype === item.nearest_archetype),
  no_free_text_in_projection: !JSON.stringify(graph).toLowerCase().includes("note"),
  no_automated_admission_decision: graph.nodes.every((node) => node.type !== "admission_decision"),
};
const ok = Object.values(checks).every(Boolean);

console.log(JSON.stringify({
  ok,
  model: "deterministic_workflow_feature_baseline",
  vector_dimensions: ["intake_completeness", "document_readiness", "assessment_progress", "queue_urgency", "collision_pressure"],
  graph: { nodes: graph.nodes.length, edges: graph.edges.length },
  holdout_predictions: predictions,
  checks,
  note: "The fixture is synthetic and contains no PHI. This baseline retrieves similar work states; it does not recommend admission or replace human review.",
}, null, 2));

if (!ok) process.exit(1);

function fixture(id, archetype, vector) {
  return {
    id,
    archetype,
    vector,
    events: [
      { id: `${id}-created`, type: "referral_created", occurredAt: "2026-01-01T00:00:00.000Z" },
      { id: `${id}-current`, type: archetype, occurredAt: "2026-01-02T00:00:00.000Z" },
    ],
  };
}

function projectGraph(fixtures) {
  const nodes = [];
  const edges = [];
  for (const item of [...fixtures].sort((left, right) => left.id.localeCompare(right.id))) {
    nodes.push({ id: `case:${item.id}`, type: "work_case", state: item.archetype });
    for (const event of item.events) {
      const eventId = `event:${event.id}`;
      nodes.push({ id: eventId, type: "workflow_event", event_type: event.type });
      edges.push({
        from: `case:${item.id}`,
        to: eventId,
        type: "HAS_EVENT",
        provenance: { event_id: event.id, occurred_at: event.occurredAt },
      });
    }
  }
  return { nodes, edges };
}

function cosine(left, right) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const leftMagnitude = Math.sqrt(left.reduce((sum, value) => sum + value ** 2, 0));
  const rightMagnitude = Math.sqrt(right.reduce((sum, value) => sum + value ** 2, 0));
  return dot / (leftMagnitude * rightMagnitude);
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000;
}

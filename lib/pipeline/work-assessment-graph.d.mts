import type { OperationsRequirementItem, OperationsWorkItem } from "./operations-types";

export const workAssessmentGraphVersion: "work-assessment-graph-v1";

export type WorkAssessmentArchetype =
  | "unassigned"
  | "records_blocked"
  | "assessment_active"
  | "decision_ready"
  | "placement_follow_up"
  | "intake_incomplete"
  | "workflow_active";

export type WorkAssessmentFeatureVector = {
  intake_completeness: number;
  document_readiness: number;
  assessment_progress: number;
  queue_urgency: number;
  collision_pressure: number;
};

export type WorkAssessmentGraphProvenance = {
  source_type: "operational_work_item" | "operational_requirement";
  source_id: string;
  observed_at: string;
  transformation_version: typeof workAssessmentGraphVersion;
};

export type WorkAssessmentSimilarity = {
  referral_id: number;
  archetype: WorkAssessmentArchetype;
  score: number;
};

export type WorkAssessmentGraphCase = {
  referral_id: number;
  client_id: string | null;
  client_name: string;
  community: string;
  owner: string;
  workflow_status: OperationsWorkItem["workflow_status"];
  flow_state: OperationsWorkItem["flow_state"];
  archetype: WorkAssessmentArchetype;
  vector: WorkAssessmentFeatureVector;
  why: string[];
  inspect_next: string;
  evidence: WorkAssessmentGraphProvenance[];
  similar_work: WorkAssessmentSimilarity[];
  collision_signal: "not_observed";
};

export type WorkAssessmentGraphNode = {
  id: string;
  type: "work_case" | "archetype" | "owner" | "community";
  label: string;
  provenance: WorkAssessmentGraphProvenance;
};

export type WorkAssessmentGraphEdge = {
  from: string;
  to: string;
  type: "classified_as" | "owned_by" | "located_at";
  provenance: WorkAssessmentGraphProvenance;
};

export type WorkAssessmentGraphSnapshot = {
  schema_version: 1;
  transformation_version: typeof workAssessmentGraphVersion;
  generated_at: string;
  source: "operational_projection";
  total: number;
  truncated: boolean;
  summary: {
    archetypes: Record<WorkAssessmentArchetype, number>;
    needs_attention: number;
    ready_for_decision: number;
  };
  cases: WorkAssessmentGraphCase[];
  graph: {
    nodes: WorkAssessmentGraphNode[];
    edges: WorkAssessmentGraphEdge[];
  };
  assurance: {
    projection_only: true;
    retrieval_excludes_direct_identifiers: true;
    retrieval_excludes_free_text: true;
    automated_admission_decisions: false;
  };
};

export function buildWorkAssessmentGraphSnapshot(
  work: readonly OperationsWorkItem[],
  requirements: readonly OperationsRequirementItem[],
  generatedAt: string,
  options?: { limit?: number },
): WorkAssessmentGraphSnapshot;

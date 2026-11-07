import { buildAssessmentContext } from "@/lib/assessment/assessment-context";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { WorkflowRecordSnapshot } from "./workflow-records";

export type ReferralContextInput = WorkflowRecordSnapshot & {
  transitions: readonly unknown[];
  capabilities: Record<string, boolean>;
};

export function buildReferralContext(workflow: ReferralContextInput, assessment: PipelineAssessmentRecord | null) {
  const referralId = workflow.referral.id;
  if (assessment && (assessment.referral_id !== referralId || assessment.assessment_id !== workflow.context.assessmentId)) {
    throw new Error("Assessment does not belong to this referral context.");
  }
  const base = `/api/referrals/${referralId}`;
  return {
    schemaVersion: 1,
    kind: "pipeline.referral-context",
    ownerApplication: "pipeline",
    source: { path: `${base}/workflow`, referralId, referralVersion: workflow.referral.version ?? null,
      sectionVersions: workflow.referral.sectionVersions ?? null, updatedAt: workflow.referral.updatedAt ?? null },
    workflow,
    assessment: assessment ? buildAssessmentContext(assessment) : null,
    relatedSources: [
      { kind: "referral", path: base },
      { kind: "activity", path: `${base}/activity`, limit: 100, history: "bounded-mixed-audit-and-record-projection" },
      { kind: "assessments", path: `${base}/assessments` },
      { kind: "packet", path: `${base}/packet` },
      { kind: "contacts", path: `${base}/contacts` },
      { kind: "notes", path: `${base}/notes` },
      { kind: "admission-packets", path: `${base}/admission-packets` },
      { kind: "admission-flow", path: `${base}/admission-flow` },
    ],
    coverage: {
      workflow: "current-source-snapshot",
      assessment: assessment ? "current-linked-record" : workflow.context.assessmentId ? "linked-record-unavailable" : "not-linked",
      consistency: "separate-source-reads-not-an-atomic-snapshot",
      history: "partial", originals: "references-only",
      gaps: ["complete-event-history", "original-document-bytes", "recipient-acknowledgment", "historical-guidance-version"],
    },
    authority: {
      facts: "source-owned-operational-records",
      guidance: "resolve-reviewed-ProForma-publication-separately",
      access: "same-user-and-referral-access-as-source",
      capabilities: "current-user-capabilities-not-an-agent-grant",
      canExecute: false, crossCaseUse: "not-authorized-by-this-response",
    },
  };
}

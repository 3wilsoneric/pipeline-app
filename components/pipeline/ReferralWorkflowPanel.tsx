"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ReferralWorkflowPanelLoading,
  ReferralWorkflowPanelPresentation,
  WorkflowNotice,
} from "@/components/pipeline/ReferralWorkflowPanelPresentation";
import {
  decisionConfirmationMessage,
  deriveWorkflowPanelView,
  referralFromConflictPayload,
  requirementNeedsDetail,
  type DecisionOutcomeDraft,
  type PendingWorkflowDetail,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { createMutationId } from "@/lib/pipeline/referral-packet-upload";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import type { ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { AdmissionRequirement, AssessmentRecommendation, Referral, RequirementStatus } from "@/lib/pipeline/referral-types";

type ReferralWorkflowPanelProps = {
  referral: Referral;
  onReferralChange: (referral: Referral) => void;
  onOpenIntake: () => void;
  onOpenAssessment: () => void;
  onOpenFiles: () => void;
  onOpenProfile: (canonicalClientId: string) => void;
};

type RecommendationDraft = {
  outcome: AssessmentRecommendation["outcome"];
  reasonCode: string;
  reasonNote: string;
};

type DecisionDraft = {
  outcome: DecisionOutcomeDraft;
  reasonCode: string;
  reasonNote: string;
};

export default function ReferralWorkflowPanel({
  referral,
  onReferralChange,
  onOpenIntake,
  onOpenAssessment,
  onOpenFiles,
  onOpenProfile,
}: ReferralWorkflowPanelProps) {
  const [workflow, setWorkflow] = useState<WorkflowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recommendationDraft, setRecommendationDraft] = useState<RecommendationDraft>({ outcome: "accept", reasonCode: "", reasonNote: "" });
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft>({ outcome: "", reasonCode: "", reasonNote: "" });
  const [manualIntakeReason, setManualIntakeReason] = useState("");
  const [pendingDetail, setPendingDetail] = useState<PendingWorkflowDetail | null>(null);
  const mutationIds = useRef(new Map<string, string>());
  const recommendationDirty = useRef(false);
  const decisionDirty = useRef(false);

  const loadWorkflow = useCallback(async (signal?: AbortSignal) => {
    const payload = await fetchPipelineJson<WorkflowResponse>(`/api/referrals/${referral.id}/workflow`, {
      cache: "no-store",
      signal,
    });
    setWorkflow(payload);
    setError("");
    if (!recommendationDirty.current) {
      setRecommendationDraft({
        outcome: payload.recommendation?.outcome ?? "accept",
        reasonCode: payload.recommendation?.reasonCode ?? "",
        reasonNote: payload.recommendation?.reasonNote ?? "",
      });
    }
    if (!decisionDirty.current) {
      setDecisionDraft((current) => ({
        ...current,
        outcome: payload.decision?.outcome ?? "",
        reasonCode: payload.decision?.reasonCode ?? "",
        reasonNote: payload.decision?.reasonNote ?? "",
      }));
    }
    setLoading(false);
  }, [referral.id]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadWorkflow(controller.signal).catch((loadError) => {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : "Workflow could not be loaded.");
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [loadWorkflow, referral.version]);

  const runMutation = async <T extends { referral?: Referral }>(
    key: string,
    url: string,
    method: "PATCH" | "POST" | "PUT",
    body: Record<string, unknown>,
    successMessage: string,
  ) => {
    const clientMutationId = mutationIds.current.get(key) ?? createMutationId();
    mutationIds.current.set(key, clientMutationId);
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const payload = await fetchPipelineJson<T>(url, {
        method,
        body: JSON.stringify({ ...body, client_mutation_id: clientMutationId }),
      });
      mutationIds.current.delete(key);
      if (payload.referral) onReferralChange(payload.referral);
      if (key.startsWith("recommendation:")) recommendationDirty.current = false;
      if (key.startsWith("decision:")) {
        decisionDirty.current = false;
      }
      setMessage(successMessage);
      await loadWorkflow();
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof PipelineApiError && mutationError.status === 409) {
        const latest = referralFromConflictPayload(mutationError.payload);
        if (latest) onReferralChange(latest);
        await loadWorkflow().catch(() => undefined);
      }
      setError(mutationError instanceof Error ? mutationError.message : "The workflow change could not be saved.");
      return null;
    } finally {
      setBusy("");
    }
  };

  if (loading && !workflow) return <ReferralWorkflowPanelLoading />;
  if (!workflow) return <WorkflowNotice tone="error">{error || "Workflow could not be loaded."}</WorkflowNotice>;

  const { currentReferral } = deriveWorkflowPanelView(workflow);
  const sections = normalizeReferralSectionVersions(currentReferral.sectionVersions);

  const saveRequirement = async (item: AdmissionRequirement, status: RequirementStatus, detail = "") => {
    const patch: Record<string, unknown> = { status };
    if (status === "requested") {
      patch.requestedFrom = detail;
      patch.followUpAt = item.followUpAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    }
    if (status === "waived") patch.waiverReason = detail;
    if (status === "unavailable" || status === "not_applicable") patch.unavailableReason = detail;
    await runMutation(
      `requirement:${item.id}:${item.version ?? 1}:${status}`,
      `/api/referrals/${currentReferral.id}/work-items/${item.id}`,
      "PATCH",
      { if_match: item.version ?? 1, patch },
      `${item.label} updated`,
    );
  };

  const updateRequirement = (item: AdmissionRequirement, status: RequirementStatus) => {
    if (requirementNeedsDetail(status)) {
      setPendingDetail({ kind: "requirement", item, status });
      return;
    }
    void saveRequirement(item, status);
  };

  const submitRecommendation = () => {
    void runMutation(
      `recommendation:${currentReferral.version}:${sections.decision}`,
      `/api/referrals/${currentReferral.id}/recommendation`,
      "PUT",
      {
        if_match: currentReferral.version,
        if_match_section: sections.decision,
        assessment_id: workflow.context.assessmentId,
        outcome: recommendationDraft.outcome,
        reason_code: recommendationDraft.reasonCode,
        reason_note: recommendationDraft.reasonNote,
      },
      "Recommendation submitted",
    );
  };

  const submitDecision = () => {
    if (!decisionDraft.outcome) return;
    if (!window.confirm(decisionConfirmationMessage(decisionDraft.outcome, false))) return;
    void runMutation(
      `decision:${currentReferral.version}:${sections.decision}`,
      `/api/referrals/${currentReferral.id}/decision`,
      "PUT",
      {
        if_match: currentReferral.version,
        if_match_section: sections.decision,
        outcome: decisionDraft.outcome,
        reason_code: decisionDraft.reasonCode,
        reason_note: decisionDraft.reasonNote,
      },
      "Supervisor decision recorded",
    );
  };

  const requestReviewChanges = (reason: string) => {
    const review = workflow.review;
    if (!review) return;
    void runMutation(
      `review-changes:${review.reviewId}:${review.version}`,
      `/api/referrals/${currentReferral.id}/assessment-review`,
      "POST",
      {
        action: "request_changes",
        if_match: currentReferral.version,
        if_match_section: sections.decision,
        if_match_review: review.version,
        review_id: review.reviewId,
        reason_note: reason,
      },
      "Changes requested and a new assessment revision created",
    );
  };

  const submitTransition = (target: ReferralStage) => {
    if (target === "Accepted / Admitted" && !window.confirm(
      "Mark this referral admitted? Confirm the accepted decision and every required admission item are complete. This closes the active referral stage and enables EHR handoff.",
    )) return;
    void runMutation(
      `transition:${target}:${currentReferral.version}`,
      `/api/referrals/${currentReferral.id}/transition`,
      "POST",
      { if_match: currentReferral.version, if_match_section: sections.workflow, target_stage: target },
      target === "Accepted / Admitted" ? "Admission recorded" : `Moved to ${target}`,
    );
  };

  const authorizeManualIntake = () => {
    void runMutation(
      `manual-intake:${currentReferral.version}`,
      `/api/referrals/${currentReferral.id}/manual-intake`,
      "POST",
      { if_match: currentReferral.version, if_match_section: sections.documents, reason: manualIntakeReason.trim() },
      "Manual chart intake authorized",
    );
  };

  const updateHandoff = (action: "queue" | "mark_sent" | "mark_failed" | "retry", failureReason = "") => {
    void runMutation(
      `ehr:${action}:${currentReferral.version}:${sections.decision}`,
      `/api/referrals/${currentReferral.id}/ehr-handoff`,
      "POST",
      { if_match: currentReferral.version, if_match_section: sections.decision, action, failure_reason: failureReason },
      action === "mark_sent" ? "EHR handoff recorded as sent" : action === "mark_failed" ? "EHR handoff failure recorded" : "EHR handoff queued",
    );
  };

  const recordHandoffSent = () => {
    if (!window.confirm("Record this EHR handoff as sent? Confirm the downstream transfer succeeded before continuing.")) return;
    updateHandoff("mark_sent");
  };

  return (
    <ReferralWorkflowPanelPresentation
      workflow={workflow}
      busy={busy}
      message={message}
      error={error}
      recommendation={recommendationDraft}
      decision={decisionDraft}
      manualIntakeReason={manualIntakeReason}
      pendingDetail={pendingDetail}
      onRecommendationChange={(patch) => {
        recommendationDirty.current = true;
        setRecommendationDraft((current) => ({ ...current, ...patch }));
      }}
      onDecisionChange={(patch) => {
        decisionDirty.current = true;
        setDecisionDraft((current) => ({ ...current, ...patch }));
      }}
      onManualIntakeReasonChange={setManualIntakeReason}
      onUpdateRequirement={updateRequirement}
      onSubmitRecommendation={submitRecommendation}
      onSubmitDecision={submitDecision}
      onRequestReviewChanges={() => workflow.review && setPendingDetail({ kind: "review_changes", review: workflow.review })}
      onSubmitTransition={submitTransition}
      onAuthorizeManualIntake={authorizeManualIntake}
      onUpdateHandoff={updateHandoff}
      onRecordHandoffSent={recordHandoffSent}
      onOpenHandoffFailure={() => setPendingDetail({ kind: "ehr_failure" })}
      onConfirmDetail={(detail) => {
        const current = pendingDetail;
        setPendingDetail(null);
        if (!current) return;
        if (current.kind === "ehr_failure") updateHandoff("mark_failed", detail);
        else if (current.kind === "review_changes") requestReviewChanges(detail);
        else void saveRequirement(current.item, current.status, detail);
      }}
      onCloseDetail={() => setPendingDetail(null)}
      onOpenIntake={onOpenIntake}
      onOpenAssessment={onOpenAssessment}
      onOpenFiles={onOpenFiles}
      onOpenProfile={onOpenProfile}
    />
  );
}

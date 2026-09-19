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
  type PendingWorkflowDetail,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { createMutationId } from "@/lib/pipeline/referral-packet-upload";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import type { ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { AdmissionRequirement, AssessmentRecommendation, Referral, RequirementStatus } from "@/lib/pipeline/referral-types";
import assessmentStyles from "@/components/pipeline/AssessmentWorkingSection.module.css";

type ReferralWorkflowPanelProps = {
  referral: Referral;
  onReferralChange: (referral: Referral) => void;
  onOpenIntake: () => void;
  onOpenAssessment: () => void;
  onOpenFiles: () => void;
  onOpenEmail: () => void;
  onOpenProfile: (canonicalClientId: string) => void;
  onDone?: () => Promise<void>;
  compactRecommendation?: boolean;
  recommendationAssessmentId?: string;
  onSavingChange?: (saving: boolean) => void;
};

type RecommendationDraft = {
  outcome: AssessmentRecommendation["outcome"] | "";
  reasonCode: string;
  reasonNote: string;
};

export default function ReferralWorkflowPanel({
  referral,
  onReferralChange,
  onOpenIntake,
  onOpenAssessment,
  onOpenFiles,
  onOpenEmail,
  onOpenProfile,
  onDone,
  compactRecommendation = false,
  recommendationAssessmentId,
  onSavingChange,
}: ReferralWorkflowPanelProps) {
  const [workflow, setWorkflow] = useState<WorkflowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recommendationDraft, setRecommendationDraft] = useState<RecommendationDraft>({ outcome: "", reasonCode: "", reasonNote: "" });
  const [admissionDateDraft, setAdmissionDateDraft] = useState(referral.admissionDate ?? "");
  const [manualIntakeReason, setManualIntakeReason] = useState("");
  const [pendingDetail, setPendingDetail] = useState<PendingWorkflowDetail | null>(null);
  const mutationIds = useRef(new Map<string, string>());
  const recommendationDirty = useRef(false);
  const admissionDateDirty = useRef(false);

  const loadWorkflow = useCallback(async (signal?: AbortSignal) => {
    const payload = await fetchPipelineJson<WorkflowResponse>(`/api/referrals/${referral.id}/workflow`, {
      cache: "no-store",
      signal,
    });
    setWorkflow(payload);
    setError("");
    if (!recommendationDirty.current) {
      setRecommendationDraft({
        outcome: payload.decision ? (payload.decision.outcome === "accepted" ? "accept" : "decline") : payload.recommendation?.outcome ?? "",
        reasonCode: payload.recommendation?.reasonCode ?? "",
        reasonNote: payload.recommendation?.reasonNote ?? "",
      });
    }
    if (!admissionDateDirty.current) setAdmissionDateDraft(payload.referral.admissionDate ?? "");
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

  const clearSavedDraftState = (key: string) => {
    if (key.startsWith("recommendation:")) recommendationDirty.current = false;
    if (key.startsWith("decision:")) recommendationDirty.current = false;
    if (key.startsWith("admit-date:")) admissionDateDirty.current = false;
  };

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
    onSavingChange?.(true);
    setError("");
    setMessage("");
    try {
      const payload = await fetchPipelineJson<T>(url, {
        method,
        body: JSON.stringify({ ...body, client_mutation_id: clientMutationId }),
      });
      mutationIds.current.delete(key);
      if (payload.referral) onReferralChange(payload.referral);
      clearSavedDraftState(key);
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
      onSavingChange?.(false);
    }
  };

  if (loading && !workflow) return compactRecommendation ? <span className={assessmentStyles.recommendationStatus}>Loading recommendation...</span> : <ReferralWorkflowPanelLoading />;
  if (!workflow) return compactRecommendation ? <button type="button" onClick={() => void loadWorkflow().catch(() => setError("Recommendation unavailable. Try again."))}>Retry recommendation</button> : <WorkflowNotice tone="error">{error || "Workflow could not be loaded."}</WorkflowNotice>;

  const { currentReferral } = deriveWorkflowPanelView(workflow);
  const sections = normalizeReferralSectionVersions(currentReferral.sectionVersions);

  const saveRequirement = async (item: AdmissionRequirement, status: RequirementStatus, detail = "") => {
    const patch: Record<string, unknown> = { status };
    if (status === "requested") {
      patch.requestedFrom = detail;
      patch.followUpAt = item.followUpAt ?? "";
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

  const saveRecommendation = (draft: RecommendationDraft) => {
    if (!draft.outcome || compactRecommendation && (recommendationAssessmentId !== workflow.context.assessmentId || workflow.context.assessmentSigned)) return;
    void runMutation(
      `recommendation:${currentReferral.version}:${sections.decision}:${JSON.stringify(draft)}`,
      `/api/referrals/${currentReferral.id}/recommendation`,
      "PUT",
      {
        if_match: currentReferral.version,
        if_match_section: sections.decision,
        assessment_id: workflow.context.assessmentId,
        outcome: draft.outcome,
        reason_code: draft.reasonCode,
        reason_note: draft.reasonNote,
      },
      draft.outcome === "needs_more_information" ? "Under review saved. The referral remains open." : "Recommendation saved. You can keep editing and sign separately.",
    );
  };
  const submitDecision = () => {
    if (!recommendationDraft.outcome) return;
    if (recommendationDraft.outcome === "needs_more_information") {
      saveRecommendation(recommendationDraft);
      return;
    }
    const outcome = recommendationDraft.outcome === "accept" ? "accepted" : "declined";
    if (!window.confirm(decisionConfirmationMessage(outcome, false))) return;
    void runMutation(
      `decision:${currentReferral.version}:${sections.decision}:${JSON.stringify(recommendationDraft)}`,
      `/api/referrals/${currentReferral.id}/decision`,
      "PUT",
      {
        if_match: currentReferral.version,
        if_match_section: sections.decision,
        outcome,
        reason_code: recommendationDraft.reasonCode,
        reason_note: recommendationDraft.reasonNote,
      },
      "Decision recorded",
    );
  };

  const submitTransition = (target: ReferralStage) => {
    if (target === "Accepted / Admitted" && !window.confirm(
      "Mark this referral admitted? Missing dates and documents will remain visible and unresolved. This closes the active referral stage.",
    )) return;
    void runMutation(
      `transition:${target}:${currentReferral.version}`,
      `/api/referrals/${currentReferral.id}/transition`,
      "POST",
      { if_match: currentReferral.version, if_match_section: sections.workflow, target_stage: target },
      target === "Accepted / Admitted" ? "Admission recorded" : `Moved to ${target}`,
    );
  };

  const saveAdmissionDate = async (openPreview = true) => {
    if (workflow.decision?.outcome !== "accepted") {
      setError("Record an accepted decision before preparing Meet the Client.");
      return false;
    }
    if (admissionDateDraft === (currentReferral.admissionDate ?? "")) {
      if (!admissionDateDraft) setMessage("Admission date is not provided. You can still preview Meet the Client.");
      if (openPreview) onOpenEmail();
      return true;
    }
    const saved = await runMutation(
      `admit-date:${currentReferral.version}:${sections.intake}`,
      `/api/referrals/${currentReferral.id}`,
      "PATCH",
      { if_match: currentReferral.version, if_match_sections: { intake: sections.intake }, patch: { admissionDate: admissionDateDraft } },
      "Date of admit recorded",
    );
    if (saved && openPreview) onOpenEmail();
    return Boolean(saved);
  };

  const finishWorkspace = async () => {
    if (!onDone || busy) return;
    if (admissionDateDirty.current && !await saveAdmissionDate(false)) return;
    setBusy("done");
    try {
      await onDone();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The workspace could not be saved.");
    } finally {
      setBusy("");
    }
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

  if (compactRecommendation && recommendationAssessmentId !== workflow.context.assessmentId) return <span className={assessmentStyles.recommendationStatus}>Open the current assessment to recommend placement.</span>;
  if (compactRecommendation) return <div data-quick-recommendation className={assessmentStyles.quickRecommendation}>
    <label><span>Placement recommendation</span><select aria-label="Placement recommendation" value={workflow.decision ? (workflow.decision.outcome === "accepted" ? "accept" : "decline") : workflow.recommendation?.outcome ?? ""} disabled={Boolean(busy) || !workflow.capabilities.can_recommend || Boolean(workflow.context.assessmentSigned) || Boolean(workflow.decision)} onChange={(event) => {
      const next = { ...recommendationDraft, outcome: event.target.value as AssessmentRecommendation["outcome"] };
      recommendationDirty.current = true;
      setRecommendationDraft(next);
      saveRecommendation(next);
    }}>
      <option value="" disabled>Select recommendation</option>
      <option value="accept">Accept</option>
      <option value="decline">Deny</option>
      <option value="needs_more_information">Under review</option>
    </select></label>
    {error ? <span role="alert">{error}</span> : <span className={assessmentStyles.recommendationStatus} role="status">{busy ? "Saving..." : workflow.decision ? "Decision recorded" : message ? "Recommendation saved" : "Not a final admission decision"}</span>}
  </div>;

  return (
    <ReferralWorkflowPanelPresentation
      workflow={workflow}
      busy={busy}
      message={message}
      error={error}
      onDone={onDone && !recommendationDirty.current ? () => void finishWorkspace() : undefined}
      recommendation={recommendationDraft}
      admissionDate={admissionDateDraft}
      manualIntakeReason={manualIntakeReason}
      pendingDetail={pendingDetail}
      onRecommendationChange={(patch) => {
        recommendationDirty.current = true;
        setRecommendationDraft((current) => ({ ...current, ...patch }));
      }}
      onAdmissionDateChange={(value) => {
        admissionDateDirty.current = true;
        setAdmissionDateDraft(value);
      }}
      onSaveAdmissionDate={() => void saveAdmissionDate()}
      onManualIntakeReasonChange={setManualIntakeReason}
      onUpdateRequirement={updateRequirement}
      onSubmitDecision={submitDecision}
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

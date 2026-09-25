"use client";

import { getPlannedAdmissionDate } from "@/lib/pipeline/admission-lifecycle";
import { useConfirmationDialog } from "./useConfirmationDialog";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";

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
  transitionSuccessMessage,
  type PendingWorkflowDetail,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { createMutationId } from "@/lib/pipeline/referral-packet-upload";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import type { ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { AdmissionDecision, AdmissionRequirement, AssessmentRecommendation, Referral, RequirementStatus } from "@/lib/pipeline/referral-types";
import assessmentStyles from "@/components/pipeline/AssessmentWorkingSection.module.css";
import UnderReviewEmailDialog, { defaultUnderReviewMessage } from "./UnderReviewEmailDialog";

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
  beforeWorkspaceNavigationRef?: RefObject<(() => Promise<void>) | null>;
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
  beforeWorkspaceNavigationRef,
}: ReferralWorkflowPanelProps) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [workflow, setWorkflow] = useState<WorkflowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recommendationDraft, setRecommendationDraft] = useState<RecommendationDraft>({ outcome: "", reasonCode: "", reasonNote: "" });
  const [admissionDateDraft, setAdmissionDateDraft] = useState(getPlannedAdmissionDate(referral));
  const [manualIntakeReason, setManualIntakeReason] = useState("");
  const [pendingDetail, setPendingDetail] = useState<PendingWorkflowDetail | null>(null);
  const [emailRecommendation, setEmailRecommendation] = useState<AssessmentRecommendation | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [pendingRequirements, setPendingRequirements] = useState<Record<string, RequirementStatus>>({});
  const [requirementErrors, setRequirementErrors] = useState<Record<string, string>>({});
  const mutationIds = useRef(new Map<string, string>());
  const confirmedDecision = useRef<{ referral: Referral; decision: AdmissionDecision } | null>(null);
  const recommendationDirty = useRef(false);
  const admissionDateDirty = useRef(false);
  const mutationInFlight = useRef(false);
  const pendingRequirementIds = useRef(new Set<string>());
  const mutationTail = useRef<Promise<void>>(Promise.resolve());

  const guardNavigation = useEffectEvent(async () => {
    try {
      if (mutationInFlight.current || pendingRequirementIds.current.size > 0) throw new Error("Wait for the decision changes to finish saving before leaving.");
      if (recommendationDirty.current) {
        if (!await confirm({ title: "Leave without recording these changes?", message: "Your changes to the admission decision have not been recorded. Stay to finish them, or discard these changes and leave.", confirmLabel: "Discard changes", cancelLabel: "Keep editing" })) {
          throw new Error("Your decision changes are still open. Record them when you are ready.");
        }
        recommendationDirty.current = false;
      }
      if (admissionDateDirty.current && !await saveAdmissionDate(false)) throw new Error("The admission date could not be saved. Stay here and retry.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The decision changes could not be saved.");
      throw failure;
    }
  });
  useEffect(() => {
    if (compactRecommendation || !beforeWorkspaceNavigationRef) return;
    const guard = () => guardNavigation();
    beforeWorkspaceNavigationRef.current = guard;
    return () => { if (beforeWorkspaceNavigationRef.current === guard) beforeWorkspaceNavigationRef.current = null; };
  }, [beforeWorkspaceNavigationRef, compactRecommendation]);
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!mutationInFlight.current && pendingRequirementIds.current.size === 0 && !recommendationDirty.current && !admissionDateDirty.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);
  usePersonaSwitchSave(async () => {
    if (mutationInFlight.current || pendingRequirementIds.current.size > 0 || recommendationDirty.current || admissionDateDirty.current) throw new Error("Finish saving the decision changes before switching accounts.");
  });

  const loadWorkflow = useCallback(async (signal?: AbortSignal) => {
    if (confirmedDecision.current?.referral.id !== referral.id) confirmedDecision.current = null;
    const payload = await fetchPipelineJson<WorkflowResponse>(`/api/referrals/${referral.id}/workflow`, {
      cache: "no-store",
      signal,
    });
    const confirmed = confirmedDecision.current;
    if (confirmed && payload.decision?.decisionId !== confirmed.decision.decisionId) {
      if ((payload.referral.version ?? 0) <= (confirmed.referral.version ?? 0)) {
        // An older read must not reopen the form after the server confirmed the decision.
        setLoading(false);
        return { ...payload, referral: confirmed.referral, decision: confirmed.decision };
      }
      confirmedDecision.current = null;
    } else if (confirmed) {
      confirmedDecision.current = { ...confirmed, referral: payload.referral };
    }
    setWorkflow(payload);
    setError("");
    if (!recommendationDirty.current) {
      setRecommendationDraft({
        outcome: payload.decision ? (payload.decision.outcome === "accepted" ? "accept" : "decline") : payload.recommendation?.outcome ?? "",
        reasonCode: payload.recommendation?.reasonCode ?? "",
        reasonNote: payload.recommendation?.reasonNote ?? "",
      });
    }
    if (!admissionDateDirty.current) setAdmissionDateDraft(getPlannedAdmissionDate(payload.referral));
    setLoading(false);
    return payload;
  }, [referral.id]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadWorkflow(controller.signal).catch((loadError) => {
      if (!controller.signal.aborted) {
        if (confirmedDecision.current?.referral.id === referral.id) {
          setMessage("Decision recorded. The latest details could not refresh; reload the page to check them.");
          setError("");
        } else {
          setError(loadError instanceof Error ? loadError.message : "Workflow could not be loaded.");
        }
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [loadWorkflow, referral.id, referral.version]);

  const clearSavedDraftState = (key: string) => {
    if (key.startsWith("recommendation:")) recommendationDirty.current = false;
    if (key.startsWith("decision:")) recommendationDirty.current = false;
    if (key.startsWith("admit-date:")) admissionDateDirty.current = false;
  };

  const runMutation = async <T extends { referral?: Referral; decision?: AdmissionDecision }>(
    key: string,
    url: string,
    method: "PATCH" | "POST" | "PUT",
    body: Record<string, unknown>,
    successMessage: string,
    queueRequirement = false,
  ) => {
    if (!queueRequirement && (mutationInFlight.current || pendingRequirementIds.current.size > 0)) {
      setError("Another change is still saving. Try again when it finishes.");
      return null;
    }
    const perform = async (): Promise<T | null> => {
      mutationInFlight.current = true;
      const mutationKey = JSON.stringify([key, url, method, body]);
      const clientMutationId = mutationIds.current.get(mutationKey) ?? createMutationId();
      mutationIds.current.set(mutationKey, clientMutationId);
      setBusy(key);
      onSavingChange?.(true);
      setError("");
      setMessage("");
      try {
        let payload: T;
        try {
          payload = await fetchPipelineJson<T>(url, {
            method,
            body: JSON.stringify({ ...body, client_mutation_id: clientMutationId }),
          });
        } catch (mutationError) {
          if (key.startsWith("decision:")) {
            try {
              const latest = await loadWorkflow();
              onReferralChange(latest.referral);
              if (latest.decision) {
                confirmedDecision.current = { referral: latest.referral, decision: latest.decision };
                mutationIds.current.delete(mutationKey);
                clearSavedDraftState(key);
                setMessage(latest.decision.outcome === body.outcome
                  ? `${latest.decision.outcome === "accepted" ? "Acceptance" : "Denial"} is already recorded. Review the saved decision before continuing.`
                  : "A different decision is recorded. Review it before continuing.");
                return null;
              }
            } catch { /* Preserve the original save error when the decision cannot be read back. */ }
          } else if (mutationError instanceof PipelineApiError && mutationError.status === 409) {
            const latest = referralFromConflictPayload(mutationError.payload);
            if (latest) onReferralChange(latest);
            await loadWorkflow().catch(() => undefined);
          }
          const uncertainDecision = key.startsWith("decision:")
            && (!(mutationError instanceof PipelineApiError) || mutationError.status === 0 || mutationError.status === 499 || mutationError.status >= 500);
          setError(uncertainDecision
            ? "Could not confirm whether the decision was saved. Reload the workspace to check before trying again."
            : mutationError instanceof Error ? mutationError.message : "The workflow change could not be saved.");
          return null;
        }
        mutationIds.current.delete(mutationKey);
        if (key.startsWith("decision:") && payload.decision && payload.referral) {
          confirmedDecision.current = { referral: payload.referral, decision: payload.decision };
          setWorkflow((current) => current ? {
            ...current,
            referral: payload.referral ?? current.referral,
            decision: payload.decision ?? current.decision,
          } : current);
        }
        if (payload.referral) onReferralChange(payload.referral);
        clearSavedDraftState(key);
        setMessage(successMessage);
        try {
          await loadWorkflow();
        } catch {
          setMessage(`${successMessage}. The latest details could not refresh; reload the page to check them.`);
        }
        return payload;
      } finally {
        mutationInFlight.current = false;
        setBusy("");
        onSavingChange?.(false);
      }
    };
    const result = queueRequirement ? mutationTail.current.then(perform) : perform();
    mutationTail.current = result.then(() => undefined, () => undefined);
    return result;
  };

  if (loading && !workflow) return compactRecommendation ? <span className={assessmentStyles.recoveryButton}>Loading decision...</span> : <ReferralWorkflowPanelLoading />;
  if (!workflow) return compactRecommendation ? <button type="button" className={assessmentStyles.recoveryButton} onClick={() => void loadWorkflow().catch(() => setError("Decision unavailable. Try again."))}>Retry decision</button> : <WorkflowNotice tone="error">{error || "Workflow could not be loaded."}</WorkflowNotice>;

  const { currentReferral } = deriveWorkflowPanelView(workflow);
  const sections = normalizeReferralSectionVersions(currentReferral.sectionVersions);

  const saveRequirement = async (item: AdmissionRequirement, status: RequirementStatus, detail = "") => {
    if (pendingRequirementIds.current.has(item.id)) return;
    pendingRequirementIds.current.add(item.id);
    setPendingRequirements((current) => ({ ...current, [item.id]: status }));
    setRequirementErrors((current) => { const next = { ...current }; delete next[item.id]; return next; });
    const patch: Record<string, unknown> = { status };
    if (status === "requested") {
      patch.requestedFrom = detail;
      patch.followUpAt = item.followUpAt ?? "";
    }
    if (status === "waived") patch.waiverReason = detail;
    if (status === "unavailable" || status === "not_applicable") patch.unavailableReason = detail;
    try {
      const saved = await runMutation<{ referral?: Referral; work_item: AdmissionRequirement }>(
        `requirement:${item.id}:${item.version ?? 1}:${status}`,
        `/api/referrals/${currentReferral.id}/work-items/${item.id}`,
        "PATCH",
        { if_match: item.version ?? 1, patch },
        `${item.label} updated`,
        true,
      );
      if (saved) setWorkflow((current) => current ? {
        ...current,
        referral: saved.referral && (saved.referral.version ?? 0) >= (current.referral.version ?? 0) ? saved.referral : current.referral,
        work_items: current.work_items.map((entry) => entry.id === item.id && (entry.version ?? 1) <= (saved.work_item.version ?? 1) ? saved.work_item : entry),
      } : current);
      else setRequirementErrors((current) => ({ ...current, [item.id]: "Status not saved. Choose a status to retry." }));
    } catch {
      setRequirementErrors((current) => ({ ...current, [item.id]: "Status not saved. Choose a status to retry." }));
    } finally {
      pendingRequirementIds.current.delete(item.id);
      setPendingRequirements((current) => { const next = { ...current }; delete next[item.id]; return next; });
    }
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
    void runMutation<{ referral?: Referral; recommendation: AssessmentRecommendation }>(
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
      draft.outcome === "needs_more_information" ? "Under review saved. Review the email to Andrew and Sandeep before sending." : "Recommendation saved. You can keep editing and sign separately.",
    ).then((payload) => {
      if (draft.outcome !== "needs_more_information" || !payload) return;
      setEmailError("");
      setEmailRecommendation(payload.recommendation);
    });
  };
  const sendUnderReviewEmail = async (content: string) => {
    if (!emailRecommendation || emailSending) return;
    setEmailSending(true);
    setEmailError("");
    try {
      const result = await fetchPipelineJson<{ notification: "sent" | "already_requested" | "unavailable" | "failed" }>(`/api/referrals/${currentReferral.id}/under-review-email`, {
        method: "POST",
        body: JSON.stringify({ recommendation_id: emailRecommendation.recommendationId, recommendation_version: emailRecommendation.version, message: content }),
      });
      if (result.notification === "sent") {
        setMessage("Under review saved. Microsoft 365 accepted the email to Andrew and Sandeep.");
        setEmailRecommendation(null);
      } else setEmailError(result.notification === "already_requested" ? "This email is being sent already. Check Sent Items before trying again." : result.notification === "failed" ? "Microsoft 365 did not confirm the email. Check Sent Items and contact Andrew and Sandeep directly; this update will not resend automatically." : "Email is not configured here. Under Review remains saved; contact Andrew and Sandeep directly.");
    } catch (failure) {
      setEmailError(failure instanceof Error ? failure.message : "The email could not be sent.");
    } finally { setEmailSending(false); }
  };
  const emailDialog = emailRecommendation ? <UnderReviewEmailDialog key={`${emailRecommendation.recommendationId}:${emailRecommendation.version}`} referralId={currentReferral.id} initialMessage={defaultUnderReviewMessage(currentReferral.id, emailRecommendation.reasonNote)} sending={emailSending} error={emailError} onSend={(content) => void sendUnderReviewEmail(content)} onClose={() => setEmailRecommendation(null)} /> : null;
  const submitDecision = async () => {
    if (!recommendationDraft.outcome) return;
    if (recommendationDraft.outcome === "needs_more_information") {
      saveRecommendation(recommendationDraft);
      return;
    }
    const outcome = recommendationDraft.outcome === "accept" ? "accepted" : "declined";
    if (!await confirm({ title: outcome === "accepted" ? "Accept this referral?" : "Deny this referral?", message: decisionConfirmationMessage(outcome, false), confirmLabel: outcome === "accepted" ? "Record acceptance" : "Record denial", destructive: outcome === "declined" })) return;
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

  const submitTransition = async (target: ReferralStage, actualAdmissionDate?: string) => {
    if (target === "Accepted / Admitted" && !await confirm({ title: "Mark this referral admitted?", message: "Missing dates and documents will remain visible and unresolved. This closes the active referral stage.", confirmLabel: "Mark admitted" })) return;
    void runMutation(
      `transition:${target}:${currentReferral.version}`,
      `/api/referrals/${currentReferral.id}/transition`,
      "POST",
      { if_match: currentReferral.version, if_match_section: sections.workflow, target_stage: target, ...(actualAdmissionDate ? { actual_admission_date: actualAdmissionDate } : {}) },
      transitionSuccessMessage(target),
    );
  };

  const saveAdmissionDate = async (openPreview = true) => {
    if (workflow.decision?.outcome !== "accepted") {
      setError("Record an accepted decision before preparing Meet the Client.");
      return false;
    }
    if (admissionDateDraft === getPlannedAdmissionDate(currentReferral)) {
      if (openPreview) onOpenEmail();
      return true;
    }
    const saved = await runMutation(
      `admit-date:${currentReferral.version}:${sections.intake}`,
      `/api/referrals/${currentReferral.id}`,
      "PATCH",
      { if_match: currentReferral.version, if_match_sections: { intake: sections.intake }, patch: { plannedAdmissionDate: admissionDateDraft } },
      admissionDateDraft ? "Planned admit date saved" : "Planned admit date cleared",
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

  const recordHandoffSent = async () => {
    if (!await confirm({ title: "Record EHR handoff as sent?", message: "Confirm the downstream transfer succeeded before continuing.", confirmLabel: "Record as sent" })) return;
    updateHandoff("mark_sent");
  };

  if (compactRecommendation && recommendationAssessmentId !== workflow.context.assessmentId) return null;
  if (compactRecommendation) return <><div data-quick-recommendation data-outcome={workflow.decision ? (workflow.decision.outcome === "accepted" ? "accept" : "decline") : workflow.recommendation?.outcome ?? ""} className={assessmentStyles.quickRecommendation} aria-busy={Boolean(busy)}>
    <label><span>{workflow.decision ? "Recorded decision" : "Working decision"}</span><select aria-label={workflow.decision ? "Recorded decision" : "Working decision"} title={workflow.decision || workflow.context.assessmentSigned ? "Review this choice in Decision." : "Guides the next steps. Does not sign, send, or record final admission."} value={workflow.decision ? (workflow.decision.outcome === "accepted" ? "accept" : "decline") : workflow.recommendation?.outcome ?? ""} disabled={Boolean(busy) || !workflow.capabilities.can_recommend || Boolean(workflow.context.assessmentSigned) || Boolean(workflow.decision)} onChange={(event) => {
      const next = { ...recommendationDraft, outcome: event.target.value as AssessmentRecommendation["outcome"] };
      recommendationDirty.current = true;
      setRecommendationDraft(next);
      saveRecommendation(next);
    }}>
      <option value="" disabled>Choose...</option>
      <option value="accept">Accept</option>
      <option value="decline">Deny</option>
      <option value="needs_more_information">Under review</option>
    </select></label>
    {error ? <span role="alert">Not saved. {error}</span> : <span className="sr-only" role="status">{busy ? "Saving working decision..." : workflow.decision ? "Decision recorded" : message ? "Working decision saved" : "Not a final admission decision"}</span>}
  </div>{emailDialog}</>;

  return (
    <>{confirmationDialog}{emailDialog}<ReferralWorkflowPanelPresentation
      workflow={workflow}
      busy={busy || (Object.keys(pendingRequirements).length > 0 ? "requirement:queued" : "")}
      message={message}
      error={error}
      onDone={onDone && !recommendationDirty.current ? () => void finishWorkspace() : undefined}
      recommendation={recommendationDraft}
      admissionDate={admissionDateDraft}
      manualIntakeReason={manualIntakeReason}
      pendingDetail={pendingDetail}
      pendingRequirements={pendingRequirements}
      requirementErrors={requirementErrors}
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
      onOpenUnderReviewEmail={() => { if (workflow.recommendation?.outcome === "needs_more_information") { setEmailError(""); setEmailRecommendation(workflow.recommendation); } }}
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
    /></>
  );
}

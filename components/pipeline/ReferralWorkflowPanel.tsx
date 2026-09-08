"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, Circle, ClipboardCheck, LoaderCircle, Send, ShieldCheck } from "lucide-react";

import ActionDetailDialog from "@/components/pipeline/ActionDetailDialog";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { createMutationId } from "@/lib/pipeline/referral-packet-upload";
import { referralStageDefinitions, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import type {
  AdmissionDecision,
  AdmissionRequirement,
  AssessmentRecommendation,
  EhrHandoffStatus,
  Referral,
  RequirementStatus,
} from "@/lib/pipeline/referral-types";
import { isRequirementComplete } from "@/lib/pipeline/workflow-records";

type WorkflowResponse = {
  referral: Referral;
  context: {
    assessmentId?: string | null;
    assessmentSigned?: boolean;
  };
  work_items: AdmissionRequirement[];
  decision: AdmissionDecision | null;
  recommendation: AssessmentRecommendation | null;
  transitions: Array<{
    target: ReferralStage;
    blockers: Array<{ code: string; label: string }>;
  }>;
  capabilities: {
    can_update: boolean;
    can_recommend: boolean;
    can_decide: boolean;
    can_authorize_manual_intake: boolean;
  };
};

type ReferralWorkflowPanelProps = {
  referral: Referral;
  onReferralChange: (referral: Referral) => void;
  onOpenIntake: () => void;
  onOpenAssessment: () => void;
  onOpenFiles: () => void;
};

type PendingWorkflowDetail =
  | { kind: "requirement"; item: AdmissionRequirement; status: RequirementStatus }
  | { kind: "ehr_failure" };

type DecisionOutcomeDraft = AdmissionDecision["outcome"] | "";

const requirementStatuses: Array<{ value: RequirementStatus; label: string }> = [
  { value: "needed", label: "Needed" },
  { value: "requested", label: "Requested" },
  { value: "received", label: "Received" },
  { value: "reviewed", label: "Reviewed" },
  { value: "waived", label: "Waived" },
  { value: "unavailable", label: "Unavailable" },
  { value: "not_applicable", label: "Not applicable" },
];

export default function ReferralWorkflowPanel({
  referral,
  onReferralChange,
  onOpenIntake,
  onOpenAssessment,
  onOpenFiles,
}: ReferralWorkflowPanelProps) {
  const [workflow, setWorkflow] = useState<WorkflowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recommendationOutcome, setRecommendationOutcome] = useState<AssessmentRecommendation["outcome"]>("accept");
  const [recommendationCode, setRecommendationCode] = useState("");
  const [recommendationNote, setRecommendationNote] = useState("");
  const [decisionOutcome, setDecisionOutcome] = useState<DecisionOutcomeDraft>("");
  const [decisionCode, setDecisionCode] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
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
      setRecommendationOutcome(payload.recommendation?.outcome ?? "accept");
      setRecommendationCode(payload.recommendation?.reasonCode ?? "");
      setRecommendationNote(payload.recommendation?.reasonNote ?? "");
    }
    if (!decisionDirty.current) {
      setDecisionOutcome(payload.decision?.outcome ?? "");
      setDecisionCode(payload.decision?.reasonCode ?? "");
      setDecisionNote(payload.decision?.reasonNote ?? "");
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
        setOverrideReason("");
      }
      setMessage(successMessage);
      await loadWorkflow();
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof PipelineApiError && mutationError.status === 409) {
        const latest = referralFromError(mutationError);
        if (latest) onReferralChange(latest);
        await loadWorkflow().catch(() => undefined);
      }
      setError(mutationError instanceof Error ? mutationError.message : "The workflow change could not be saved.");
      return null;
    } finally {
      setBusy("");
    }
  };

  if (loading && !workflow) {
    return <div className="flex min-h-64 items-center justify-center gap-2 text-[12px] text-[#737373]"><LoaderCircle className="animate-spin" size={16} /> Loading admission workflow...</div>;
  }
  if (!workflow) {
    return <WorkflowNotice tone="error">{error || "Workflow could not be loaded."}</WorkflowNotice>;
  }

  const currentReferral = workflow.referral;
  const sections = normalizeReferralSectionVersions(currentReferral.sectionVersions);
  const forwardTransition = workflow.transitions.find((transition) => transition.target !== "Declined");
  const incompleteMoveIn = workflow.work_items.filter((item) => item.requiredFor === "move_in" && item.blocker && !isRequirementComplete(item.status));
  const handoffStatus = currentReferral.ehrHandoff?.status ?? "not_ready";
  const decisionDisclosureIsOpen = shouldOpenDecisionDisclosure(workflow);
  const decisionDisclosureKey = disclosureState(decisionDisclosureIsOpen);

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
    if (["requested", "waived", "unavailable", "not_applicable"].includes(status)) {
      setPendingDetail({ kind: "requirement", item, status });
      return;
    }
    void saveRequirement(item, status);
  };

  const submitDecision = () => {
    if (!decisionOutcome) return;
    if (!window.confirm(decisionConfirmationMessage(decisionOutcome, Boolean(workflow.decision)))) return;
    void runMutation(
      `decision:${currentReferral.version}:${sections.decision}`,
      `/api/referrals/${currentReferral.id}/decision`,
      "PUT",
      { if_match: currentReferral.version, if_match_section: sections.decision, outcome: decisionOutcome, reason_code: decisionCode, reason_note: decisionNote, override_reason: overrideReason },
      workflow.decision ? "Supervisor decision updated" : "Supervisor decision recorded",
    );
  };

  const recordHandoffSent = () => {
    if (!window.confirm("Record this EHR handoff as sent? Confirm the downstream transfer succeeded before continuing.")) return;
    void updateHandoff("mark_sent");
  };

  const renderStageProgress = () => (
    <div className="grid gap-px border-y border-[#d9d9d9] bg-[#d9d9d9] sm:grid-cols-4 xl:grid-cols-7">
      {referralStageDefinitions.map((definition) => {
        const active = definition.stage === currentReferral.stage;
        const complete = referralStageDefinitions.findIndex((item) => item.stage === currentReferral.stage) > referralStageDefinitions.findIndex((item) => item.stage === definition.stage)
          && !(currentReferral.stage === "Declined" && definition.stage === "Accepted / Admitted");
        return (
          <div key={definition.stage} className={`min-w-0 bg-white px-3 py-3 ${active ? "shadow-[inset_0_-3px_0_#0f8b73]" : ""}`}>
            <div className="flex items-center gap-2 text-[10px] font-black text-[#202522]">{complete ? <Check size={13} className="text-[#0f8b73]" /> : <Circle size={11} className={active ? "fill-[#0f8b73] text-[#0f8b73]" : "text-[#a0a0a0]"} />}<span className="truncate">{definition.label}</span></div>
          </div>
        );
      })}
    </div>
  );

  const renderCurrentGate = () => (
    <WorkflowCard icon={<ClipboardCheck size={17} />} title="Current gate" detail={currentReferral.stage}>
      {forwardTransition ? (
        <>
          {forwardTransition.blockers.length > 0 ? (
            <div className="space-y-2">
              {forwardTransition.blockers.map((blocker) => <div key={blocker.code} className="text-[11px] leading-5 text-[#7a4c0d]">{blocker.label}</div>)}
              <div className="flex flex-wrap gap-2 pt-1">
                <SecondaryButton onClick={onOpenIntake}>Open intake</SecondaryButton>
                <SecondaryButton onClick={onOpenFiles}>Open files</SecondaryButton>
                <SecondaryButton onClick={onOpenAssessment}>Open assessment</SecondaryButton>
              </div>
            </div>
          ) : (
            <PrimaryButton
              busy={busy === `transition:${forwardTransition.target}`}
              disabled={!workflow.capabilities.can_update}
              onClick={() => void runMutation(
                `transition:${forwardTransition.target}:${currentReferral.version}`,
                `/api/referrals/${currentReferral.id}/transition`,
                "POST",
                { if_match: currentReferral.version, if_match_section: sections.workflow, target_stage: forwardTransition.target },
                `Moved to ${forwardTransition.target}`,
              )}
            >Advance to {forwardTransition.target}</PrimaryButton>
          )}
        </>
      ) : <div className="flex items-center gap-2 text-[11px] font-black text-[#0f6f5e]"><CheckCircle2 size={15} /> This referral is in a terminal stage.</div>}

      {!currentReferral.manualIntakeAuthorization && workflow.capabilities.can_authorize_manual_intake && ["New", "Packet Needed"].includes(currentReferral.stage) ? (
        <div className="mt-4 border-t border-[#e3e6e4] pt-4">
          <label className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]" htmlFor="manual-intake-reason">Chart-only exception</label>
          <textarea id="manual-intake-reason" value={manualIntakeReason} onChange={(event) => setManualIntakeReason(event.target.value)} rows={2} placeholder="Explain why intake must proceed without packet extraction" className="mt-2 w-full border border-[#c9ceca] px-3 py-2 text-[11px] outline-none focus:border-[#0f8b73]" />
          <SecondaryButton disabled={manualIntakeReason.trim().length < 10 || Boolean(busy)} onClick={() => void runMutation(
            `manual-intake:${currentReferral.version}`,
            `/api/referrals/${currentReferral.id}/manual-intake`,
            "POST",
            { if_match: currentReferral.version, if_match_section: sections.documents, reason: manualIntakeReason.trim() },
            "Manual chart intake authorized",
          )}>Authorize manual intake</SecondaryButton>
        </div>
      ) : null}
    </WorkflowCard>
  );

  const renderClinicalRecommendation = () => (
    <WorkflowDisclosure
      key={`recommendation-${workflow.context.assessmentId || workflow.recommendation ? "ready" : "pending"}`}
      icon={<ShieldCheck size={17} />}
      title="Clinical recommendation"
      detail={workflow.context.assessmentSigned ? "Signed assessment available" : "Assessment signature required"}
      defaultOpen={Boolean(workflow.context.assessmentId || workflow.recommendation)}
    >
      {workflow.recommendation ? <RecordSummary title={`${formatOutcome(workflow.recommendation.outcome)} recommendation`} actor={workflow.recommendation.recommendedByName} date={workflow.recommendation.recommendedAt} note={workflow.recommendation.reasonNote} /> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <WorkflowSelect label="Recommendation" value={recommendationOutcome} onChange={(value) => { recommendationDirty.current = true; setRecommendationOutcome(value as AssessmentRecommendation["outcome"]); }} options={[{ value: "accept", label: "Recommend acceptance" }, { value: "decline", label: "Recommend decline" }, { value: "needs_more_information", label: "Needs more information" }]} />
        <WorkflowInput label="Reason code (optional)" value={recommendationCode} onChange={(value) => { recommendationDirty.current = true; setRecommendationCode(value); }} />
      </div>
      <WorkflowTextArea label="Clinical rationale" value={recommendationNote} onChange={(value) => { recommendationDirty.current = true; setRecommendationNote(value); }} />
      <PrimaryButton
        busy={busy.startsWith("recommendation:")}
        disabled={!workflow.capabilities.can_recommend || !workflow.context.assessmentId || (recommendationOutcome !== "accept" && !recommendationNote.trim())}
        onClick={() => void runMutation(
          `recommendation:${currentReferral.version}:${sections.decision}`,
          `/api/referrals/${currentReferral.id}/recommendation`,
          "PUT",
          { if_match: currentReferral.version, if_match_section: sections.decision, assessment_id: workflow.context.assessmentId, outcome: recommendationOutcome, reason_code: recommendationCode, reason_note: recommendationNote },
          "Recommendation submitted",
        )}
      >Submit recommendation</PrimaryButton>
    </WorkflowDisclosure>
  );

  const renderSupervisorDecision = () => (
    <WorkflowDisclosure
      key={`decision-${decisionDisclosureKey}`}
      icon={<CheckCircle2 size={17} />}
      title="Supervisor decision"
      detail={workflow.capabilities.can_decide ? "Supervisor authority" : "Visible to the assigned team"}
      defaultOpen={decisionDisclosureIsOpen}
    >
      {workflow.decision ? <RecordSummary title={`${formatOutcome(workflow.decision.outcome)} decision`} actor={workflow.decision.decidedByName} date={workflow.decision.decidedAt} note={workflow.decision.reasonNote} /> : null}
      {workflow.capabilities.can_decide ? (
        <>
          <DecisionReadiness workflow={workflow} outcome={decisionOutcome} note={decisionNote} overrideReason={overrideReason} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <WorkflowSelect label="Decision" value={decisionOutcome} onChange={(value) => { decisionDirty.current = true; setDecisionOutcome(value as DecisionOutcomeDraft); }} options={[{ value: "", label: "Select a decision" }, { value: "accepted", label: "Accept" }, { value: "declined", label: "Decline" }]} />
            <WorkflowInput label="Reason code (optional)" value={decisionCode} onChange={(value) => { decisionDirty.current = true; setDecisionCode(value); }} />
          </div>
          <WorkflowTextArea label="Decision rationale (required for decline)" value={decisionNote} onChange={(value) => { decisionDirty.current = true; setDecisionNote(value); }} />
          {!workflow.recommendation ? <WorkflowTextArea label="Supervisor override reason" value={overrideReason} onChange={(value) => { decisionDirty.current = true; setOverrideReason(value); }} /> : null}
          <PrimaryButton
            busy={busy.startsWith("decision:")}
            disabled={decisionSubmissionIsBlocked(workflow, decisionOutcome, decisionNote, overrideReason)}
            onClick={submitDecision}
          >{workflow.decision ? "Update decision" : "Record decision"}</PrimaryButton>
        </>
      ) : null}
    </WorkflowDisclosure>
  );

  const renderRequirements = () => (
    <WorkflowCard icon={<ClipboardCheck size={17} />} title="Admission requirements" detail={`${incompleteMoveIn.length} blocking move-in item${incompleteMoveIn.length === 1 ? "" : "s"} remaining`}>
      <div className="divide-y divide-[#e4e7e5] border-y border-[#d9d9d9]">
        {workflow.work_items.map((item) => (
          <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-black text-[#202522]">{isRequirementComplete(item.status) ? <Check size={13} className="text-[#0f8b73]" /> : <Circle size={11} className="text-[#a0a0a0]" />}<span>{item.label}</span>{item.blocker ? <span className="text-[9px] font-black uppercase text-[#9a6115]">Required</span> : null}</div>
              <div className="mt-1 text-[10px] leading-4 text-[#737373]">{item.nextStep}</div>
            </div>
            <select aria-label={`${item.label} status`} value={item.status} disabled={!workflow.capabilities.can_update || Boolean(busy)} onChange={(event) => updateRequirement(item, event.target.value as RequirementStatus)} className="h-9 w-full border border-[#c9ceca] bg-white px-2 text-[10px] font-black outline-none focus:border-[#0f8b73]">
              {requirementStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </WorkflowCard>
  );

  const renderEhrHandoff = () => (
    <WorkflowDisclosure
      key={`ehr-${currentReferral.stage === "Accepted / Admitted" || handoffStatus !== "not_ready" ? "ready" : "pending"}`}
      icon={<Send size={17} />}
      title="EHR handoff"
      detail={handoffDescription(handoffStatus)}
      defaultOpen={currentReferral.stage === "Accepted / Admitted" || handoffStatus !== "not_ready"}
    >
      <div className="flex flex-wrap gap-2">
        {handoffStatus === "failed" ? <PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update} onClick={() => void updateHandoff("retry")}>Retry handoff</PrimaryButton> : null}
        {handoffStatus !== "queued" && handoffStatus !== "sent" && handoffStatus !== "failed" ? <PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update || currentReferral.stage !== "Accepted / Admitted"} onClick={() => void updateHandoff("queue")}>Queue EHR handoff</PrimaryButton> : null}
        {handoffStatus === "queued" ? <><PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update} onClick={recordHandoffSent}>Record sent</PrimaryButton><SecondaryButton disabled={Boolean(busy)} onClick={() => setPendingDetail({ kind: "ehr_failure" })}>Record failed</SecondaryButton></> : null}
        {handoffStatus === "sent" ? <div className="flex items-center gap-2 text-[11px] font-black text-[#0f6f5e]"><CheckCircle2 size={15} /> Handoff recorded as sent.</div> : null}
      </div>
    </WorkflowDisclosure>
  );

  return (
    <section aria-label="Admission workflow" className="space-y-6 py-2 sm:px-2">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Admission workflow</div>
        <h2 className="mt-1 text-[22px] font-black text-[#111111]">From referral to handoff</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[#68716c]">Complete the current gate, record the clinical recommendation, obtain the supervisor decision, finish admission requirements, and prepare the EHR handoff.</p>
      </div>

      {message ? <WorkflowNotice tone="success">{message}</WorkflowNotice> : null}
      {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}

      {renderStageProgress()}
      <DecisionHandoffOverview workflow={workflow} incompleteMoveIn={incompleteMoveIn} handoffStatus={handoffStatus} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-5">
          {renderCurrentGate()}
          {renderClinicalRecommendation()}
          {renderSupervisorDecision()}
        </div>

        <div className="space-y-5">
          {renderRequirements()}
          {renderEhrHandoff()}
        </div>
      </div>
      {pendingDetail ? (
        <WorkflowDetailDialog
          pending={pendingDetail}
          onConfirm={(detail) => {
            const current = pendingDetail;
            setPendingDetail(null);
            if (current.kind === "ehr_failure") {
              void updateHandoff("mark_failed", detail);
            } else {
              void saveRequirement(current.item, current.status, detail);
            }
          }}
          onClose={() => setPendingDetail(null)}
        />
      ) : null}
    </section>
  );

  async function updateHandoff(action: "queue" | "mark_sent" | "mark_failed" | "retry", failureReason = "") {
    await runMutation(
      `ehr:${action}:${currentReferral.version}:${sections.decision}`,
      `/api/referrals/${currentReferral.id}/ehr-handoff`,
      "POST",
      { if_match: currentReferral.version, if_match_section: sections.decision, action, failure_reason: failureReason },
      action === "mark_sent" ? "EHR handoff recorded as sent" : action === "mark_failed" ? "EHR handoff failure recorded" : "EHR handoff queued",
    );
  }
}

function WorkflowCard({ icon, title, detail, children }: { icon: React.ReactNode; title: string; detail: string; children: React.ReactNode }) {
  return <section className="border border-[#d9d9d9] bg-white"><header className="flex items-center gap-3 border-b border-[#e4e7e5] bg-[#f8faf9] px-4 py-3"><span className="text-[#0f8b73]">{icon}</span><div><h3 className="text-[12px] font-black text-[#202522]">{title}</h3><p className="mt-0.5 text-[10px] text-[#737373]">{detail}</p></div></header><div className="p-4">{children}</div></section>;
}

function WorkflowDisclosure({
  icon,
  title,
  detail,
  defaultOpen,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="group border border-[#d9d9d9] bg-white" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 bg-[#f8faf9] px-4 py-3 outline-none hover:bg-[#f2f6f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] [&::-webkit-details-marker]:hidden">
        <span className="text-[#0f8b73]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-black text-[#202522]">{title}</span>
          <span className="mt-0.5 block text-[10px] text-[#737373]">{detail}</span>
        </span>
        <ChevronDown size={15} className="text-[#737373] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[#e4e7e5] p-4">{children}</div>
    </details>
  );
}

function WorkflowDetailDialog({
  pending,
  onConfirm,
  onClose,
}: {
  pending: PendingWorkflowDetail;
  onConfirm: (detail: string) => void;
  onClose: () => void;
}) {
  if (pending.kind === "ehr_failure") {
    return (
      <ActionDetailDialog
        title="Record EHR handoff failure"
        description="This reason is recorded in the referral activity log for follow-up."
        label="Failure reason"
        confirmLabel="Record failure"
        minimumLength={3}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
  }

  const presentation = requirementDetailPresentation(pending.item, pending.status);
  return <ActionDetailDialog {...presentation} onConfirm={onConfirm} onClose={onClose} />;
}

function requirementDetailPresentation(item: AdmissionRequirement, status: RequirementStatus) {
  if (status === "requested") {
    return {
      title: `Request ${item.label}`,
      description: "Record who is expected to provide this item. Pipeline will set a seven-day follow-up when none exists.",
      label: "Expected provider",
      initialValue: item.requestedFrom ?? "",
      confirmLabel: "Mark requested",
      minimumLength: 1,
    };
  }
  if (status === "waived") {
    return {
      title: `Waive ${item.label}`,
      description: "The waiver and its reason remain visible in the referral record.",
      label: "Waiver reason",
      initialValue: item.waiverReason ?? "",
      confirmLabel: "Record waiver",
      minimumLength: 3,
    };
  }
  return {
    title: status === "unavailable" ? `Mark ${item.label} unavailable` : `Mark ${item.label} not applicable`,
    description: "Record why this requirement cannot or does not need to be completed.",
    label: "Reason",
    initialValue: item.unavailableReason ?? "",
    confirmLabel: status === "unavailable" ? "Mark unavailable" : "Mark not applicable",
    minimumLength: 3,
  };
}

function shouldOpenDecisionDisclosure(workflow: WorkflowResponse) {
  return Boolean(workflow.recommendation || workflow.decision || (workflow.capabilities.can_decide && workflow.context.assessmentSigned));
}

function disclosureState(open: boolean) {
  return open ? "ready" : "pending";
}

function DecisionHandoffOverview({
  workflow,
  incompleteMoveIn,
  handoffStatus,
}: {
  workflow: WorkflowResponse;
  incompleteMoveIn: AdmissionRequirement[];
  handoffStatus: EhrHandoffStatus;
}) {
  const declined = workflow.decision?.outcome === "declined";
  const steps = [
    { label: "Assessment", value: workflow.context.assessmentSigned ? "Signed" : "Signature needed", complete: Boolean(workflow.context.assessmentSigned) },
    { label: "Recommendation", value: workflow.recommendation ? formatOutcome(workflow.recommendation.outcome) : "Not recorded", complete: Boolean(workflow.recommendation) },
    { label: "Supervisor decision", value: workflow.decision ? formatOutcome(workflow.decision.outcome) : "Not recorded", complete: Boolean(workflow.decision) },
    { label: "EHR handoff", value: declined ? "Not required" : handoffDescription(handoffStatus), complete: declined || handoffStatus === "sent" },
  ];
  return (
    <section aria-label="Decision and handoff readiness" className="border border-[#cfd8d3] bg-[#f8faf9]">
      <div className="grid gap-px bg-[#dfe5e2] sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <div key={step.label} className="bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#68716c]">
              {step.complete ? <CheckCircle2 size={13} className="text-[#0f8b73]" /> : <Circle size={11} className="text-[#a0a0a0]" />}
              {step.label}
            </div>
            <div className="mt-1 text-[11px] font-black text-[#202522]">{step.value}</div>
          </div>
        ))}
      </div>
      <p className="border-t border-[#dfe5e2] px-4 py-3 text-[11px] font-semibold leading-5 text-[#4f5c57]">{decisionHandoffNextAction(workflow, incompleteMoveIn, handoffStatus)}</p>
    </section>
  );
}

function DecisionReadiness({
  workflow,
  outcome,
  note,
  overrideReason,
}: {
  workflow: WorkflowResponse;
  outcome: DecisionOutcomeDraft;
  note: string;
  overrideReason: string;
}) {
  const items = [
    { label: "Signed assessment", complete: Boolean(workflow.context.assessmentSigned) },
    { label: workflow.recommendation ? `${formatOutcome(workflow.recommendation.outcome)} recommendation recorded` : "Supervisor override documented", complete: Boolean(workflow.recommendation || overrideReason.trim()) },
    { label: outcome ? `${formatOutcome(outcome)} selected` : "Decision selected", complete: Boolean(outcome) },
    ...(outcome === "declined" ? [{ label: "Decline rationale documented", complete: Boolean(note.trim()) }] : []),
  ];
  return (
    <section aria-label="Supervisor decision readiness" className="mt-3 border-l-2 border-[#0f8b73] bg-[#f3faf7] px-3 py-3">
      <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#176f60]">Decision readiness</div>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.label} className={`flex items-center gap-2 text-[10px] font-bold ${item.complete ? "text-[#285b50]" : "text-[#7a4c0d]"}`}>
            {item.complete ? <CheckCircle2 size={13} /> : <Circle size={11} />}
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function decisionHandoffNextAction(
  workflow: WorkflowResponse,
  incompleteMoveIn: AdmissionRequirement[],
  handoffStatus: EhrHandoffStatus,
) {
  if (!workflow.context.assessmentSigned) return "Complete and sign the assessment before the decision can be recorded.";
  if (!workflow.recommendation && !workflow.decision) return "Record the clinical recommendation, or document a supervisor override with the decision.";
  if (!workflow.decision) return "The signed assessment and clinical recommendation are ready for supervisor review.";
  if (workflow.decision.outcome === "declined") return "The referral is closed by the supervisor's decline decision; no EHR handoff is required.";
  return acceptedHandoffNextAction(workflow, incompleteMoveIn, handoffStatus);
}

function acceptedHandoffNextAction(
  workflow: WorkflowResponse,
  incompleteMoveIn: AdmissionRequirement[],
  handoffStatus: EhrHandoffStatus,
) {
  if (incompleteMoveIn.length > 0) return `${incompleteMoveIn.length} required move-in item${incompleteMoveIn.length === 1 ? " remains" : "s remain"} before admission.`;
  if (workflow.referral.stage !== "Accepted / Admitted") return "Admission requirements are complete. Advance the referral to Accepted / Admitted.";
  if (handoffStatus === "queued") return "Confirm the downstream transfer, then record the handoff as sent or failed.";
  if (handoffStatus === "failed") return "Review the recorded failure, correct the downstream issue, and retry the handoff.";
  if (handoffStatus === "sent") return "The accepted referral and EHR handoff are complete.";
  return "The accepted referral is ready to queue for EHR handoff.";
}

function decisionConfirmationMessage(outcome: AdmissionDecision["outcome"], updating: boolean) {
  const action = updating ? "Update" : "Record";
  const effect = outcome === "declined"
    ? "This closes the referral and writes the decision to its activity history."
    : "This advances the referral into post-assessment admission work and writes the decision to its activity history.";
  return `${action} the ${outcome} admission decision? ${effect}`;
}

function decisionSubmissionIsBlocked(
  workflow: WorkflowResponse,
  outcome: DecisionOutcomeDraft,
  note: string,
  overrideReason: string,
) {
  return !outcome
    || !workflow.context.assessmentSigned
    || (outcome === "declined" && !note.trim())
    || (!workflow.recommendation && !overrideReason.trim());
}

function WorkflowNotice({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  return <div role={tone === "error" ? "alert" : "status"} className={`border-l-2 px-4 py-3 text-[11px] font-semibold ${tone === "error" ? "border-[#a63d2f] bg-[#fff5f2] text-[#8b3328]" : "border-[#0f8b73] bg-[#effaf5] text-[#174f43]"}`}>{children}</div>;
}

function PrimaryButton({ busy, disabled, onClick, children }: { busy?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={disabled || busy} onClick={onClick} className="mt-3 inline-flex h-9 items-center gap-2 bg-[#111111] px-4 text-[10px] font-black text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={13} /> : null}{children}</button>;
}

function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="mt-3 h-9 border border-[#bfc8c4] bg-white px-3 text-[10px] font-black text-[#174f43] hover:border-[#0f8b73] disabled:opacity-40">{children}</button>;
}

function WorkflowInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">{label}</span><input value={value} maxLength={128} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full border border-[#c9ceca] px-3 text-[11px] outline-none focus:border-[#0f8b73]" /></label>;
}

function WorkflowTextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="mt-3 block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">{label}</span><textarea value={value} maxLength={20_000} rows={3} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full resize-y border border-[#c9ceca] px-3 py-2 text-[11px] leading-5 outline-none focus:border-[#0f8b73]" /></label>;
}

function WorkflowSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function RecordSummary({ title, actor, date, note }: { title: string; actor: string; date: string; note: string }) {
  return <div className="border-l-2 border-[#0f8b73] bg-[#f3faf7] px-3 py-2"><div className="text-[11px] font-black text-[#174f43]">{title}</div><div className="mt-0.5 text-[9px] text-[#597068]">{actor} · {new Date(date).toLocaleString()}</div>{note ? <div className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-[#40534d]">{note}</div> : null}</div>;
}

function formatOutcome(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function handoffDescription(status: EhrHandoffStatus) {
  if (status === "sent") return "Sent and recorded";
  if (status === "queued") return "Queued for transfer";
  if (status === "failed") return "Failed; reason recorded";
  if (status === "ready") return "Ready to queue";
  return "Available after acceptance";
}

function referralFromError(error: PipelineApiError) {
  const payload = error.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const referral = (payload as { referral?: unknown }).referral;
  return referral && typeof referral === "object" && !Array.isArray(referral) ? referral as Referral : null;
}

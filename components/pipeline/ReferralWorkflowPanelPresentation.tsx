import { useState, type ReactNode } from "react";
import { Check, CheckCircle2, ChevronDown, Circle, ClipboardCheck, LoaderCircle, Send, ShieldCheck } from "lucide-react";

import ActionDetailDialog from "@/components/pipeline/ActionDetailDialog";
import ReferralClientActivationPanel from "@/components/pipeline/ReferralClientActivationPanel";
import {
  admissionReadinessLabel,
  admissionRequirementSummary,
  decisionHandoffNextAction,
  decisionSubmissionIsBlocked,
  deriveWorkflowPanelView,
  formatOutcome,
  formatRequirementStatus,
  handoffDescription,
  requirementDetailPresentation,
  requirementGroups,
  requirementStatuses,
  requirementStatusDetail,
  resolvedRequirementCount,
  terminalStageMessage,
  transitionActionLabel,
  type DecisionOutcomeDraft,
  type PendingWorkflowDetail,
  type RequirementGroupPresentation,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import { referralStageDefinitions, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { AdmissionRequirement, AssessmentRecommendation, AssessmentReview, EhrHandoffStatus, RequirementStatus } from "@/lib/pipeline/referral-types";
import { isRequirementComplete } from "@/lib/pipeline/workflow-records";

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

type HandoffActionProps = {
  workflow: WorkflowResponse;
  currentReferral: WorkflowResponse["referral"];
  busy: string;
  ehrIsBlocked: boolean;
  onUpdateHandoff: (action: "queue" | "retry") => void;
  onRecordHandoffSent: () => void;
  onOpenHandoffFailure: () => void;
};

const handoffContentByStatus: Record<EhrHandoffStatus, (props: HandoffActionProps) => ReactNode> = {
  failed: ({ workflow, busy, ehrIsBlocked, onUpdateHandoff }) => <PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update || ehrIsBlocked} onClick={() => onUpdateHandoff("retry")}>Retry handoff</PrimaryButton>,
  queued: ({ workflow, busy, onRecordHandoffSent, onOpenHandoffFailure }) => <><PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update} onClick={onRecordHandoffSent}>Record sent</PrimaryButton><SecondaryButton disabled={Boolean(busy)} onClick={onOpenHandoffFailure}>Record failed</SecondaryButton></>,
  sent: () => <div className="space-y-2"><div className="flex items-center gap-2 text-[11px] font-black text-[#0f6f5e]"><CheckCircle2 size={15} /> Handoff recorded as sent.</div><p className="text-[10px] leading-4 text-[#68716c]">The admitted-client profile appears only after the governed Alamo roster contains the person and an explicit identity link is confirmed.</p></div>,
  ready: (props) => <QueueHandoffButton {...props} />,
  not_ready: (props) => <QueueHandoffButton {...props} />,
};

type ReferralWorkflowPanelPresentationProps = {
  workflow: WorkflowResponse;
  busy: string;
  message: string;
  error: string;
  recommendation: RecommendationDraft;
  decision: DecisionDraft;
  manualIntakeReason: string;
  pendingDetail: PendingWorkflowDetail | null;
  onRecommendationChange: (patch: Partial<RecommendationDraft>) => void;
  onDecisionChange: (patch: Partial<DecisionDraft>) => void;
  onManualIntakeReasonChange: (value: string) => void;
  onUpdateRequirement: (item: AdmissionRequirement, status: RequirementStatus) => void;
  onSubmitRecommendation: () => void;
  onSubmitDecision: () => void;
  onRequestReviewChanges: () => void;
  onSubmitTransition: (target: ReferralStage) => void;
  onAuthorizeManualIntake: () => void;
  onUpdateHandoff: (action: "queue" | "retry") => void;
  onRecordHandoffSent: () => void;
  onOpenHandoffFailure: () => void;
  onConfirmDetail: (detail: string) => void;
  onCloseDetail: () => void;
  onOpenIntake: () => void;
  onOpenAssessment: () => void;
  onOpenFiles: () => void;
  onOpenProfile: (canonicalClientId: string) => void;
};

export function ReferralWorkflowPanelPresentation({
  workflow,
  busy,
  message,
  error,
  recommendation,
  decision,
  manualIntakeReason,
  pendingDetail,
  onRecommendationChange,
  onDecisionChange,
  onManualIntakeReasonChange,
  onUpdateRequirement,
  onSubmitRecommendation,
  onSubmitDecision,
  onRequestReviewChanges,
  onSubmitTransition,
  onAuthorizeManualIntake,
  onUpdateHandoff,
  onRecordHandoffSent,
  onOpenHandoffFailure,
  onConfirmDetail,
  onCloseDetail,
  onOpenIntake,
  onOpenAssessment,
  onOpenFiles,
  onOpenProfile,
}: ReferralWorkflowPanelPresentationProps) {
  const view = deriveWorkflowPanelView(workflow);
  const {
    currentReferral,
    incompleteDecision,
    incompleteMoveIn,
    incompleteEhr,
    handoffStatus,
  } = view;

  return (
    <section aria-label="Admission workflow" className="space-y-6 py-2 sm:px-2">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Admission workflow</div>
        <h2 className="mt-1 text-[22px] font-black text-[#111111]">From referral to handoff</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[#68716c]">Complete the current gate, record the clinical recommendation, obtain the supervisor decision, finish admission requirements, and prepare the EHR handoff.</p>
      </div>

      {message ? <WorkflowNotice tone="success">{message}</WorkflowNotice> : null}
      {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}

      <StageProgress currentStage={currentReferral.stage} />
      <DecisionHandoffOverview workflow={workflow} incompleteDecision={incompleteDecision} incompleteMoveIn={incompleteMoveIn} incompleteEhr={incompleteEhr} handoffStatus={handoffStatus} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <WorkflowPrimaryColumn
          workflow={workflow}
          view={view}
          busy={busy}
          recommendation={recommendation}
          decision={decision}
          manualIntakeReason={manualIntakeReason}
          onRecommendationChange={onRecommendationChange}
          onDecisionChange={onDecisionChange}
          onManualIntakeReasonChange={onManualIntakeReasonChange}
          onSubmitRecommendation={onSubmitRecommendation}
          onSubmitDecision={onSubmitDecision}
          onRequestReviewChanges={onRequestReviewChanges}
          onSubmitTransition={onSubmitTransition}
          onAuthorizeManualIntake={onAuthorizeManualIntake}
          onOpenIntake={onOpenIntake}
          onOpenAssessment={onOpenAssessment}
          onOpenFiles={onOpenFiles}
        />
        <WorkflowSecondaryColumn
          workflow={workflow}
          view={view}
          busy={busy}
          onUpdateRequirement={onUpdateRequirement}
          onUpdateHandoff={onUpdateHandoff}
          onRecordHandoffSent={onRecordHandoffSent}
          onOpenHandoffFailure={onOpenHandoffFailure}
          onOpenProfile={onOpenProfile}
        />
      </div>

      {pendingDetail ? <WorkflowDetailDialog pending={pendingDetail} onConfirm={onConfirmDetail} onClose={onCloseDetail} /> : null}
    </section>
  );
}

type WorkflowView = ReturnType<typeof deriveWorkflowPanelView>;

function WorkflowPrimaryColumn({
  workflow,
  view,
  busy,
  recommendation,
  decision,
  manualIntakeReason,
  onRecommendationChange,
  onDecisionChange,
  onManualIntakeReasonChange,
  onSubmitRecommendation,
  onSubmitDecision,
  onRequestReviewChanges,
  onSubmitTransition,
  onAuthorizeManualIntake,
  onOpenIntake,
  onOpenAssessment,
  onOpenFiles,
}: Pick<ReferralWorkflowPanelPresentationProps,
  "workflow" | "busy" | "recommendation" | "decision" | "manualIntakeReason" | "onRecommendationChange" | "onDecisionChange" |
  "onManualIntakeReasonChange" | "onSubmitRecommendation" | "onSubmitDecision" | "onRequestReviewChanges" | "onSubmitTransition" | "onAuthorizeManualIntake" |
  "onOpenIntake" | "onOpenAssessment" | "onOpenFiles"
> & { view: WorkflowView }) {
  return (
    <div className="space-y-5">
      <CurrentGateCard workflow={workflow} view={view} busy={busy} manualIntakeReason={manualIntakeReason} onManualIntakeReasonChange={onManualIntakeReasonChange} onSubmitTransition={onSubmitTransition} onAuthorizeManualIntake={onAuthorizeManualIntake} onOpenIntake={onOpenIntake} onOpenAssessment={onOpenAssessment} onOpenFiles={onOpenFiles} />
      <ClinicalRecommendationDisclosure workflow={workflow} busy={busy} recommendation={recommendation} onRecommendationChange={onRecommendationChange} onSubmitRecommendation={onSubmitRecommendation} />
      <SupervisorDecisionDisclosure workflow={workflow} view={view} busy={busy} decision={decision} onDecisionChange={onDecisionChange} onSubmitDecision={onSubmitDecision} onRequestReviewChanges={onRequestReviewChanges} />
    </div>
  );
}

function CurrentGateCard({
  workflow,
  view,
  busy,
  manualIntakeReason,
  onManualIntakeReasonChange,
  onSubmitTransition,
  onAuthorizeManualIntake,
  onOpenIntake,
  onOpenAssessment,
  onOpenFiles,
}: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "manualIntakeReason" | "onManualIntakeReasonChange" | "onSubmitTransition" | "onAuthorizeManualIntake" | "onOpenIntake" | "onOpenAssessment" | "onOpenFiles"> & { view: WorkflowView }) {
  const { currentReferral, forwardTransition } = view;
  return (
    <WorkflowCard icon={<ClipboardCheck size={17} />} title="Current gate" detail={currentReferral.stage}>
      {forwardTransition ? (
        forwardTransition.blockers.length > 0 ? (
          <div className="space-y-2">
            {forwardTransition.blockers.map((blocker) => <div key={blocker.code} className="text-[11px] leading-5 text-[#7a4c0d]">{blocker.label}</div>)}
            <div className="flex flex-wrap gap-2 pt-1"><SecondaryButton onClick={onOpenIntake}>Open intake</SecondaryButton><SecondaryButton onClick={onOpenFiles}>Open files</SecondaryButton><SecondaryButton onClick={onOpenAssessment}>Open assessment</SecondaryButton></div>
          </div>
        ) : <PrimaryButton busy={busy === `transition:${forwardTransition.target}`} disabled={!workflow.capabilities.can_update} onClick={() => onSubmitTransition(forwardTransition.target)}>{transitionActionLabel(forwardTransition.target)}</PrimaryButton>
      ) : <div className="flex items-center gap-2 text-[11px] font-black text-[#0f6f5e]"><CheckCircle2 size={15} /> {terminalStageMessage(currentReferral)}</div>}

      {!currentReferral.manualIntakeAuthorization && workflow.capabilities.can_authorize_manual_intake && ["New", "Packet Needed"].includes(currentReferral.stage) ? (
        <div className="mt-4 border-t border-[#e3e6e4] pt-4">
          <label className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]" htmlFor="manual-intake-reason">Chart-only exception</label>
          <textarea id="manual-intake-reason" value={manualIntakeReason} onChange={(event) => onManualIntakeReasonChange(event.target.value)} rows={2} placeholder="Explain why intake must proceed without packet extraction" className="mt-2 w-full border border-[#c9ceca] px-3 py-2 text-[11px] outline-none focus:border-[#0f8b73]" />
          <SecondaryButton disabled={manualIntakeReason.trim().length < 10 || Boolean(busy)} onClick={onAuthorizeManualIntake}>Authorize manual intake</SecondaryButton>
        </div>
      ) : null}
    </WorkflowCard>
  );
}

function ClinicalRecommendationDisclosure({ workflow, busy, recommendation, onRecommendationChange, onSubmitRecommendation }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "recommendation" | "onRecommendationChange" | "onSubmitRecommendation">) {
  return (
    <WorkflowDisclosure key={`recommendation-${workflow.context.assessmentId || workflow.recommendation ? "ready" : "pending"}`} icon={<ShieldCheck size={17} />} title="Clinical recommendation" detail={workflow.context.assessmentSigned ? "Signed assessment available" : "Assessment signature required"} defaultOpen={Boolean(workflow.context.assessmentId || workflow.recommendation)}>
      {workflow.recommendation ? <RecordSummary title={`${formatOutcome(workflow.recommendation.outcome)} recommendation`} actor={workflow.recommendation.recommendedByName} date={workflow.recommendation.recommendedAt} note={workflow.recommendation.reasonNote} /> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <WorkflowSelect label="Recommendation" value={recommendation.outcome} onChange={(value) => onRecommendationChange({ outcome: value as AssessmentRecommendation["outcome"] })} options={[{ value: "accept", label: "Recommend acceptance" }, { value: "decline", label: "Recommend decline" }, { value: "needs_more_information", label: "Needs more information" }]} />
        <WorkflowInput label="Reason code (optional)" value={recommendation.reasonCode} onChange={(reasonCode) => onRecommendationChange({ reasonCode })} />
      </div>
      <WorkflowTextArea label="Clinical rationale" value={recommendation.reasonNote} onChange={(reasonNote) => onRecommendationChange({ reasonNote })} />
      <PrimaryButton busy={busy.startsWith("recommendation:")} disabled={!workflow.capabilities.can_recommend || !workflow.context.assessmentId || workflow.review?.status === "submitted" || (recommendation.outcome !== "accept" && !recommendation.reasonNote.trim())} onClick={onSubmitRecommendation}>Submit for supervisor review</PrimaryButton>
    </WorkflowDisclosure>
  );
}

function SupervisorDecisionDisclosure({ workflow, view, busy, decision, onDecisionChange, onSubmitDecision, onRequestReviewChanges }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "decision" | "onDecisionChange" | "onSubmitDecision" | "onRequestReviewChanges"> & { view: WorkflowView }) {
  return (
    <WorkflowDisclosure key={`decision-${view.decisionDisclosureKey}`} icon={<CheckCircle2 size={17} />} title="Supervisor decision" detail={workflow.capabilities.can_decide ? "Supervisor authority" : "Visible to the assigned team"} defaultOpen={view.decisionDisclosureIsOpen}>
      {workflow.decision ? <RecordSummary title={`${formatOutcome(workflow.decision.outcome)} decision`} actor={workflow.decision.decidedByName} date={workflow.decision.decidedAt} note={workflow.decision.reasonNote} /> : null}
      {workflow.review ? <ReviewSummary review={workflow.review} /> : null}
      {workflow.capabilities.can_decide && !workflow.decision ? (
        <>
          <DecisionReadiness workflow={workflow} outcome={decision.outcome} note={decision.reasonNote} incompleteDecision={view.incompleteDecision} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><WorkflowSelect label="Decision" value={decision.outcome} onChange={(value) => onDecisionChange({ outcome: value as DecisionOutcomeDraft })} options={[{ value: "", label: "Select a decision" }, { value: "accepted", label: "Accept" }, { value: "declined", label: "Decline" }]} /><WorkflowInput label="Reason code (optional)" value={decision.reasonCode} onChange={(reasonCode) => onDecisionChange({ reasonCode })} /></div>
          <WorkflowTextArea label="Decision rationale (required for decline)" value={decision.reasonNote} onChange={(reasonNote) => onDecisionChange({ reasonNote })} />
          {!workflow.review ? <WorkflowNotice tone="error">Submit a signed assessment and recommendation for supervisor review before recording a final decision.</WorkflowNotice> : null}
          <div className="flex flex-wrap gap-2">
            <PrimaryButton busy={busy.startsWith("decision:")} disabled={decisionSubmissionIsBlocked(workflow, decision.outcome, decision.reasonNote, view.incompleteDecision)} onClick={onSubmitDecision}>Record final decision</PrimaryButton>
            {workflow.review?.status === "submitted" && workflow.capabilities.can_request_changes ? <SecondaryButton disabled={Boolean(busy)} onClick={onRequestReviewChanges}>Request changes</SecondaryButton> : null}
          </div>
        </>
      ) : null}
    </WorkflowDisclosure>
  );
}

function WorkflowSecondaryColumn({ workflow, view, busy, onUpdateRequirement, onUpdateHandoff, onRecordHandoffSent, onOpenHandoffFailure, onOpenProfile }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "onUpdateRequirement" | "onUpdateHandoff" | "onRecordHandoffSent" | "onOpenHandoffFailure" | "onOpenProfile"> & { view: WorkflowView }) {
  return (
    <div className="space-y-5">
      <WorkflowCard icon={<ClipboardCheck size={17} />} title="Admission requirements" detail={admissionRequirementSummary(workflow.work_items)}><div className="space-y-5">{requirementGroups(workflow.work_items).map((group) => <RequirementGroup key={group.label} group={group} disabled={!workflow.capabilities.can_update || Boolean(busy)} onChange={onUpdateRequirement} />)}</div></WorkflowCard>
      <EhrHandoffDisclosure workflow={workflow} view={view} busy={busy} onUpdateHandoff={onUpdateHandoff} onRecordHandoffSent={onRecordHandoffSent} onOpenHandoffFailure={onOpenHandoffFailure} />
      {view.currentReferral.stage === "Accepted / Admitted" ? <ReferralClientActivationPanel referralId={view.currentReferral.id} canReconcile={workflow.capabilities.can_reconcile_identity} canReview={workflow.capabilities.can_review_identity} onOpenProfile={onOpenProfile} /> : null}
    </div>
  );
}

function EhrHandoffDisclosure({ workflow, view, busy, onUpdateHandoff, onRecordHandoffSent, onOpenHandoffFailure }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "onUpdateHandoff" | "onRecordHandoffSent" | "onOpenHandoffFailure"> & { view: WorkflowView }) {
  const { currentReferral, handoffStatus, ehrIsBlocked } = view;
  const ready = currentReferral.stage === "Accepted / Admitted" || handoffStatus !== "not_ready";
  const handoffContent = handoffContentByStatus[handoffStatus];
  return (
    <WorkflowDisclosure key={`ehr-${ready ? "ready" : "pending"}`} icon={<Send size={17} />} title="EHR handoff" detail={handoffDescription(handoffStatus)} defaultOpen={ready}>
      <div className="flex flex-wrap gap-2">
        {handoffContent({ workflow, currentReferral, busy, ehrIsBlocked, onUpdateHandoff, onRecordHandoffSent, onOpenHandoffFailure })}
      </div>
    </WorkflowDisclosure>
  );
}

function QueueHandoffButton({ workflow, currentReferral, busy, ehrIsBlocked, onUpdateHandoff }: HandoffActionProps) {
  return <PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update || currentReferral.stage !== "Accepted / Admitted" || ehrIsBlocked} onClick={() => onUpdateHandoff("queue")}>Queue EHR handoff</PrimaryButton>;
}

export function ReferralWorkflowPanelLoading() {
  return <div className="flex min-h-64 items-center justify-center gap-2 text-[12px] text-[#737373]"><LoaderCircle className="animate-spin" size={16} /> Loading admission workflow...</div>;
}

const noticePresentation = {
  error: { role: "alert", className: "border-[#a63d2f] bg-[#fff5f2] text-[#8b3328]" },
  success: { role: "status", className: "border-[#0f8b73] bg-[#effaf5] text-[#174f43]" },
} as const;

export function WorkflowNotice({ tone, children }: { tone: "success" | "error"; children: ReactNode }) {
  const presentation = noticePresentation[tone];
  return <div role={presentation.role} className={`border-l-2 px-4 py-3 text-[11px] font-semibold ${presentation.className}`}>{children}</div>;
}

function StageProgress({ currentStage }: { currentStage: ReferralStage }) {
  const currentIndex = referralStageDefinitions.findIndex((item) => item.stage === currentStage);
  return (
    <div className="grid gap-px border-y border-[#d9d9d9] bg-[#d9d9d9] sm:grid-cols-4 xl:grid-cols-7">
      {referralStageDefinitions.map((definition, index) => {
        const active = definition.stage === currentStage;
        const complete = currentIndex > index && !(currentStage === "Declined" && definition.stage === "Accepted / Admitted");
        return (
          <div key={definition.stage} className={`min-w-0 bg-white px-3 py-3 ${active ? "shadow-[inset_0_-3px_0_#0f8b73]" : ""}`}>
            <div className="flex items-center gap-2 text-[10px] font-black text-[#202522]">{complete ? <Check size={13} className="text-[#0f8b73]" /> : <Circle size={11} className={active ? "fill-[#0f8b73] text-[#0f8b73]" : "text-[#a0a0a0]"} />}<span className="truncate">{definition.label}</span></div>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowCard({ icon, title, detail, children }: { icon: ReactNode; title: string; detail: string; children: ReactNode }) {
  return <section className="border border-[#d9d9d9] bg-white"><header className="flex items-center gap-3 border-b border-[#e4e7e5] bg-[#f8faf9] px-4 py-3"><span className="text-[#0f8b73]">{icon}</span><div><h3 className="text-[12px] font-black text-[#202522]">{title}</h3><p className="mt-0.5 text-[10px] text-[#737373]">{detail}</p></div></header><div className="p-4">{children}</div></section>;
}

function WorkflowDisclosure({ icon, title, detail, defaultOpen, children }: { icon: ReactNode; title: string; detail: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="group border border-[#d9d9d9] bg-white" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 bg-[#f8faf9] px-4 py-3 outline-none hover:bg-[#f2f6f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] [&::-webkit-details-marker]:hidden">
        <span className="text-[#0f8b73]">{icon}</span>
        <span className="min-w-0 flex-1"><span className="block text-[12px] font-black text-[#202522]">{title}</span><span className="mt-0.5 block text-[10px] text-[#737373]">{detail}</span></span>
        <ChevronDown size={15} className="text-[#737373] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[#e4e7e5] p-4">{children}</div>
    </details>
  );
}

function WorkflowDetailDialog({ pending, onConfirm, onClose }: { pending: PendingWorkflowDetail; onConfirm: (detail: string) => void; onClose: () => void }) {
  if (pending.kind === "ehr_failure") {
    return <ActionDetailDialog title="Record EHR handoff failure" description="This reason is recorded in the referral activity log for follow-up." label="Failure reason" confirmLabel="Record failure" minimumLength={3} onConfirm={onConfirm} onClose={onClose} />;
  }
  if (pending.kind === "review_changes") {
    return <ActionDetailDialog title="Request assessment changes" description="The signed submission remains frozen. Pipeline will create a new editable revision and record these correction instructions in activity." label="Specific corrections" confirmLabel="Request changes" minimumLength={3} onConfirm={onConfirm} onClose={onClose} />;
  }
  return <ActionDetailDialog {...requirementDetailPresentation(pending.item, pending.status)} onConfirm={onConfirm} onClose={onClose} />;
}

function RequirementGroup({ group, disabled, onChange }: { group: RequirementGroupPresentation; disabled: boolean; onChange: (item: AdmissionRequirement, status: RequirementStatus) => void }) {
  return (
    <section aria-label={`${group.label} requirements`}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div><h4 className="text-[10px] font-black uppercase tracking-[0.08em] text-[#44504b]">{group.label}</h4><p className="mt-0.5 text-[9px] text-[#737c77]">{group.detail}</p></div>
        <span className="shrink-0 text-[9px] font-black text-[#68716c]">{resolvedRequirementCount(group.items)} / {group.items.length} resolved</span>
      </div>
      <div className="divide-y divide-[#e4e7e5] border-y border-[#d9d9d9]">
        {group.items.map((item) => (
          <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-[#202522]">{isRequirementComplete(item.status) ? <Check size={13} className="text-[#0f8b73]" /> : <Circle size={11} className="text-[#a0a0a0]" />}<span>{item.label}</span>{item.blocker ? <span className="text-[9px] font-black uppercase text-[#9a6115]">Required</span> : null}</div>
              <div className="mt-1 text-[10px] leading-4 text-[#737373]">{requirementStatusDetail(item)}</div>
            </div>
            <select aria-label={`${item.label} status`} value={item.status} disabled={disabled} onChange={(event) => onChange(item, event.target.value as RequirementStatus)} className="h-9 w-full border border-[#c9ceca] bg-white px-2 text-[10px] font-black outline-none focus:border-[#0f8b73]">{requirementStatuses.map((status) => <option key={status} value={status}>{formatRequirementStatus(status)}</option>)}</select>
          </div>
        ))}
      </div>
    </section>
  );
}

function DecisionHandoffOverview({ workflow, incompleteDecision, incompleteMoveIn, incompleteEhr, handoffStatus }: { workflow: WorkflowResponse; incompleteDecision: AdmissionRequirement[]; incompleteMoveIn: AdmissionRequirement[]; incompleteEhr: AdmissionRequirement[]; handoffStatus: ReturnType<typeof deriveWorkflowPanelView>["handoffStatus"] }) {
  const declined = workflow.decision?.outcome === "declined";
  const admitted = workflow.referral.stage === "Accepted / Admitted";
  const admissionBlockers = incompleteDecision.length + incompleteMoveIn.length;
  const steps = [
    { label: "Assessment", value: workflow.context.assessmentSigned ? "Signed" : "Signature needed", complete: Boolean(workflow.context.assessmentSigned) },
    { label: "Recommendation", value: workflow.recommendation ? formatOutcome(workflow.recommendation.outcome) : "Not recorded", complete: Boolean(workflow.recommendation) },
    { label: "Supervisor decision", value: workflow.decision ? formatOutcome(workflow.decision.outcome) : "Not recorded", complete: Boolean(workflow.decision) },
    { label: "Admission", value: admissionReadinessLabel(workflow, admissionBlockers), complete: declined || admitted },
    { label: "EHR handoff", value: declined ? "Not required" : handoffDescription(handoffStatus), complete: declined || handoffStatus === "sent" },
  ];
  return (
    <section aria-label="Decision and handoff readiness" className="border border-[#cfd8d3] bg-[#f8faf9]">
      <div className="grid gap-px bg-[#dfe5e2] sm:grid-cols-2 xl:grid-cols-5">{steps.map((step) => <div key={step.label} className="bg-white px-4 py-3"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#68716c]">{step.complete ? <CheckCircle2 size={13} className="text-[#0f8b73]" /> : <Circle size={11} className="text-[#a0a0a0]" />}{step.label}</div><div className="mt-1 text-[11px] font-black text-[#202522]">{step.value}</div></div>)}</div>
      <p className="border-t border-[#dfe5e2] px-4 py-3 text-[11px] font-semibold leading-5 text-[#4f5c57]">{decisionHandoffNextAction(workflow, incompleteDecision, incompleteMoveIn, incompleteEhr, handoffStatus)}</p>
    </section>
  );
}

function DecisionReadiness({ workflow, outcome, note, incompleteDecision }: { workflow: WorkflowResponse; outcome: DecisionOutcomeDraft; note: string; incompleteDecision: AdmissionRequirement[] }) {
  const items = [
    { label: "Signed assessment", complete: Boolean(workflow.context.assessmentSigned) },
    { label: workflow.review?.status === "submitted" ? "Supervisor review is open" : "Submit for supervisor review", complete: workflow.review?.status === "submitted" },
    { label: workflow.recommendation ? `${formatOutcome(workflow.recommendation.outcome)} recommendation recorded` : "Recommendation required", complete: Boolean(workflow.recommendation) },
    { label: incompleteDecision.length === 0 ? "Decision requirements resolved" : `${incompleteDecision.length} decision requirement${incompleteDecision.length === 1 ? "" : "s"} remaining`, complete: incompleteDecision.length === 0 },
    { label: outcome ? `${formatOutcome(outcome)} selected` : "Decision selected", complete: Boolean(outcome) },
    ...(outcome === "declined" ? [{ label: "Decline rationale documented", complete: Boolean(note.trim()) }] : []),
  ];
  return <section aria-label="Supervisor decision readiness" className="mt-3 border-l-2 border-[#0f8b73] bg-[#f3faf7] px-3 py-3"><div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#176f60]">Decision readiness</div><ul className="mt-2 grid gap-2 sm:grid-cols-2">{items.map((item) => <li key={item.label} className={`flex items-center gap-2 text-[10px] font-bold ${item.complete ? "text-[#285b50]" : "text-[#7a4c0d]"}`}>{item.complete ? <CheckCircle2 size={13} /> : <Circle size={11} />}{item.label}</li>)}</ul></section>;
}

function PrimaryButton({ busy, disabled, onClick, children }: { busy?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled || busy} onClick={onClick} className="mt-3 inline-flex h-9 items-center gap-2 bg-[#111111] px-4 text-[10px] font-black text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={13} /> : null}{children}</button>;
}

function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: ReactNode }) {
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

function ReviewSummary({ review }: { review: AssessmentReview }) {
  const label = {
    submitted: "Awaiting supervisor review",
    changes_requested: "Changes requested",
    approved_for_placement: "Approved for placement",
    not_accepted: "Not accepted",
  }[review.status];
  return (
    <div className="mt-3 border border-[#dfe5e2] bg-white px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-black text-[#202522]">Review {review.submissionNumber} · {label}</div>
        <div className="text-[9px] font-bold text-[#68716c]">Signed assessment v{review.assessmentVersion}</div>
      </div>
      <div className="mt-1 text-[9px] text-[#68716c]">Submitted by {review.submittedByName} · {new Date(review.submittedAt).toLocaleString()}</div>
      {review.reviewNote ? <div className="mt-2 whitespace-pre-wrap text-[10px] leading-4 text-[#40534d]">{review.reviewNote}</div> : null}
    </div>
  );
}

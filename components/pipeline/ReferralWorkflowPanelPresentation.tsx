import ReferralAdmissionPanel from "./ReferralAdmissionPanel";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Clock3, LoaderCircle, Minus } from "lucide-react";

import ActionDetailDialog from "@/components/pipeline/ActionDetailDialog";
import ReferralClientActivationPanel from "@/components/pipeline/ReferralClientActivationPanel";
import {
  admissionRequirementSummary,
  decisionActionState,
  decisionProgressSteps,
  deriveWorkflowPanelView,
  formatRecordedAt,
  formatRequirementStatus,
  handoffDescription,
  hasLegacyDecisionSubmission,
  recommendationPresentation,
  requirementDetailPresentation,
  requirementGroups,
  requirementStatuses,
  requirementStatusDetail,
  resolvedRequirementCount,
  terminalStageMessage,
  transitionActionLabel,
  type DecisionProgressStep,
  type PendingWorkflowDetail,
  type RequirementGroupPresentation,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import { getStageLabel, referralStageDefinitions, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { AdmissionRequirement, AssessmentRecommendation, EhrHandoffStatus, RequirementStatus } from "@/lib/pipeline/referral-types";
import { isRequirementComplete } from "@/lib/pipeline/workflow-records";
import styles from "./ReferralDecision.module.css";
import { useDesignV2 } from "@/components/design/DesignSwitch";

type RecommendationDraft = {
  outcome: AssessmentRecommendation["outcome"] | "";
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
  sent: () => <div className="space-y-2"><div className="flex items-center gap-2 text-[14px] font-bold text-[#0f6f5e]"><CheckCircle2 size={15} /> Handoff recorded as sent.</div><p className="text-[10px] leading-4 text-[#68716c]">The admitted-client profile appears only after the governed Alamo roster contains the person and an explicit identity link is confirmed.</p></div>,
  ready: (props) => <QueueHandoffButton {...props} />,
  not_ready: (props) => <QueueHandoffButton {...props} />,
};

type ReferralWorkflowPanelPresentationProps = {
  workflow: WorkflowResponse;
  busy: string;
  message: string;
  error: string;
  recommendation: RecommendationDraft;
  admissionDate: string;
  manualIntakeReason: string;
  pendingDetail: PendingWorkflowDetail | null;
  onRecommendationChange: (patch: Partial<RecommendationDraft>) => void;
  onAdmissionDateChange: (value: string) => void;
  onSaveAdmissionDate: () => void;
  onManualIntakeReasonChange: (value: string) => void;
  onUpdateRequirement: (item: AdmissionRequirement, status: RequirementStatus) => void;
  onSubmitDecision: () => void;
  onOpenUnderReviewEmail?: () => void;
  onSubmitTransition: (target: ReferralStage, actualAdmissionDate?: string) => void;
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
  onDone?: () => void;
};

export function ReferralWorkflowPanelPresentation({
  workflow,
  busy,
  message,
  error,
  recommendation,
  admissionDate,
  manualIntakeReason,
  pendingDetail,
  onRecommendationChange,
  onAdmissionDateChange,
  onSaveAdmissionDate,
  onManualIntakeReasonChange,
  onUpdateRequirement,
  onSubmitDecision,
  onOpenUnderReviewEmail,
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
  onDone,
}: ReferralWorkflowPanelPresentationProps) {
  const view = deriveWorkflowPanelView(workflow);
  const resultRef = useRef<HTMLDivElement>(null);
  const focusedDecision = useRef(workflow.decision?.decisionId);
  const decisionId = workflow.decision?.decisionId;
  useEffect(() => {
    if (message === "Decision recorded" && decisionId && focusedDecision.current !== decisionId) {
      resultRef.current?.focus();
      focusedDecision.current = decisionId;
    }
  }, [decisionId, message]);

  return (
    <section data-guide-target="workspace-decision" aria-label="Admission decision" className={styles.page}>
      <DecisionPageHeading workflow={workflow} />
      {message ? <div className={message === "Decision recorded" ? "sr-only" : undefined}><WorkflowNotice tone="success">{message}</WorkflowNotice></div> : null}
      {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}

      <div className={styles.layout}>
        <div className={styles.main} ref={resultRef} {...recordedDecisionAttributes(workflow)}>
          <DecisionCard workflow={workflow} busy={busy} recommendation={recommendation} onRecommendationChange={onRecommendationChange} onSubmitDecision={onSubmitDecision} onOpenUnderReviewEmail={onOpenUnderReviewEmail} />
          {workflow.decision?.outcome === "accepted" ? <AdmissionHandoff workflow={workflow} busy={busy} admissionDate={admissionDate} onAdmissionDateChange={onAdmissionDateChange} onSaveAdmissionDate={onSaveAdmissionDate} /> : null}
          {showDecisionDone(workflow) && onDone ? (
            <div className={styles.done}>
              <p>{workflow.decision ? "No client handoff is needed." : "The referral stays open. Return when you have more information."}</p>
              <PrimaryButton busy={busy === "done"} disabled={Boolean(busy)} onClick={onDone}>Done</PrimaryButton>
            </div>
          ) : null}
        </div>
        <DecisionContext workflow={workflow} busy={busy} recommendation={recommendation} onOpenAssessment={onOpenAssessment} />
      </div>
      <details className={styles.details}>
          <summary>Admission paperwork &amp; EHR handoff</summary>
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
      </details>
      <details className={styles.details} data-admin-controls>
          <summary>Administrative controls</summary>
          <p className={styles.adminNote}>For authorized staff. These change the referral&apos;s stage or grant a manual intake exception. They do not record the decision, sign the assessment, or send anything.</p>
          <label className="mb-4 flex flex-wrap items-center gap-3 text-[14px] font-medium text-[#59645e]">Referral stage
            <select aria-label="Workflow stage" value={workflow.referral.stage} disabled={Boolean(busy) || !workflow.capabilities.can_update} onChange={(event) => onSubmitTransition(event.target.value as ReferralStage)} className="h-11 border border-[#c9ceca] bg-white px-3 text-[#303b34]">
              {referralStageDefinitions.filter((item) => !item.terminal || item.stage === workflow.referral.stage || (item.stage === "Declined" && workflow.decision?.outcome === "declined")).map((item) => <option key={item.stage} value={item.stage}>{item.label}</option>)}
            </select>
            <span>Changing the stage only moves the referral; nothing else is recorded.</span>
          </label>
          <CurrentGateCard workflow={workflow} view={view} busy={busy} manualIntakeReason={manualIntakeReason} onManualIntakeReasonChange={onManualIntakeReasonChange} onSubmitTransition={onSubmitTransition} onAuthorizeManualIntake={onAuthorizeManualIntake} onOpenIntake={onOpenIntake} onOpenAssessment={onOpenAssessment} onOpenFiles={onOpenFiles} />
      </details>

      {pendingDetail ? <WorkflowDetailDialog pending={pendingDetail} onConfirm={onConfirmDetail} onClose={onCloseDetail} /> : null}
    </section>
  );
}

type WorkflowView = ReturnType<typeof deriveWorkflowPanelView>;

function DecisionContext({ workflow, busy, recommendation, onOpenAssessment }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "recommendation" | "onOpenAssessment">) {
  const outcome = workflow.decision?.outcome ?? recommendation.outcome;
  const next = decisionNextStep(outcome);
  return <aside className={styles.context} aria-label="Decision context">
    <div className={styles.client}><span>Client</span><h4>{workflow.referral.name || "Name not provided"}</h4><p>{workflow.referral.community || "Community not selected"}</p></div>
    <div className={styles.assessmentState}>
      <span id="decision-progress-heading">Where this referral stands</span>
      <ol className={styles.progress} aria-labelledby="decision-progress-heading">{decisionProgressSteps(workflow).map((step) => <ProgressStep key={step.key} step={step} />)}</ol>
      <button type="button" disabled={Boolean(busy)} onClick={onOpenAssessment}>{decisionAssessmentAction(workflow)}<ArrowRight size={16} aria-hidden="true" /></button>
    </div>
    <div className={styles.consequence}><h4>{workflow.decision?.outcome === "declined" ? "Referral closed" : "What happens next"}</h4><p>{workflow.decision?.outcome === "declined" ? "The decision is in the activity history. No client handoff is needed." : next}</p></div>
  </aside>;
}

function AdmissionHandoff({ workflow, busy, admissionDate, onAdmissionDateChange, onSaveAdmissionDate }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "admissionDate" | "onAdmissionDateChange" | "onSaveAdmissionDate">) {
  return <section className={styles.handoff} aria-label="Prepare client handoff">
    <h4>{workflow.context.packetSentAt ? "Client handoff sent" : "Prepare the client handoff"}</h4>
    <ol aria-label="Handoff progress" className="my-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-semibold text-[#365b4d]">
      <li>1. {workflow.context.assessmentSigned ? "Assessment signed" : "Sign assessment"}</li>
      <li>2. Decision recorded</li>
      <li aria-current={workflow.context.assessmentSigned && !workflow.context.packetSentAt ? "step" : undefined}>3. {workflow.context.packetSentAt ? "Packet sent" : "Review & send"}</li>
    </ol>
    <p>{workflow.context.packetSentAt ? "The handoff is recorded. You can return to the email and packet to review what was sent." : workflow.context.assessmentSigned ? "Review the recipients, client summary and chart files before sending." : "You can preview the packet now. Sign the assessment before sending."}</p>
    <ReferralAdmissionPanel key={workflow.referral.id} referral={workflow.referral} packetSentAt={workflow.context.packetSentAt} admissionDate={admissionDate} disabled={!workflow.capabilities.can_update || Boolean(busy)} onAdmissionDateChange={onAdmissionDateChange} onSaveAdmissionDate={onSaveAdmissionDate} />
  </section>;
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
  const { currentReferral, forwardTransition, assessmentState, showManualIntake } = view;
  if (workflow.decision?.outcome === "accepted") return null;
  if (workflow.context.assessmentSigned && !workflow.decision) return null;
  if (assessmentState && !workflow.decision) return null;
  const renderTransition = () => (forwardTransition ? (
        forwardTransition.blockers.length > 0 ? (
          <div className="space-y-2">
            {forwardTransition.blockers.map((blocker) => <div key={blocker.code} className="text-[11px] leading-5 text-[#7a4c0d]">{blocker.label}</div>)}
            <div className="flex flex-wrap gap-2 pt-1"><SecondaryButton onClick={onOpenIntake}>Open intake</SecondaryButton><SecondaryButton onClick={onOpenFiles}>Open files</SecondaryButton><SecondaryButton onClick={onOpenAssessment}>Open assessment</SecondaryButton></div>
          </div>
        ) : <div className="space-y-3">{forwardTransition.alerts?.length ? <div role="status" className="bg-[#f7faf9] px-3 py-2 text-[14px] leading-6 text-[#59645e]">{forwardTransition.alerts.map((alert) => <div key={alert.code}>{alert.label}</div>)}<div className="mt-1 font-bold">You can continue with these items unanswered.</div></div> : null}<SecondaryButton disabled={Boolean(busy) || !workflow.capabilities.can_update} onClick={() => onSubmitTransition(forwardTransition.target)}>{transitionActionLabel(forwardTransition.target)}</SecondaryButton></div>
      ) : <div className="flex items-center gap-2 text-[14px] font-bold text-[#0f6f5e]"><CheckCircle2 size={15} /> {terminalStageMessage(currentReferral)}</div>);
  return (
    <WorkflowCard title="Stage and intake controls" detail={`Current stage: ${getStageLabel(currentReferral.stage)}`}>
      {renderTransition()}

      {showManualIntake ? (
        <div className="mt-4 border-t border-[#e3e6e4] pt-4">
          <label className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]" htmlFor="manual-intake-reason">Manual intake note (optional)</label>
          <textarea id="manual-intake-reason" value={manualIntakeReason} onChange={(event) => onManualIntakeReasonChange(event.target.value)} rows={2} placeholder="Add any context, or continue without a note" className="mt-2 w-full border border-[#c9ceca] px-3 py-2 text-[14px] outline-none focus:border-[#0f8b73]" />
          <SecondaryButton disabled={Boolean(busy)} onClick={onAuthorizeManualIntake}>Authorize manual intake</SecondaryButton>
        </div>
      ) : null}
    </WorkflowCard>
  );
}

export function DecisionCard({ workflow, busy, recommendation, onRecommendationChange, onSubmitDecision, onOpenUnderReviewEmail }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "recommendation" | "onRecommendationChange" | "onSubmitDecision" | "onOpenUnderReviewEmail">) {
  if (workflow.decision) return <section className={styles.savedDecision} data-outcome={workflow.decision.outcome}>
    <RecordSummary title={workflow.decision.outcome === "accepted" ? "Accepted" : "Denied"} actor={workflow.decision.decidedByName} date={workflow.decision.decidedAt} note={workflow.decision.reasonNote} />
    <RecommendationOnFile workflow={workflow} compact />
  </section>;
  const underReview = recommendation.outcome === "needs_more_information";
  const savedUnderReview = isSavedUnderReview(workflow, recommendation);
  const action = decisionActionState(workflow, recommendation, Boolean(busy));
  return (
    <section className={styles.decisionCard}>
      <RecommendationOnFile workflow={workflow} selected={recommendation.outcome} selectedNote={recommendation.reasonNote} />
      <fieldset disabled={!workflow.capabilities.can_decide || Boolean(busy)}>
        <legend className={styles.legend}>Final decision</legend>
        <div className={styles.options}>
          {([{ value: "accept", label: "Accept", detail: "Proceed with placement", Icon: Check }, { value: "decline", label: "Deny", detail: "Close this referral", Icon: Minus }, { value: "needs_more_information", label: "Under review", detail: "Keep open for follow-up", Icon: Clock3 }] as const).map(({ Icon, ...option }) => (
            <label key={option.value} className={styles.option} data-outcome={option.value} data-selected={recommendation.outcome === option.value}>
              <input type="radio" name="assessment-outcome" aria-label={option.label} aria-describedby={`decision-${option.value}-detail`} value={option.value} checked={recommendation.outcome === option.value} onChange={() => onRecommendationChange({ outcome: option.value })} />
              <Icon size={23} className={styles.outcomeIcon} aria-hidden="true" /><strong>{option.label}</strong><span id={`decision-${option.value}-detail`}>{option.detail}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <WorkflowTextArea label={underReview ? "What needs review?" : "Reason (optional)"} value={recommendation.reasonNote} disabled={!workflow.capabilities.can_decide || Boolean(busy)} onChange={(reasonNote) => onRecommendationChange({ reasonNote })} />
      <div className={styles.decisionActions}>
        <p id="decision-action-hint" data-blocked={!savedUnderReview && action.disabled && !busy ? "true" : undefined}>{savedUnderReview ? "Under review saved. Edit the note to save an update." : action.hint}</p>
        {!savedUnderReview ? <PrimaryButton busy={Boolean(busy)} disabled={action.disabled} describedBy="decision-action-hint" onClick={onSubmitDecision}>{underReview ? "Save under review" : "Record decision"}<ArrowRight size={18} aria-hidden="true" /></PrimaryButton> : null}
        {savedUnderReview && onOpenUnderReviewEmail ? <button type="button" className="min-h-11 font-semibold text-[#087d66] underline" onClick={onOpenUnderReviewEmail}>Review email to Andrew and Sandeep</button> : null}
      </div>
    </section>
  );
}

function RecommendationOnFile({ workflow, selected, selectedNote, compact = false }: { workflow: WorkflowResponse; selected?: RecommendationDraft["outcome"]; selectedNote?: string; compact?: boolean }) {
  const presentation = recommendationPresentation(workflow);
  if (!presentation) {
    return compact ? null : <p className={styles.noRecommendation}>No recommendation is on file. The assessor records one in the assessment review.</p>;
  }
  const guidance = recommendationGuidance(presentation.outcome, selected);
  return <section className={styles.recommendation} data-compact={compact || undefined} aria-label="Recommendation on file">
    <span className={styles.recommendationLabel}>Recommendation on file</span>
    <p className={styles.recommendationOutcome}><strong>{presentation.outcomeLabel}</strong><span>{presentation.attribution}</span></p>
    {presentation.earlierAssessment ? <p className={styles.recommendationDetail}>Recorded for an earlier assessment.</p> : null}
    {showRecommendationNote(presentation.note, compact, selectedNote) ? <p className={styles.recommendationNote}>{presentation.note}</p> : null}
    {presentation.review ? <p className={styles.recommendationDetail}>{presentation.review}</p> : null}
    {!compact && !hasLegacyDecisionSubmission(workflow) ? <p className={styles.recommendationDetail}>{guidance}</p> : null}
  </section>;
}

function ProgressStep({ step }: { step: DecisionProgressStep }) {
  const Icon = step.state === "done" ? CheckCircle2 : step.state === "not_needed" ? Minus : Circle;
  return <li data-state={step.state}><Icon size={17} aria-hidden="true" /><span><strong>{step.label}</strong><span>{step.detail}</span></span></li>;
}

function WorkflowSecondaryColumn({ workflow, view, busy, onUpdateRequirement, onUpdateHandoff, onRecordHandoffSent, onOpenHandoffFailure, onOpenProfile }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "onUpdateRequirement" | "onUpdateHandoff" | "onRecordHandoffSent" | "onOpenHandoffFailure" | "onOpenProfile"> & { view: WorkflowView }) {
  return (
    <div className="space-y-5">
      <WorkflowCard title="Admission requirements" detail={admissionRequirementSummary(workflow.work_items)}><div className="space-y-5">{requirementGroups(workflow.work_items).map((group) => <RequirementGroup key={group.label} group={group} disabled={!workflow.capabilities.can_update || Boolean(busy)} onChange={onUpdateRequirement} />)}</div></WorkflowCard>
      <EhrHandoffDisclosure workflow={workflow} view={view} busy={busy} onUpdateHandoff={onUpdateHandoff} onRecordHandoffSent={onRecordHandoffSent} onOpenHandoffFailure={onOpenHandoffFailure} />
      {view.currentReferral.stage === "Accepted / Admitted" ? <ReferralClientActivationPanel referralId={view.currentReferral.id} canReconcile={workflow.capabilities.can_reconcile_identity} canReview={workflow.capabilities.can_review_identity} onOpenProfile={onOpenProfile} /> : null}
    </div>
  );
}

function EhrHandoffDisclosure({ workflow, view, busy, onUpdateHandoff, onRecordHandoffSent, onOpenHandoffFailure }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "onUpdateHandoff" | "onRecordHandoffSent" | "onOpenHandoffFailure"> & { view: WorkflowView }) {
  const { currentReferral, handoffStatus, ehrIsBlocked } = view;
  const ready = workflow.decision?.outcome === "accepted" || handoffStatus !== "not_ready";
  const handoffContent = handoffContentByStatus[handoffStatus];
  return (
    <WorkflowDisclosure key={`ehr-${ready ? "ready" : "pending"}`} title="EHR handoff" detail={handoffDescription(handoffStatus)} defaultOpen={ready}>
      <div className="flex flex-wrap gap-2">
        {handoffContent({ workflow, currentReferral, busy, ehrIsBlocked, onUpdateHandoff, onRecordHandoffSent, onOpenHandoffFailure })}
      </div>
    </WorkflowDisclosure>
  );
}

function QueueHandoffButton({ workflow, busy, ehrIsBlocked, onUpdateHandoff }: HandoffActionProps) {
  return <PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update || ehrIsBlocked} onClick={() => onUpdateHandoff("queue")}>Queue EHR handoff</PrimaryButton>;
}

export function ReferralWorkflowPanelLoading() {
  return <div className="flex min-h-64 items-center justify-center gap-2 text-[12px] text-[#737373]"><LoaderCircle className="animate-spin" size={16} /> Loading decision...</div>;
}

const noticePresentation = {
  error: { role: "alert", className: "border-[#9aa7a0] bg-[#f7faf9] text-[#59645e]" },
  success: { role: "status", className: "border-[#0f8b73] bg-[#effaf5] text-[#174f43]" },
} as const;

export function WorkflowNotice({ tone, children }: { tone: "success" | "error"; children: ReactNode }) {
  const presentation = noticePresentation[tone];
  return <div role={presentation.role} className={`border-l-2 px-4 py-3 text-[11px] font-semibold ${presentation.className}`}>{children}</div>;
}

function WorkflowCard({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return <section className="border-b border-[#dce4df] bg-white pb-5"><header className="mb-3"><h3 className="text-[15px] font-semibold text-[#25372d]">{title}</h3>{detail ? <p className="mt-1 text-[13px] text-[#59665f]">{detail}</p> : null}</header>{children}</section>;
}

function WorkflowDisclosure({ title, detail, defaultOpen, children }: { title: string; detail: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="group border-b border-[#dce4df] bg-white" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-[#25372d]">{title}</span>{detail ? <span className="mt-1 block text-[13px] text-[#59665f]">{detail}</span> : null}</span>
        <ChevronDown size={15} className="text-[#59665f] transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="pb-5">{children}</div>
    </details>
  );
}

function WorkflowDetailDialog({ pending, onConfirm, onClose }: { pending: PendingWorkflowDetail; onConfirm: (detail: string) => void; onClose: () => void }) {
  if (pending.kind === "ehr_failure") {
    return <ActionDetailDialog title="Record EHR handoff failure" description="This reason is recorded in the referral activity log for follow-up." label="Failure reason" confirmLabel="Record failure" minimumLength={3} onConfirm={onConfirm} onClose={onClose} />;
  }
  return <ActionDetailDialog {...requirementDetailPresentation(pending.item, pending.status)} onConfirm={onConfirm} onClose={onClose} />;
}

function RequirementGroup({ group, disabled, onChange }: { group: RequirementGroupPresentation; disabled: boolean; onChange: (item: AdmissionRequirement, status: RequirementStatus) => void }) {
  return (
    <section aria-label={`${group.label} requirements`}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div><h4 className="text-[14px] font-bold uppercase tracking-[0.08em] text-[#44504b]">{group.label}</h4><p className="mt-0.5 text-[14px] text-[#737c77]">{group.detail}</p></div>
        <span className="shrink-0 text-[14px] font-semibold text-[#68716c]">{resolvedRequirementCount(group.items)} / {group.items.length} resolved</span>
      </div>
      <div className="divide-y divide-[#e4e7e5] border-y border-[#d9d9d9]">
        {group.items.map((item) => (
          <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#202522]">{isRequirementComplete(item.status) ? <Check size={13} className="text-[#0f8b73]" /> : <Circle size={11} className="text-[#a0a0a0]" />}<span>{item.label}</span>{item.blocker ? <span className="text-[14px] font-semibold uppercase text-[#68716c]">To complete</span> : null}</div>
              <div className="mt-1 text-[14px] leading-5 text-[#737373]">{requirementStatusDetail(item)}</div>
            </div>
            <select aria-label={`${item.label} status`} value={item.status} disabled={disabled} onChange={(event) => onChange(item, event.target.value as RequirementStatus)} className="h-11 w-full border border-[#c9ceca] bg-white px-2 text-[14px] font-semibold outline-none focus:border-[#0f8b73]">{requirementStatuses.map((status) => <option key={status} value={status}>{formatRequirementStatus(status)}</option>)}</select>
          </div>
        ))}
      </div>
    </section>
  );
}

function PrimaryButton({ busy, disabled, describedBy, onClick, children }: { busy?: boolean; disabled?: boolean; describedBy?: string; onClick: () => void; children: ReactNode }) {
  const designV2 = useDesignV2();
  return <button type="button" disabled={disabled || busy} aria-describedby={describedBy} onClick={onClick} className={designV2 ? "mt-3 inline-flex min-h-11 items-center gap-2 rounded-input bg-link px-5 py-2 text-value font-semibold text-paper hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40" : "mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08775e] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#065f4b] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"}>{busy ? <LoaderCircle className="animate-spin" size={13} /> : null}{children}</button>;
}

function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="mt-3 h-10 rounded-md border border-[#cbd5cf] bg-white px-4 text-[13px] font-semibold text-[#35473c] hover:border-[#08775e] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40">{children}</button>;
}

function WorkflowTextArea({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className={styles.note}><span>{label}</span><textarea value={value} disabled={disabled} maxLength={20_000} rows={3} onChange={(event) => onChange(event.target.value)} placeholder="Add context for the team, if helpful." /></label>;
}

function RecordSummary({ title, actor, date, note }: { title: string; actor: string; date: string; note: string }) {
  return <div><span className={styles.savedLabel}><CheckCircle2 size={18} aria-hidden="true" /> Decision recorded</span><h4>{title}</h4><p className={styles.recordedBy}>{actor || "Name not recorded"} · {formatRecordedAt(date)}</p>{note ? <p className={styles.recordedNote}>{note}</p> : null}</div>;
}

function decisionNextStep(outcome: string) {
  return outcome === "accepted" || outcome === "accept"
    ? "Prepare the admission date and client handoff. Email is reviewed separately before sending."
    : outcome === "declined" || outcome === "decline"
      ? "Recording Deny closes this referral. No client handoff is sent."
      : outcome === "needs_more_information"
        ? "Keep the referral open while you gather more information. No approval request is sent."
        : "Choose an outcome. Nothing is signed or sent from this page.";
}

function decisionRecordState(workflow: WorkflowResponse) {
  return workflow.recommendation?.outcome === "needs_more_information" ? "Under review" : "Decision not recorded";
}

function showDecisionDone(workflow: WorkflowResponse) {
  return workflow.decision ? workflow.decision.outcome === "declined" : workflow.recommendation?.outcome === "needs_more_information";
}

function isSavedUnderReview(workflow: WorkflowResponse, recommendation: RecommendationDraft) {
  return recommendation.outcome === "needs_more_information" && workflow.recommendation?.outcome === recommendation.outcome && workflow.recommendation.reasonNote === recommendation.reasonNote && workflow.recommendation.reasonCode === recommendation.reasonCode;
}

function decisionAssessmentAction(workflow: WorkflowResponse) {
  if (workflow.context.assessmentSigned || workflow.decision?.outcome === "declined") return "View assessment";
  return workflow.context.assessmentStarted ? "Continue assessment" : "Prepare assessment";
}

function recordedDecisionAttributes(workflow: WorkflowResponse) {
  return workflow.decision ? { tabIndex: -1, role: "group", "aria-label": "Recorded decision" } : {};
}

function DecisionPageHeading({ workflow }: { workflow: WorkflowResponse }) {
  return (
      <header className={styles.pageHeading}>
        <div><h3>Placement decision</h3><p>{workflow.decision ? "Saved in the referral's activity history." : "Review the recommendation and context, then record the final outcome."}</p></div>
        {!workflow.decision ? <span className={styles.recordState}>{decisionRecordState(workflow)}</span> : null}
      </header>
  );
}

function recommendationGuidance(outcome: RecommendationDraft["outcome"], selected: RecommendationDraft["outcome"] | undefined) {
  return outcome === selected
    ? "Pre-selected below. It becomes final only when you record the decision."
    : selected ? "Your selection below differs from this recommendation." : "Choose the final decision below.";
}

function showRecommendationNote(note: string | null | undefined, compact: boolean, selectedNote: string | undefined) {
  return note && !compact && note !== selectedNote;
}

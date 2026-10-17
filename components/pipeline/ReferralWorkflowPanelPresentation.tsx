import ReferralAdmissionPanel from "./ReferralAdmissionPanel";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, CheckCircle2, Circle, Clock3, LoaderCircle, Minus } from "lucide-react";

import ActionDetailDialog from "@/components/pipeline/ActionDetailDialog";
import ReferralClientActivationPanel from "@/components/pipeline/ReferralClientActivationPanel";
import {
  decisionActionState,
  deriveWorkflowPanelView,
  formatRecordedAt,
  formatRequirementStatus,
  handoffDescription,
  hasLegacyDecisionSubmission,
  recommendationPresentation,
  requirementDetailPresentation,
  requirementStatuses,
  requirementStatusDetail,
  resolvedRequirementCount,
  terminalStageMessage,
  transitionActionLabel,
  type PendingWorkflowDetail,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import { getStageLabel, referralStageDefinitions, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { AdmissionRequirement, AssessmentRecommendation, EhrHandoffStatus, RequirementStatus } from "@/lib/pipeline/referral-types";
import { isRequirementComplete } from "@/lib/pipeline/workflow-records";
import styles from "./ReferralDecision.module.css";

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
  queued: ({ workflow, busy, ehrIsBlocked, onRecordHandoffSent, onOpenHandoffFailure }) => <><PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update || ehrIsBlocked} onClick={onRecordHandoffSent}>Record sent</PrimaryButton><SecondaryButton disabled={Boolean(busy)} onClick={onOpenHandoffFailure}>Record failed</SecondaryButton></>,
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
  pendingRequirements: Record<string, RequirementStatus>;
  requirementErrors: Record<string, string>;
  onRecommendationChange: (patch: Partial<RecommendationDraft>) => void;
  onAdmissionDateChange: (value: string) => void;
  onSaveAdmissionDate: () => void;
  onManualIntakeReasonChange: (value: string) => void;
  onUpdateRequirement: (item: AdmissionRequirement, status: RequirementStatus) => void;
  onSubmitDecision: () => void;
  onOpenUnderReviewEmail?: () => void;
  onSubmitTransition: (target: ReferralStage, actualAdmissionDate?: string) => void;
  onSavePlacementCancellation: (reason: string) => Promise<boolean>;
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
  onSubmitDecision,
  onOpenUnderReviewEmail,
  onSubmitTransition,
  onSavePlacementCancellation,
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
      {!workflow.decision ? <DecisionPageHeading workflow={workflow} /> : null}
      {message ? <div className={message === "Decision recorded" ? "sr-only" : undefined}><WorkflowNotice tone="success">{message}</WorkflowNotice></div> : null}
      {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}

      <div className={styles.layout} data-recorded={Boolean(workflow.decision) || undefined}>
        <div className={styles.main} ref={resultRef} {...recordedDecisionAttributes(workflow)}>
          <DecisionCard workflow={workflow} busy={busy} recommendation={recommendation} onRecommendationChange={onRecommendationChange} onSubmitDecision={onSubmitDecision} onOpenUnderReviewEmail={onOpenUnderReviewEmail} onOpenAssessment={onOpenAssessment} />
          {workflow.decision?.outcome === "accepted" ? <AdmissionHandoff workflow={workflow} busy={busy} admissionDate={admissionDate} onAdmissionDateChange={onAdmissionDateChange} onSaveAdmissionDate={onSaveAdmissionDate} onSubmitTransition={onSubmitTransition} onSavePlacementCancellation={onSavePlacementCancellation} /> : null}
          {showDecisionDone(workflow) && onDone ? (
            <div className={styles.done}>
              <p>{workflow.referral.placementCancellation ? "Placement cancelled. The earlier decision and handoff remain in the record." : workflow.decision ? "No client handoff is needed." : "The referral stays open. Return when you have more information."}</p>
              <PrimaryButton busy={busy === "done"} disabled={Boolean(busy)} onClick={onDone}>Done</PrimaryButton>
            </div>
          ) : null}
        </div>
        {!workflow.decision ? <DecisionContext workflow={workflow} busy={busy} onOpenAssessment={onOpenAssessment} /> : null}
      </div>
      {workflow.decision?.outcome === "accepted" ? <section className={styles.paperwork} aria-label="EHR handoff">
        <EhrHandoffCard workflow={workflow} view={view} busy={busy} onUpdateHandoff={onUpdateHandoff} onRecordHandoffSent={onRecordHandoffSent} onOpenHandoffFailure={onOpenHandoffFailure} />
        {view.currentReferral.stage === "Accepted / Admitted" ? <ReferralClientActivationPanel referralId={view.currentReferral.id} canReconcile={workflow.capabilities.can_reconcile_identity} canReview={workflow.capabilities.can_review_identity} onOpenProfile={onOpenProfile} /> : null}
      </section> : null}
      <details className={styles.details} data-admin-controls>
          <summary>Administrative controls</summary>
          <p className={styles.adminNote}>For authorized staff. These change the referral&apos;s stage or grant a manual intake exception. They do not record the decision, sign the assessment, or send anything.</p>
          <label className="mb-4 flex flex-wrap items-center gap-3 text-[14px] font-medium text-[#59645e]">Referral stage
            <select aria-label="Workflow stage" value={workflow.referral.stage} disabled={Boolean(busy) || !workflow.capabilities.can_update || Boolean(workflow.referral.placementCancellation)} onChange={(event) => onSubmitTransition(event.target.value as ReferralStage)} className="h-11 border border-[#c9ceca] bg-white px-3 text-[#303b34]">
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

function DecisionContext({ workflow, busy, onOpenAssessment }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "onOpenAssessment">) {
  const declined = workflow.decision?.outcome === "declined";
  return <aside className={styles.context} aria-label="Decision context">
    <div className={styles.client}><span>Client</span><h4>{workflow.referral.name || "Name not provided"}</h4><p>{workflow.referral.community || "Community not selected"}</p></div>
    <div className={styles.assessmentState}>
      <span>Assessment</span>
      <p>{workflow.context.assessmentSigned ? "Signed and ready for the decision." : "Open the assessment to review or continue it."}</p>
      <button type="button" disabled={Boolean(busy)} onClick={onOpenAssessment}>{decisionAssessmentAction(workflow)}<ArrowRight size={16} aria-hidden="true" /></button>
    </div>
    {declined ? <div className={styles.consequence}><h4>Referral closed</h4><p>The decision is in the activity history. No client handoff is needed.</p></div> : null}
  </aside>;
}

function AdmissionHandoff({ workflow, busy, admissionDate, onAdmissionDateChange, onSaveAdmissionDate, onSubmitTransition, onSavePlacementCancellation }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "admissionDate" | "onAdmissionDateChange" | "onSaveAdmissionDate" | "onSubmitTransition" | "onSavePlacementCancellation">) {
  const cancelled = Boolean(workflow.referral.placementCancellation);
  return <section className={styles.handoff} aria-label="Prepare client handoff">
    <h4>{cancelled ? "Placement cancelled" : workflow.context.packetSentAt ? "Client handoff sent" : "Prepare the client handoff"}</h4>
    <p>{cancelled ? workflow.context.packetSentAt ? "The handoff was sent before placement was cancelled. You can review the earlier email and packet." : "The accepted decision remains recorded. You can review the email and packet, but this placement cannot be sent." : workflow.context.packetSentAt ? "The handoff is recorded. You can return to the email and packet to review what was sent." : workflow.context.assessmentSigned ? "Review the recipients, client summary and chart files before sending." : "You can preview the packet now. Sign the assessment before sending."}</p>
    <ReferralAdmissionPanel key={workflow.referral.id} referral={workflow.referral} packetSentAt={workflow.context.packetSentAt} admissionDate={admissionDate} disabled={!workflow.capabilities.can_update || Boolean(busy)} onAdmissionDateChange={onAdmissionDateChange} onSaveAdmissionDate={onSaveAdmissionDate} onMarkAdmitted={workflow.capabilities.can_confirm_admission ? (actualDate) => onSubmitTransition("Accepted / Admitted", actualDate) : undefined} onSavePlacementCancellation={workflow.capabilities.can_cancel_placement ? onSavePlacementCancellation : undefined} />
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

export function DecisionCard({ workflow, busy, recommendation, onRecommendationChange, onSubmitDecision, onOpenUnderReviewEmail, onOpenAssessment }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "recommendation" | "onRecommendationChange" | "onSubmitDecision" | "onOpenUnderReviewEmail"> & { onOpenAssessment?: () => void }) {
  if (workflow.decision) return <section className={styles.savedDecision} data-outcome={workflow.decision.outcome}>
    <RecordSummary title={workflow.decision.outcome === "accepted" ? "Accepted" : "Denied"} actor={workflow.decision.decidedByName} date={workflow.decision.decidedAt} note={workflow.decision.reasonNote} />
    {onOpenAssessment ? <button type="button" className={styles.savedAssessmentLink} disabled={Boolean(busy)} onClick={onOpenAssessment}>View assessment <ArrowRight size={15} aria-hidden="true" /></button> : null}
    <RecommendationOnFile workflow={workflow} compact />
  </section>;
  const underReview = recommendation.outcome === "needs_more_information";
  const savedUnderReview = isSavedUnderReview(workflow, recommendation);
  const action = decisionActionState(workflow, recommendation, Boolean(busy));
  // A checklist save must not freeze a decision the assessor is still drafting.
  // Submission remains guarded by action.disabled until that save finishes.
  const draftLocked = Boolean(busy) && !busy.startsWith("requirement:");
  return (
    <section className={styles.decisionCard}>
      <RecommendationOnFile workflow={workflow} selected={recommendation.outcome} selectedNote={recommendation.reasonNote} />
      <fieldset disabled={!workflow.capabilities.can_decide || draftLocked}>
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
      <WorkflowTextArea label={underReview ? "What needs review?" : "Reason (optional)"} value={recommendation.reasonNote} disabled={!workflow.capabilities.can_decide || draftLocked} onChange={(reasonNote) => onRecommendationChange({ reasonNote })} />
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

export function AdmissionRequirementsPanel({ workflow, busy, message, error, pendingRequirements, requirementErrors, pendingDetail, onUpdateRequirement, onConfirmDetail, onCloseDetail }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "message" | "error" | "pendingRequirements" | "requirementErrors" | "pendingDetail" | "onUpdateRequirement" | "onConfirmDetail" | "onCloseDetail">) {
  const [editingIds, setEditingIds] = useState<Set<string>>(() => new Set());
  const items = workflow.work_items.filter((item) => item.type !== "profile_field");
  const toggleEditing = (id: string) => setEditingIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <section aria-label="Admission requirements" className={styles.requirements}>
      <details>
        <summary><span>Admission requirements</span><span>{resolvedRequirementCount(items)} / {items.length} resolved</span></summary>
        {message ? <WorkflowNotice tone="success">{message}</WorkflowNotice> : null}
        {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}
        <ul className={styles.requirementList}>
          {items.map((item) => <li key={item.id} className={styles.requirementRow}>
            <span className={styles.requirementName}>{isRequirementComplete(item.status) ? <Check size={15} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}{item.label}</span>
            <span className={styles.requirementStatus}>{formatRequirementStatus(pendingRequirements[item.id] ?? item.status)}</span>
            {workflow.capabilities.can_update ? editingIds.has(item.id) ? <div className={styles.requirementEdit}>
              <select autoFocus aria-label={`${item.label} status`} value={pendingRequirements[item.id] ?? item.status} disabled={Boolean(pendingRequirements[item.id]) || Boolean(busy && !busy.startsWith("requirement:"))} onChange={(event) => onUpdateRequirement(item, event.target.value as RequirementStatus)}>{requirementStatuses.map((status) => <option key={status} value={status}>{formatRequirementStatus(status)}</option>)}</select>
              <button type="button" onClick={() => toggleEditing(item.id)}>Done</button>
            </div> : <button type="button" className={styles.requirementChange} onClick={() => toggleEditing(item.id)} aria-label={`Change ${item.label} status`}>Change</button> : null}
            {item.status !== "needed" ? <span className={styles.requirementDetail}>{requirementStatusDetail(item)}</span> : null}
            {pendingRequirements[item.id] ? <span role="status" className={styles.requirementDetail}>{busy.startsWith(`requirement:${item.id}:`) ? "Saving status…" : "Status queued…"}</span> : requirementErrors[item.id] ? <span role="alert" className={styles.requirementError}>{requirementErrors[item.id]}</span> : null}
          </li>)}
        </ul>
      </details>
      {pendingDetail?.kind === "requirement" ? <WorkflowDetailDialog pending={pendingDetail} onConfirm={onConfirmDetail} onClose={onCloseDetail} /> : null}
    </section>
  );
}

function EhrHandoffCard({ workflow, view, busy, onUpdateHandoff, onRecordHandoffSent, onOpenHandoffFailure }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "onUpdateHandoff" | "onRecordHandoffSent" | "onOpenHandoffFailure"> & { view: WorkflowView }) {
  const { currentReferral, handoffStatus, ehrIsBlocked } = view;
  const handoffContent = handoffContentByStatus[handoffStatus];
  return (
    <WorkflowCard title="EHR handoff" detail={handoffDescription(handoffStatus)}>
      <div className="flex flex-wrap gap-2">
        {handoffContent({ workflow, currentReferral, busy, ehrIsBlocked, onUpdateHandoff, onRecordHandoffSent, onOpenHandoffFailure })}
      </div>
    </WorkflowCard>
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

function WorkflowDetailDialog({ pending, onConfirm, onClose }: { pending: PendingWorkflowDetail; onConfirm: (detail: string) => void; onClose: () => void }) {
  if (pending.kind === "ehr_failure") {
    return <ActionDetailDialog title="Record EHR handoff failure" description="This reason is recorded in the referral activity log for follow-up." label="Failure reason" confirmLabel="Record failure" minimumLength={3} onConfirm={onConfirm} onClose={onClose} />;
  }
  return <ActionDetailDialog {...requirementDetailPresentation(pending.item, pending.status)} onConfirm={onConfirm} onClose={onClose} />;
}

function PrimaryButton({ busy, disabled, describedBy, onClick, children }: { busy?: boolean; disabled?: boolean; describedBy?: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled || busy} aria-describedby={describedBy} onClick={onClick} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-input bg-link px-5 py-2 text-value font-semibold text-paper hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={13} /> : null}{children}</button>;
}

function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="mt-3 h-10 rounded-md border border-[#cbd5cf] bg-white px-4 text-[13px] font-semibold text-[#35473c] hover:border-[#08775e] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40">{children}</button>;
}

function WorkflowTextArea({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className={styles.note}><span>{label}</span><textarea value={value} disabled={disabled} maxLength={20_000} rows={3} onChange={(event) => onChange(event.target.value)} placeholder="Add context for the team, if helpful." /></label>;
}

function RecordSummary({ title, actor, date, note }: { title: string; actor: string; date: string; note: string }) {
  return <div className={styles.recordSummary}><div className={styles.recordHeading}><h4><CheckCircle2 size={20} aria-hidden="true" />{title}</h4><span>Decision recorded</span></div><p className={styles.recordedBy}>{actor || "Name not recorded"} · {formatRecordedAt(date)}</p>{note ? <p className={styles.recordedNote}>{note}</p> : null}</div>;
}

function decisionRecordState(workflow: WorkflowResponse) {
  return workflow.recommendation?.outcome === "needs_more_information" ? "Under review" : "Decision not recorded";
}

function showDecisionDone(workflow: WorkflowResponse) {
  return workflow.referral.placementCancellation ? true : workflow.decision ? workflow.decision.outcome === "declined" : workflow.recommendation?.outcome === "needs_more_information";
}

function isSavedUnderReview(workflow: WorkflowResponse, recommendation: RecommendationDraft) {
  return recommendation.outcome === "needs_more_information" && workflow.recommendation?.outcome === recommendation.outcome && workflow.recommendation.reasonNote === recommendation.reasonNote && workflow.recommendation.reasonCode === recommendation.reasonCode;
}

function decisionAssessmentAction(workflow: WorkflowResponse) {
  if (workflow.referral.placementCancellation || workflow.context.assessmentSigned || workflow.decision?.outcome === "declined") return "View assessment";
  return workflow.context.assessmentStarted ? "Continue assessment" : "Prepare assessment";
}

function recordedDecisionAttributes(workflow: WorkflowResponse) {
  return workflow.decision ? { tabIndex: -1, role: "group", "aria-label": "Recorded decision" } : {};
}

function DecisionPageHeading({ workflow }: { workflow: WorkflowResponse }) {
  return (
      <header className={styles.pageHeading}>
        <div><h3>Placement decision</h3>{workflow.decision ? <p>Saved in the referral&apos;s activity history.</p> : null}</div>
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

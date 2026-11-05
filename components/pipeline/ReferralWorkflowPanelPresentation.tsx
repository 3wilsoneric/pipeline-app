import ReferralAdmissionPanel from "./ReferralAdmissionPanel";
import PipelineIllustration from "./PipelineIllustration";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, CheckCircle2, Circle, Clock3, LoaderCircle, Minus, Settings, SlidersHorizontal, X } from "lucide-react";

import ActionDetailDialog from "@/components/pipeline/ActionDetailDialog";
import ReferralClientActivationPanel from "@/components/pipeline/ReferralClientActivationPanel";
import {
  decisionActionState,
  deriveWorkflowPanelView,
  formatRecordedAt,
  formatRequirementStatus,
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
import type { AdmissionRequirement, AssessmentRecommendation, Referral, RequirementStatus } from "@/lib/pipeline/referral-types";
import { isRequirementComplete } from "@/lib/pipeline/workflow-records";
import { assumedAdmissionDate } from "@/lib/pipeline/admission-lifecycle";
import { calendarToday } from "@/lib/pipeline/calendar-date";
import { admissionFlowToday } from "@/lib/pipeline/admission-flow-day";
import styles from "./ReferralDecision.module.css";

type RecommendationDraft = {
  outcome: AssessmentRecommendation["outcome"] | "";
  reasonCode: string;
  reasonNote: string;
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
  onSubmitDecision: (confirmedInReview?: boolean) => void;
  onReopenDecision?: () => void;
  onOpenUnderReviewEmail?: () => void;
  onSubmitTransition: (target: ReferralStage) => void;
  onConfirmAdmission: (actualDate: string) => void;
  onSavePlacementCancellation: (reason: string) => Promise<boolean>;
  onAdmissionFlowAction: (action: "record_ready" | "start_hold" | "end_hold", details?: Record<string, string>) => Promise<boolean>;
  onAuthorizeManualIntake: () => void;
  onConfirmDetail: (detail: string) => void;
  onCloseDetail: () => void;
  onOpenIntake: () => void;
  onOpenAssessment: () => void;
  onOpenDecision?: () => void;
  onOpenPlacement?: () => void;
  onOpenFiles: () => void;
  onOpenProfile: (canonicalClientId: string) => void;
  onDone?: () => void;
  reviewConfirmation?: boolean;
  confirmRecommendation?: boolean;
  placementOnly?: boolean;
  placementContent?: ReactNode;
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
  onReopenDecision,
  onOpenUnderReviewEmail,
  onSubmitTransition,
  onConfirmAdmission,
  onSavePlacementCancellation,
  onAdmissionFlowAction,
  onAuthorizeManualIntake,
  onConfirmDetail,
  onCloseDetail,
  onOpenIntake,
  onOpenAssessment,
  onOpenDecision,
  onOpenPlacement,
  onOpenFiles,
  onOpenProfile,
  onDone,
  reviewConfirmation = false,
  confirmRecommendation = false,
  placementOnly = false,
  placementContent,
}: ReferralWorkflowPanelPresentationProps) {
  const view = deriveWorkflowPanelView(workflow);
  const resultRef = useRef<HTMLDivElement>(null);
  const followUpRef = useRef<HTMLDialogElement>(null);
  const followUpTriggerRef = useRef<HTMLButtonElement>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [actualAdmissionDate, setActualAdmissionDate] = useState("");
  const [arrivalVerified, setArrivalVerified] = useState(false);
  const openFollowUp = () => {
    setActualAdmissionDate("");
    setArrivalVerified(false);
    setFollowUpOpen(true);
    if (!followUpRef.current?.open) followUpRef.current?.showModal();
  };
  const closeFollowUp = () => followUpRef.current?.close();
  const focusedDecision = useRef(workflow.decision?.decisionId);
  const decisionId = workflow.decision?.decisionId;
  useEffect(() => {
    if (message === "Decision recorded" && decisionId && focusedDecision.current !== decisionId) {
      resultRef.current?.focus();
      focusedDecision.current = decisionId;
    }
  }, [decisionId, message]);

  if (reviewConfirmation) return <section aria-label="Admission decision" className={styles.reviewDecision}>
    <div ref={resultRef} {...recordedDecisionAttributes(workflow)}>
    {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}
    {message && message !== "Decision recorded" ? <WorkflowNotice tone="success">{message}</WorkflowNotice> : null}
    <DecisionCard confirmRecommendation workflow={workflow} busy={busy} recommendation={recommendation} onRecommendationChange={onRecommendationChange} onSubmitDecision={onSubmitDecision} onOpenUnderReviewEmail={onOpenUnderReviewEmail} />
    {workflow.decision?.outcome === "accepted" && onOpenPlacement ? <div className={styles.decisionActions}><PrimaryButton disabled={Boolean(busy)} onClick={onOpenPlacement}>Continue to Handoff<ArrowRight size={18} aria-hidden="true" /></PrimaryButton></div> : null}
    {showDecisionDone(workflow) && onDone ? <div className={styles.decisionActions}><PrimaryButton disabled={Boolean(busy)} onClick={onDone}>Done<ArrowRight size={18} aria-hidden="true" /></PrimaryButton></div> : null}
    </div>
  </section>;

  if (placementOnly) return <section aria-label="Handoff follow-through" className={styles.page}>
    {message ? <WorkflowNotice tone="success">{message}</WorkflowNotice> : null}
    {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}
    {workflow.decision?.outcome !== "accepted" ? <>
      {workflow.decision ? <p className={styles.placementNotice}>This referral was denied. Its decision remains in the record.</p> : null}
      {placementContent ? <div className={styles.placementHandoff}>{placementContent}</div> : onOpenDecision ? <SecondaryButton onClick={onOpenDecision}>Open decision</SecondaryButton> : null}
    </> : <>
      <div className={styles.placementIntro}><div className={styles.placementHeading}><div><h3 className="sr-only">Meet the Client</h3><p role="status">{workflow.referral.placementCancellation ? "Did not move in" : (view.currentReferral.stage === "Accepted / Admitted" || assumedAdmissionDate(view.currentReferral)) ? "Admitted" : workflow.context.packetSentAt ? "Sent · Awaiting admission" : "Accepted · Not sent"}</p></div><button ref={followUpTriggerRef} type="button" aria-label="Handoff actions" title="Handoff actions" aria-haspopup="dialog" aria-expanded={followUpOpen} className={styles.followUpTrigger} onClick={openFollowUp}><SlidersHorizontal size={18} aria-hidden="true" /></button></div></div>
      <div className={styles.placementMain}>
        {workflow.context.packetSentAt && view.currentReferral.stage !== "Accepted / Admitted" ? <div className={styles.placementPlan}>
          <h4>Planned arrival</h4>
          <ReferralAdmissionPanel key={workflow.referral.id} referral={workflow.referral} packetSentAt={workflow.context.packetSentAt} admissionDate={admissionDate} disabled={!workflow.capabilities.can_update || Boolean(busy)} onAdmissionDateChange={onAdmissionDateChange} onSaveAdmissionDate={onSaveAdmissionDate} showReviewButton={false} showCancellation={false} />
        </div> : null}
        {placementContent ? <div className={styles.placementHandoff}>{placementContent}</div> : null}
      </div>
      {view.currentReferral.stage === "Accepted / Admitted" ? <section className={styles.paperwork} aria-label="Client profile"><ReferralClientActivationPanel referralId={view.currentReferral.id} canReconcile={workflow.capabilities.can_reconcile_identity} canReview={workflow.capabilities.can_review_identity} onOpenProfile={onOpenProfile} /></section> : null}
      <dialog ref={followUpRef} aria-labelledby="placement-actions-title" className={styles.followUpDrawer} onClose={() => { setFollowUpOpen(false); followUpTriggerRef.current?.focus(); }} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className={styles.followUpHead}><h2 id="placement-actions-title">Handoff actions</h2><button type="button" aria-label="Close handoff actions" onClick={closeFollowUp}><X size={18} aria-hidden="true" /></button></div>
        <div className={styles.followUpBody}>
          {workflow.capabilities.can_track_admission_flow && view.currentReferral.stage !== "Accepted / Admitted" && !workflow.referral.placementCancellation ? <AdmissionFlowControls referral={workflow.referral} disabled={Boolean(busy)} onAction={onAdmissionFlowAction} /> : null}
          {view.currentReferral.stage !== "Accepted / Admitted" && workflow.capabilities.can_cancel_placement ? <div className={styles.drawerSection}><h3>Placement change</h3><ReferralAdmissionPanel key={workflow.referral.id} referral={workflow.referral} packetSentAt={workflow.context.packetSentAt} admissionDate={admissionDate} disabled={!workflow.capabilities.can_update || Boolean(busy)} onAdmissionDateChange={onAdmissionDateChange} onSaveAdmissionDate={onSaveAdmissionDate} onSavePlacementCancellation={onSavePlacementCancellation} showReviewButton={false} showDateEditor={false} /></div> : null}
          {view.currentReferral.stage !== "Accepted / Admitted" && !workflow.referral.placementCancellation && workflow.capabilities.can_confirm_admission ? <section className={styles.drawerSection} aria-label="Confirm actual admission">
            <h3>Confirm arrival</h3>
            <p className={styles.adminNote}>For coordinators and admins after the client actually arrives. Use the actual admission date, not the planned date. This does not send Meet the Client.</p>
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); closeFollowUp(); onConfirmAdmission(actualAdmissionDate); }}>
              <label className="block text-sm font-semibold" htmlFor="actual-admission-date">Actual admission date</label>
              <input id="actual-admission-date" aria-label="Actual admission date" type="date" required max={calendarToday()} value={actualAdmissionDate} onChange={(event) => setActualAdmissionDate(event.target.value)} disabled={Boolean(busy)} className="h-11 w-full border border-[#c9ceca] bg-white px-3 text-sm" />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={arrivalVerified} onChange={(event) => setArrivalVerified(event.target.checked)} disabled={Boolean(busy)} className="mt-1" />I confirm this client arrived at this community on the actual admission date.</label>
              <button type="submit" disabled={Boolean(busy) || !actualAdmissionDate || !arrivalVerified} className="min-h-11 border border-[#0f8b73] px-4 py-2 text-sm font-semibold text-[#0f6f5e] disabled:opacity-50">Record admission</button>
            </form>
          </section> : null}
          <section className={styles.drawerSection} data-admin-controls><h3>Administrative controls</h3><p className={styles.adminNote}>Changing the stage does not send Meet the Client or confirm admission.</p><label className="mb-4 flex flex-wrap items-center gap-3 text-[14px] font-medium text-[#59645e]">Referral stage<select aria-label="Workflow stage" value={workflow.referral.stage} disabled={Boolean(busy) || !workflow.capabilities.can_update || Boolean(workflow.referral.placementCancellation)} onChange={(event) => onSubmitTransition(event.target.value as ReferralStage)} className="h-11 border border-[#c9ceca] bg-white px-3 text-[#303b34]">{referralStageDefinitions.filter((item) => !item.terminal || item.stage === workflow.referral.stage).map((item) => <option key={item.stage} value={item.stage}>{item.label}</option>)}</select></label></section>
        </div>
      </dialog>
    </>}
    {pendingDetail ? <WorkflowDetailDialog pending={pendingDetail} onConfirm={onConfirmDetail} onClose={onCloseDetail} /> : null}
  </section>;

  return (
    <section data-guide-target="workspace-decision" aria-label="Admission decision" className={styles.page}>
      <div className={styles.decisionHeader} data-recorded={Boolean(workflow.decision) || undefined}>
        {!workflow.decision ? <DecisionContext workflow={workflow} busy={busy} onOpenAssessment={onOpenAssessment} /> : null}
        {workflow.decision?.outcome !== "accepted" ? <div className={styles.followUpBar}><button ref={followUpTriggerRef} type="button" aria-label="Decision settings" aria-haspopup="dialog" aria-expanded={followUpOpen} className={`${styles.followUpTrigger} ${styles.decisionSettingsTrigger}`} onClick={openFollowUp}><Settings size={20} aria-hidden="true" /><span>Settings</span></button></div> : null}
      </div>
      {!followUpOpen && message ? <div className={message === "Decision recorded" ? "sr-only" : undefined}><WorkflowNotice tone="success">{message}</WorkflowNotice></div> : null}
      {!followUpOpen && error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}

      <div className={styles.layout} data-recorded={Boolean(workflow.decision) || undefined}>
        <div className={styles.main} ref={resultRef} {...recordedDecisionAttributes(workflow)}>
          <DecisionCard confirmRecommendation={confirmRecommendation} workflow={workflow} busy={busy} recommendation={recommendation} onRecommendationChange={onRecommendationChange} onSubmitDecision={onSubmitDecision} onOpenUnderReviewEmail={onOpenUnderReviewEmail} onOpenAssessment={onOpenAssessment} />
          {workflow.referral.admissionDecisionHistory?.length ? <details className={styles.details}><summary>Previous decisions</summary>{workflow.referral.admissionDecisionHistory.map((decision) => <RecordSummary key={decision.decisionId} title={decision.outcome === "accepted" ? "Accepted" : "Denied"} actor={decision.decidedByName} date={decision.decidedAt} note={decision.reasonNote} />)}</details> : null}
          {workflow.decision?.outcome === "accepted" && onOpenPlacement ? <div className={styles.decisionNext}><PrimaryButton disabled={Boolean(busy)} onClick={onOpenPlacement}>Continue to Handoff <ArrowRight size={17} aria-hidden="true" /></PrimaryButton></div> : null}
          {showDecisionDone(workflow) && onDone ? (
            <div className={styles.done}>
              <p>{workflow.referral.placementCancellation ? "Placement cancelled. The earlier decision and handoff remain in the record." : workflow.decision ? "No client handoff is needed." : "The referral stays open. Return when you have more information."}</p>
              <PrimaryButton busy={busy === "done"} disabled={Boolean(busy)} onClick={onDone}>Done</PrimaryButton>
            </div>
          ) : null}
        </div>
      </div>

      <dialog ref={followUpRef} aria-labelledby="decision-follow-up-title" className={styles.followUpDrawer} onClose={() => { setFollowUpOpen(false); followUpTriggerRef.current?.focus(); }} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className={styles.followUpHead}><h2 id="decision-follow-up-title">Decision settings</h2><button type="button" aria-label="Close decision settings" onClick={closeFollowUp}><X size={18} aria-hidden="true" /></button></div>
        <div className={styles.followUpBody}>
          {followUpOpen && message ? <WorkflowNotice tone="success">{message}</WorkflowNotice> : null}
          {followUpOpen && error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}
          {workflow.decision?.outcome === "declined" && workflow.capabilities.can_decide && onReopenDecision && !workflow.referral.placementCancellation && !workflow.referral.actualAdmissionDate && !workflow.context.packetSentAt ? <SecondaryButton disabled={Boolean(busy)} onClick={() => { closeFollowUp(); onReopenDecision(); }}>Reopen decision</SecondaryButton> : null}
          {workflow.capabilities.can_track_admission_flow && !workflow.referral.placementCancellation && workflow.referral.stage !== "Declined" ? <AdmissionFlowControls referral={workflow.referral} disabled={Boolean(busy)} onAction={onAdmissionFlowAction} /> : null}
          <details className={styles.details} data-admin-controls>
          <summary>Administrative controls</summary>
          <p className={styles.adminNote}>For authorized staff. These change the referral&apos;s stage or grant a manual intake exception. They do not record the decision, sign the assessment, or send anything.</p>
          <label className="mb-4 flex flex-wrap items-center gap-3 text-[14px] font-medium text-[#59645e]">Referral stage
            <select aria-label="Workflow stage" value={workflow.referral.stage} disabled={Boolean(busy) || !workflow.capabilities.can_update || Boolean(workflow.referral.placementCancellation)} onChange={(event) => { closeFollowUp(); onSubmitTransition(event.target.value as ReferralStage); }} className="h-11 border border-[#c9ceca] bg-white px-3 text-[#303b34]">
              {referralStageDefinitions.filter((item) => !item.terminal || item.stage === workflow.referral.stage || (item.stage === "Declined" && workflow.decision?.outcome === "declined")).map((item) => <option key={item.stage} value={item.stage}>{item.label}</option>)}
            </select>
            <span>Changing the stage only moves the referral; nothing else is recorded.</span>
          </label>
          <CurrentGateCard workflow={workflow} view={view} busy={busy} manualIntakeReason={manualIntakeReason} onManualIntakeReasonChange={onManualIntakeReasonChange} onSubmitTransition={(target) => { closeFollowUp(); onSubmitTransition(target); }} onAuthorizeManualIntake={onAuthorizeManualIntake} onOpenIntake={() => { closeFollowUp(); onOpenIntake(); }} onOpenAssessment={() => { closeFollowUp(); onOpenAssessment(); }} onOpenFiles={() => { closeFollowUp(); onOpenFiles(); }} />
          </details>
        </div>
      </dialog>

      {pendingDetail ? <WorkflowDetailDialog pending={pendingDetail} onConfirm={onConfirmDetail} onClose={onCloseDetail} /> : null}
    </section>
  );
}

type WorkflowView = ReturnType<typeof deriveWorkflowPanelView>;

function DecisionContext({ workflow, busy, onOpenAssessment }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "onOpenAssessment">) {
  const status = workflow.context.assessmentSigned ? "Signed and ready for the decision." : "Open the assessment to review or continue it.";
  return <aside className={styles.context} aria-label="Decision context">
    <span id="decision-assessment-status" className="sr-only">{status}</span>
    <button type="button" disabled={Boolean(busy)} onClick={onOpenAssessment} aria-describedby="decision-assessment-status" title={status}>
      <PipelineIllustration kind="assessment" size={32} />{decisionAssessmentAction(workflow)}
      {workflow.context.assessmentSigned ? <CheckCircle2 size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
    </button>
  </aside>;
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

export function DecisionCard({ confirmRecommendation = false, workflow, busy, recommendation, onRecommendationChange, onSubmitDecision, onOpenUnderReviewEmail, onOpenAssessment }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "recommendation" | "onRecommendationChange" | "onSubmitDecision" | "onOpenUnderReviewEmail"> & { onOpenAssessment?: () => void; confirmRecommendation?: boolean }) {
  const [changingRecommendation, setChangingRecommendation] = useState(false);
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
  if (confirmRecommendation && !changingRecommendation && workflow.recommendation
    && workflow.recommendation.assessmentId === workflow.context.assessmentId
    && !underReview && recommendation.outcome === workflow.recommendation.outcome
    && recommendation.reasonNote === workflow.recommendation.reasonNote
    && recommendation.reasonCode === workflow.recommendation.reasonCode) {
    const accepted = recommendation.outcome === "accept";
    const Icon = accepted ? Check : Minus;
    return <div className={styles.confirmWorkingDecision} data-outcome={recommendation.outcome}>
      <div className={styles.confirmChoice}>
        <span className={styles.outcomeSeal} aria-hidden="true"><Icon className={styles.outcomeIcon} /></span>
        <div><span className={styles.recommendationLabel}>Working decision</span><h4>{accepted ? "Accept" : "Deny"}</h4></div>
        <button type="button" className={styles.changeWorkingDecision} disabled={Boolean(busy) || !workflow.capabilities.can_decide} onClick={() => setChangingRecommendation(true)}>Change</button>
      </div>
      {recommendation.reasonNote ? <p className={styles.confirmReason}>{recommendation.reasonNote}</p> : null}
      <div className={styles.confirmAction}>
        <p>{accepted ? "Nothing is sent." : "Closes this referral. Nothing is sent."}</p>
        <PrimaryButton className={styles.confirmButton} busy={Boolean(busy)} disabled={action.disabled} onClick={() => onSubmitDecision(true)}>{accepted ? "Record acceptance" : "Record denial"}<ArrowRight size={18} aria-hidden="true" /></PrimaryButton>
      </div>
      {!workflow.capabilities.can_decide ? <p className={styles.help}>{action.hint}</p> : null}
    </div>;
  }
  return (
    <section className={styles.decisionCard}>
      <RecommendationOnFile workflow={workflow} selected={recommendation.outcome} selectedNote={recommendation.reasonNote} />
      <fieldset disabled={!workflow.capabilities.can_decide || draftLocked}>
        <legend className="sr-only">Final decision</legend>
        <div className={styles.options}>
          {([{ value: "accept", label: "Accept", detail: "Proceed with placement", Icon: Check }, { value: "decline", label: "Deny", detail: "Close this referral", Icon: Minus }, { value: "needs_more_information", label: "Under review", detail: "Keep open for follow-up", Icon: Clock3 }] as const).map(({ Icon, ...option }) => (
            <label key={option.value} className={styles.option} data-outcome={option.value} data-selected={recommendation.outcome === option.value}>
              <input type="radio" name="assessment-outcome" aria-label={option.label} aria-describedby={`decision-${option.value}-detail`} value={option.value} checked={recommendation.outcome === option.value} onChange={() => onRecommendationChange({ outcome: option.value })} />
              <span className={styles.outcomeSeal} aria-hidden="true"><Icon size={28} className={styles.outcomeIcon} /></span>
              <strong>{option.label}</strong>
              <span className={styles.selectionMark} aria-hidden="true"><Check size={16} /></span>
              <span className="sr-only" id={`decision-${option.value}-detail`}>{option.detail}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <WorkflowTextArea label={underReview ? "What needs review?" : "Reason (optional)"} value={recommendation.reasonNote} disabled={!workflow.capabilities.can_decide || draftLocked} onChange={(reasonNote) => onRecommendationChange({ reasonNote })} />
      <div className={styles.decisionActions}>
        <p id="decision-action-hint" className={!savedUnderReview && (workflow.capabilities.can_decide && !recommendation.outcome || !action.disabled) ? "sr-only" : undefined} data-blocked={!savedUnderReview && action.disabled && !busy ? "true" : undefined}>{savedUnderReview ? "Under review saved. Edit the note to save an update." : action.hint}</p>
        {!savedUnderReview ? <PrimaryButton busy={Boolean(busy)} disabled={action.disabled} describedBy="decision-action-hint" onClick={() => onSubmitDecision()}>{underReview ? "Save under review" : "Record decision"}<ArrowRight size={18} aria-hidden="true" /></PrimaryButton> : null}
        {savedUnderReview && onOpenUnderReviewEmail ? <button type="button" className="min-h-11 font-semibold text-[#087d66] underline" onClick={onOpenUnderReviewEmail}>Review email to Andrew and Sandeep</button> : null}
      </div>
    </section>
  );
}

function RecommendationOnFile({ workflow, selected, selectedNote, compact = false }: { workflow: WorkflowResponse; selected?: RecommendationDraft["outcome"]; selectedNote?: string; compact?: boolean }) {
  const presentation = recommendationPresentation(workflow);
  if (!presentation) return null;
  const guidance = recommendationGuidance(presentation.outcome, selected);
  return <section className={styles.recommendation} data-compact={compact || undefined} aria-label="Recommendation on file">
    <span className={styles.recommendationLabel}>Recommendation on file</span>
    <p className={styles.recommendationOutcome}><strong>{presentation.outcomeLabel}</strong><span>{presentation.attribution}</span></p>
    {presentation.earlierAssessment ? <p className={styles.recommendationDetail}>Recorded for an earlier assessment.</p> : null}
    {showRecommendationNote(presentation.note, compact, selectedNote) ? <p className={styles.recommendationNote}>{presentation.note}</p> : null}
    {presentation.review ? <p className={styles.recommendationDetail}>{presentation.review}</p> : null}
    {!compact && !hasLegacyDecisionSubmission(workflow) ? <p className={selected && selected !== presentation.outcome ? styles.recommendationDetail : "sr-only"}>{guidance}</p> : null}
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
  return <ActionDetailDialog {...requirementDetailPresentation(pending.item, pending.status)} onConfirm={onConfirm} onClose={onClose} />;
}

function PrimaryButton({ className, busy, disabled, describedBy, onClick, children }: { className?: string; busy?: boolean; disabled?: boolean; describedBy?: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled || busy} aria-describedby={describedBy} onClick={onClick} className={`mt-3 inline-flex min-h-action items-center gap-3 rounded-input border-2 border-night px-6 py-3 text-value font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40 ${className ?? "bg-action text-on-action hover:bg-action-hover"}`}>{busy ? <LoaderCircle className="animate-spin" size={13} /> : null}{children}</button>;
}

function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="mt-3 h-10 rounded-md border border-[#cbd5cf] bg-white px-4 text-[13px] font-semibold text-[#35473c] hover:border-[#08775e] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40">{children}</button>;
}

const holdReasons = [
  ["source_records", "Records from referral source"],
  ["client_availability", "Client or family availability"],
  ["clinical_clearance", "Clinical clearance"],
  ["payer_authorization", "Payer authorization"],
  ["admission_paperwork", "Admission paperwork"],
  ["staffed_bed", "Staffed bed"],
  ["transport", "Transportation"],
  ["scheduling", "Scheduling"],
  ["needs_clarification", "Cause needs clarification"],
] as const;

const holdOwners = [
  ["referral_source", "Referral source"], ["client_or_family", "Client or family"],
  ["pipeline", "Admissions team"], ["community", "Community"],
  ["external_partner", "External partner"], ["unassigned", "Owner not established"],
] as const;

function AdmissionFlowControls({ referral, disabled, onAction }: {
  referral: Referral;
  disabled: boolean;
  onAction: (action: "record_ready" | "start_hold" | "end_hold", details?: Record<string, string>) => Promise<boolean>;
}) {
  const [readyDate, setReadyDate] = useState(referral.admissionFlow?.readyToMoveInDate ?? admissionFlowToday());
  const [reason, setReason] = useState<string>(holdReasons[0][0]);
  const [owner, setOwner] = useState<string>(holdOwners[0][0]);
  const activeHold = referral.admissionFlow?.holds?.find((hold) => !hold.endedAt);
  const activeLabel = activeHold && holdReasons.find(([code]) => code === activeHold.reason)?.[1];
  return <section className={styles.drawerSection} aria-label="Admission timing">
    <h3>Admission timing</h3>
    {referral.admissionDecision?.outcome === "accepted" ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void onAction("record_ready", { ready_date: readyDate }); }}>
      <label className="block text-sm font-semibold" htmlFor="client-ready-date">Client ready to move in</label>
      <div className="flex flex-wrap items-center gap-2"><input id="client-ready-date" type="date" min={referral.date.slice(0, 10)} max={admissionFlowToday()} value={readyDate} onChange={(event) => setReadyDate(event.target.value)} required disabled={disabled} className="h-10 border border-[var(--pipeline-surface-edge)] bg-white px-2 text-sm" />
        <button type="submit" disabled={disabled || !readyDate || readyDate === referral.admissionFlow?.readyToMoveInDate} className="min-h-10 border border-[var(--pipeline-green)] px-3 text-sm font-semibold text-[var(--pipeline-green)] disabled:opacity-50">{referral.admissionFlow?.readyToMoveInDate ? "Correct date" : "Record ready date"}</button></div>
      {referral.admissionFlow?.readyToMoveInDate ? <p className={styles.adminNote}>Recorded: {referral.admissionFlow.readyToMoveInDate}</p> : null}
    </form> : null}
    {activeHold ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span>Waiting: {activeLabel ?? activeHold.reason} · {holdOwners.find(([code]) => code === activeHold.responsibleParty)?.[1] ?? activeHold.responsibleParty}</span><button type="button" disabled={disabled} onClick={() => void onAction("end_hold")} className="min-h-10 border border-[var(--pipeline-surface-edge)] bg-white px-3 font-semibold disabled:opacity-50">End hold</button></div> : <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void onAction("start_hold", { reason, responsible_party: owner }); }}>
      <label className="block text-sm font-semibold" htmlFor="admission-hold-reason">If waiting, what is needed?</label>
      <select id="admission-hold-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={disabled} className="h-10 w-full border border-[var(--pipeline-surface-edge)] bg-white px-2 text-sm">{holdReasons.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>
      <label className="block text-sm font-semibold" htmlFor="admission-hold-owner">Who owns the next action?</label>
      <select id="admission-hold-owner" value={owner} onChange={(event) => setOwner(event.target.value)} disabled={disabled} className="h-10 w-full border border-[var(--pipeline-surface-edge)] bg-white px-2 text-sm">{holdOwners.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>
      <button type="submit" disabled={disabled} className="min-h-10 border border-[var(--pipeline-surface-edge)] bg-white px-3 text-sm font-semibold disabled:opacity-50">Record hold</button>
    </form>}
  </section>;
}

function WorkflowTextArea({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const labelId = useId();
  return <label className={styles.note}><span id={labelId}>{label}</span><textarea aria-labelledby={labelId} value={value} disabled={disabled} maxLength={20_000} rows={3} onChange={(event) => onChange(event.target.value)} placeholder="Add context for the team, if helpful." /></label>;
}

function RecordSummary({ title, actor, date, note }: { title: string; actor: string; date: string; note: string }) {
  return <div className={styles.recordSummary}><div className={styles.recordHeading}><h4><CheckCircle2 size={20} aria-hidden="true" />{title}</h4><span>Decision recorded</span></div><p className={styles.recordedBy}>{actor || "Name not recorded"} · {formatRecordedAt(date)}</p>{note ? <p className={styles.recordedNote}>{note}</p> : null}</div>;
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

function recommendationGuidance(outcome: RecommendationDraft["outcome"], selected: RecommendationDraft["outcome"] | undefined) {
  return outcome === selected
    ? "Pre-selected below. It becomes final only when you record the decision."
    : selected ? "Your selection below differs from this recommendation." : "Choose the final decision below.";
}

function showRecommendationNote(note: string | null | undefined, compact: boolean, selectedNote: string | undefined) {
  return note && !compact && note !== selectedNote;
}

import { useState, type ReactNode } from "react";
import { Check, CheckCircle2, ChevronDown, Circle, LoaderCircle } from "lucide-react";

import ActionDetailDialog from "@/components/pipeline/ActionDetailDialog";
import ReferralClientActivationPanel from "@/components/pipeline/ReferralClientActivationPanel";
import {
  admissionRequirementSummary,
  deriveWorkflowPanelView,
  formatRequirementStatus,
  handoffDescription,
  requirementDetailPresentation,
  requirementGroups,
  requirementStatuses,
  requirementStatusDetail,
  resolvedRequirementCount,
  terminalStageMessage,
  transitionActionLabel,
  type PendingWorkflowDetail,
  type RequirementGroupPresentation,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import { referralStageDefinitions, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { AdmissionRequirement, AssessmentRecommendation, EhrHandoffStatus, RequirementStatus } from "@/lib/pipeline/referral-types";
import { isRequirementComplete } from "@/lib/pipeline/workflow-records";

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
  admissionDate: string;
  manualIntakeReason: string;
  pendingDetail: PendingWorkflowDetail | null;
  onRecommendationChange: (patch: Partial<RecommendationDraft>) => void;
  onAdmissionDateChange: (value: string) => void;
  onSaveAdmissionDate: () => void;
  onManualIntakeReasonChange: (value: string) => void;
  onUpdateRequirement: (item: AdmissionRequirement, status: RequirementStatus) => void;
  onSubmitDecision: () => void;
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

  return (
    <section aria-label="Admission decision" className="mx-auto max-w-3xl space-y-4 py-4 sm:px-3">
      {message ? <WorkflowNotice tone="success">{message}</WorkflowNotice> : null}
      {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}

      <div className="space-y-5">
        <WorkflowPrimaryColumn
          workflow={workflow}
          view={view}
          busy={busy}
          recommendation={recommendation}
          admissionDate={admissionDate}
          manualIntakeReason={manualIntakeReason}
          onRecommendationChange={onRecommendationChange}
          onAdmissionDateChange={onAdmissionDateChange}
          onSaveAdmissionDate={onSaveAdmissionDate}
          onManualIntakeReasonChange={onManualIntakeReasonChange}
          onSubmitDecision={onSubmitDecision}
          onSubmitTransition={onSubmitTransition}
          onAuthorizeManualIntake={onAuthorizeManualIntake}
          onOpenIntake={onOpenIntake}
          onOpenAssessment={onOpenAssessment}
          onOpenFiles={onOpenFiles}
        />
        <details>
          <summary className="cursor-pointer py-4 text-[13px] font-semibold text-[#53615a] focus-visible:outline-2">Admission details</summary>
          <label className="mb-4 flex flex-wrap items-center gap-3 text-[13px] font-medium text-[#59645e]">Workflow stage
            <select aria-label="Workflow stage" value={workflow.referral.stage} disabled={Boolean(busy) || !workflow.capabilities.can_update} onChange={(event) => onSubmitTransition(event.target.value as ReferralStage)} className="h-10 border border-[#c9ceca] bg-white px-3 text-[#303b34]">
              {referralStageDefinitions.filter((item) => !item.terminal || item.stage === workflow.referral.stage || (item.stage === "Accepted / Admitted" ? workflow.decision?.outcome === "accepted" : workflow.decision?.outcome === "declined")).map((item) => <option key={item.stage} value={item.stage}>{item.label}</option>)}
            </select>
            <span>Revisit earlier work or move ahead as needed.</span>
          </label>
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
      </div>

      {(workflow.recommendation?.outcome === "needs_more_information" || workflow.decision) && onDone ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#d9dfdb] pt-5">
          <p className="text-[12px] text-[#68716c]">Saved. You can return to this referral anytime.</p>
          <PrimaryButton busy={busy === "done"} disabled={Boolean(busy)} onClick={onDone}>Done</PrimaryButton>
        </div>
      ) : null}

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
  admissionDate,
  manualIntakeReason,
  onRecommendationChange,
  onAdmissionDateChange,
  onSaveAdmissionDate,
  onManualIntakeReasonChange,
  onSubmitDecision,
  onSubmitTransition,
  onAuthorizeManualIntake,
  onOpenIntake,
  onOpenAssessment,
  onOpenFiles,
}: Pick<ReferralWorkflowPanelPresentationProps,
  "workflow" | "busy" | "recommendation" | "admissionDate" | "manualIntakeReason" | "onRecommendationChange" | "onAdmissionDateChange" | "onSaveAdmissionDate" |
  "onManualIntakeReasonChange" | "onSubmitDecision" | "onSubmitTransition" | "onAuthorizeManualIntake" |
  "onOpenIntake" | "onOpenAssessment" | "onOpenFiles"
> & { view: WorkflowView }) {
  return (
    <div className="space-y-5">
      <DecisionCard workflow={workflow} busy={busy} recommendation={recommendation} onRecommendationChange={onRecommendationChange} onSubmitDecision={onSubmitDecision} />
      <CurrentGateCard workflow={workflow} view={view} busy={busy} admissionDate={admissionDate} onAdmissionDateChange={onAdmissionDateChange} onSaveAdmissionDate={onSaveAdmissionDate} manualIntakeReason={manualIntakeReason} onManualIntakeReasonChange={onManualIntakeReasonChange} onSubmitTransition={onSubmitTransition} onAuthorizeManualIntake={onAuthorizeManualIntake} onOpenIntake={onOpenIntake} onOpenAssessment={onOpenAssessment} onOpenFiles={onOpenFiles} />
    </div>
  );
}

function CurrentGateCard({
  workflow,
  view,
  busy,
  admissionDate,
  onAdmissionDateChange,
  onSaveAdmissionDate,
  manualIntakeReason,
  onManualIntakeReasonChange,
  onSubmitTransition,
  onAuthorizeManualIntake,
  onOpenIntake,
  onOpenAssessment,
  onOpenFiles,
}: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "admissionDate" | "onAdmissionDateChange" | "onSaveAdmissionDate" | "manualIntakeReason" | "onManualIntakeReasonChange" | "onSubmitTransition" | "onAuthorizeManualIntake" | "onOpenIntake" | "onOpenAssessment" | "onOpenFiles"> & { view: WorkflowView }) {
  const { currentReferral, forwardTransition, assessmentState, showManualIntake } = view;
  if (workflow.context.assessmentSigned && !workflow.decision) return null;
  if (assessmentState && !workflow.decision) return null;
  return (
    <WorkflowCard title={workflow.decision?.outcome === "accepted" ? "Admission" : "Next step"} detail={currentReferral.stage}>
      {workflow.decision?.outcome === "accepted" ? (
        <div className="mb-4 flex flex-wrap items-end gap-3 border-b border-[#e3e6e4] pb-4">
          <label className="block min-w-[180px] flex-1 text-[11px] font-bold text-[#303b34]" htmlFor="workflow-admit-date">
            Admission date
            <input id="workflow-admit-date" type="date" value={admissionDate} onChange={(event) => onAdmissionDateChange(event.target.value)} disabled={!workflow.capabilities.can_update || Boolean(busy)} className="mt-1 block h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] text-[#202320] focus-visible:outline-[#0f8b73] disabled:bg-[#f4f6f5]" />
          </label>
          {workflow.capabilities.can_email ? <PrimaryButton busy={busy.startsWith("admit-date:")} disabled={Boolean(busy)} onClick={onSaveAdmissionDate}>Prepare Meet the Client</PrimaryButton> : <p className="text-[12px] text-[#68716c]">A supervisor prepares and sends Meet the Client.</p>}
        </div>
      ) : null}
      {forwardTransition ? (
        forwardTransition.blockers.length > 0 ? (
          <div className="space-y-2">
            {forwardTransition.blockers.map((blocker) => <div key={blocker.code} className="text-[11px] leading-5 text-[#7a4c0d]">{blocker.label}</div>)}
            <div className="flex flex-wrap gap-2 pt-1"><SecondaryButton onClick={onOpenIntake}>Open intake</SecondaryButton><SecondaryButton onClick={onOpenFiles}>Open files</SecondaryButton><SecondaryButton onClick={onOpenAssessment}>Open assessment</SecondaryButton></div>
          </div>
        ) : <div className="space-y-3">{forwardTransition.alerts?.length ? <div role="status" className="bg-[#f7faf9] px-3 py-2 text-[11px] leading-5 text-[#59645e]">{forwardTransition.alerts.map((alert) => <div key={alert.code}>{alert.label}</div>)}<div className="mt-1 font-bold">You can continue with these items unanswered.</div></div> : null}<PrimaryButton busy={busy === `transition:${forwardTransition.target}`} disabled={!workflow.capabilities.can_update} onClick={() => onSubmitTransition(forwardTransition.target)}>{transitionActionLabel(forwardTransition.target)}</PrimaryButton></div>
      ) : <div className="flex items-center gap-2 text-[11px] font-black text-[#0f6f5e]"><CheckCircle2 size={15} /> {terminalStageMessage(currentReferral)}</div>}

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

function DecisionCard({ workflow, busy, recommendation, onRecommendationChange, onSubmitDecision }: Pick<ReferralWorkflowPanelPresentationProps, "workflow" | "busy" | "recommendation" | "onRecommendationChange" | "onSubmitDecision">) {
  if (workflow.decision) return <WorkflowCard title="Decision recorded" detail="">
    <RecordSummary title={workflow.decision.outcome === "accepted" ? "Accepted" : "Denied"} actor={workflow.decision.decidedByName} date={workflow.decision.decidedAt} note={workflow.decision.reasonNote} />
  </WorkflowCard>;
  const underReview = recommendation.outcome === "needs_more_information";
  const legacySubmission = Boolean(workflow.review && workflow.review.assessmentId === workflow.context.assessmentId);
  return (
    <WorkflowCard title="Decision" detail="">
      <fieldset disabled={!workflow.capabilities.can_decide || Boolean(busy)} className="my-4">
        <legend className="sr-only">Placement decision</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {([{ value: "accept", label: "Accept" }, { value: "decline", label: "Deny" }, { value: "needs_more_information", label: "Under review" }] as const).map((option) => (
            <label key={option.value} className={`flex min-h-12 cursor-pointer items-center gap-3 border px-4 py-3 text-[14px] font-bold ${recommendation.outcome === option.value ? "border-[#0f8b73] bg-[#eff8f3]" : "border-[#c9ceca] bg-white"}`}>
              <input type="radio" name="assessment-outcome" value={option.value} checked={recommendation.outcome === option.value} onChange={() => onRecommendationChange({ outcome: option.value })} className="accent-[#0f8b73]" />{option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <WorkflowTextArea label={underReview ? "What needs review?" : "Reason (optional)"} value={recommendation.reasonNote} onChange={(reasonNote) => onRecommendationChange({ reasonNote })} />
      <p className="mt-3 text-[12px] text-[#68716c]">{underReview ? legacySubmission ? "This earlier submission is preserved. Choose Accept or Deny when ready." : "Keeps the referral open. No approval request is sent." : "Signing and packet sending are separate."}</p>
      {underReview && !workflow.context.assessmentId ? <p className="mt-2 text-[12px] text-[#68716c]">Open the assessment before saving Under review.</p> : null}
      <PrimaryButton busy={Boolean(busy)} disabled={!workflow.capabilities.can_decide || !recommendation.outcome || (underReview && (!workflow.capabilities.can_recommend || !workflow.context.assessmentId || legacySubmission))} onClick={onSubmitDecision}>{underReview ? "Save under review" : "Record decision"}</PrimaryButton>
    </WorkflowCard>
  );
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
        <div><h4 className="text-[10px] font-black uppercase tracking-[0.08em] text-[#44504b]">{group.label}</h4><p className="mt-0.5 text-[9px] text-[#737c77]">{group.detail}</p></div>
        <span className="shrink-0 text-[9px] font-black text-[#68716c]">{resolvedRequirementCount(group.items)} / {group.items.length} resolved</span>
      </div>
      <div className="divide-y divide-[#e4e7e5] border-y border-[#d9d9d9]">
        {group.items.map((item) => (
          <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-[#202522]">{isRequirementComplete(item.status) ? <Check size={13} className="text-[#0f8b73]" /> : <Circle size={11} className="text-[#a0a0a0]" />}<span>{item.label}</span>{item.blocker ? <span className="text-[9px] font-black uppercase text-[#68716c]">To complete</span> : null}</div>
              <div className="mt-1 text-[10px] leading-4 text-[#737373]">{requirementStatusDetail(item)}</div>
            </div>
            <select aria-label={`${item.label} status`} value={item.status} disabled={disabled} onChange={(event) => onChange(item, event.target.value as RequirementStatus)} className="h-9 w-full border border-[#c9ceca] bg-white px-2 text-[10px] font-black outline-none focus:border-[#0f8b73]">{requirementStatuses.map((status) => <option key={status} value={status}>{formatRequirementStatus(status)}</option>)}</select>
          </div>
        ))}
      </div>
    </section>
  );
}

function PrimaryButton({ busy, disabled, onClick, children }: { busy?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled || busy} onClick={onClick} className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-[#08775e] px-4 text-[13px] font-semibold text-white hover:bg-[#065f4b] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={13} /> : null}{children}</button>;
}

function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="mt-3 h-10 rounded-md border border-[#cbd5cf] bg-white px-4 text-[13px] font-semibold text-[#35473c] hover:border-[#08775e] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40">{children}</button>;
}

function WorkflowTextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="mt-3 block"><span className="text-[13px] font-medium text-[#53615a]">{label}</span><textarea value={value} maxLength={20_000} rows={3} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full resize-y border border-[#c9ceca] px-3 py-2 text-[14px] leading-6 outline-none focus:border-[#0f8b73]" /></label>;
}

function RecordSummary({ title, actor, date, note }: { title: string; actor: string; date: string; note: string }) {
  return <div className="border-l-2 border-[#0f8b73] px-3 py-2"><div className="text-[14px] font-semibold text-[#25372d]">{title}</div><div className="mt-1 text-[13px] text-[#59665f]">{actor} · {new Date(date).toLocaleString()}</div>{note ? <div className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-[#35473c]">{note}</div> : null}</div>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Circle, ClipboardCheck, LoaderCircle, Send, ShieldCheck } from "lucide-react";

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
  const [decisionOutcome, setDecisionOutcome] = useState<AdmissionDecision["outcome"]>("accepted");
  const [decisionCode, setDecisionCode] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [manualIntakeReason, setManualIntakeReason] = useState("");
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
      setDecisionOutcome(payload.decision?.outcome ?? "accepted");
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

  const updateRequirement = async (item: AdmissionRequirement, status: RequirementStatus) => {
    const patch: Record<string, unknown> = { status };
    if (status === "requested") {
      const requestedFrom = window.prompt("Who is expected to provide this item?", item.requestedFrom ?? "")?.trim();
      if (!requestedFrom) return;
      patch.requestedFrom = requestedFrom;
      patch.followUpAt = item.followUpAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    }
    if (status === "waived") {
      const reason = window.prompt("Why is this requirement being waived?", item.waiverReason ?? "")?.trim();
      if (!reason) return;
      patch.waiverReason = reason;
    }
    if (status === "unavailable" || status === "not_applicable") {
      const reason = window.prompt(status === "unavailable" ? "Why is this unavailable?" : "Why does this not apply?", item.unavailableReason ?? "")?.trim();
      if (!reason) return;
      patch.unavailableReason = reason;
    }
    await runMutation(
      `requirement:${item.id}:${item.version ?? 1}:${status}`,
      `/api/referrals/${currentReferral.id}/work-items/${item.id}`,
      "PATCH",
      { if_match: item.version ?? 1, patch },
      `${item.label} updated`,
    );
  };

  return (
    <section aria-label="Admission workflow" className="space-y-6 py-2 sm:px-2">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Admission workflow</div>
        <h2 className="mt-1 text-[22px] font-black text-[#111111]">From referral to handoff</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[#68716c]">Complete the current gate, record the clinical recommendation, obtain the supervisor decision, finish admission requirements, and prepare the EHR handoff.</p>
      </div>

      {message ? <WorkflowNotice tone="success">{message}</WorkflowNotice> : null}
      {error ? <WorkflowNotice tone="error">{error}</WorkflowNotice> : null}

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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-5">
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

          <WorkflowCard icon={<ShieldCheck size={17} />} title="Clinical recommendation" detail={workflow.context.assessmentSigned ? "Signed assessment available" : "Assessment signature required"}>
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
          </WorkflowCard>

          <WorkflowCard icon={<CheckCircle2 size={17} />} title="Supervisor decision" detail={workflow.capabilities.can_decide ? "Supervisor authority" : "Visible to the assigned team"}>
            {workflow.decision ? <RecordSummary title={`${formatOutcome(workflow.decision.outcome)} decision`} actor={workflow.decision.decidedByName} date={workflow.decision.decidedAt} note={workflow.decision.reasonNote} /> : null}
            {workflow.capabilities.can_decide ? (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <WorkflowSelect label="Decision" value={decisionOutcome} onChange={(value) => { decisionDirty.current = true; setDecisionOutcome(value as AdmissionDecision["outcome"]); }} options={[{ value: "accepted", label: "Accept" }, { value: "declined", label: "Decline" }]} />
                  <WorkflowInput label="Reason code (optional)" value={decisionCode} onChange={(value) => { decisionDirty.current = true; setDecisionCode(value); }} />
                </div>
                <WorkflowTextArea label="Decision rationale" value={decisionNote} onChange={(value) => { decisionDirty.current = true; setDecisionNote(value); }} />
                {!workflow.recommendation ? <WorkflowTextArea label="Supervisor override reason" value={overrideReason} onChange={(value) => { decisionDirty.current = true; setOverrideReason(value); }} /> : null}
                <PrimaryButton
                  busy={busy.startsWith("decision:")}
                  disabled={!workflow.context.assessmentSigned || (decisionOutcome === "declined" && !decisionNote.trim()) || (!workflow.recommendation && !overrideReason.trim())}
                  onClick={() => void runMutation(
                    `decision:${currentReferral.version}:${sections.decision}`,
                    `/api/referrals/${currentReferral.id}/decision`,
                    "PUT",
                    { if_match: currentReferral.version, if_match_section: sections.decision, outcome: decisionOutcome, reason_code: decisionCode, reason_note: decisionNote, override_reason: overrideReason },
                    "Supervisor decision recorded",
                  )}
                >Record decision</PrimaryButton>
              </>
            ) : null}
          </WorkflowCard>
        </div>

        <div className="space-y-5">
          <WorkflowCard icon={<ClipboardCheck size={17} />} title="Admission requirements" detail={`${incompleteMoveIn.length} blocking move-in item${incompleteMoveIn.length === 1 ? "" : "s"} remaining`}>
            <div className="divide-y divide-[#e4e7e5] border-y border-[#d9d9d9]">
              {workflow.work_items.map((item) => (
                <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-black text-[#202522]">{isRequirementComplete(item.status) ? <Check size={13} className="text-[#0f8b73]" /> : <Circle size={11} className="text-[#a0a0a0]" />}<span>{item.label}</span>{item.blocker ? <span className="text-[9px] font-black uppercase text-[#9a6115]">Required</span> : null}</div>
                    <div className="mt-1 text-[10px] leading-4 text-[#737373]">{item.nextStep}</div>
                  </div>
                  <select aria-label={`${item.label} status`} value={item.status} disabled={!workflow.capabilities.can_update || Boolean(busy)} onChange={(event) => void updateRequirement(item, event.target.value as RequirementStatus)} className="h-9 w-full border border-[#c9ceca] bg-white px-2 text-[10px] font-black outline-none focus:border-[#0f8b73]">
                    {requirementStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </WorkflowCard>

          <WorkflowCard icon={<Send size={17} />} title="EHR handoff" detail={handoffDescription(handoffStatus)}>
            <div className="flex flex-wrap gap-2">
              {handoffStatus === "failed" ? <PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update} onClick={() => void updateHandoff("retry")}>Retry handoff</PrimaryButton> : null}
              {handoffStatus !== "queued" && handoffStatus !== "sent" && handoffStatus !== "failed" ? <PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update || currentReferral.stage !== "Accepted / Admitted"} onClick={() => void updateHandoff("queue")}>Queue EHR handoff</PrimaryButton> : null}
              {handoffStatus === "queued" ? <><PrimaryButton busy={busy.startsWith("ehr:")} disabled={!workflow.capabilities.can_update} onClick={() => void updateHandoff("mark_sent")}>Record sent</PrimaryButton><SecondaryButton disabled={Boolean(busy)} onClick={() => void updateHandoff("mark_failed")}>Record failed</SecondaryButton></> : null}
              {handoffStatus === "sent" ? <div className="flex items-center gap-2 text-[11px] font-black text-[#0f6f5e]"><CheckCircle2 size={15} /> Handoff recorded as sent.</div> : null}
            </div>
          </WorkflowCard>
        </div>
      </div>
    </section>
  );

  async function updateHandoff(action: "queue" | "mark_sent" | "mark_failed" | "retry") {
    let failureReason = "";
    if (action === "mark_failed") {
      failureReason = window.prompt("Why did the EHR handoff fail?")?.trim() ?? "";
      if (!failureReason) return;
    }
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
  return <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
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

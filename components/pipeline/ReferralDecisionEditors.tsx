"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type {
  AdmissionDecision,
  AssessmentRecommendation,
  EhrHandoffRecord,
  Referral,
} from "@/lib/pipeline/referral-types";

export function DeleteWorkspaceDialog({
  name,
  busy,
  onConfirm,
  onClose,
}: {
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="delete-workspace-title" className="w-full max-w-md border border-[#cfcfcf] border-t-[3px] border-t-[#a9473d] bg-white p-5 shadow-xl">
        <h2 id="delete-workspace-title" className="text-[16px] font-black text-[#111111]">Move workspace to trash?</h2>
        <p className="mt-2 text-[12px] leading-5 text-[#595959]"><strong>{name}</strong> and its files will leave active work immediately. They can be restored from Trash for 30 days.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="h-10 border border-[#c9ceca] px-4 text-[11px] font-black text-[#595959] hover:bg-[#f7faf9]">Cancel</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="h-10 bg-[#a9473d] px-4 text-[11px] font-black text-white hover:bg-[#8d382f] disabled:opacity-50">{busy ? "Moving..." : "Move to trash"}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function EhrHandoffEditor({
  referral,
  onSaved,
}: {
  referral: Referral | null;
  onSaved: (referral: Referral) => void | Promise<void>;
}) {
  const handoff = referral?.ehrHandoff;
  const [failureReason, setFailureReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const accepted = referral?.stage === "Accepted / Admitted" && referral.admissionDecision?.outcome === "accepted";

  const run = async (action: "queue" | "mark_sent" | "mark_failed" | "retry") => {
    if (!referral) return;
    setSaving(true);
    setMessage("");
    try {
      const payload = await fetchPipelineJson<{ referral: Referral; ehr_handoff: EhrHandoffRecord }>(
        `/api/referrals/${referral.id}/ehr-handoff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: referral.version,
            if_match_section: referral.sectionVersions?.decision ?? 1,
            action,
            failure_reason: action === "mark_failed" ? failureReason.trim() : "",
          }),
        },
      );
      await onSaved(payload.referral);
      setFailureReason("");
      setMessage({
        queue: "EHR handoff queued.",
        retry: "EHR handoff queued again.",
        mark_sent: "EHR handoff recorded as sent.",
        mark_failed: "EHR handoff failure recorded.",
      }[action]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The EHR handoff could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  if (!referral?.admissionDecision || referral.admissionDecision.outcome !== "accepted") return null;

  const status = handoff?.status ?? "not_ready";
  return (
    <section aria-label="EHR handoff" className="mt-5 border-t border-[#d9d9d9] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">EHR handoff</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[13px] font-black capitalize">{status.replace("_", " ")}</span>
            {handoff?.queuedAt ? (
              <span className="text-[11px] text-[#737373]">Queued {new Date(handoff.queuedAt).toLocaleString()}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(status === "not_ready" || status === "ready") ? (
            <button
              type="button"
              onClick={() => void run("queue")}
              disabled={!accepted || saving}
              className="h-9 bg-[#111111] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73] disabled:bg-[#d9d9d9]"
            >
              Queue handoff
            </button>
          ) : null}
          {status === "failed" ? (
            <button type="button" onClick={() => void run("retry")} disabled={saving} className="h-9 bg-[#111111] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73] disabled:bg-[#d9d9d9]">
              Retry
            </button>
          ) : null}
          {status === "queued" ? (
            <>
              <button type="button" onClick={() => void run("mark_sent")} disabled={saving} className="h-9 border border-[#0f8b73] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-[#0f8b73] hover:bg-[#effaf5] disabled:text-[#b3b3b3]">
                Mark sent
              </button>
              <input
                value={failureReason}
                onChange={(event) => setFailureReason(event.target.value)}
                placeholder="Failure reason"
                aria-label="EHR handoff failure reason"
                className="h-9 w-44 border border-[#c9ceca] px-3 text-[11px] outline-none focus:border-[#a63d2f]"
              />
              <button type="button" onClick={() => void run("mark_failed")} disabled={saving || !failureReason.trim()} className="h-9 border border-[#a63d2f] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-[#a63d2f] hover:bg-[#fff7f5] disabled:border-[#d9d9d9] disabled:text-[#b3b3b3]">
                Mark failed
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-2 min-h-4 text-[11px] text-[#737373]">
        {message || (!accepted ? "Move the accepted referral to Accepted / Admitted before queueing the handoff." : status === "not_ready" ? "Queue only after the accepted record and EHR requirements are complete." : handoff?.failureReason ?? "")}
      </div>
    </section>
  );
}

export function AdmissionDecisionEditor({
  referral,
  assessmentComplete,
  assessmentId,
  onSaved,
}: {
  referral: Referral | null;
  assessmentComplete: boolean;
  assessmentId?: string;
  onSaved: (referral: Referral) => void | Promise<void>;
}) {
  const existing = referral?.admissionDecision;
  const [viewer, setViewer] = useState<{ id: string; roles: string[] } | null>(null);
  const [savedRecommendation, setSavedRecommendation] = useState<AssessmentRecommendation | undefined>(referral?.assessmentRecommendation);
  const recommendation = savedRecommendation;
  const [recommendationOutcome, setRecommendationOutcome] = useState<AssessmentRecommendation["outcome"] | "">(recommendation?.outcome ?? "");
  const [recommendationNote, setRecommendationNote] = useState(recommendation?.reasonNote ?? "");
  const [outcome, setOutcome] = useState<AdmissionDecision["outcome"] | "">(existing?.outcome ?? "");
  const [reasonNote, setReasonNote] = useState(existing?.reasonNote ?? "");
  const [overrideReason, setOverrideReason] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const isSupervisor = Boolean(viewer?.roles.some((role) => role === "admin" || role === "assessment_coordinator"));
  const isAssignedAssessor = Boolean(viewer && referral?.ownerId === viewer.id);

  useEffect(() => {
    fetchPipelineJson<{ user: { id: string; roles: string[] } }>("/api/auth/me", { cache: "no-store" })
      .then((payload) => setViewer(payload.user))
      .catch(() => setViewer(null));
  }, []);

  useEffect(() => {
    setOutcome(referral?.admissionDecision?.outcome ?? "");
    setReasonNote(referral?.admissionDecision?.reasonNote ?? "");
    setSavedRecommendation(referral?.assessmentRecommendation);
    setRecommendationOutcome(referral?.assessmentRecommendation?.outcome ?? "");
    setRecommendationNote(referral?.assessmentRecommendation?.reasonNote ?? "");
  }, [referral?.admissionDecision, referral?.assessmentRecommendation]);

  const saveRecommendation = async () => {
    if (!referral || !assessmentId || !recommendationOutcome) return;
    setSaving(true);
    setStatus("");
    try {
      const payload = await fetchPipelineJson<{ referral: Referral; recommendation: AssessmentRecommendation }>(
        `/api/referrals/${referral.id}/recommendation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: referral.version,
            if_match_section: referral.sectionVersions?.decision ?? 1,
            assessment_id: assessmentId,
            outcome: recommendationOutcome,
            reason_note: recommendationNote.trim(),
          }),
        },
      );
      setSavedRecommendation(payload.recommendation);
      await onSaved(payload.referral);
      setStatus("Recommendation submitted for supervisor review");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the recommendation.");
    } finally {
      setSaving(false);
    }
  };

  const saveDecision = async () => {
    if (!referral || !outcome) return;
    setSaving(true);
    setStatus("");
    try {
      const payload = await fetchPipelineJson<{ referral: Referral; decision: AdmissionDecision }>(
        `/api/referrals/${referral.id}/decision`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: referral.version,
            if_match_section: referral.sectionVersions?.decision ?? 1,
            outcome,
            reason_note: outcome === "declined" ? reasonNote : "",
            override_reason: recommendation ? "" : overrideReason.trim(),
          }),
        },
      );
      await onSaved(payload.referral);
      setStatus("Decision saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the admission decision.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Admission decision" className="mt-5 border-t border-[#d9d9d9] pt-5">
      {recommendation ? (
        <div className="mb-4 border-l-2 border-[#0f8b73] bg-[#f2f8f5] px-4 py-3 text-[11px] text-[#315e50]">
          <strong>Assessor recommendation: {recommendationLabel(recommendation.outcome)}</strong>
          {recommendation.reasonNote ? <span className="mt-1 block whitespace-pre-wrap">{recommendation.reasonNote}</span> : null}
          <span className="mt-1 block text-[9px] text-[#597168]">{recommendation.recommendedByName} · {new Date(recommendation.recommendedAt).toLocaleString()}</span>
        </div>
      ) : isAssignedAssessor && !existing ? (
        <div className="mb-5 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_auto] lg:items-end">
          <label className="block"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#0f8b73]">Assessor recommendation</span><select value={recommendationOutcome} onChange={(event) => setRecommendationOutcome(event.target.value as typeof recommendationOutcome)} disabled={!assessmentComplete} className="mt-2 h-10 w-full border border-[#c9ceca] bg-white px-3 text-[11px] font-black outline-none focus:border-[#0f8b73]"><option value="">Choose recommendation</option><option value="accept">Recommend admission</option><option value="decline">Do not recommend admission</option><option value="needs_more_information">Need more information</option></select></label>
          <label className="block"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#595959]">Clinical rationale</span><textarea value={recommendationNote} onChange={(event) => setRecommendationNote(event.target.value)} rows={2} className="mt-2 w-full resize-none border border-[#c9ceca] px-3 py-2 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
          <button type="button" onClick={() => void saveRecommendation()} disabled={!assessmentComplete || !assessmentId || !recommendationOutcome || (recommendationOutcome !== "accept" && !recommendationNote.trim()) || saving} className="h-10 bg-[#111111] px-5 text-[11px] font-black uppercase text-white hover:bg-[#0f8b73] disabled:bg-[#d9d9d9]">Submit</button>
        </div>
      ) : null}

      {isSupervisor ? <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Supervisor decision</div>
          <div className="mt-2 flex border border-[#c9ceca] bg-white">
            {(["accepted", "declined"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setOutcome(value)}
                disabled={!referral || !assessmentComplete}
                className={`h-10 flex-1 px-4 text-[11px] font-black uppercase ${outcome === value ? "bg-[#111111] text-white" : "text-[#595959] hover:bg-[#f7faf9]"} disabled:cursor-not-allowed disabled:text-[#b3b3b3]`}
              >
                {value === "accepted" ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#595959]">Why no admission</span>
          <textarea
            value={reasonNote}
            onChange={(event) => setReasonNote(event.target.value)}
            disabled={outcome !== "declined"}
            rows={2}
            className="mt-2 w-full resize-none border border-[#c9ceca] px-3 py-2 text-[12px] outline-none focus:border-[#0f8b73] disabled:bg-[#f7f7f7]"
          />
        </label>
        {!recommendation ? <label className="block lg:col-span-2"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#a16a16]">Override reason</span><input value={overrideReason} maxLength={1_000} onChange={(event) => setOverrideReason(event.target.value)} className="mt-2 h-10 w-full border border-[#d7bd84] bg-[#fffaf0] px-3 text-[12px] outline-none focus:border-[#a16a16]" /></label> : null}
        <button
          type="button"
          onClick={saveDecision}
          disabled={!referral || !assessmentComplete || !outcome || (outcome === "declined" && !reasonNote.trim()) || (!recommendation && !overrideReason.trim()) || saving}
          className="h-10 bg-[#111111] px-5 text-[11px] font-black uppercase text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#d9d9d9]"
        >
          {saving ? "Saving" : "Save decision"}
        </button>
      </div> : null}
      <div className="mt-2 min-h-4 text-[11px] text-[#737373]">
        {status || (!referral
          ? "Save the referral first."
          : !assessmentComplete
            ? "Sign the assessment before recommendation or decision."
              : existing
                ? `Recorded by ${existing.decidedByName}.`
                : !isSupervisor && !isAssignedAssessor
                  ? "The assigned assessor submits the recommendation; a supervisor records the final decision."
                  : "")}
      </div>
    </section>
  );
}

function recommendationLabel(value: AssessmentRecommendation["outcome"]) {
  if (value === "accept") return "Admit";
  if (value === "decline") return "Do not admit";
  return "Needs more information";
}

"use client";

import { useEffect, useState } from "react";

import { AssessmentField } from "@/components/pipeline/AssessmentInterviewFields";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { assessmentInterviewQuestions } from "@/lib/assessment/assessment-interview-schema";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { assessmentToolFieldDefinitions, type AssessmentToolData, type AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import { pipelineCommunities } from "@/lib/pipeline/community-config";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import type { Referral, ReferralPatch } from "@/lib/pipeline/referral-types";
import { completionMemoAddendumReason, completionMemoAssessmentField } from "@/lib/pipeline/completion-memo-fields";
import type { CompletionMemoClient, CompletionMemoTask } from "@/lib/pipeline/weekly-completion-memo";

const chartFields = {
  name: "name", dob: "dob", gender: "gender", community: "community",
  referent: "source", county: "county", referralReceived: "date",
} as const satisfies Record<string, keyof Referral>;
const unresolvedAnswers = new Set(["tbd", "pending", "see packet", "see referral packet", "same as above", "?"]);

export default function CompletionMemoReviewForm({ client, task, onSaved, onOpenTask }: {
  client: CompletionMemoClient;
  task: CompletionMemoTask;
  onSaved: () => Promise<void>;
  onOpenTask: () => void;
}) {
  const assessmentField = completionMemoAssessmentField(task.id);
  const chartKey = task.id.startsWith("profile:") ? task.id.slice("profile:".length) as keyof typeof chartFields : null;
  const chartField = chartKey && Object.hasOwn(chartFields, chartKey) ? chartFields[chartKey] : null;
  const definition = assessmentToolFieldDefinitions.find((item) => item.key === assessmentField);
  const question = assessmentInterviewQuestions.find((item) => item.field === assessmentField);
  const canEditAssessment = Boolean(assessmentField && definition && question && client.assessment_id);
  const canEditChart = Boolean(chartField);
  const [assessment, setAssessment] = useState<PipelineAssessmentRecord | null>(null);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [answer, setAnswer] = useState<AssessmentToolData[AssessmentToolFieldKey]>(null);
  const [unableReason, setUnableReason] = useState("");
  const [chartValue, setChartValue] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setAssessment(null);
    setReferral(null);
    setAnswer(null);
    setUnableReason("");
    setChartValue("");
    setSourceNote("");
    setError("");
    setSaved("");
    setConflict(false);
    if (!canEditAssessment && !canEditChart) return () => controller.abort();
    setLoading(true);
    const path = canEditAssessment
      ? `/api/assessments/${encodeURIComponent(client.assessment_id!)}`
      : `/api/referrals/${client.referral_id}`;
    void fetchPipelineJson<{ assessment?: PipelineAssessmentRecord; referral?: Referral }>(path, { signal: controller.signal, cache: "no-store" })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (payload.assessment && assessmentField) {
          setAssessment(payload.assessment);
          setAnswer(payload.assessment[assessmentField]);
          setUnableReason(payload.assessment.unable_to_assess_reasons?.[assessmentField] ?? "");
        }
        if (payload.referral && chartField) {
          setReferral(payload.referral);
          setChartValue(String(payload.referral[chartField] ?? ""));
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "This record could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client.assessment_id, client.referral_id, task.id, canEditAssessment, canEditChart, assessmentField, chartField]);

  const finalized = Boolean(assessment?.meet_client_sent_at);
  const hasAnswer = Array.isArray(answer) ? answer.length > 0
    : typeof answer === "string" ? answer.trim().length > 0
    : answer !== null && answer !== undefined;
  const answerChanged = assessment && assessmentField
    ? JSON.stringify(answer) !== JSON.stringify(assessment[assessmentField])
      || unableReason.trim() !== (assessment.unable_to_assess_reasons?.[assessmentField] ?? "").trim()
    : false;
  const missingUnableReason = answer === "unable_to_assess" && !unableReason.trim();
  const unresolvedAnswer = typeof answer === "string" && unresolvedAnswers.has(answer.trim().toLowerCase());
  const canSaveAssessment = Boolean(assessment && definition && question && !saved && !conflict && hasAnswer && answerChanged && !unresolvedAnswer && !missingUnableReason
    && (!finalized || sourceNote.trim()));
  const canSaveChart = Boolean(referral && chartField && !saved && !conflict && chartValue.trim() && chartValue.trim() !== String(referral[chartField] ?? "").trim());

  async function save() {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      if (assessment && assessmentField && definition && question && canSaveAssessment) {
        if (finalized) {
          const note = `Question: ${definition.label}\nAnswer: ${answerForNote(answer, question.options)}${unableReason.trim() ? `\nContext: ${unableReason.trim()}` : ""}\nSource or reason: ${sourceNote.trim()}`;
          const result = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
            `/api/assessments/${encodeURIComponent(assessment.assessment_id)}/addenda`, {
              method: "POST",
              body: JSON.stringify({
                if_match: assessment.version,
                client_mutation_id: crypto.randomUUID(),
                reason_code: completionMemoAddendumReason(assessmentField), note,
              }),
            },
          );
          setAssessment(result.assessment);
          setSaved("Correction added to the signed assessment. The original sent answer remains preserved.");
        } else {
          const data: Partial<AssessmentToolData> = { [assessmentField]: answer };
          if (answer === "unable_to_assess" || assessment.unable_to_assess_reasons?.[assessmentField]) {
            data.unable_to_assess_reasons = {
              ...assessment.unable_to_assess_reasons,
              [assessmentField]: answer === "unable_to_assess" ? unableReason.trim() : "",
            };
          }
          const result = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
            `/api/assessments/${encodeURIComponent(assessment.assessment_id)}`, {
              method: "PATCH",
              body: JSON.stringify({
                if_match: assessment.version,
                client_mutation_id: crypto.randomUUID(),
                patch: { data },
              }),
            },
          );
          setAssessment(result.assessment);
          setSaved("Answer saved to the assessment with its change history.");
        }
      } else if (referral && chartField && canSaveChart) {
        const patch = { [chartField]: chartValue.trim() } as ReferralPatch;
        const result = await fetchPipelineJson<{ referral: Referral }>(`/api/referrals/${referral.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            if_match: referral.version,
            if_match_sections: normalizeReferralSectionVersions(referral.sectionVersions),
            client_mutation_id: crypto.randomUUID(), patch,
          }),
        });
        setReferral(result.referral);
        setSaved("Chart value saved with its change history.");
      } else return;
      await onSaved();
    } catch (cause) {
      if (cause instanceof PipelineApiError && cause.status === 409 && cause.payload && typeof cause.payload === "object") {
        const latest = cause.payload as { assessment?: PipelineAssessmentRecord; referral?: Referral };
        if (latest.assessment) setAssessment(latest.assessment);
        if (latest.referral) setReferral(latest.referral);
        setConflict(true);
        setError("Someone else changed this record. Your entry is still here and was not saved. Compare it with the latest saved value before trying again.");
      } else {
        setError(cause instanceof Error ? cause.message : "The change was not saved. Review the latest record and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!canEditAssessment && !canEditChart) return <button type="button" onClick={onOpenTask} className="rounded-input border border-stage-green-border px-4 py-2 text-label font-bold text-link hover:bg-primary-soft">{task.action} →</button>;
  if (loading) return <p role="status" className="text-meta text-ink-muted">Loading the current saved value…</p>;
  return <div className="space-y-4">
    {error ? <p role="alert" className="rounded-input border border-red-300 bg-red-50 p-3 text-meta text-red-800">{error} No change was recorded.</p> : null}
    {conflict ? <div className="rounded-input border border-amber-300 bg-amber-50 p-3 text-meta text-ink">
      <p>Latest saved value: {assessment && assessmentField ? answerForNote(assessment[assessmentField], question?.options) || "Blank" : referral && chartField ? String(referral[chartField] ?? "") || "Blank" : "Unavailable"}</p>
      <button type="button" onClick={() => { setConflict(false); setError(""); }} className="mt-2 font-bold text-link underline">I reviewed the latest value; let me save my entry</button>
    </div> : null}
    {saved ? <p role="status" className="rounded-input border border-stage-green-border bg-primary-soft p-3 text-meta text-link">{saved}</p> : null}
    {assessment && definition && question ? <>
      <p className="text-meta leading-5 text-ink-muted">{finalized
        ? "Meet the Client was sent. Enter the corrected answer and its source here; Pipeline will append a dated correction and keep the original signed answer."
        : assessment.signed_at
          ? "Meet the Client has not been sent. This saves the answer to the signed assessment with an audit record."
          : "This saves directly to the working assessment with an audit record."}</p>
      <AssessmentField
        definition={definition} question={question} value={answer}
        unableReason={unableReason} required pending={false} disabled={busy}
        reviewDisabled onChange={(value) => { setAnswer(value); setSaved(""); }} onUnableReasonChange={(value) => { setUnableReason(value); setSaved(""); }}
        onReview={() => undefined}
      />
      {finalized ? <label className="block text-label font-semibold text-ink">Where did this answer come from, or why did it change?
        <textarea value={sourceNote} onChange={(event) => { setSourceNote(event.target.value); setSaved(""); }} maxLength={2000} rows={3} className="mt-2 w-full rounded-input border border-sheet-border bg-paper px-3 py-2 text-value font-normal" />
      </label> : null}
    </> : null}
    {referral && chartField ? <label className="block text-label font-semibold text-ink">{task.label.replace(/^Record /, "")}
      {chartField === "community" ? <select value={chartValue} onChange={(event) => { setChartValue(event.target.value); setSaved(""); }} className="mt-2 block w-full rounded-input border border-sheet-border bg-paper px-3 py-2 text-value font-normal">
        <option value="">Choose community</option>
        {pipelineCommunities.filter((community) => community !== "Unassigned").map((community) => <option key={community} value={community}>{community}</option>)}
      </select> : <input type={chartField === "dob" || chartField === "date" ? "date" : "text"} value={chartValue} onChange={(event) => { setChartValue(event.target.value); setSaved(""); }} maxLength={256} className="mt-2 block w-full rounded-input border border-sheet-border bg-paper px-3 py-2 text-value font-normal" />}
    </label> : null}
    {(assessment || referral) ? <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy || !(assessment ? canSaveAssessment : canSaveChart)} onClick={() => void save()} className="min-h-10 rounded-input bg-primary px-4 py-2 text-label font-bold text-white disabled:opacity-50">{busy ? "Saving…" : finalized ? "Add correction" : "Save answer"}</button>
      <button type="button" onClick={onOpenTask} className="text-label font-semibold text-link underline-offset-2 hover:underline">Open full record</button>
    </div> : null}
  </div>;
}

function answerForNote(value: AssessmentToolData[AssessmentToolFieldKey], options: readonly { value: string; label: string }[] | undefined) {
  const label = (item: string) => options?.find((option) => option.value === item)?.label ?? item;
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? label(item) : JSON.stringify(item)).join("; ");
  if (typeof value === "string") return label(value.trim());
  return String(value ?? "");
}

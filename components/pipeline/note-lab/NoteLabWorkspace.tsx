"use client";

import { startTransition, useState } from "react";
import { ArrowRight, Check, Download, FileCheck2, ShieldCheck } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  noteLabDocumentationCriteria,
  noteLabRevisionReasons,
  type NoteLabCriterionId,
  type NoteLabRevisionReasonId,
} from "@/lib/note-lab/assessment-language-standards";
import {
  type NoteLabPreferenceProfile,
  type NoteLabSampleDisposition,
  type NoteLabSession,
} from "@/lib/note-lab/note-lab-contracts";

export default function NoteLabWorkspace({
  initialSession,
  reviewerName,
}: {
  initialSession: NoteLabSession;
  reviewerName: string;
}) {
  const [session, setSession] = useState(initialSession);
  const [selectedCriterionIds, setSelectedCriterionIds] = useState<NoteLabCriterionId[]>(
    initialSession.scenario?.recommendedCriterionIds ?? [],
  );
  const [sampleDisposition, setSampleDisposition] = useState<NoteLabSampleDisposition | null>(null);
  const [revisionReasonIds, setRevisionReasonIds] = useState<NoteLabRevisionReasonId[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scenario = session.scenario;
  const sampleDecisionComplete = sampleDecisionIsComplete(
    Boolean(scenario?.reviewSample),
    sampleDisposition,
    revisionReasonIds.length,
  );
  const canSubmit = Boolean(scenario && selectedCriterionIds.length > 0 && sampleDecisionComplete && !saving);

  const toggleCriterion = (criterionId: NoteLabCriterionId) => {
    setSelectedCriterionIds((current) => current.includes(criterionId)
      ? current.filter((item) => item !== criterionId)
      : [...current, criterionId]);
    setError(null);
  };

  const chooseDisposition = (disposition: NoteLabSampleDisposition) => {
    setSampleDisposition(disposition);
    if (disposition === "teach") setRevisionReasonIds([]);
    setError(null);
  };

  const toggleRevisionReason = (reasonId: NoteLabRevisionReasonId) => {
    setRevisionReasonIds((current) => current.includes(reasonId)
      ? current.filter((item) => item !== reasonId)
      : [...current, reasonId]);
    setError(null);
  };

  const applySession = (next: NoteLabSession) => {
    setSession(next);
    setSelectedCriterionIds(next.scenario?.recommendedCriterionIds ?? []);
    setSampleDisposition(null);
    setRevisionReasonIds([]);
  };

  const submit = async () => {
    if (!scenario || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const next = await fetchPipelineJson<NoteLabSession>("/api/note-lab/session", {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: session.revision,
          calibrationVersion: session.calibrationVersion,
          scenarioId: scenario.id,
          targetField: scenario.targetField,
          selectedCriterionIds,
          sampleId: scenario.reviewSample?.id ?? null,
          sampleDisposition: scenario.reviewSample ? sampleDisposition : null,
          revisionReasonIds: scenario.reviewSample ? revisionReasonIds : [],
        }),
      });
      startTransition(() => {
        applySession(next);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The review could not be saved.");
      try {
        const current = await fetchPipelineJson<NoteLabSession>("/api/note-lab/session", { cache: "no-store" });
        applySession(current);
      } catch {
        // Keep the current field and choices in place so the supervisor can retry.
      }
    } finally {
      setSaving(false);
    }
  };

  if (!session.available) return <LabFrame reviewerName={reviewerName}><EmptyLab message={session.message} /></LabFrame>;
  if (session.calibration.complete) {
    return <LabFrame reviewerName={reviewerName}><CalibrationComplete profile={session.calibration.profile} /></LabFrame>;
  }
  if (!scenario) return <LabFrame reviewerName={reviewerName}><EmptyLab message={session.message} /></LabFrame>;

  return (
    <LabFrame reviewerName={reviewerName}>
      <main className="border border-[#cfd7d4] bg-white">
        <WorkflowGuide session={session} hasCurrentSample={Boolean(scenario.reviewSample)} />
        <CalibrationProgress session={session} />
        <div className="border-t border-[#d8dfdc] px-4 py-5 sm:px-7 sm:py-7">
          <CompletedTrail session={session} />

          <header className="grid gap-3 border-b border-[#d8dfdc] pb-5 md:grid-cols-[minmax(0,1fr)_260px] md:gap-8">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f7a67]">
                Current field · {session.calibration.currentStep} of {session.calibration.targetDecisions}
              </div>
              <h1 className="mt-1.5 text-[24px] font-black tracking-[-0.035em] text-[#202522] sm:text-[28px]">
                {scenario.targetFieldLabel}
              </h1>
              <p className="mt-2 max-w-[720px] text-[11px] font-semibold leading-5 text-[#626d68]">
                {scenario.fieldPurpose}
              </p>
            </div>
            <div className="border-l-2 border-[#8db9aa] bg-[#f4f8f6] px-4 py-3 text-[10px] leading-5 text-[#4e5c56]">
              <span className="block text-[9px] font-black uppercase tracking-[0.08em] text-[#0f7a67]">A strong answer should</span>
              <span className="mt-1 block">{scenario.reviewQuestion}</span>
            </div>
          </header>

          <section className="py-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0f7a67]">Step 1</div>
                <h2 className="mt-1 text-[14px] font-black text-[#252c28]">What must every answer include?</h2>
                <p className="mt-1 text-[10px] font-semibold text-[#75807b]">The suggested requirements are already selected. Deselect an item only if it should not be required every time this field is completed.</p>
              </div>
              <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#0f7a67]">{selectedCriterionIds.length} required</span>
            </div>
            <div role="group" aria-label={`Required documentation for ${scenario.targetFieldLabel}`} className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {noteLabDocumentationCriteria.map((criterion) => {
                const selected = selectedCriterionIds.includes(criterion.id);
                return (
                  <button
                    key={criterion.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleCriterion(criterion.id)}
                    className={`min-h-[82px] border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 ${selected ? "border-[#0f8b73] bg-[#edf7f3]" : "border-[#d6ddda] bg-[#fafbfa] hover:border-[#9eafa8]"}`}
                  >
                    <span className="flex items-start gap-2.5">
                      <SelectionBox selected={selected} />
                      <span>
                        <span className={`block text-[10px] font-black ${selected ? "text-[#0b6f5d]" : "text-[#39423e]"}`}>{criterion.label}</span>
                        <span className="mt-1 block text-[9px] font-semibold leading-4 text-[#727d78]">{criterion.description}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <DraftStandard scenario={scenario} />
          <HistoricalAnswerReview
            scenario={scenario}
            disposition={sampleDisposition}
            revisionReasonIds={revisionReasonIds}
            onDisposition={chooseDisposition}
            onReason={toggleRevisionReason}
          />

          <div className="mt-5 border-l-2 border-[#c9a968] bg-[#fbf8f0] px-4 py-3 text-[10px] leading-5 text-[#625b4b]">
            <span className="font-black text-[#3e392f]">Do not cross this line:</span> {scenario.guardrail}
          </div>

          <footer className="sticky bottom-0 z-10 -mx-4 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dfdc] bg-white/95 px-4 py-3 shadow-[0_-8px_20px_rgba(32,37,34,0.06)] backdrop-blur sm:-mx-7 sm:px-7">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0f7a67]">Step 3</div>
              <div role="status" className={`mt-1 max-w-[620px] text-[10px] ${error ? "font-bold text-[#a44337]" : "text-[#6f7a75]"}`}>
                {error ?? submissionHint(scenario.reviewSample !== null, selectedCriterionIds.length, sampleDisposition, revisionReasonIds.length)}
              </div>
            </div>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className="inline-flex h-10 items-center gap-3 bg-[#0f8b73] px-5 text-[11px] font-black text-white outline-none hover:bg-[#0c705f] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#aeb9b5]"
            >
              {submissionButtonLabel(saving, session.calibration.remaining)}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </footer>
        </div>
      </main>
    </LabFrame>
  );
}

function WorkflowGuide({ session, hasCurrentSample }: { session: NoteLabSession; hasCurrentSample: boolean }) {
  const hasSamples = session.stats.corpusSamplesAvailable > 0;
  return (
    <section aria-labelledby="note-lab-purpose" className="border-b border-[#d8dfdc] bg-[#f7faf8] px-4 py-4 sm:px-7">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <h1 id="note-lab-purpose" className="text-[15px] font-black tracking-[-0.02em] text-[#202522]">Set the writing standard for assessment answers</h1>
          <p className="mt-1 max-w-[760px] text-[10px] font-semibold leading-5 text-[#626d68]">
            Review one free-text field at a time. Your saved choices become the field-specific guidance assessors see while documenting; they do not change a client record or make an admission decision.
          </p>
        </div>
        <ol aria-label="Review steps" className="grid min-w-0 gap-1.5 text-[9px] font-bold text-[#4e5a54] sm:grid-cols-3 lg:w-[440px]">
          <WorkflowStep number="1" label="Confirm required content" />
          <WorkflowStep number="2" label={hasCurrentSample ? "Judge the example" : "Example skipped"} muted={!hasCurrentSample} />
          <WorkflowStep number="3" label="Save and continue" />
        </ol>
      </div>
      {!hasSamples ? (
        <div className="mt-3 border-l-2 border-[#b9924f] bg-[#fffaf0] px-3 py-2 text-[9px] font-semibold leading-4 text-[#665b46]">
          No historical answers are mapped in this environment. You can still define every field standard; example review will appear after the note corpus is connected.
        </div>
      ) : null}
    </section>
  );
}

function WorkflowStep({ number, label, muted = false }: { number: string; label: string; muted?: boolean }) {
  return (
    <li className={`flex min-h-8 items-center gap-2 border px-2.5 ${muted ? "border-[#dde2df] bg-[#f0f2f1] text-[#848d89]" : "border-[#ccd8d3] bg-white"}`}>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center text-[8px] font-black ${muted ? "bg-[#dfe4e2] text-[#6f7974]" : "bg-[#0f8b73] text-white"}`}>{number}</span>
      <span>{label}</span>
    </li>
  );
}

function sampleDecisionIsComplete(
  hasSample: boolean,
  disposition: NoteLabSampleDisposition | null,
  revisionReasonCount: number,
) {
  if (!hasSample) return true;
  if (disposition === "teach") return revisionReasonCount === 0;
  return disposition === "revise" || disposition === "do_not_teach"
    ? revisionReasonCount > 0
    : false;
}

function submissionButtonLabel(saving: boolean, remaining: number) {
  if (saving) return "Saving";
  return remaining === 1 ? "Finish standard" : "Save and continue";
}

function DraftStandard({ scenario }: { scenario: NonNullable<NoteLabSession["scenario"]> }) {
  return (
    <section className="grid border border-[#d2dad7] bg-[#f8faf9] lg:grid-cols-[250px_minmax(0,1fr)]">
      <div className="border-b border-[#d2dad7] p-4 lg:border-b-0 lg:border-r">
        <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#6d7873]">Guidance assessors will see</div>
        <div className="mt-2 text-[14px] font-black text-[#27302c]">{scenario.formatStandard.label}</div>
        <div className="mt-1 text-[10px] font-semibold text-[#707a75]">{scenario.formatStandard.lengthGuidance}</div>
        <div className="mt-4 border-t border-[#dde3e0] pt-3 text-[10px] font-bold leading-5 text-[#43504a]">
          {scenario.formatStandard.template}
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#6d7873]">Must cover</div>
            <ul className="mt-2 space-y-1.5">
              {scenario.formatStandard.requiredElements.map((element) => (
                <li key={element} className="flex gap-2 text-[10px] font-semibold leading-4 text-[#4e5954]">
                  <Check size={12} className="mt-0.5 shrink-0 text-[#0f8b73]" strokeWidth={2.4} aria-hidden="true" />{element}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#6d7873]">Reference answer</div>
            <p className="mt-2 border-l-2 border-[#9ab9ae] pl-3 text-[11px] leading-[1.7] text-[#35413b]">
              {scenario.formatStandard.referenceAnswer}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function HistoricalAnswerReview({
  scenario,
  disposition,
  revisionReasonIds,
  onDisposition,
  onReason,
}: {
  scenario: NonNullable<NoteLabSession["scenario"]>;
  disposition: NoteLabSampleDisposition | null;
  revisionReasonIds: NoteLabRevisionReasonId[];
  onDisposition: (disposition: NoteLabSampleDisposition) => void;
  onReason: (reason: NoteLabRevisionReasonId) => void;
}) {
  const sample = scenario.reviewSample;
  if (!sample) {
    return (
      <section className="mt-4 border border-dashed border-[#cfd7d4] bg-[#fafbfa] p-5">
        <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#87908c]">Example review unavailable</div>
        <div className="mt-1 text-[11px] font-black text-[#3b4540]">There is no mapped historical answer for this field yet.</div>
        <p className="mt-1 text-[10px] leading-5 text-[#737d79]">Nothing else is required here. Confirm the content requirements above, then save this field and continue.</p>
      </section>
    );
  }
  const needsReasons = disposition === "revise" || disposition === "do_not_teach";
  return (
    <section className="mt-4 border border-[#d2dad7] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce2df] bg-[#f7f8f7] px-4 py-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0f7a67]">Step 2</div>
          <h2 className="mt-1 text-[12px] font-black text-[#27302c]">Would you use this as an example for assessors?</h2>
          <p className="mt-0.5 text-[9px] font-semibold text-[#7b8580]">Redacted · {humanize(sample.sourceSection)} · {sample.wordCount} words · not pre-approved</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.08em] text-[#5e6964]"><ShieldCheck size={13} aria-hidden="true" /> Supervisor review required</span>
      </div>
      <div className="p-4 sm:p-5">
        <p className="whitespace-pre-wrap border-l-2 border-[#b8c4bf] pl-4 text-[12px] leading-[1.75] text-[#303a35]">{sample.text}</p>
        <div role="group" aria-label="Historical answer decision" className="mt-5 grid gap-2 sm:grid-cols-3">
          <DispositionButton label="Teach as written" detail="Safe as a future example" selected={disposition === "teach"} onClick={() => onDisposition("teach")} />
          <DispositionButton label="Useful, but revise" detail="Keep the substance, fix the writing" selected={disposition === "revise"} onClick={() => onDisposition("revise")} />
          <DispositionButton label="Do not teach" detail="Not a safe pattern to repeat" selected={disposition === "do_not_teach"} onClick={() => onDisposition("do_not_teach")} />
        </div>
        {needsReasons ? (
          <div className="mt-4 border-t border-[#dce2df] pt-4">
            <div className="text-[10px] font-black text-[#39433e]">What needs to change?</div>
            <div role="group" aria-label="Revision reasons" className="mt-3 flex flex-wrap gap-2">
              {noteLabRevisionReasons.map((reason) => {
                const selected = revisionReasonIds.includes(reason.id);
                return (
                  <button
                    key={reason.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onReason(reason.id)}
                    className={`min-h-9 border px-3 py-2 text-[9px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 ${selected ? "border-[#9a5c53] bg-[#fbf1ef] text-[#81443b]" : "border-[#d4dbd8] bg-white text-[#626d68] hover:border-[#aab5b0]"}`}
                  >
                    {reason.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DispositionButton({
  label,
  detail,
  selected,
  onClick,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 ${selected ? "border-[#0f8b73] bg-[#edf7f3]" : "border-[#d3dad7] hover:border-[#98aaa3]"}`}>
      <span className="flex items-start gap-2.5"><SelectionBox selected={selected} /><span><span className="block text-[10px] font-black text-[#303a35]">{label}</span><span className="mt-1 block text-[9px] font-semibold leading-4 text-[#78827d]">{detail}</span></span></span>
    </button>
  );
}

function LabFrame({ reviewerName, children }: { reviewerName: string; children: React.ReactNode }) {
  return (
    <div className="pipeline-route-enter h-full overflow-y-auto bg-[#f4f6f5]">
      <div className="mx-auto max-w-[1120px] px-3 py-4 sm:px-6 lg:py-6">
        <header className="flex min-h-12 items-center justify-between gap-4 border border-b-0 border-[#cfd7d4] bg-white px-4 sm:px-6">
          <span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Assessment note standards</span>
          <span className="text-[10px] font-bold text-[#737d79]">{reviewerName}</span>
        </header>
        {children}
      </div>
    </div>
  );
}

function CalibrationProgress({ session }: { session: NoteLabSession }) {
  const calibration = session.calibration;
  return (
    <div className="px-4 py-4 sm:px-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-black text-[#252c28]">Review progress</div>
          <div className="mt-1 text-[9px] font-semibold text-[#7a847f]">About {calibration.estimatedMinutesRemaining} minutes remaining · each field saves independently</div>
        </div>
        <div className="text-right text-[10px] font-black text-[#0f7a67]">{calibration.decisionsCompleted} / {calibration.targetDecisions}</div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden bg-[#e3e8e6]">
        <div className="h-full bg-[#0f8b73] transition-[width] duration-300" style={{ width: `${calibration.progressPercent}%` }} />
      </div>
    </div>
  );
}

function CompletedTrail({ session }: { session: NoteLabSession }) {
  const recent = session.calibration.trail.slice(-3);
  if (recent.length === 0) return null;
  return (
    <details className="group mb-4 border border-[#e0e5e3] bg-[#fafbfa]">
      <summary className="cursor-pointer list-none px-3 py-2 text-[9px] font-black text-[#5d6863] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73]">
        {session.calibration.decisionsCompleted} completed field{session.calibration.decisionsCompleted === 1 ? "" : "s"} · show recent
      </summary>
      <ol aria-label="Completed calibration fields" className="border-t border-[#e0e5e3] px-3 py-2">
        {recent.map((item) => (
          <li key={item.step} className="flex items-center justify-between gap-3 py-1 text-[9px]">
            <span className="flex min-w-0 items-center gap-2 font-bold text-[#46514c]"><Check size={11} className="shrink-0 text-[#0f7a67]" aria-hidden="true" /><span className="truncate">{item.targetFieldLabel}</span></span>
            <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.06em] text-[#87918c]">{item.selectedCriterionIds.length} requirements · {item.sampleDisposition ? dispositionLabel(item.sampleDisposition) : "No example"}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function SelectionBox({ selected }: { selected: boolean }) {
  return (
    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border ${selected ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#aeb9b5] bg-white"}`}>
      {selected ? <Check size={12} strokeWidth={2.6} aria-hidden="true" /> : null}
    </span>
  );
}

function CalibrationComplete({ profile }: { profile: NoteLabPreferenceProfile }) {
  const reviewedSamples = profile.sampleOutcomes.teach + profile.sampleOutcomes.revise + profile.sampleOutcomes.do_not_teach;
  return (
    <main className="border border-[#cfd7d4] bg-white px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-[820px]">
        <span className="flex h-10 w-10 items-center justify-center bg-[#0f8b73] text-white"><Check size={20} strokeWidth={2.5} aria-hidden="true" /></span>
        <h1 className="mt-5 text-[26px] font-black tracking-[-0.035em] text-[#202522]">Field standard ready for review</h1>
        <p className="mt-2 max-w-[680px] text-[11px] font-semibold leading-5 text-[#69736e]">
          This profile records required documentation evidence and coded judgments about historical answers. It contains no note text or source identifiers and does not change the live assessment.
        </p>

        <div className="mt-6 grid gap-px border border-[#d8dfdc] bg-[#d8dfdc] sm:grid-cols-3">
          <SummaryMetric label="Fields reviewed" value={profile.fieldsReviewed} />
          <SummaryMetric label="Samples reviewed" value={reviewedSamples} />
          <SummaryMetric label="Teach as written" value={profile.sampleOutcomes.teach} />
        </div>

        <section className="mt-6 border border-[#d8dfdc] p-4 sm:p-5">
          <h2 className="text-[12px] font-black text-[#27302c]">Evidence required across fields</h2>
          <div className="mt-4 space-y-3">
            {profile.criteria.map((criterion) => (
              <div key={criterion.id}>
                <div className="flex items-center justify-between gap-4 text-[10px]">
                  <span className="font-black text-[#46514c]">{criterion.label}</span>
                  <span className="font-bold text-[#74807b]">{criterion.selectedCount} fields · {criterion.selectionRate}%</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-[#e5e9e7]"><div className="h-full bg-[#0f8b73]" style={{ width: `${criterion.selectionRate}%` }} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-3 border border-[#d8dfdc] p-4 sm:p-5">
          <h2 className="text-[12px] font-black text-[#27302c]">What the review indicates</h2>
          {profile.inferredRules.length > 0 ? (
            <ul className="mt-3 space-y-2.5">
              {profile.inferredRules.map((rule) => <li key={rule} className="flex gap-3 text-[11px] leading-5 text-[#4c5752]"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-[#0f8b73]" />{rule}</li>)}
            </ul>
          ) : <p className="mt-3 text-[11px] text-[#737d79]">Complete more field reviews before drawing a documentation rule.</p>}
        </section>

        <button type="button" onClick={() => downloadProfile(profile)} className="mt-5 inline-flex h-10 items-center gap-2.5 bg-[#0f8b73] px-4 text-[10px] font-black text-white outline-none hover:bg-[#0c705f] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
          <Download size={14} aria-hidden="true" />Download field standard
        </button>
      </div>
    </main>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return <div className="bg-white px-4 py-4"><div className="text-[20px] font-black text-[#202522]">{value}</div><div className="mt-1 text-[8px] font-black uppercase tracking-[0.09em] text-[#7a847f]">{label}</div></div>;
}

function EmptyLab({ message }: { message: string | null }) {
  return <section className="flex min-h-[430px] items-center justify-center border border-[#cfd7d4] bg-white p-8 text-center"><div className="max-w-[480px]"><FileCheck2 size={28} strokeWidth={1.6} className="mx-auto text-[#0f8b73]" aria-hidden="true" /><h2 className="mt-4 text-[18px] font-black text-[#252c28]">No field review is ready</h2><p className="mt-2 text-[11px] leading-5 text-[#6d7773]">{message ?? "Assessment writing standards are unavailable."}</p></div></section>;
}

function submissionHint(
  hasSample: boolean,
  criterionCount: number,
  disposition: NoteLabSampleDisposition | null,
  reasonCount: number,
) {
  if (criterionCount === 0) return "Keep at least one required evidence item.";
  if (!hasSample) return "No historical answer is available; the field standard can be saved now.";
  if (!disposition) return "Judge whether the historical answer should be taught, revised, or excluded.";
  if ((disposition === "revise" || disposition === "do_not_teach") && reasonCount === 0) {
    return "Select at least one specific reason the historical answer needs work.";
  }
  return "The field standard and historical-answer judgment are ready to save.";
}

function dispositionLabel(value: NoteLabSampleDisposition) {
  if (value === "teach") return "Teach";
  if (value === "revise") return "Revise";
  return "Do not teach";
}

function humanize(value: string | undefined) {
  if (!value) return "Assessment writing";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function downloadProfile(profile: NoteLabPreferenceProfile) {
  const blob = new Blob([`${JSON.stringify(profile, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pipeline-assessment-field-standard-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

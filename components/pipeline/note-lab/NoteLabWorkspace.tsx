"use client";

import { startTransition, useState } from "react";
import { ArrowRight, Check, Download, FileCheck2 } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  noteLabAnswerComponents,
  noteLabBaselineCriterionIds,
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
    normalizeAnswerComponentCriteria(initialSession.scenario?.recommendedCriterionIds ?? []),
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
  const canSubmit = Boolean(scenario
    && selectedAnswerComponentCount(selectedCriterionIds) > 0
    && sampleDecisionComplete
    && !saving);

  const toggleAnswerComponent = (criterionIds: readonly NoteLabCriterionId[]) => {
    setSelectedCriterionIds((current) => {
      const selected = criterionIds.every((criterionId) => current.includes(criterionId));
      return selected
        ? current.filter((criterionId) => !criterionIds.includes(criterionId))
        : [...new Set([...current, ...criterionIds])];
    });
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
    setSelectedCriterionIds(normalizeAnswerComponentCriteria(next.scenario?.recommendedCriterionIds ?? []));
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
        document.querySelector<HTMLElement>("[data-note-lab-scroll-container]")
          ?.scrollTo({ top: 0, behavior: "smooth" });
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
        <div className="grid grid-cols-[48px_minmax(0,1fr)] sm:grid-cols-[210px_minmax(0,1fr)] lg:grid-cols-[230px_minmax(0,1fr)]">
          <FieldProgressRail session={session} />

          <div className="min-w-0 border-l border-[#d8dfdc] px-4 py-5 sm:px-7 sm:py-7">
            <header className="border-b border-[#d8dfdc] pb-5">
              <h1 className="text-[24px] font-black tracking-[-0.035em] text-[#202522] sm:text-[28px]">
                {scenario.targetFieldLabel}
              </h1>
            </header>

            <section className="py-7">
              <WhatToDocument
                scenario={scenario}
                fieldLabel={scenario.targetFieldLabel}
                selectedCriterionIds={selectedCriterionIds}
                onToggle={toggleAnswerComponent}
              />
            </section>

            <section className="border-t border-[#d8dfdc] py-7">
              <GoodNoteExample scenario={scenario} />
            </section>

            <section className="border-t border-[#d8dfdc] py-7">
              <HistoricalAnswerReview
                scenario={scenario}
                disposition={sampleDisposition}
                revisionReasonIds={revisionReasonIds}
                onDisposition={chooseDisposition}
                onReason={toggleRevisionReason}
              />
              <div className="mt-4 border-l-2 border-[#c9a968] bg-[#fbf8f0] px-4 py-3 text-[10px] leading-5 text-[#625b4b]">
                {scenario.guardrail}
              </div>
            </section>

            <section className="border-t border-[#d8dfdc] py-7">
              <SaveFieldAction
                canSubmit={canSubmit}
                error={error}
                hasSample={scenario.reviewSample !== null}
                selectedAnswerCount={selectedAnswerComponentCount(selectedCriterionIds)}
                disposition={sampleDisposition}
                revisionReasonCount={revisionReasonIds.length}
                saving={saving}
                remaining={session.calibration.remaining}
                onSubmit={() => void submit()}
              />
            </section>
          </div>
        </div>
      </main>
    </LabFrame>
  );
}

function WhatToDocument({
  scenario,
  fieldLabel,
  selectedCriterionIds,
  onToggle,
}: {
  scenario: NonNullable<NoteLabSession["scenario"]>;
  fieldLabel: string;
  selectedCriterionIds: NoteLabCriterionId[];
  onToggle: (criterionIds: readonly NoteLabCriterionId[]) => void;
}) {
  return (
    <>
      <h2 className="text-[14px] font-black text-[#252c28]">What to document</h2>
      <p className="mt-2 max-w-[760px] text-[12px] leading-5 text-[#4f5b56]">{scenario.fieldPurpose}</p>
      <ul className="mt-4 grid gap-x-6 gap-y-2 border-y border-[#e0e5e3] py-4 sm:grid-cols-2">
        {scenario.formatStandard.requiredElements.map((element) => (
          <li key={element} className="flex items-start gap-2.5 text-[10px] font-semibold leading-4 text-[#46514c]">
            <Check size={12} strokeWidth={2.5} className="mt-0.5 shrink-0 text-[#0f8b73]" aria-hidden="true" />
            {element}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-black text-[#39423e]">Note structure</h3>
        <span className="text-[9px] font-bold text-[#6f7a75]">{selectedAnswerComponentCount(selectedCriterionIds)} selected</span>
      </div>
      <div role="group" aria-label={`Answer variations for ${fieldLabel}`} className="mt-3 grid gap-px border border-[#c9ceca] bg-[#d9dfdb] sm:grid-cols-2 lg:grid-cols-5">
        {noteLabAnswerComponents.map((component) => {
          const selected = component.criterionIds.every((criterionId) => selectedCriterionIds.includes(criterionId));
          return (
            <button
              key={component.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(component.criterionIds)}
              className={`grid min-h-[52px] grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 p-3 text-left outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-inset ${selected ? "bg-[#edf7f3]" : "bg-white hover:bg-[#f7f9f8]"}`}
            >
              <SelectionBox selected={selected} />
              <span className={`block text-[9px] font-black leading-4 ${selected ? "text-[#0b6f5d]" : "text-[#39423e]"}`}>{component.label}</span>
              <span className="sr-only">{component.examplePattern}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function SaveFieldAction({
  canSubmit,
  error,
  hasSample,
  selectedAnswerCount,
  disposition,
  revisionReasonCount,
  saving,
  remaining,
  onSubmit,
}: {
  canSubmit: boolean;
  error: string | null;
  hasSample: boolean;
  selectedAnswerCount: number;
  disposition: NoteLabSampleDisposition | null;
  revisionReasonCount: number;
  saving: boolean;
  remaining: number;
  onSubmit: () => void;
}) {
  const hint = error ?? submissionHint(hasSample, selectedAnswerCount, disposition, revisionReasonCount);
  return (
    <footer className="flex flex-wrap items-center justify-end gap-4">
      {!canSubmit || error ? (
        <div role="status" className={`mr-auto max-w-[620px] text-[10px] leading-5 ${error ? "font-bold text-[#a44337]" : "text-[#59655f]"}`}>
          {hint}
        </div>
      ) : null}
      <button
        type="button"
        disabled={!canSubmit}
        onClick={onSubmit}
        className="inline-flex h-10 items-center gap-3 bg-[#0f8b73] px-5 text-[11px] font-black text-white outline-none hover:bg-[#0c705f] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#aeb9b5]"
      >
        {submissionButtonLabel(saving, remaining)}
        <ArrowRight size={15} aria-hidden="true" />
      </button>
    </footer>
  );
}

function FieldProgressRail({
  session,
}: {
  session: NoteLabSession;
}) {
  return (
    <aside className="sticky top-3 max-h-[calc(100vh-5rem)] self-start overflow-y-auto px-1.5 py-4 sm:px-3 sm:py-5" aria-label="Assessment field progress">
      <div className="hidden items-baseline justify-between gap-3 px-2 sm:flex">
        <span className="text-[10px] font-black text-[#2d3531]">Assessment fields</span>
        <span className="text-[9px] font-bold text-[#74807b]">{session.calibration.currentStep} / {session.calibration.targetDecisions}</span>
      </div>
      <nav aria-label="Assessment fields" className="mt-1 sm:mt-3">
        <ol className="space-y-0.5">
          {session.calibration.fieldSteps.map((field, index) => (
            <FieldProgressRailStep
              key={field.field}
              field={field}
              index={index}
              active={index === session.calibration.decisionsCompleted}
              completed={index < session.calibration.decisionsCompleted}
            />
          ))}
        </ol>
      </nav>
    </aside>
  );
}

function FieldProgressRailStep({
  field,
  index,
  active,
  completed,
}: {
  field: NoteLabSession["calibration"]["fieldSteps"][number];
  index: number;
  active: boolean;
  completed: boolean;
}) {
  return (
    <li
      aria-current={active ? "step" : undefined}
      className={`grid min-h-8 grid-cols-[26px_minmax(0,1fr)] items-center gap-2 border-l-2 px-1.5 py-1.5 sm:px-2 ${active ? "border-[#0f8b73] bg-[#edf7f3]" : "border-transparent"}`}
    >
      <span className={`flex h-5 w-5 items-center justify-center border text-[8px] font-black ${progressStepBadgeClass(active, completed)}`}>
        {completed ? <Check size={11} strokeWidth={2.6} aria-hidden="true" /> : String(index + 1).padStart(2, "0")}
      </span>
      <span className={`hidden min-w-0 text-[9px] font-bold leading-4 sm:block ${active ? "text-[#0b6f5d]" : completed ? "text-[#4f5a55]" : "text-[#78827d]"}`}>
        {field.label}
      </span>
      <span className="sr-only sm:hidden">{field.label}</span>
    </li>
  );
}

function progressStepBadgeClass(active: boolean, completed: boolean) {
  if (active) return "border-[#0f8b73] bg-[#0f8b73] text-white";
  if (completed) return "border-[#8db9aa] bg-[#edf7f3] text-[#0f7a67]";
  return "border-[#cbd4d0] bg-white text-[#76817c]";
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

function selectedAnswerComponentCount(selectedCriterionIds: readonly NoteLabCriterionId[]) {
  return noteLabAnswerComponents.filter((component) => component.criterionIds
    .every((criterionId) => selectedCriterionIds.includes(criterionId))).length;
}

function normalizeAnswerComponentCriteria(criterionIds: readonly NoteLabCriterionId[]) {
  const normalized = new Set<NoteLabCriterionId>(noteLabBaselineCriterionIds);
  for (const component of noteLabAnswerComponents) {
    if (component.criterionIds.some((criterionId) => criterionIds.includes(criterionId))) {
      component.criterionIds.forEach((criterionId) => normalized.add(criterionId));
    }
  }
  return [...normalized];
}

function GoodNoteExample({ scenario }: { scenario: NonNullable<NoteLabSession["scenario"]> }) {
  return (
    <section aria-label={`${scenario.targetFieldLabel} good note example`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-black text-[#252c28]">Good note example</h2>
        <span className="text-[9px] font-bold text-[#74807b]">{scenario.formatStandard.lengthGuidance}</span>
      </div>
      <blockquote className="mt-3 border-l-3 border-[#0f8b73] bg-[#f3f8f6] px-4 py-4 text-[12px] font-semibold leading-6 text-[#2f3a35]">
        {scenario.formatStandard.referenceAnswer}
      </blockquote>
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
      <section>
        <h2 className="text-[13px] font-black text-[#252c28]">Past note to review</h2>
        <div className="mt-3 border border-dashed border-[#cfd7d4] bg-[#fafbfa] p-4 text-[10px] font-semibold text-[#737d79]">
          No historical example for this field.
        </div>
      </section>
    );
  }
  const needsReasons = disposition === "revise" || disposition === "do_not_teach";
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-black text-[#252c28]">Past note to review</h2>
        <span className="text-[9px] font-semibold text-[#7b8580]">Redacted · {humanize(sample.sourceSection)} · {sample.wordCount} words</span>
      </div>
      <div className="mt-3 border border-[#d2dad7] bg-white p-4 sm:p-5">
        <p className="whitespace-pre-wrap border-l-2 border-[#b8c4bf] pl-4 text-[12px] leading-[1.75] text-[#303a35]">{sample.text}</p>
        <div role="group" aria-label="Historical answer decision" className="mt-5 grid gap-2 sm:grid-cols-3">
          <DispositionButton label="Use as example" selected={disposition === "teach"} onClick={() => onDisposition("teach")} />
          <DispositionButton label="Revise" selected={disposition === "revise"} onClick={() => onDisposition("revise")} />
          <DispositionButton label="Do not use" selected={disposition === "do_not_teach"} onClick={() => onDisposition("do_not_teach")} />
        </div>
        {needsReasons ? (
          <div className="mt-4 border-t border-[#dce2df] pt-4">
            <div role="group" aria-label="Revision reasons" className="flex flex-wrap gap-2">
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
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 ${selected ? "border-[#0f8b73] bg-[#edf7f3]" : "border-[#d3dad7] hover:border-[#98aaa3]"}`}>
      <span className="flex items-center gap-2.5"><SelectionBox selected={selected} /><span className="block text-[10px] font-black text-[#303a35]">{label}</span></span>
    </button>
  );
}

function LabFrame({ reviewerName, children }: { reviewerName: string; children: React.ReactNode }) {
  return (
    <div data-note-lab-scroll-container aria-label={`${reviewerName} assessment language review`} className="pipeline-route-enter h-full overflow-y-auto bg-[#f4f6f5]">
      <div className="mx-auto max-w-[1240px] px-3 py-4 sm:px-6 lg:py-6">
        {children}
      </div>
    </div>
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
        <h1 className="mt-5 text-[26px] font-black tracking-[-0.035em] text-[#202522]">Review complete</h1>

        <div className="mt-6 grid gap-px border border-[#d8dfdc] bg-[#d8dfdc] sm:grid-cols-3">
          <SummaryMetric label="Fields reviewed" value={profile.fieldsReviewed} />
          <SummaryMetric label="Samples reviewed" value={reviewedSamples} />
          <SummaryMetric label="Teach as written" value={profile.sampleOutcomes.teach} />
        </div>

        <section className="mt-6 border border-[#d8dfdc] p-4 sm:p-5">
          <h2 className="text-[12px] font-black text-[#27302c]">Criteria</h2>
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
          <h2 className="text-[12px] font-black text-[#27302c]">Summary</h2>
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
  return <section className="flex min-h-[430px] items-center justify-center border border-[#cfd7d4] bg-white p-8 text-center"><div className="max-w-[480px]"><FileCheck2 size={28} strokeWidth={1.6} className="mx-auto text-[#0f8b73]" aria-hidden="true" /><h2 className="mt-4 text-[18px] font-black text-[#252c28]">No review available</h2><p className="mt-2 text-[11px] leading-5 text-[#6d7773]">{message ?? "Assessment writing standards are unavailable."}</p></div></section>;
}

function submissionHint(
  hasSample: boolean,
  answerVariationCount: number,
  disposition: NoteLabSampleDisposition | null,
  reasonCount: number,
) {
  if (answerVariationCount === 0) return "Select at least one answer variation.";
  if (!hasSample) return "No historical answer is available; the field standard can be saved now.";
  if (!disposition) return "Choose how to use the historical example.";
  if ((disposition === "revise" || disposition === "do_not_teach") && reasonCount === 0) {
    return "Select what needs work.";
  }
  return "Ready to save.";
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

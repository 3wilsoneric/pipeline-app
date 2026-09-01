"use client";

import { startTransition, useEffect, useState } from "react";
import { ArrowRight, Check, Download, FileCheck2, ShieldCheck } from "lucide-react";

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

const fieldReviewSections = [
  { id: "answer-parts", label: "Answer parts", shortLabel: "Parts" },
  { id: "reference-answer", label: "Reference answer", shortLabel: "Reference" },
  { id: "historical-example", label: "Historical example", shortLabel: "Example" },
  { id: "save-field", label: "Save field", shortLabel: "Save" },
] as const;

type FieldReviewSectionId = typeof fieldReviewSections[number]["id"];

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
  const [activeSectionId, setActiveSectionId] = useState<FieldReviewSectionId>("answer-parts");
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

  useEffect(() => {
    const sectionElements = fieldReviewSections
      .map(({ id }) => document.getElementById(`note-lab-${id}`))
      .filter((element): element is HTMLElement => element !== null);
    const scrollContainer = sectionElements[0]?.closest<HTMLElement>("[data-note-lab-scroll-container]");
    if (!scrollContainer || sectionElements.length === 0) return;

    let animationFrame = 0;
    const updateActiveSection = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const containerTop = scrollContainer.getBoundingClientRect().top;
        const readingLine = containerTop + Math.min(220, Math.max(110, scrollContainer.clientHeight * 0.24));
        let nextSectionId: FieldReviewSectionId = fieldReviewSections[0].id;

        for (const element of sectionElements) {
          if (element.getBoundingClientRect().top <= readingLine) {
            nextSectionId = element.dataset.noteLabSection as FieldReviewSectionId;
          }
        }

        const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
        if (distanceFromBottom < 24) nextSectionId = fieldReviewSections.at(-1)?.id ?? nextSectionId;
        setActiveSectionId(nextSectionId);
      });
    };

    updateActiveSection();
    scrollContainer.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      cancelAnimationFrame(animationFrame);
      scrollContainer.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [scenario?.id]);

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
    setActiveSectionId("answer-parts");
  };

  const navigateToSection = (sectionId: FieldReviewSectionId) => {
    document.getElementById(`note-lab-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        <WorkflowGuide session={session} hasCurrentSample={Boolean(scenario.reviewSample)} />
        <div className="grid grid-cols-[42px_minmax(0,1fr)] border-t border-[#d8dfdc] sm:grid-cols-[154px_minmax(0,1fr)] lg:grid-cols-[176px_minmax(0,1fr)]">
          <FieldProgressRail
            session={session}
            activeSectionId={activeSectionId}
            hasCurrentSample={Boolean(scenario.reviewSample)}
            sampleDecisionComplete={sampleDecisionComplete}
            onNavigate={navigateToSection}
          />

          <div className="min-w-0 border-l border-[#d8dfdc] px-4 py-5 sm:px-7 sm:py-7">
            <CompletedTrail session={session} />

            <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#d8dfdc] pb-5">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f7a67]">
                  Current field · {session.calibration.currentStep} of {session.calibration.targetDecisions}
                </div>
                <h1 className="mt-1.5 text-[24px] font-black tracking-[-0.035em] text-[#202522] sm:text-[28px]">
                  {scenario.targetFieldLabel}
                </h1>
                <p className="mt-1.5 max-w-[760px] text-[10px] font-semibold leading-5 text-[#626d68]">
                  {scenario.fieldPurpose}
                </p>
              </div>
              <span className="text-[9px] font-bold text-[#6d7873]">{scenario.formatStandard.label} · {scenario.formatStandard.lengthGuidance}</span>
            </header>

            <ReviewSection id="answer-parts" activeSectionId={activeSectionId} className="py-7">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0f7a67]">01 · Answer parts</div>
                  <h2 className="mt-1 text-[14px] font-black text-[#252c28]">Choose the answer variations</h2>
                  <p className="mt-1 text-[10px] font-semibold text-[#75807b]">Select every type of detail assessors should be prepared to document for this question.</p>
                </div>
                <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#0f7a67]">{selectedAnswerComponentCount(selectedCriterionIds)} selected</span>
              </div>
              <div className="mt-3 border-l-2 border-[#8db9aa] bg-[#f4f8f6] px-3 py-2 text-[9px] font-semibold text-[#4e5c56]">
                Always applied: person-centered language · concise and current documentation
              </div>
              <div role="group" aria-label={`Answer variations for ${scenario.targetFieldLabel}`} className="mt-3 grid gap-px border border-[#c9ceca] bg-[#d9dfdb] md:grid-cols-2">
                {noteLabAnswerComponents.map((component) => {
                  const selected = component.criterionIds.every((criterionId) => selectedCriterionIds.includes(criterionId));
                  return (
                    <button
                      key={component.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleAnswerComponent(component.criterionIds)}
                      className={`grid min-h-[78px] grid-cols-[auto_minmax(0,1fr)] gap-3 p-3 text-left outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-inset ${selected ? "bg-[#edf7f3]" : "bg-white hover:bg-[#f7f9f8]"}`}
                    >
                      <SelectionBox selected={selected} />
                      <span>
                        <span className={`block text-[10px] font-black ${selected ? "text-[#0b6f5d]" : "text-[#39423e]"}`}>{component.label}</span>
                        <span className="mt-1 block text-[9px] font-semibold leading-4 text-[#727d78]">{component.description}</span>
                        <span className="mt-1.5 block text-[9px] leading-4 text-[#59655f]"><span className="font-black text-[#486158]">Pattern:</span> {component.examplePattern}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </ReviewSection>

            <ReviewSection id="reference-answer" activeSectionId={activeSectionId} className="border-t border-[#d8dfdc] py-7">
              <AssessmentAnswerPreview scenario={scenario} />
            </ReviewSection>

            <ReviewSection id="historical-example" activeSectionId={activeSectionId} className="border-t border-[#d8dfdc] py-7">
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
            </ReviewSection>

            <ReviewSection id="save-field" activeSectionId={activeSectionId} className="border-t border-[#d8dfdc] py-7">
              <footer className="flex flex-wrap items-center justify-between gap-4 border border-[#cfd8d4] bg-[#f7faf8] p-4 sm:p-5">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0f7a67]">04 · Save field</div>
                  <div role="status" className={`mt-1.5 max-w-[620px] text-[10px] leading-5 ${error ? "font-bold text-[#a44337]" : "text-[#59655f]"}`}>
                    {error ?? submissionHint(scenario.reviewSample !== null, selectedAnswerComponentCount(selectedCriterionIds), sampleDisposition, revisionReasonIds.length)}
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
            </ReviewSection>
          </div>
        </div>
      </main>
    </LabFrame>
  );
}

function WorkflowGuide({ session, hasCurrentSample }: { session: NoteLabSession; hasCurrentSample: boolean }) {
  const hasSamples = session.stats.corpusSamplesAvailable > 0;
  return (
    <section aria-labelledby="note-lab-purpose" className="border-b border-[#d8dfdc] bg-[#f7faf8] px-4 py-4 sm:px-7">
      <h1 id="note-lab-purpose" className="text-[15px] font-black tracking-[-0.02em] text-[#202522]">Choose how assessment answers should be written</h1>
      <p className="mt-1 max-w-[820px] text-[10px] font-semibold leading-5 text-[#626d68]">
        Follow the field from top to bottom. Choose answer variations, review the reference, {hasCurrentSample ? "judge the example" : "skip the unavailable example"}, then save and continue. Saving creates a supervisor draft only and does not change client data.
      </p>
      {!hasSamples ? (
        <div className="mt-3 border-l-2 border-[#b9924f] bg-[#fffaf0] px-3 py-2 text-[9px] font-semibold leading-4 text-[#665b46]">
          No historical answers are mapped in this environment. You can still define every field standard; example review will appear after the note corpus is connected.
        </div>
      ) : null}
    </section>
  );
}

function FieldProgressRail({
  session,
  activeSectionId,
  hasCurrentSample,
  sampleDecisionComplete,
  onNavigate,
}: {
  session: NoteLabSession;
  activeSectionId: FieldReviewSectionId;
  hasCurrentSample: boolean;
  sampleDecisionComplete: boolean;
  onNavigate: (sectionId: FieldReviewSectionId) => void;
}) {
  const activeIndex = Math.max(0, fieldReviewSections.findIndex(({ id }) => id === activeSectionId));
  const scrollProgress = activeIndex / (fieldReviewSections.length - 1) * 100;
  return (
    <aside className="sticky top-3 h-fit self-start px-2 py-5 sm:px-4 sm:py-6" aria-label="Field review progress">
      <div className="hidden sm:block">
        <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0f7a67]">Field progress</div>
        <div className="mt-1 text-[12px] font-black text-[#2d3531]">{session.calibration.currentStep} of {session.calibration.targetDecisions}</div>
        <div className="mt-1 text-[9px] font-semibold leading-4 text-[#7a847f]">{session.calibration.estimatedMinutesRemaining} min remaining</div>
      </div>

      <nav aria-label="Current field sections" className="mt-1 grid grid-cols-[3px_minmax(0,1fr)] gap-2.5 sm:mt-5 sm:gap-3">
        <div className="relative my-2 bg-[#dce3e0]" aria-hidden="true">
          <div className="absolute inset-x-0 top-0 bg-[#0f8b73] transition-[height] duration-300" style={{ height: `${scrollProgress}%` }} />
        </div>
        <ol className="space-y-2 sm:space-y-3">
          {fieldReviewSections.map((section, index) => {
            const active = section.id === activeSectionId;
            const completed = index < activeIndex
              && (section.id !== "historical-example" || sampleDecisionComplete);
            const unavailable = section.id === "historical-example" && !hasCurrentSample;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  aria-current={active ? "step" : undefined}
                  onClick={() => onNavigate(section.id)}
                  className={`group grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 ${active ? "text-[#0b6f5d]" : "text-[#707a75] hover:text-[#303936]"}`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center border text-[8px] font-black transition-colors ${active ? "border-[#0f8b73] bg-[#0f8b73] text-white" : completed ? "border-[#8db9aa] bg-[#edf7f3] text-[#0f7a67]" : "border-[#cbd4d0] bg-white text-[#76817c]"}`}>
                    {completed ? <Check size={11} strokeWidth={2.6} aria-hidden="true" /> : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className={`block text-[9px] font-black ${active ? "text-[#0b6f5d]" : "text-[#4f5a55]"}`}>{section.label}</span>
                    {unavailable ? <span className="mt-0.5 block text-[8px] font-bold text-[#8a938f]">Example skipped</span> : null}
                  </span>
                  <span className="sr-only sm:hidden">{section.shortLabel}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mt-5 hidden h-1 overflow-hidden bg-[#e3e8e6] sm:block" aria-label={`${session.calibration.progressPercent}% of field reviews complete`}>
        <div className="h-full bg-[#0f8b73]" style={{ width: `${session.calibration.progressPercent}%` }} />
      </div>
    </aside>
  );
}

function ReviewSection({
  id,
  activeSectionId,
  className,
  children,
}: {
  id: FieldReviewSectionId;
  activeSectionId: FieldReviewSectionId;
  className?: string;
  children: React.ReactNode;
}) {
  const sectionIndex = fieldReviewSections.findIndex((section) => section.id === id);
  const activeIndex = fieldReviewSections.findIndex((section) => section.id === activeSectionId);
  const reached = sectionIndex <= activeIndex;
  return (
    <div
      id={`note-lab-${id}`}
      data-note-lab-section={id}
      className={`scroll-mt-4 transition-[opacity,transform] duration-300 motion-reduce:transition-none ${reached ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-70"} ${className ?? ""}`}
    >
      {children}
    </div>
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

function AssessmentAnswerPreview({ scenario }: { scenario: NonNullable<NoteLabSession["scenario"]> }) {
  return (
    <section aria-label={`${scenario.targetFieldLabel} reference answer`} className="border border-[#d2dad7] bg-[#f8faf9] p-4 sm:p-5">
      <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#6d7873]">Reference answer</div>
      <div className="mt-1.5 text-[11px] font-black text-[#303638]">How the selected parts read together</div>
      <textarea
        readOnly
        aria-label={`Reference answer for ${scenario.targetFieldLabel}`}
        rows={4}
        value={scenario.formatStandard.referenceAnswer}
        className="mt-3 w-full resize-none border border-[#c9ceca] bg-white px-3 py-2.5 text-[12px] leading-5 text-[#303638] outline-none"
      />
      <p className="mt-2 text-[9px] font-semibold leading-4 text-[#65706b]"><span className="font-black text-[#3b4741]">Quality check:</span> {scenario.reviewQuestion}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Field-specific answer elements">
        {scenario.formatStandard.requiredElements.map((element) => (
          <span key={element} className="border border-[#d5dcd8] bg-white px-2 py-1 text-[9px] font-semibold text-[#56615c]">{element}</span>
        ))}
      </div>
      <div className="mt-3 border-l-2 border-[#8db9aa] bg-white px-3 py-2 text-[9px] font-semibold leading-4 text-[#4e5c56]"><span className="font-black text-[#315e50]">Answer order:</span> {scenario.formatStandard.template}</div>
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
    <div data-note-lab-scroll-container className="pipeline-route-enter h-full overflow-y-auto bg-[#f4f6f5]">
      <div className="mx-auto max-w-[1240px] px-3 py-4 sm:px-6 lg:py-6">
        <header className="flex min-h-12 items-center justify-between gap-4 border border-b-0 border-[#cfd7d4] bg-white px-4 sm:px-6">
          <span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Assessment note standards</span>
          <span className="text-[10px] font-bold text-[#737d79]">{reviewerName}</span>
        </header>
        {children}
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
  answerVariationCount: number,
  disposition: NoteLabSampleDisposition | null,
  reasonCount: number,
) {
  if (answerVariationCount === 0) return "Select at least one answer variation.";
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

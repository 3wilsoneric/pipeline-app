"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Download, FileCheck2 } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  noteLabAnswerComponents,
  noteLabBaselineCriterionIds,
  type NoteLabCriterionId,
} from "@/lib/note-lab/assessment-language-standards";
import {
  type NoteLabPreferenceProfile,
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
    criteriaForSession(initialSession),
  );
  const [saving, setSaving] = useState(false);
  const [loadingField, setLoadingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigationController = useRef<AbortController | null>(null);
  const scenario = session.scenario;
  const reviewed = session.review !== null;
  const canSubmit = Boolean(scenario
    && selectedAnswerComponentCount(selectedCriterionIds) > 0
    && !reviewed
    && !saving);
  const activeFieldIndex = session.calibration.fieldSteps.findIndex(
    (field) => field.field === scenario?.targetField,
  );
  const nextField = activeFieldIndex >= 0
    ? session.calibration.fieldSteps[activeFieldIndex + 1] ?? null
    : null;

  useEffect(() => () => navigationController.current?.abort(), []);

  const applySession = (next: NoteLabSession) => {
    setSession(next);
    setSelectedCriterionIds(criteriaForSession(next));
  };

  const navigateToField = async (field: string) => {
    if (field === scenario?.targetField) {
      document.querySelector<HTMLElement>("[data-note-lab-scroll-container]")
        ?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    navigationController.current?.abort();
    const controller = new AbortController();
    navigationController.current = controller;
    setLoadingField(field);
    setError(null);
    try {
      const next = await fetchPipelineJson<NoteLabSession>(
        `/api/note-lab/session?field=${encodeURIComponent(field)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      startTransition(() => {
        applySession(next);
        document.querySelector<HTMLElement>("[data-note-lab-scroll-container]")
          ?.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch (navigationError) {
      if (!controller.signal.aborted) {
        setError(navigationError instanceof Error ? navigationError.message : "That field could not be opened.");
      }
    } finally {
      if (navigationController.current === controller) {
        navigationController.current = null;
        setLoadingField(null);
      }
    }
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
          sampleId: null,
          sampleDisposition: null,
          revisionReasonIds: [],
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
  if (!scenario) return <LabFrame reviewerName={reviewerName}><EmptyLab message={session.message} /></LabFrame>;

  return (
    <LabFrame reviewerName={reviewerName}>
      <main aria-busy={loadingField !== null} className="border border-[#cfd7d4] bg-white">
        <div className="grid grid-cols-[48px_minmax(0,1fr)] sm:grid-cols-[230px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)]">
          <FieldProgressRail
            session={session}
            loadingField={loadingField}
            disabled={saving}
            onNavigate={(field) => void navigateToField(field)}
          />

          <div className="min-w-0 border-l border-[#d8dfdc] px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
            <header className="border-b border-[#d8dfdc] pb-6">
              <h1 className="text-[28px] font-black tracking-[-0.035em] text-[#202522] sm:text-[34px]">
                {scenario.targetFieldLabel}
              </h1>
            </header>

            <section className="py-8">
              <WhatToDocument scenario={scenario} />
            </section>

            <section className="border-t border-[#d8dfdc] py-8">
              <GoodNoteExample scenario={scenario} />
            </section>

            <section className="border-t border-[#d8dfdc] py-7">
              <div className="border-l-2 border-[#c9a968] bg-[#fbf8f0] px-4 py-3 text-[10px] leading-5 text-[#625b4b]">
                {scenario.guardrail}
              </div>
            </section>

            <section className="border-t border-[#d8dfdc] py-7">
              <SaveFieldAction
                canSubmit={canSubmit}
                error={error}
                selectedAnswerCount={selectedAnswerComponentCount(selectedCriterionIds)}
                saving={saving}
                remaining={session.calibration.remaining}
                reviewed={reviewed}
                calibrationComplete={session.calibration.complete}
                profile={session.calibration.profile}
                onSubmit={() => void submit()}
              />
            </section>

            {nextField ? (
              <section className="border-t border-[#d8dfdc] py-5">
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={saving || loadingField !== null}
                    onClick={() => void navigateToField(nextField.field)}
                    className="inline-flex h-10 items-center gap-3 border border-[#bdc8c3] bg-white px-5 text-[11px] font-black text-[#35413b] outline-none hover:border-[#81938b] hover:bg-[#f6f8f7] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                  >
                    Next field
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </LabFrame>
  );
}

function WhatToDocument({
  scenario,
}: {
  scenario: NonNullable<NoteLabSession["scenario"]>;
}) {
  const instructionSteps = scenario.formatStandard.instructionSteps
    ?? scenario.formatStandard.requiredElements.map((element, index) => ({
      title: element,
      instruction: `${index === 0 ? "Start with" : "Then document"} ${element.toLowerCase()} using specific, attributable information.`,
    }));

  return (
    <div className="max-w-[920px]">
      <h2 className="text-[18px] font-black text-[#252c28]">What this field is about</h2>
      <p className="mt-3 max-w-[860px] text-[15px] leading-7 text-[#44504a]">{scenario.fieldPurpose}</p>

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[18px] font-black text-[#252c28]">Note structure</h3>
          <p className="mt-1 text-[13px] leading-6 text-[#5f6a65]">Write the note in this order.</p>
        </div>
        <span className="text-[11px] font-bold text-[#69746f]">{scenario.formatStandard.lengthGuidance}</span>
      </div>
      <ol className="mt-4 divide-y divide-[#dfe5e2] border-y border-[#d5ddda] bg-white">
        {instructionSteps.map((step, index) => (
          <li key={`${step.title}-${index}`} className="grid gap-3 py-5 sm:grid-cols-[38px_190px_minmax(0,1fr)] sm:items-start sm:gap-5">
            <span className="flex h-8 w-8 items-center justify-center bg-[#e9f5f1] text-[12px] font-black text-[#08715f]">
              {index + 1}
            </span>
            <strong className="text-[14px] leading-6 text-[#26302b]">{step.title}</strong>
            <p className="text-[14px] leading-6 text-[#4e5954]">{step.instruction}</p>
          </li>
        ))}
      </ol>

      <div className="mt-5 border border-[#d8dfdc] bg-white px-5 py-4">
        <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#0d7c68]">Quick pattern</div>
        <p className="mt-2 text-[14px] font-semibold leading-7 text-[#34403a]">{scenario.formatStandard.template}</p>
      </div>
    </div>
  );
}

function SaveFieldAction({
  canSubmit,
  error,
  selectedAnswerCount,
  saving,
  remaining,
  reviewed,
  calibrationComplete,
  profile,
  onSubmit,
}: {
  canSubmit: boolean;
  error: string | null;
  selectedAnswerCount: number;
  saving: boolean;
  remaining: number;
  reviewed: boolean;
  calibrationComplete: boolean;
  profile: NoteLabPreferenceProfile;
  onSubmit: () => void;
}) {
  if (reviewed) {
    return (
      <footer className="flex items-center justify-between gap-4">
        <div role="status" className="text-[10px] font-bold leading-5 text-[#0b705f]">
          This field is complete. Use the field list to continue or review another field.
        </div>
        {calibrationComplete ? (
          <button
            type="button"
            onClick={() => downloadProfile(profile)}
            className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white outline-none hover:bg-[#0c705f] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2"
          >
            <Download size={14} aria-hidden="true" />Download standard
          </button>
        ) : (
          <span className="inline-flex h-10 items-center gap-2 bg-[#edf7f3] px-5 text-[11px] font-black text-[#0b705f]">
            <Check size={14} aria-hidden="true" />Reviewed
          </span>
        )}
      </footer>
    );
  }
  const hint = error ?? submissionHint(selectedAnswerCount);
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
  loadingField,
  disabled,
  onNavigate,
}: {
  session: NoteLabSession;
  loadingField: string | null;
  disabled: boolean;
  onNavigate: (field: string) => void;
}) {
  const activeIndex = session.calibration.fieldSteps.findIndex(
    (field) => field.field === session.scenario?.targetField,
  );
  return (
    <aside className="sticky top-3 max-h-[calc(100vh-5rem)] self-start overflow-y-auto px-1.5 py-4 sm:px-3 sm:py-5" aria-label="Assessment field progress">
      <div className="hidden items-baseline justify-between gap-3 px-2 sm:flex">
        <span className="text-[11px] font-black text-[#2d3531]">Assessment fields</span>
        <span className="text-[10px] font-bold text-[#74807b]">{Math.max(activeIndex + 1, 1)} / {session.calibration.targetDecisions}</span>
      </div>
      <nav aria-label="Assessment fields" className="mt-1 sm:mt-3">
        <ol className="space-y-0.5">
          {session.calibration.fieldSteps.map((field, index) => (
            <FieldProgressRailStep
              key={field.field}
              field={field}
              index={index}
              active={index === activeIndex}
              loading={field.field === loadingField}
              disabled={disabled || loadingField !== null}
              onNavigate={onNavigate}
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
  loading,
  disabled,
  onNavigate,
}: {
  field: NoteLabSession["calibration"]["fieldSteps"][number];
  index: number;
  active: boolean;
  loading: boolean;
  disabled: boolean;
  onNavigate: (field: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "step" : undefined}
        aria-label={`Field ${index + 1}: ${field.label}${field.reviewed ? ", reviewed" : ""}`}
        disabled={disabled}
        onClick={() => onNavigate(field.field)}
        className={`grid min-h-8 w-full grid-cols-[26px_minmax(0,1fr)] items-center gap-2 border-l-2 px-1.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] sm:px-2 ${active ? "border-[#0f8b73] bg-[#edf7f3]" : "border-transparent hover:bg-[#f3f6f4]"} disabled:cursor-wait disabled:opacity-65`}
      >
        <span className={`flex h-5 w-5 items-center justify-center border text-[8px] font-black ${progressStepBadgeClass(active, field.reviewed)}`}>
          {field.reviewed ? <Check size={11} strokeWidth={2.6} aria-hidden="true" /> : loading ? "…" : String(index + 1).padStart(2, "0")}
        </span>
        <span className={`hidden min-w-0 text-[10px] font-bold leading-4 sm:block ${active ? "text-[#0b6f5d]" : field.reviewed ? "text-[#4f5a55]" : "text-[#78827d]"}`}>
          {field.label}
        </span>
        <span className="sr-only sm:hidden">{field.label}</span>
      </button>
    </li>
  );
}

function progressStepBadgeClass(active: boolean, completed: boolean) {
  if (active) return "border-[#0f8b73] bg-[#0f8b73] text-white";
  if (completed) return "border-[#8db9aa] bg-[#edf7f3] text-[#0f7a67]";
  return "border-[#cbd4d0] bg-white text-[#76817c]";
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

function criteriaForSession(session: NoteLabSession) {
  return normalizeAnswerComponentCriteria(
    session.review?.selectedCriterionIds ?? session.scenario?.recommendedCriterionIds ?? [],
  );
}

function GoodNoteExample({ scenario }: { scenario: NonNullable<NoteLabSession["scenario"]> }) {
  return (
    <section aria-label={`${scenario.targetFieldLabel} good note example`} className="max-w-[920px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[18px] font-black text-[#252c28]">Good note example</h2>
        <span className="text-[11px] font-bold text-[#74807b]">{scenario.formatStandard.label}</span>
      </div>
      <blockquote className="mt-4 border border-[#d6deda] border-l-4 border-l-[#0f8b73] bg-white px-6 py-6 text-[17px] font-medium leading-8 text-[#28332e] sm:px-7 sm:py-7">
        {scenario.formatStandard.referenceAnswer}
      </blockquote>
    </section>
  );
}

function LabFrame({ reviewerName, children }: { reviewerName: string; children: React.ReactNode }) {
  return (
    <div data-note-lab-scroll-container aria-label={`${reviewerName} assessment language review`} className="pipeline-route-enter h-full overflow-y-auto bg-[#f4f6f5]">
      <div className="mx-auto max-w-[1380px] px-3 py-4 sm:px-6 lg:py-6">
        {children}
      </div>
    </div>
  );
}

function EmptyLab({ message }: { message: string | null }) {
  return <section className="flex min-h-[430px] items-center justify-center border border-[#cfd7d4] bg-white p-8 text-center"><div className="max-w-[480px]"><FileCheck2 size={28} strokeWidth={1.6} className="mx-auto text-[#0f8b73]" aria-hidden="true" /><h2 className="mt-4 text-[18px] font-black text-[#252c28]">No review available</h2><p className="mt-2 text-[11px] leading-5 text-[#6d7773]">{message ?? "Assessment writing standards are unavailable."}</p></div></section>;
}

function submissionHint(answerVariationCount: number) {
  if (answerVariationCount === 0) return "Select at least one answer variation.";
  return "Ready to save.";
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

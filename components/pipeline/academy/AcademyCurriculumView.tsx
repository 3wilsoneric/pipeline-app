"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Circle,
  ClipboardCheck,
  Code2,
  FlaskConical,
  LockKeyhole,
  Terminal,
  Timer,
} from "lucide-react";
import { useState } from "react";

import {
  academyActivityKey,
  academyModules,
  academyTracks,
  getAcademyModule,
  getAcademyTrack,
} from "@/lib/academy/academy-curriculum";
import {
  academyEvidenceFor,
  countAcademyModuleActivities,
  evidenceMeetsMinimum,
  isAcademyActivityComplete,
  isAcademyModuleComplete,
  isAcademyModuleUnlocked,
} from "@/lib/academy/academy-progress";
import type { AcademyProgress } from "@/lib/academy/academy-progress-contract";
import type { AcademyActivity, AcademyModule } from "@/lib/academy/academy-types";

export default function AcademyCurriculumView({
  progress,
  onSelect,
  onEvidenceChange,
  onEvidenceCommit,
  onComplete,
}: {
  progress: AcademyProgress;
  onSelect: (module: AcademyModule, activity: AcademyActivity) => void;
  onEvidenceChange: (module: AcademyModule, activity: AcademyActivity, text: string) => void;
  onEvidenceCommit: () => void;
  onComplete: (module: AcademyModule, activity: AcademyActivity) => void;
}) {
  const activeModule = getAcademyModule(progress.activeModuleId) ?? academyModules[0];
  const activeActivity = activeModule.activities.find((activity) => activity.id === progress.activeActivityId)
    ?? activeModule.activities[0];

  return (
    <div className="grid min-h-[680px] overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[310px_minmax(0,1fr)]">
      <CurriculumRail progress={progress} activeModule={activeModule} onSelect={onSelect} />
      <ActivityWorkspace
        key={academyActivityKey(activeModule.id, activeActivity.id)}
        progress={progress}
        module={activeModule}
        activity={activeActivity}
        onSelect={onSelect}
        onEvidenceChange={onEvidenceChange}
        onEvidenceCommit={onEvidenceCommit}
        onComplete={onComplete}
      />
    </div>
  );
}

function CurriculumRail({
  progress,
  activeModule,
  onSelect,
}: {
  progress: AcademyProgress;
  activeModule: AcademyModule;
  onSelect: (module: AcademyModule, activity: AcademyActivity) => void;
}) {
  return (
    <aside className="border-b border-[#d7dfdc] bg-[#f3f6f5] lg:border-b-0 lg:border-r">
      <div className="border-b border-[#d7dfdc] px-4 py-4">
        <label htmlFor="academy-module-mobile" className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.11em] text-[#6f7975] lg:hidden">Current module</label>
        <select
          id="academy-module-mobile"
          value={activeModule.id}
          onChange={(event) => {
            const academyModule = getAcademyModule(event.target.value);
            if (academyModule) onSelect(academyModule, academyModule.activities[0]);
          }}
          className="h-11 w-full border border-[#becbc6] bg-white px-3 text-[11px] font-black text-[#2c3330] outline-none focus:border-[#0f8b73] lg:hidden"
        >
          {academyModules.map((module) => <option key={module.id} value={module.id}>{module.number}. {module.title}</option>)}
        </select>
        <div className="hidden items-center gap-3 lg:flex">
          <div className="flex h-10 w-10 items-center justify-center border border-[#a7c9be] bg-[#eef7f4] text-[#0c705f]"><BookOpen size={19} aria-hidden="true" /></div>
          <div><div className="text-[13px] font-black text-[#202724]">Enterprise curriculum</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.09em] text-[#7b8481]">10 tracks · 36 modules</div></div>
        </div>
      </div>
      <nav aria-label="Academy curriculum" className="hidden max-h-[calc(100vh-260px)] overflow-y-auto p-2 lg:block">
        {academyTracks.map((track) => {
          const modules = academyModules.filter((module) => module.trackId === track.id);
          return (
            <section key={track.id} className="mb-3">
              <div className="flex items-center justify-between px-2 py-1.5">
                <h3 className="text-[9px] font-black uppercase tracking-[0.12em] text-[#68726e]">{track.number}. {track.shortTitle}</h3>
                <span className="text-[9px] font-bold text-[#929a97]">{modules.filter((module) => isAcademyModuleComplete(progress, module)).length}/{modules.length}</span>
              </div>
              {modules.map((module) => {
                const active = module.id === activeModule.id;
                const complete = isAcademyModuleComplete(progress, module);
                const unlocked = isAcademyModuleUnlocked(progress, module);
                return (
                  <button
                    key={module.id}
                    type="button"
                    onClick={() => onSelect(module, module.activities[0])}
                    className={`mb-0.5 grid min-h-[48px] w-full grid-cols-[26px_minmax(0,1fr)_18px] items-center gap-2 border-l-[3px] px-2.5 py-2 text-left ${active ? "border-l-[#0f8b73] bg-white shadow-[0_2px_7px_rgba(20,50,42,0.05)]" : "border-l-transparent hover:bg-white/70"}`}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center border text-[9px] font-black ${complete ? "border-[#0f8b73] bg-[#0f8b73] text-white" : active ? "border-[#79b5a3] bg-[#eef7f4] text-[#0c705f]" : "border-[#d0d8d5] bg-white text-[#707976]"}`}>
                      {complete ? <Check size={12} aria-hidden="true" /> : module.number}
                    </span>
                    <span className="min-w-0"><span className="block text-[10px] font-black leading-4 text-[#2c3431]">{module.title}</span><span className="mt-0.5 block text-[8px] font-bold uppercase tracking-[0.07em] text-[#89918e]">{countAcademyModuleActivities(progress, module)}/4 · {Math.round(module.minutes / 60 * 10) / 10}h</span></span>
                    {unlocked ? <ArrowRight size={12} className={active ? "text-[#0f8b73]" : "text-[#a0a8a5]"} aria-hidden="true" /> : <LockKeyhole size={11} className="text-[#9aa29f]" aria-hidden="true" />}
                  </button>
                );
              })}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

function ActivityWorkspace({
  progress,
  module,
  activity,
  onSelect,
  onEvidenceChange,
  onEvidenceCommit,
  onComplete,
}: {
  progress: AcademyProgress;
  module: AcademyModule;
  activity: AcademyActivity;
  onSelect: (module: AcademyModule, activity: AcademyActivity) => void;
  onEvidenceChange: (module: AcademyModule, activity: AcademyActivity, text: string) => void;
  onEvidenceCommit: () => void;
  onComplete: (module: AcademyModule, activity: AcademyActivity) => void;
}) {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answerChecked, setAnswerChecked] = useState(false);
  const evidence = academyEvidenceFor(progress, module.id, activity.id);
  const complete = isAcademyActivityComplete(progress, module.id, activity.id);
  const answerCorrect = activity.check ? selectedAnswer === activity.check.answer : true;
  const evidenceReady = !activity.evidencePrompt || evidenceMeetsMinimum(evidence);
  const canComplete = complete || (evidenceReady && (!activity.check || (answerChecked && answerCorrect)));
  const activityIndex = module.activities.findIndex((candidate) => candidate.id === activity.id);
  const track = getAcademyTrack(module.trackId);
  const moduleUnlocked = isAcademyModuleUnlocked(progress, module);

  return (
    <main className="min-w-0 bg-[#fbfcfb]">
      <header className="border-b border-[#d8dfdc] bg-white px-5 py-5 sm:px-7 md:px-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[9px] font-black uppercase tracking-[0.13em] text-[#0c705f]">Track {track?.number} · Module {module.number} · {module.level}</div>
          <div className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.08em] text-[#737d79]"><Timer size={13} aria-hidden="true" /> {activity.minutes} minutes</div>
        </div>
        <h2 className="mt-2 text-[25px] font-black leading-tight tracking-[-0.03em] text-[#151817]">{module.title}</h2>
        <p className="mt-2 max-w-[800px] text-[12px] leading-5 text-[#5f6965]">{module.summary}</p>
        <div className="mt-5 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label={`${module.title} activities`}>
          {module.activities.map((candidate, index) => {
            const active = candidate.id === activity.id;
            const done = isAcademyActivityComplete(progress, module.id, candidate.id);
            return (
              <button key={candidate.id} type="button" role="tab" aria-selected={active} onClick={() => onSelect(module, candidate)} className={`flex h-10 shrink-0 items-center gap-2 border px-3 text-[9px] font-black uppercase tracking-[0.06em] ${active ? "border-[#0f8b73] bg-[#eaf5f1] text-[#0c705f]" : "border-[#d4dbd9] bg-white text-[#68726e] hover:border-[#9db8af]"}`}>
                <span className={`flex h-5 w-5 items-center justify-center border text-[8px] ${done ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#cbd4d1] bg-white"}`}>{done ? <Check size={11} aria-hidden="true" /> : index + 1}</span>
                {activityLabel(candidate.kind)}
              </button>
            );
          })}
        </div>
      </header>

      <AcademyActivityBody
        module={module}
        activity={activity}
        moduleUnlocked={moduleUnlocked}
        evidence={evidence}
        selectedAnswer={selectedAnswer}
        answerChecked={answerChecked}
        onEvidenceChange={(text) => onEvidenceChange(module, activity, text)}
        onEvidenceCommit={onEvidenceCommit}
        onAnswerSelect={(answer) => { setSelectedAnswer(answer); setAnswerChecked(false); }}
        onAnswerCheck={() => setAnswerChecked(true)}
      />
      <AcademyActivityFooter
        module={module}
        activity={activity}
        activityIndex={activityIndex}
        evidence={evidence}
        evidenceReady={evidenceReady}
        complete={complete}
        moduleUnlocked={moduleUnlocked}
        canComplete={canComplete}
        onSelect={onSelect}
        onComplete={onComplete}
      />
    </main>
  );
}

function AcademyActivityBody({ module, activity, moduleUnlocked, evidence, selectedAnswer, answerChecked, onEvidenceChange, onEvidenceCommit, onAnswerSelect, onAnswerCheck }: { module: AcademyModule; activity: AcademyActivity; moduleUnlocked: boolean; evidence: string; selectedAnswer: number | null; answerChecked: boolean; onEvidenceChange: (text: string) => void; onEvidenceCommit: () => void; onAnswerSelect: (answer: number) => void; onAnswerCheck: () => void }) {
  return (
    <article className="px-5 py-6 sm:px-7 md:px-9 md:py-8">
      {!moduleUnlocked ? <div className="mb-5 flex gap-3 border border-[#e1cda0] bg-[#fff9ea] px-4 py-3 text-[11px] leading-5 text-[#6c5525]"><LockKeyhole size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>This module is available for preview. Complete its prerequisite modules before recording completion.</span></div> : null}
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#176b78]">{activityIcon(activity.kind)} {activityLabel(activity.kind)}</div>
      <h3 className="mt-2 text-[24px] font-black tracking-[-0.025em] text-[#202623]">{activity.title}</h3>
      <p className="mt-3 max-w-[820px] text-[13px] leading-6 text-[#59635f]">{activity.summary}</p>
      <section className="mt-6 border border-[#d4ddda] bg-white px-5 py-4">
        <h4 className="text-[10px] font-black uppercase tracking-[0.11em] text-[#59635f]">Required work</h4>
        <ol className="mt-3 space-y-3">{activity.instructions.map((instruction, index) => <li key={instruction} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 text-[12px] leading-5 text-[#46504c]"><span className="flex h-6 w-6 items-center justify-center border border-[#b9d2ca] bg-[#f0f7f4] text-[9px] font-black text-[#0c705f]">{index + 1}</span><span>{instruction}</span></li>)}</ol>
      </section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="border border-[#c9d9d4] bg-[#f4faf7] px-5 py-4"><h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.11em] text-[#0c705f]"><Code2 size={14} aria-hidden="true" /> Read in the repository</h4><div className="mt-3 space-y-2">{activity.sources.map((source) => <div key={source.path} className="border border-[#d7e3df] bg-white px-3 py-2.5"><code className="break-all font-mono text-[10px] font-bold text-[#28574b]">{source.path}</code><p className="mt-1 text-[10px] leading-4 text-[#737d79]">{source.purpose}</p></div>)}</div></section>
        <section className="border border-[#d6dcda] bg-white px-4 py-4"><h4 className="text-[10px] font-black uppercase tracking-[0.11em] text-[#626c68]">After this module</h4><ul className="mt-3 space-y-2.5">{module.objectives.map((objective) => <li key={objective} className="flex gap-2 text-[11px] leading-5 text-[#535d59]"><Circle size={7} fill="currentColor" className="mt-1.5 shrink-0 text-[#0f8b73]" aria-hidden="true" /><span>{objective}</span></li>)}</ul></section>
      </div>
      {activity.commands?.length ? <section className="mt-5 overflow-hidden border border-[#293d37] bg-[#17221f]"><div className="flex items-center gap-2 border-b border-[#344943] px-4 py-2.5 text-[9px] font-black uppercase tracking-[0.1em] text-[#b9d8ce]"><Terminal size={13} aria-hidden="true" /> Commands to understand before running</div><pre className="overflow-x-auto p-4 text-[11px] leading-6 text-[#e7f2ee]"><code>{activity.commands.join("\n")}</code></pre></section> : null}
      {activity.evidencePrompt ? <EvidenceEditor activity={activity} evidence={evidence} onChange={onEvidenceChange} onBlur={onEvidenceCommit} /> : null}
      {activity.check ? <KnowledgeCheck check={activity.check} selectedAnswer={selectedAnswer} checked={answerChecked} onSelect={onAnswerSelect} onCheck={onAnswerCheck} /> : null}
    </article>
  );
}

function AcademyActivityFooter({ module, activity, activityIndex, evidence, evidenceReady, complete, moduleUnlocked, canComplete, onSelect, onComplete }: { module: AcademyModule; activity: AcademyActivity; activityIndex: number; evidence: string; evidenceReady: boolean; complete: boolean; moduleUnlocked: boolean; canComplete: boolean; onSelect: (module: AcademyModule, activity: AcademyActivity) => void; onComplete: (module: AcademyModule, activity: AcademyActivity) => void }) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dfdc] bg-white px-5 py-4 sm:px-7 md:px-9">
      <button type="button" disabled={activityIndex === 0} onClick={() => onSelect(module, module.activities[activityIndex - 1])} className="inline-flex h-10 items-center gap-2 border border-[#d0d8d5] px-3.5 text-[10px] font-black text-[#626c68] hover:border-[#9eb4ac] disabled:invisible"><ArrowLeft size={13} aria-hidden="true" /> Previous</button>
      <div className="text-[9px] font-bold text-[#7a837f]">{academyFooterMessage(activity, evidence, evidenceReady, complete)}</div>
      <button type="button" disabled={!moduleUnlocked || !canComplete} onClick={() => onComplete(module, activity)} className="inline-flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[10px] font-black text-white shadow-[0_4px_12px_rgba(15,139,115,0.16)] hover:bg-[#0b7762] disabled:cursor-not-allowed disabled:bg-[#aab5b1] disabled:shadow-none">{complete ? <Check size={14} aria-hidden="true" /> : null}{complete ? "Continue" : "Record and continue"}<ArrowRight size={14} aria-hidden="true" /></button>
    </footer>
  );
}

function academyFooterMessage(activity: AcademyActivity, evidence: string, evidenceReady: boolean, complete: boolean) {
  if (activity.evidencePrompt && !evidenceReady) return `${Math.min(80, evidence.trim().length)}/80 evidence characters required`;
  return complete ? "Evidence recorded" : "Complete the work before continuing";
}

function EvidenceEditor({ activity, evidence, onChange, onBlur }: { activity: AcademyActivity; evidence: string; onChange: (text: string) => void; onBlur: () => void }) {
  return (
    <section className="mt-5 border border-[#d8ccb2] bg-[#fffaf0] px-5 py-5">
      <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.11em] text-[#805b19]"><ClipboardCheck size={15} aria-hidden="true" /> Mastery evidence</h4>
      <p className="mt-2 text-[12px] font-bold leading-5 text-[#5e5138]">{activity.evidencePrompt}</p>
      <p className="mt-2 text-[10px] leading-4 text-[#8a7752]">Use synthetic examples only. Never enter client names, dates of birth, packet text, document names, credentials, or production identifiers.</p>
      <textarea value={evidence} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} maxLength={6000} rows={7} placeholder="Write from memory first. Verify the source second, then record what changed in your understanding." className="mt-4 w-full resize-y border border-[#cfc1a5] bg-white px-3.5 py-3 text-[12px] leading-5 text-[#343935] outline-none focus:border-[#9b6a16] focus:ring-2 focus:ring-[#f2e3bd]" />
      {activity.acceptanceCriteria?.length ? <div className="mt-3"><div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#7c6945]">Acceptance criteria</div><ul className="mt-2 grid gap-2 md:grid-cols-2">{activity.acceptanceCriteria.map((criterion) => <li key={criterion} className="flex gap-2 text-[10px] leading-4 text-[#65583e]"><Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{criterion}</li>)}</ul></div> : null}
    </section>
  );
}

function KnowledgeCheck({ check, selectedAnswer, checked, onSelect, onCheck }: { check: NonNullable<AcademyActivity["check"]>; selectedAnswer: number | null; checked: boolean; onSelect: (answer: number) => void; onCheck: () => void }) {
  const correct = selectedAnswer === check.answer;
  return (
    <section className="mt-5 border border-[#cfdad6] bg-[#f7faf9] px-5 py-5">
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#176b78]">Knowledge check</div>
      <h4 className="mt-2 text-[17px] font-black leading-6 text-[#202623]">{check.prompt}</h4>
      <div className="mt-4 grid gap-2">
        {check.options.map((option, index) => {
          const selected = selectedAnswer === index;
          const showCorrect = checked && index === check.answer;
          const showIncorrect = checked && selected && !correct;
          return <button key={option} type="button" onClick={() => onSelect(index)} className={`grid min-h-[48px] grid-cols-[28px_minmax(0,1fr)] items-center gap-3 border px-3 py-2.5 text-left text-[11px] font-bold ${showCorrect ? "border-[#0f8b73] bg-[#eaf6f1] text-[#0c5f50]" : showIncorrect ? "border-[#c85b4d] bg-[#fff0ed] text-[#943c32]" : selected ? "border-[#27889a] bg-[#edf8fa] text-[#176b78]" : "border-[#d3dad8] bg-white text-[#4d5552] hover:border-[#9eb2ab]"}`}><span className="flex h-6 w-6 items-center justify-center border border-current text-[9px] font-black">{String.fromCharCode(65 + index)}</span><span>{option}</span></button>;
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={selectedAnswer === null} onClick={onCheck} className="h-10 bg-[#176b78] px-4 text-[10px] font-black text-white hover:bg-[#115b66] disabled:opacity-40">Check answer</button>{checked ? <p role="status" className={`max-w-[620px] text-[10px] font-bold leading-5 ${correct ? "text-[#0c705f]" : "text-[#a04436]"}`}><span className="font-black">{correct ? "Correct. " : "Not yet. "}</span>{check.explanation}</p> : null}</div>
    </section>
  );
}

function activityLabel(kind: AcademyActivity["kind"]) {
  if (kind === "learn") return "Learn";
  if (kind === "source-trace") return "Trace";
  if (kind === "lab") return "Lab";
  return "Verify";
}

function activityIcon(kind: AcademyActivity["kind"]) {
  if (kind === "learn") return <BookOpen size={14} aria-hidden="true" />;
  if (kind === "source-trace") return <Code2 size={14} aria-hidden="true" />;
  if (kind === "lab") return <FlaskConical size={14} aria-hidden="true" />;
  return <ClipboardCheck size={14} aria-hidden="true" />;
}

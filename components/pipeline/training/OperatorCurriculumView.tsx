"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ClipboardCheck, Eye, Footprints, LockKeyhole, ShieldCheck, Timer } from "lucide-react";
import { useState } from "react";

import OperatorLessonVideo from "@/components/pipeline/training/OperatorLessonVideo";
import {
  getOperatorModule,
  getOperatorTrack,
  operatorActivityKey,
  operatorModulesForRole,
  operatorTrainingTracks,
} from "@/lib/training/operator-training-curriculum";
import {
  isOperatorActivityComplete,
  isOperatorModuleComplete,
  isOperatorModuleUnlocked,
  operatorEvidence,
  operatorEvidenceReady,
  operatorModuleActivityCount,
} from "@/lib/training/operator-training-progress";
import type { OperatorTrainingProgress } from "@/lib/training/operator-training-progress-contract";
import type { OperatorActivity, OperatorModule } from "@/lib/training/operator-training-types";

export default function OperatorCurriculumView({
  progress,
  onSelect,
  onEvidenceChange,
  onEvidenceCommit,
  onComplete,
  onConfidence,
}: {
  progress: OperatorTrainingProgress;
  onSelect: (module: OperatorModule, activity: OperatorActivity) => void;
  onEvidenceChange: (module: OperatorModule, activity: OperatorActivity, text: string) => void;
  onEvidenceCommit: () => void;
  onComplete: (module: OperatorModule, activity: OperatorActivity) => void;
  onConfidence: (moduleId: string, value: number) => void;
}) {
  const modules = operatorModulesForRole(progress.role);
  const activeModule = getOperatorModule(progress.activeModuleId) ?? modules[0];
  const activeActivity = activeModule.activities.find((activity) => activity.id === progress.activeActivityId) ?? activeModule.activities[0];
  return (
    <div className="grid min-h-[680px] overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[310px_minmax(0,1fr)]">
      <CurriculumRail progress={progress} modules={modules} activeModule={activeModule} onSelect={onSelect} />
      <ActivityWorkspace key={operatorActivityKey(activeModule.id, activeActivity.id)} progress={progress} module={activeModule} activity={activeActivity} onSelect={onSelect} onEvidenceChange={onEvidenceChange} onEvidenceCommit={onEvidenceCommit} onComplete={onComplete} onConfidence={onConfidence} />
    </div>
  );
}

function CurriculumRail({ progress, modules, activeModule, onSelect }: { progress: OperatorTrainingProgress; modules: readonly OperatorModule[]; activeModule: OperatorModule; onSelect: (module: OperatorModule, activity: OperatorActivity) => void }) {
  return (
    <aside className="border-b border-[#d7dfdc] bg-[#f3f6f5] lg:border-b-0 lg:border-r">
      <div className="border-b border-[#d7dfdc] px-4 py-4">
        <label htmlFor="operator-module-mobile" className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.11em] text-[#6f7975] lg:hidden">Current module</label>
        <select id="operator-module-mobile" value={activeModule.id} onChange={(event) => { const trainingModule = getOperatorModule(event.target.value); if (trainingModule) onSelect(trainingModule, trainingModule.activities[0]); }} className="h-11 w-full border border-[#becbc6] bg-white px-3 text-[11px] font-black text-[#2c3330] outline-none lg:hidden">
          {modules.map((module) => <option key={module.id} value={module.id}>{module.number}. {module.title}</option>)}
        </select>
        <div className="hidden items-center gap-3 lg:flex"><div className="flex h-10 w-10 items-center justify-center border border-[#a7c9be] bg-[#eef7f4] text-[#0c705f]"><BookOpen size={19} aria-hidden="true" /></div><div><div className="text-[13px] font-black text-[#202724]">Your learning path</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.09em] text-[#7b8481]">{modules.length} required modules</div></div></div>
      </div>
      <nav aria-label="Operator curriculum" className="hidden max-h-[calc(100vh-260px)] overflow-y-auto p-2 lg:block">
        {operatorTrainingTracks.map((track) => {
          const trackModules = modules.filter((module) => module.trackId === track.id);
          if (!trackModules.length) return null;
          return <section key={track.id} className="mb-3"><div className="flex items-center justify-between px-2 py-1.5"><h3 className="text-[9px] font-black uppercase tracking-[0.12em] text-[#68726e]">{track.number}. {track.shortTitle}</h3><span className="text-[9px] font-bold text-[#929a97]">{trackModules.filter((module) => isOperatorModuleComplete(progress, module)).length}/{trackModules.length}</span></div>{trackModules.map((module) => {
            const active = module.id === activeModule.id;
            const complete = isOperatorModuleComplete(progress, module);
            const unlocked = isOperatorModuleUnlocked(progress, module);
            return <button key={module.id} type="button" onClick={() => onSelect(module, module.activities.find((activity) => !isOperatorActivityComplete(progress, module.id, activity.id)) ?? module.activities[0])} className={`mb-0.5 grid min-h-[50px] w-full grid-cols-[26px_minmax(0,1fr)_18px] items-center gap-2 border-l-[3px] px-2.5 py-2 text-left ${active ? "border-l-[#0f8b73] bg-white shadow-[0_2px_7px_rgba(20,50,42,0.05)]" : "border-l-transparent hover:bg-white/70"}`}><span className={`flex h-6 w-6 items-center justify-center border text-[9px] font-black ${complete ? "border-[#0f8b73] bg-[#0f8b73] text-white" : active ? "border-[#79b5a3] bg-[#eef7f4] text-[#0c705f]" : "border-[#d0d8d5] bg-white text-[#707976]"}`}>{complete ? <Check size={12} aria-hidden="true" /> : module.number}</span><span className="min-w-0"><span className="block text-[10px] font-black leading-4 text-[#2c3431]">{module.title}</span><span className="mt-0.5 block text-[8px] font-bold uppercase tracking-[0.07em] text-[#89918e]">{operatorModuleActivityCount(progress, module)}/4 · {module.minutes}m</span></span>{unlocked ? <ArrowRight size={12} className={active ? "text-[#0f8b73]" : "text-[#a0a8a5]"} aria-hidden="true" /> : <LockKeyhole size={11} className="text-[#9aa29f]" aria-hidden="true" />}</button>;
          })}</section>;
        })}
      </nav>
    </aside>
  );
}

function ActivityWorkspace({ progress, module, activity, onSelect, onEvidenceChange, onEvidenceCommit, onComplete, onConfidence }: { progress: OperatorTrainingProgress; module: OperatorModule; activity: OperatorActivity; onSelect: (module: OperatorModule, activity: OperatorActivity) => void; onEvidenceChange: (module: OperatorModule, activity: OperatorActivity, text: string) => void; onEvidenceCommit: () => void; onComplete: (module: OperatorModule, activity: OperatorActivity) => void; onConfidence: (moduleId: string, value: number) => void }) {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answerChecked, setAnswerChecked] = useState(false);
  const evidence = operatorEvidence(progress, module.id, activity.id);
  const complete = isOperatorActivityComplete(progress, module.id, activity.id);
  const correct = activity.check ? selectedAnswer === activity.check.answer : true;
  const evidenceReady = !activity.evidencePrompt || operatorEvidenceReady(evidence);
  const canComplete = complete || (evidenceReady && (!activity.check || (answerChecked && correct)));
  const index = module.activities.findIndex((candidate) => candidate.id === activity.id);
  const track = getOperatorTrack(module.trackId);
  const unlocked = isOperatorModuleUnlocked(progress, module);
  return (
    <main className="min-w-0 bg-[#fbfcfb]">
      <header className="border-b border-[#d8dfdc] bg-white px-5 py-5 sm:px-7 md:px-9"><div className="flex flex-wrap items-center justify-between gap-3"><div className="text-[9px] font-black uppercase tracking-[0.13em] text-[#0c705f]">Track {track?.number} · Module {module.number} · {module.level}</div><div className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.08em] text-[#737d79]"><Timer size={13} aria-hidden="true" /> {activity.minutes} minutes</div></div><h2 className="mt-2 text-[25px] font-black tracking-[-0.03em] text-[#151817]">{module.title}</h2><p className="mt-2 max-w-[820px] text-[12px] leading-5 text-[#5f6965]">{module.summary}</p><div className="mt-5 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label={`${module.title} activities`}>{module.activities.map((candidate, candidateIndex) => { const active = candidate.id === activity.id; const done = isOperatorActivityComplete(progress, module.id, candidate.id); return <button key={candidate.id} type="button" role="tab" aria-selected={active} onClick={() => onSelect(module, candidate)} className={`flex h-10 shrink-0 items-center gap-2 border px-3 text-[9px] font-black uppercase tracking-[0.06em] ${active ? "border-[#0f8b73] bg-[#eaf5f1] text-[#0c705f]" : "border-[#d4dbd9] bg-white text-[#68726e] hover:border-[#9db8af]"}`}><span className={`flex h-5 w-5 items-center justify-center border text-[8px] ${done ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#cbd4d1] bg-white"}`}>{done ? <Check size={11} aria-hidden="true" /> : candidateIndex + 1}</span>{activityLabel(candidate.kind)}</button>; })}</div></header>
      <OperatorActivityBody progress={progress} module={module} activity={activity} activityIndex={index} unlocked={unlocked} complete={complete} evidence={evidence} selectedAnswer={selectedAnswer} answerChecked={answerChecked} onEvidenceChange={(text) => onEvidenceChange(module, activity, text)} onEvidenceCommit={onEvidenceCommit} onAnswerSelect={(answer) => { setSelectedAnswer(answer); setAnswerChecked(false); }} onAnswerCheck={() => setAnswerChecked(true)} onConfidence={onConfidence} />
      <OperatorActivityFooter module={module} activity={activity} activityIndex={index} evidence={evidence} evidenceReady={evidenceReady} complete={complete} unlocked={unlocked} canComplete={canComplete} onSelect={onSelect} onComplete={onComplete} />
    </main>
  );
}

function OperatorActivityBody({ progress, module, activity, activityIndex, unlocked, complete, evidence, selectedAnswer, answerChecked, onEvidenceChange, onEvidenceCommit, onAnswerSelect, onAnswerCheck, onConfidence }: { progress: OperatorTrainingProgress; module: OperatorModule; activity: OperatorActivity; activityIndex: number; unlocked: boolean; complete: boolean; evidence: string; selectedAnswer: number | null; answerChecked: boolean; onEvidenceChange: (text: string) => void; onEvidenceCommit: () => void; onAnswerSelect: (answer: number) => void; onAnswerCheck: () => void; onConfidence: (moduleId: string, value: number) => void }) {
  const showConfidence = activityIndex === module.activities.length - 1 && complete;
  return (
    <article className="px-5 py-6 sm:px-7 md:px-9 md:py-8">
      {!unlocked ? <div className="mb-5 flex gap-3 border border-[#e1cda0] bg-[#fff9ea] px-4 py-3 text-[11px] leading-5 text-[#6c5525]"><LockKeyhole size={16} className="mt-0.5 shrink-0" aria-hidden="true" />Preview is available. Complete prerequisite modules before recording completion.</div> : null}
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#176b78]">{activityIcon(activity.kind)} {activityLabel(activity.kind)}</div><h3 className="mt-2 text-[23px] font-black tracking-[-0.025em] text-[#202623]">{activity.title}</h3><p className="mt-3 max-w-[820px] text-[13px] leading-6 text-[#59635f]">{activity.summary}</p>
      <OperatorLessonVideo moduleId={module.id} activityId={activity.id} />
      <section className="mt-6 border border-[#d4ddda] bg-white px-5 py-4"><h4 className="text-[10px] font-black uppercase tracking-[0.11em] text-[#59635f]">Required work</h4><ol className="mt-3 space-y-3">{activity.instructions.map((instruction, stepIndex) => <li key={instruction} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 text-[12px] leading-5 text-[#46504c]"><span className="flex h-6 w-6 items-center justify-center border border-[#b9d2ca] bg-[#f0f7f4] text-[9px] font-black text-[#0c705f]">{stepIndex + 1}</span>{instruction}</li>)}</ol></section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><section className="border border-[#c9d9d4] bg-[#f4faf7] px-5 py-4"><h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.11em] text-[#0c705f]"><Footprints size={14} aria-hidden="true" /> Practice in Pipeline</h4><div className="mt-3 grid gap-2 sm:grid-cols-2">{activity.locations.map((location) => <a key={`${location.href}:${location.label}`} href={location.href} className="flex min-h-11 items-center justify-between gap-2 border border-[#d7e3df] bg-white px-3 py-2.5 text-[10px] font-black text-[#28574b] hover:border-[#8fb8ab]">{location.label}<ArrowUpRight size={12} aria-hidden="true" /></a>)}</div></section><section className="border border-[#d6dcda] bg-white px-4 py-4"><h4 className="text-[10px] font-black uppercase tracking-[0.11em] text-[#626c68]">Never do this</h4><ul className="mt-3 space-y-2.5">{module.neverDo.map((item) => <li key={item} className="flex gap-2 text-[10px] leading-4 text-[#6a4d48]"><span className="mt-1 h-2 w-2 shrink-0 bg-[#c85b4d]" />{item}</li>)}</ul></section></div>
      {activity.evidencePrompt ? <EvidenceEditor prompt={activity.evidencePrompt} criteria={activity.acceptanceCriteria ?? []} evidence={evidence} onChange={onEvidenceChange} onBlur={onEvidenceCommit} /> : null}
      {activity.check ? <KnowledgeCheck check={activity.check} selected={selectedAnswer} checked={answerChecked} onSelect={onAnswerSelect} onCheck={onAnswerCheck} /> : null}
      {showConfidence ? <Confidence moduleId={module.id} value={progress.confidence[module.id] ?? 0} onChange={onConfidence} /> : null}
    </article>
  );
}

function OperatorActivityFooter({ module, activity, activityIndex, evidence, evidenceReady, complete, unlocked, canComplete, onSelect, onComplete }: { module: OperatorModule; activity: OperatorActivity; activityIndex: number; evidence: string; evidenceReady: boolean; complete: boolean; unlocked: boolean; canComplete: boolean; onSelect: (module: OperatorModule, activity: OperatorActivity) => void; onComplete: (module: OperatorModule, activity: OperatorActivity) => void }) {
  return <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dfdc] bg-white px-5 py-4 sm:px-7 md:px-9"><button type="button" disabled={activityIndex === 0} onClick={() => onSelect(module, module.activities[activityIndex - 1])} className="inline-flex h-10 items-center gap-2 border border-[#d0d8d5] px-3.5 text-[10px] font-black text-[#626c68] disabled:invisible"><ArrowLeft size={13} aria-hidden="true" />Previous</button><div className="text-[9px] font-bold text-[#7a837f]">{operatorFooterMessage(activity, evidence, evidenceReady, complete)}</div><button type="button" disabled={!unlocked || !canComplete} onClick={() => onComplete(module, activity)} className="inline-flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[10px] font-black text-white disabled:bg-[#aab5b1]">{complete ? <Check size={14} aria-hidden="true" /> : null}{complete ? "Continue" : "Record and continue"}<ArrowRight size={14} aria-hidden="true" /></button></footer>;
}

function operatorFooterMessage(activity: OperatorActivity, evidence: string, evidenceReady: boolean, complete: boolean) {
  if (activity.evidencePrompt && !evidenceReady) return `${Math.min(80, evidence.trim().length)}/80 evidence characters required`;
  return complete ? "Completion recorded" : "Complete the work before continuing";
}

function EvidenceEditor({ prompt, criteria, evidence, onChange, onBlur }: { prompt: string; criteria: readonly string[]; evidence: string; onChange: (value: string) => void; onBlur: () => void }) {
  return <section className="mt-5 border border-[#d8ccb2] bg-[#fffaf0] px-5 py-5"><h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.11em] text-[#805b19]"><ClipboardCheck size={15} aria-hidden="true" /> Practice evidence</h4><p className="mt-2 text-[12px] font-bold leading-5 text-[#5e5138]">{prompt}</p><p className="mt-2 text-[10px] leading-4 text-[#8a7752]">Use synthetic examples only. Never enter names, DOBs, packet text, document names, credentials, meeting links, or production identifiers.</p><textarea value={evidence} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} maxLength={4000} rows={6} placeholder="Explain the workflow in your own words using a synthetic example." className="mt-4 w-full resize-y border border-[#cfc1a5] bg-white px-3.5 py-3 text-[12px] leading-5 outline-none focus:border-[#9b6a16]" /><ul className="mt-3 grid gap-2 md:grid-cols-2">{criteria.map((criterion) => <li key={criterion} className="flex gap-2 text-[10px] leading-4 text-[#65583e]"><Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{criterion}</li>)}</ul></section>;
}

function KnowledgeCheck({ check, selected, checked, onSelect, onCheck }: { check: NonNullable<OperatorActivity["check"]>; selected: number | null; checked: boolean; onSelect: (value: number) => void; onCheck: () => void }) {
  const correct = selected === check.answer;
  return <section className="mt-5 border border-[#cfdad6] bg-[#f7faf9] px-5 py-5"><div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#176b78]">Knowledge check</div><h4 className="mt-2 text-[17px] font-black leading-6 text-[#202623]">{check.prompt}</h4><div className="mt-4 grid gap-2">{check.options.map((option, index) => { const isSelected = selected === index; const showCorrect = checked && index === check.answer; const showWrong = checked && isSelected && !correct; return <button key={option} type="button" onClick={() => onSelect(index)} className={`grid min-h-[48px] grid-cols-[28px_minmax(0,1fr)] items-center gap-3 border px-3 py-2.5 text-left text-[11px] font-bold ${showCorrect ? "border-[#0f8b73] bg-[#eaf6f1] text-[#0c5f50]" : showWrong ? "border-[#c85b4d] bg-[#fff0ed] text-[#943c32]" : isSelected ? "border-[#27889a] bg-[#edf8fa] text-[#176b78]" : "border-[#d3dad8] bg-white text-[#4d5552] hover:border-[#9eb2ab]"}`}><span className="flex h-6 w-6 items-center justify-center border border-current text-[9px] font-black">{String.fromCharCode(65 + index)}</span>{option}</button>; })}</div><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={selected === null} onClick={onCheck} className="h-10 bg-[#176b78] px-4 text-[10px] font-black text-white disabled:opacity-40">Check answer</button>{checked ? <p role="status" className={`max-w-[650px] text-[10px] font-bold leading-5 ${correct ? "text-[#0c705f]" : "text-[#a04436]"}`}><span className="font-black">{correct ? "Correct. " : "Not yet. "}</span>{check.explanation}</p> : null}</div></section>;
}

function Confidence({ moduleId, value, onChange }: { moduleId: string; value: number; onChange: (moduleId: string, value: number) => void }) {
  return <section className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-[#cddbd6] bg-[#f2f8f6] px-5 py-4"><div><h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em] text-[#0c705f]"><ShieldCheck size={14} aria-hidden="true" /> Confidence check</h4><p className="mt-1 text-[10px] text-[#66716d]">Rate your ability to perform this without coaching. Certification expects 4 or 5.</p></div><div className="flex gap-1" role="radiogroup" aria-label="Module confidence">{[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" role="radio" aria-checked={value === score} onClick={() => onChange(moduleId, score)} className={`h-9 w-9 border text-[10px] font-black ${value === score ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#bdcbc6] bg-white text-[#68726e]"}`}>{score}</button>)}</div></section>;
}

function activityLabel(kind: OperatorActivity["kind"]) { if (kind === "briefing") return "Learn"; if (kind === "guided-practice") return "Walkthrough"; if (kind === "scenario") return "Practice"; return "Verify"; }
function activityIcon(kind: OperatorActivity["kind"]) { if (kind === "briefing") return <BookOpen size={14} aria-hidden="true" />; if (kind === "guided-practice") return <Eye size={14} aria-hidden="true" />; if (kind === "scenario") return <Footprints size={14} aria-hidden="true" />; return <ClipboardCheck size={14} aria-hidden="true" />; }

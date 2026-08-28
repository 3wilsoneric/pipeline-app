"use client";

import { AlertTriangle, Check, ChevronRight, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { scenariosForRole } from "@/lib/training/operator-training-resources";
import type { OperatorTrainingProgress } from "@/lib/training/operator-training-progress-contract";
import type { OperatorScenario } from "@/lib/training/operator-training-types";

export default function OperatorPracticeLab({
  progress,
  onAttempt,
}: {
  progress: OperatorTrainingProgress;
  onAttempt: (scenarioId: string, passed: boolean) => void;
}) {
  const scenarios = scenariosForRole(progress.role);
  const [activeId, setActiveId] = useState(scenarios[0]?.id ?? "");
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const active = scenarios.find((scenario) => scenario.id === activeId) ?? scenarios[0];
  if (!active) return null;
  const correctIndex = active.choices.findIndex((choice) => choice.safe);
  const passed = progress.scenarioResults[active.id]?.passed ?? false;

  const chooseScenario = (id: string) => {
    setActiveId(id);
    setSelected(null);
    setChecked(false);
  };

  return (
    <div className="grid min-h-[660px] overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[320px_minmax(0,1fr)]">
      <ScenarioRail scenarios={scenarios} active={active} progress={progress} onSelect={chooseScenario} />
      <ScenarioWorkspace active={active} progress={progress} selected={selected} checked={checked} correctIndex={correctIndex} passed={passed} onSelect={(index) => { setSelected(index); setChecked(false); }} onReset={() => { setSelected(null); setChecked(false); }} onCheck={() => { const safe = selected === correctIndex; setChecked(true); onAttempt(active.id, safe); }} />
    </div>
  );
}

function ScenarioRail({ scenarios, active, progress, onSelect }: { scenarios: readonly OperatorScenario[]; active: OperatorScenario; progress: OperatorTrainingProgress; onSelect: (id: string) => void }) {
  return <aside className="border-b border-[#d7dfdc] bg-[#f3f6f5] lg:border-b-0 lg:border-r"><div className="border-b border-[#d7dfdc] px-4 py-4"><h2 className="text-[13px] font-black text-[#202724]">Decision practice</h2><p className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#7b8481]">Synthetic cases · no PHI</p></div><nav aria-label="Practice scenarios" className="max-h-[620px] overflow-y-auto p-2">{scenarios.map((scenario, index) => { const isActive = scenario.id === active.id; const result = progress.scenarioResults[scenario.id]; return <button key={scenario.id} type="button" onClick={() => onSelect(scenario.id)} className={`mb-1 grid min-h-[58px] w-full grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-2 border-l-[3px] px-2.5 py-2 text-left ${isActive ? "border-l-[#0f8b73] bg-white" : "border-l-transparent hover:bg-white/70"}`}><span className={`flex h-7 w-7 items-center justify-center border text-[9px] font-black ${result?.passed ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#cbd4d1] bg-white text-[#65706c]"}`}>{result?.passed ? <Check size={13} aria-hidden="true" /> : index + 1}</span><span className="min-w-0"><span className="block text-[10px] font-black leading-4 text-[#29312e]">{scenario.title}</span><span className="mt-0.5 block text-[8px] font-bold uppercase tracking-[0.07em] text-[#88918d]">{scenario.domain} · {scenario.risk}</span></span><ChevronRight size={13} className={isActive ? "text-[#0f8b73]" : "text-[#a0a8a5]"} aria-hidden="true" /></button>; })}</nav></aside>;
}

function ScenarioWorkspace({ active, progress, selected, checked, correctIndex, passed, onSelect, onReset, onCheck }: { active: OperatorScenario; progress: OperatorTrainingProgress; selected: number | null; checked: boolean; correctIndex: number; passed: boolean; onSelect: (index: number) => void; onReset: () => void; onCheck: () => void }) {
  const decisionIsSafe = selected === correctIndex;
  return <main className="min-w-0 bg-[#fbfcfb]"><header className="border-b border-[#d8dfdc] bg-white px-5 py-5 sm:px-8"><div className="flex flex-wrap items-center justify-between gap-3"><span className={`border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.09em] ${riskClassName(active.risk)}`}>{active.risk} scenario</span>{passed ? <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.08em] text-[#0c705f]"><ShieldCheck size={14} aria-hidden="true" /> Passed</span> : null}</div><h2 className="mt-3 text-[26px] font-black tracking-[-0.035em] text-[#171a18]">{active.title}</h2><p className="mt-2 max-w-[800px] text-[13px] leading-6 text-[#59635f]">{active.prompt}</p></header><div className="px-5 py-6 sm:px-8"><section className="border border-[#d5ddda] bg-white px-5 py-4"><h3 className="text-[10px] font-black uppercase tracking-[0.11em] text-[#5b6561]">What you know</h3><ul className="mt-3 grid gap-2 sm:grid-cols-2">{active.context.map((item) => <li key={item} className="flex gap-2 text-[11px] leading-5 text-[#515b57]"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-[#27889a]" />{item}</li>)}</ul></section><section className="mt-5"><h3 className="text-[10px] font-black uppercase tracking-[0.11em] text-[#5b6561]">Choose the safest next action</h3><div className="mt-3 grid gap-2">{active.choices.map((choice, index) => <ScenarioChoice key={choice.label} choice={choice} index={index} selected={selected} checked={checked} correctIndex={correctIndex} onSelect={onSelect} />)}</div></section>{checked ? <ScenarioDebrief active={active} decisionIsSafe={decisionIsSafe} /> : null}</div><footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dfdc] bg-white px-5 py-4 sm:px-8"><span className="text-[9px] font-bold text-[#7a837f]">Attempts: {progress.scenarioResults[active.id]?.attempts ?? 0}</span><div className="flex gap-2"><button type="button" onClick={onReset} className="inline-flex h-10 items-center gap-2 border border-[#d0d8d5] px-3 text-[10px] font-black text-[#65706c]"><RotateCcw size={13} aria-hidden="true" /> Reset</button><button type="button" disabled={selected === null} onClick={onCheck} className="h-10 bg-[#0f8b73] px-5 text-[10px] font-black text-white disabled:bg-[#aab5b1]">Check decision</button></div></footer></main>;
}

function ScenarioChoice({ choice, index, selected, checked, correctIndex, onSelect }: { choice: OperatorScenario["choices"][number]; index: number; selected: number | null; checked: boolean; correctIndex: number; onSelect: (index: number) => void }) {
  const chosen = selected === index;
  const correct = checked && index === correctIndex;
  const wrong = checked && chosen && !choice.safe;
  const showRationale = checked && (chosen || correct);
  const className = correct ? "border-[#0f8b73] bg-[#eaf6f1]" : wrong ? "border-[#c85b4d] bg-[#fff0ed]" : chosen ? "border-[#27889a] bg-[#edf8fa]" : "border-[#d2dad7] bg-white hover:border-[#9eb3ac]";
  return <button type="button" onClick={() => onSelect(index)} className={`grid min-h-[58px] grid-cols-[32px_minmax(0,1fr)] items-center gap-3 border px-4 py-3 text-left ${className}`}><span className="flex h-7 w-7 items-center justify-center border border-current text-[10px] font-black">{String.fromCharCode(65 + index)}</span><span><span className="block text-[11px] font-black text-[#2b322f]">{choice.label}</span>{showRationale ? <span className="mt-1 block text-[10px] leading-4 text-[#616b67]">{choice.rationale}</span> : null}</span></button>;
}

function ScenarioDebrief({ active, decisionIsSafe }: { active: OperatorScenario; decisionIsSafe: boolean }) {
  const Icon = decisionIsSafe ? ShieldCheck : AlertTriangle;
  return <section role="status" className={`mt-5 border px-5 py-4 ${decisionIsSafe ? "border-[#afd0c5] bg-[#f0f8f5]" : "border-[#e0b6af] bg-[#fff5f3]"}`}><h3 className={`flex items-center gap-2 text-[11px] font-black ${decisionIsSafe ? "text-[#0c705f]" : "text-[#a04436]"}`}><Icon size={16} aria-hidden="true" />{decisionIsSafe ? "Safe decision" : "Review the control and try again"}</h3><ul className="mt-3 space-y-2">{active.debrief.map((item) => <li key={item} className="text-[10px] leading-5 text-[#56605c]">{item}</li>)}</ul></section>;
}

function riskClassName(risk: OperatorScenario["risk"]) {
  if (risk === "critical") return "border-[#e0aaa2] bg-[#fff1ef] text-[#9e4035]";
  if (risk === "important") return "border-[#dfca97] bg-[#fff8e8] text-[#825a10]";
  return "border-[#c5d7d1] bg-[#f2f8f6] text-[#4f625b]";
}

"use client";

import { ArrowRight, Check, Compass, MapPinned, MessageCircleQuestion, ShieldCheck } from "lucide-react";

import { guidedTutorialsForRole } from "@/lib/training/operator-guided-tutorials";
import { dispatchOperatorGuide } from "@/lib/training/operator-guided-tour-state";
import type { OperatorTrainingProgress } from "@/lib/training/operator-training-progress-contract";

export default function OperatorGuidedTours({ progress }: { progress: OperatorTrainingProgress }) {
  const tutorials = guidedTutorialsForRole(progress.role);
  const completed = tutorials.filter((tutorial) => progress.tutorialResults[tutorial.id]?.status === "completed").length;
  return (
    <section className="border border-[#cbd5d1] bg-white">
      <header className="grid gap-5 border-b border-[#d8dfdc] px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
        <div><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.11em] text-[#0c705f]"><Compass size={14} aria-hidden="true" /> Guided workflows</div><h2 className="mt-2 text-[25px] font-black tracking-[-0.03em] text-[#191d1b]">Practice the work by doing it.</h2><p className="mt-2 max-w-[780px] text-[11px] leading-5 text-[#66716d]">Each deterministic path starts with an operator objective, verifies safe UI actions, and ends at a human commit boundary. The coach never reads field values or clicks create, schedule, sign, decide, export, or handoff for you.</p></div>
        <div className="border border-[#bcd2cb] bg-[#f0f7f4] px-5 py-4"><div className="text-[24px] font-black text-[#173e34]">{completed} / {tutorials.length}</div><div className="mt-1 text-[9px] font-black uppercase tracking-[0.1em] text-[#5d756d]">role tours complete</div></div>
      </header>
      <div className="grid gap-px bg-[#d8dfdc] md:grid-cols-2 xl:grid-cols-4">
        {tutorials.map((tutorial) => {
          const result = progress.tutorialResults[tutorial.id];
          const done = result?.status === "completed";
          return (
            <article key={tutorial.id} className="flex min-h-[290px] flex-col bg-white p-5">
              <div className="flex items-start justify-between gap-3"><span className={`flex h-10 w-10 items-center justify-center border ${done ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#b9d1c9] bg-[#eef7f4] text-[#0c705f]"}`}>{done ? <Check size={18} aria-hidden="true" /> : <MapPinned size={18} aria-hidden="true" />}</span><span className="text-[8px] font-black uppercase tracking-[0.09em] text-[#818b87]">{tutorial.steps.length} actions · {tutorial.minutes} min</span></div>
              <div className="mt-4 text-[8px] font-black uppercase tracking-[0.1em] text-[#0c705f]">{tutorial.workflow}</div>
              <h3 className="mt-1 text-[16px] font-black leading-5 text-[#222825]">{tutorial.title}</h3><p className="mt-2 text-[10px] leading-5 text-[#65706c]">{tutorial.summary}</p>
              <div className="mt-4 border-l-2 border-[#176b78] bg-[#f1f8f9] px-3 py-2 text-[9px] font-bold leading-4 text-[#315e66]">Outcome: {tutorial.outcome}</div>
              <button type="button" onClick={() => dispatchOperatorGuide({ type: "start", tutorialId: tutorial.id })} className="group mt-auto flex h-10 items-center justify-between bg-[#111111] px-3 text-[9px] font-black text-white hover:bg-[#0f8b73]"><span className="flex items-center gap-2"><MessageCircleQuestion size={13} aria-hidden="true" />{done ? "Practice again" : result ? "Resume guided practice" : "Start guided practice"}</span><ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></button>
            </article>
          );
        })}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dfdc] bg-[#f8faf9] px-5 py-4 sm:px-7"><span className="flex items-center gap-2 text-[9px] font-bold text-[#68736f]"><ShieldCheck size={13} className="text-[#0f8b73]" aria-hidden="true" />The guide verifies interaction events, never field contents. Use synthetic records for practice.</span><button type="button" onClick={() => dispatchOperatorGuide({ type: "open-library" })} className="text-[9px] font-black uppercase tracking-[0.08em] text-[#0c705f] hover:underline">Open workflow library</button></footer>
    </section>
  );
}

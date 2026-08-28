"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, GitBranch } from "lucide-react";
import { useState } from "react";

import { academyJourneys } from "@/lib/academy/academy-journeys";
import { getAcademyModule } from "@/lib/academy/academy-curriculum";

export default function AcademyJourneyLibrary({ onOpenModule }: { onOpenModule: (moduleId: string) => void }) {
  const [activeJourneyId, setActiveJourneyId] = useState(academyJourneys[0].id);
  const activeJourney = academyJourneys.find((journey) => journey.id === activeJourneyId) ?? academyJourneys[0];

  return (
    <section aria-labelledby="academy-journeys-title" className="space-y-5">
      <header className="border-b border-[#d6dfdc] pb-5">
        <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[#176b78]">Golden execution paths</div>
        <h2 id="academy-journeys-title" className="mt-1.5 text-[28px] font-semibold tracking-[-0.035em] text-[#151817]">Journey library</h2>
        <p className="mt-2 max-w-[760px] text-[13px] leading-6 text-[#5f6865]">
          Learn the repository through the product paths operators depend on. Every step names its runtime, implementation owner, and invariant.
        </p>
      </header>

      <div className="grid min-h-[620px] overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Golden journeys" className="border-b border-[#d8dfdd] bg-[#f4f6f5] p-2 lg:border-b-0 lg:border-r">
          {academyJourneys.map((journey, index) => (
            <button
              key={journey.id}
              type="button"
              onClick={() => setActiveJourneyId(journey.id)}
              aria-current={journey.id === activeJourney.id ? "page" : undefined}
              className={`mb-1 grid min-h-[62px] w-full grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5 border-l-[3px] px-3 py-2 text-left ${journey.id === activeJourney.id ? "border-l-[#176b78] bg-white text-[#17211e] shadow-[0_2px_8px_rgba(20,50,42,0.06)]" : "border-l-transparent text-[#5f6965] hover:bg-white/70"}`}
            >
              <span className={`flex h-7 w-7 items-center justify-center border text-[10px] font-black ${journey.id === activeJourney.id ? "border-[#7cb3bd] bg-[#edf8fa] text-[#176b78]" : "border-[#d4dbd9] bg-white text-[#7b8480]"}`}>{index + 1}</span>
              <span className="text-[11px] font-black leading-4">{journey.title}</span>
            </button>
          ))}
        </nav>

        <article className="min-w-0 px-5 py-6 sm:px-7 md:px-9">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#176b78]"><GitBranch size={14} aria-hidden="true" /> Journey contract</div>
          <h3 className="mt-2 text-[25px] font-black tracking-[-0.03em] text-[#151817]">{activeJourney.title}</h3>
          <div className="mt-5 grid gap-px overflow-hidden border border-[#d6ddda] bg-[#d6ddda] md:grid-cols-2">
            <JourneyFact label="Trigger" value={activeJourney.trigger} />
            <JourneyFact label="Proven outcome" value={activeJourney.outcome} />
          </div>

          <ol className="mt-7 space-y-0">
            {activeJourney.steps.map((step, index) => (
              <li key={`${activeJourney.id}:${step.label}`} className="relative grid grid-cols-[34px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
                {index < activeJourney.steps.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[16px] top-8 w-px bg-[#b8c9c3]" /> : null}
                <span className="relative z-10 flex h-8 w-8 items-center justify-center border border-[#8bb5aa] bg-[#eef7f4] text-[10px] font-black text-[#0c705f]">{index + 1}</span>
                <div className="border border-[#d7dedb] bg-[#fbfcfb] px-4 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-[13px] font-black text-[#242a27]">{step.label}</h4>
                      <p className="mt-1 text-[10px] font-bold text-[#6d7773]">{step.owner} · {step.runtime}</p>
                    </div>
                    <code className="max-w-full break-all border border-[#d7e3df] bg-white px-2 py-1 font-mono text-[9px] text-[#2e5c50]">{step.source}</code>
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-[#e1e6e4] pt-3 text-[11px] leading-5 text-[#4e5955]"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[#0f8b73]" aria-hidden="true" /><span>{step.invariant}</span></div>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-7 border-l-[3px] border-l-[#d28d37] bg-[#fff8eb] px-4 py-3.5">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.11em] text-[#85570f]"><AlertTriangle size={14} aria-hidden="true" /> Failure question</div>
            <p className="mt-1.5 text-[12px] font-bold leading-5 text-[#5e4b2d]">{activeJourney.failureQuestion}</p>
          </div>

          <div className="mt-6">
            <div className="text-[10px] font-black uppercase tracking-[0.11em] text-[#707a76]">Required modules</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeJourney.moduleIds.map((moduleId) => {
                const academyModule = getAcademyModule(moduleId);
                return academyModule ? (
                  <button key={moduleId} type="button" onClick={() => onOpenModule(moduleId)} className="inline-flex items-center gap-2 border border-[#bad5cc] bg-[#f2f8f5] px-3 py-2 text-[10px] font-black text-[#0c705f] hover:border-[#0f8b73]">
                    {academyModule.number}. {academyModule.title}<ArrowRight size={13} aria-hidden="true" />
                  </button>
                ) : null;
              })}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function JourneyFact({ label, value }: { label: string; value: string }) {
  return <div className="bg-white px-4 py-4"><div className="text-[9px] font-black uppercase tracking-[0.11em] text-[#7b8581]">{label}</div><p className="mt-1.5 text-[12px] font-bold leading-5 text-[#3f4945]">{value}</p></div>;
}

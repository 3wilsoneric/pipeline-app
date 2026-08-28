"use client";

import { AlertTriangle, ArrowUpRight, CheckSquare2, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { jobAidsForRole } from "@/lib/training/operator-training-resources";
import type { OperatorRole } from "@/lib/training/operator-training-types";

export default function OperatorJobAids({ role }: { role: OperatorRole }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const aids = jobAidsForRole(role).filter((aid) => !deferredQuery || `${aid.title} ${aid.whenToUse} ${aid.steps.join(" ")}`.toLowerCase().includes(deferredQuery));
  return (
    <section className="border border-[#cbd5d1] bg-white">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d8dfdc] px-5 py-5 sm:px-7">
        <div><h2 className="text-[22px] font-black tracking-[-0.025em] text-[#191d1b]">Job aids</h2><p className="mt-1 text-[11px] leading-5 text-[#69736f]">Current checklists for work you perform under pressure. Stop conditions are controls, not inconveniences.</p></div>
        <label className="flex h-10 min-w-[260px] items-center gap-2 border border-[#cbd5d1] bg-[#f8faf9] px-3"><Search size={14} className="text-[#6e7874]" aria-hidden="true" /><span className="sr-only">Search job aids</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search job aids" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" /></label>
      </header>
      <div className="grid gap-px bg-[#d8dfdc] md:grid-cols-2 xl:grid-cols-3">
        {aids.map((aid) => (
          <article key={aid.id} className="flex min-h-[330px] flex-col bg-white p-5">
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-[15px] font-black text-[#202623]">{aid.title}</h3><p className="mt-1 text-[10px] leading-4 text-[#6d7672]">{aid.whenToUse}</p></div><CheckSquare2 size={18} className="shrink-0 text-[#0f8b73]" aria-hidden="true" /></div>
            <ol className="mt-4 space-y-2.5">{aid.steps.map((step, index) => <li key={step} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 text-[10px] leading-4 text-[#4f5955]"><span className="flex h-5 w-5 items-center justify-center border border-[#b9d2ca] bg-[#eff7f4] text-[8px] font-black text-[#0c705f]">{index + 1}</span>{step}</li>)}</ol>
            <div className="mt-5 border-l-[3px] border-l-[#c85b4d] bg-[#fff5f3] px-3 py-2.5"><div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.09em] text-[#9e4035]"><AlertTriangle size={11} aria-hidden="true" /> Stop and escalate</div><p className="mt-1 text-[9px] leading-4 text-[#76504a]">{aid.stopAndEscalate.join(" · ")}</p></div>
            <a href={aid.location.href} className="mt-auto inline-flex h-10 items-center justify-center gap-2 border border-[#9fc3b8] bg-[#f1f8f5] px-3 text-[9px] font-black uppercase tracking-[0.08em] text-[#0c705f] hover:bg-[#e5f3ee]">Open {aid.location.label}<ArrowUpRight size={12} aria-hidden="true" /></a>
          </article>
        ))}
      </div>
      {!aids.length ? <div className="px-6 py-16 text-center text-[11px] text-[#737d79]">No job aids match that search.</div> : null}
    </section>
  );
}

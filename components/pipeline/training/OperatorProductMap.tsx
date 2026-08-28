"use client";

import { ArrowDown, ArrowUpRight } from "lucide-react";

import { operatorCapabilities } from "@/lib/training/operator-training-resources";

export default function OperatorProductMap({ onOpenModule }: { onOpenModule: (moduleId: string) => void }) {
  return (
    <section className="border border-[#cbd5d1] bg-white">
      <header className="border-b border-[#d8dfdc] px-5 py-5 sm:px-7"><h2 className="text-[22px] font-black tracking-[-0.025em] text-[#191d1b]">Product map</h2><p className="mt-1 max-w-[850px] text-[11px] leading-5 text-[#69736f]">Pipeline is one connected workflow. This map shows what each surface owns, what feeds it, and what it produces.</p></header>
      <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-7">
        {operatorCapabilities.map((capability, index) => (
          <div key={capability.id}>
            <article className="grid gap-4 border border-[#d3dcd8] bg-[#fbfcfb] px-5 py-4 md:grid-cols-[170px_minmax(0,1fr)_220px] md:items-center">
              <div><div className="text-[8px] font-black uppercase tracking-[0.1em] text-[#0c705f]">{capability.owner}</div><h3 className="mt-1 text-[15px] font-black text-[#222825]">{capability.title}</h3></div>
              <div><p className="text-[11px] leading-5 text-[#59635f]">{capability.purpose}</p><div className="mt-2 text-[8px] font-bold uppercase tracking-[0.08em] text-[#8a928f]">Inputs: {capability.upstream.length ? capability.upstream.join(" · ") : "Inbound work"} / Outputs: {capability.downstream.length ? capability.downstream.join(" · ") : "Governed view"}</div></div>
              <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => onOpenModule(capability.moduleIds[0])} className="h-9 border border-[#cbd5d1] bg-white px-3 text-[9px] font-black text-[#56615d]">Learn this surface</button><a href={capability.location.href} className="inline-flex h-9 items-center gap-1.5 bg-[#0f8b73] px-3 text-[9px] font-black text-white">Open<ArrowUpRight size={11} aria-hidden="true" /></a></div>
            </article>
            {index < operatorCapabilities.length - 1 ? <div className="flex h-8 items-center justify-center"><ArrowDown size={15} className="text-[#86a89d]" aria-hidden="true" /></div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

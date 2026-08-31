"use client";

import { ArrowRight, FlaskConical, Presentation, ShieldCheck } from "lucide-react";

import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function OperatorDemoEntry({ demoUrl }: { demoUrl: string | null }) {
  const destination = demoUrl?.startsWith("/") ? toPipelinePath(demoUrl) : demoUrl;
  return (
    <section className="overflow-hidden border border-[#cbd5d1] bg-white">
      <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
        <div className="flex flex-col justify-center px-6 py-10 sm:px-9 lg:px-12">
          <span className="flex h-11 w-11 items-center justify-center border border-[#a9c9be] bg-[#edf7f3] text-[#0c705f]"><Presentation size={20} /></span>
          <div className="mt-6 text-[9px] font-black uppercase tracking-[0.12em] text-[#0c705f]">Demo environment</div>
          <h2 className="mt-2 max-w-[720px] text-[27px] font-semibold tracking-[-0.035em] text-[#171b19]">Assessment walkthrough and practice</h2>
          <p className="mt-3 max-w-[720px] text-[12px] leading-6 text-[#5b6662]">Learn the assessment workflow and practice with synthetic referrals.</p>
          {destination ? (
            <a href={destination} className="mt-7 inline-flex h-11 w-fit items-center gap-3 bg-[#0f8b73] px-5 text-[10px] font-black text-white hover:bg-[#0b6d5b]">Open Demo Center <ArrowRight size={14} /></a>
          ) : (
            <div className="mt-7 w-fit border border-[#dfca97] bg-[#fff8e8] px-4 py-3 text-[10px] font-bold text-[#765817]">A separate demo deployment has not been connected to this environment yet.</div>
          )}
        </div>
        <div className="border-t border-[#d8dfdc] bg-[#eff4f2] p-6 sm:p-8 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.1em] text-[#0c705f]"><FlaskConical size={13} /> Includes</div>
          <div className="mt-5 divide-y divide-[#d1dad6] border-y border-[#d1dad6]">
            {[
              "Five assessment steps",
              "Four synthetic practice cases",
              "The complete assessment questionnaire",
              "Field-level writing guidance",
            ].map((item) => <div key={item} className="flex gap-3 py-4 text-[11px] font-bold leading-5 text-[#45504b]"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#0f8b73]" />{item}</div>)}
          </div>
          <p className="mt-5 text-[9px] leading-4 text-[#6d7773]">The dedicated deployment must use isolated storage and normal authentication. Training never elevates production permissions.</p>
        </div>
      </div>
    </section>
  );
}

"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function OperatorDemoEntry() {
  return (
    <section aria-labelledby="pipeline-walkthrough-title">
      <Link
        href={toPipelinePath("/training/demo")}
        aria-label="Open Assessor's Workshop presentation"
        data-learning-presentation-entry="true"
        className="group grid min-h-[220px] gap-7 border border-[#9fbeb4] bg-[#e8f3ef] p-6 outline-none hover:border-[#4f8f7c] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-9"
      >
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#0f7c68]">Presentation</div>
          <h2 id="pipeline-walkthrough-title" className="mt-3 text-[30px] font-semibold leading-9 tracking-[-0.03em] text-[#18372f] sm:text-[38px] sm:leading-[42px]">Assessor&apos;s Workshop</h2>
          <p className="mt-3 max-w-[760px] text-[16px] font-medium leading-6 text-[#4e6860]">See the referral and assessment flow, then work on your own assigned referral in Pipeline.</p>
        </div>
        <div className="flex items-center gap-4 border-t border-[#bcd0c9] pt-5 text-[14px] font-black text-[#315a4f] lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <span>Start presentation</span>
          <ArrowRight size={22} className="shrink-0 text-[#0f7c68] transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </div>
      </Link>
    </section>
  );
}

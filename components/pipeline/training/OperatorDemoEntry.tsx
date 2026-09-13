"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function OperatorDemoEntry({ demoUrl }: { demoUrl: string | null }) {
  const destination = demoUrl?.startsWith("/") ? toPipelinePath(demoUrl) : demoUrl;

  if (!destination) {
    return (
      <section className="border border-[#d8dfdc] bg-white px-6 py-7" aria-labelledby="pipeline-walkthrough-title">
        <h2 id="pipeline-walkthrough-title" className="text-[24px] font-semibold text-[#202623]">Pipeline walkthrough</h2>
        <p className="mt-2 text-[13px] text-[#68736f]">The presentation is not available in this environment.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="pipeline-walkthrough-title">
      <Link
        href={destination}
        aria-label="Open Pipeline walkthrough presentation"
        data-learning-presentation-entry="true"
        className="group grid min-h-[220px] gap-7 border border-[#9fbeb4] bg-[#e8f3ef] p-6 outline-none hover:border-[#4f8f7c] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-9"
      >
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#0f7c68]">Moving from Allo · Supervisor-led orientation</div>
          <h2 id="pipeline-walkthrough-title" className="mt-3 text-[30px] font-semibold leading-9 tracking-[-0.03em] text-[#18372f] sm:text-[38px] sm:leading-[42px]">Assessor orientation</h2>
          <p className="mt-3 max-w-[760px] text-[16px] font-medium leading-6 text-[#4e6860]">Find an assigned referral, review its packet, schedule the interview, and return to a saved assessment. Follow the screens through submittal and the supervisor’s decision.</p>
          <p className="mt-3 text-[13px] font-semibold text-[#4e6860]">Full-screen presentation · Enlargeable screenshots · Optional hands-on walkthroughs</p>
        </div>
        <div className="flex items-center gap-4 border-t border-[#bcd0c9] pt-5 text-[14px] font-black text-[#315a4f] lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <span>Open presentation</span>
          <ArrowRight size={22} className="shrink-0 text-[#0f7c68] transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </div>
      </Link>
    </section>
  );
}

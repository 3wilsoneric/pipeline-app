"use client";

import { AlertTriangle, Check, Circle } from "lucide-react";

import type {
  ReferralProgress,
  ReferralProgressItem,
} from "@/lib/pipeline/referral-progress";

export default function ReferralProgressPanel({
  progress,
  loading = false,
  compact = false,
}: {
  progress: ReferralProgress | null;
  loading?: boolean;
  compact?: boolean;
}) {
  if (loading) {
    if (compact) {
      return <div className="flex min-h-8 items-center gap-2 border-b border-[#d9d9d9] px-2 py-1.5 text-[10px] text-[#737373]">Loading status...</div>;
    }
    return <div className="border-y border-[#d9d9d9] px-5 py-6 text-[12px] text-[#737373]">Loading client progress...</div>;
  }

  if (!progress) {
    if (compact) {
      return <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#d9d9d9] px-2 py-1.5"><span className="text-[10px] text-[#737373]">Save this referral to start tracking completion.</span></div>;
    }
    return (
      <div className="border-y border-[#d9d9d9] px-5 py-6">
        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[#0c705f]">Client progress</div>
        <p className="mt-2 text-[13px] text-[#737373]">Save this referral to start tracking what is complete and what still needs attention.</p>
      </div>
    );
  }

  if (compact) {
    return (
      <section aria-label="Client progress" className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[#d9d9d9] px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
          <strong className="font-black capitalize text-[#111111]">{progress.phase} phase</strong>
          <span className="text-[#737373]">·</span>
          <span className="text-[#737373]">{progress.overall.complete}/{progress.overall.total} workflow items</span>
        </div>
        {progress.next_action ? <span className="text-[10px] text-[#5f4a18]">Next: {progress.next_action}</span> : null}
      </section>
    );
  }

  return (
    <section aria-label="Client progress" className="border-y border-[#d9d9d9] bg-white">
      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-7">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[#0c705f]">Client progress</div>
          <div className="mt-3 flex items-end gap-2">
            <span className="text-[44px] font-black leading-none text-[#111111]">{progress.overall.percent}%</span>
            <span className="pb-1 text-[11px] text-[#737373]">complete</span>
          </div>
          <div className="mt-3 h-2 bg-[#e4e8e3]">
            <div className="h-full bg-[#0f8b73]" style={{ width: `${progress.overall.percent}%` }} />
          </div>
          <div className="mt-2 text-[11px] text-[#737373]">{progress.overall.complete} of {progress.overall.total} tracked items</div>
          <div className="mt-5 border-l-2 border-[#0f8b73] px-3 py-1">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#737373]">Current phase</div>
            <div className="mt-1 text-[13px] font-black capitalize text-[#111111]">{progress.phase}</div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {progress.sections.map((section) => (
            <div key={section.key} className="border border-[#d9d9d9] px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[12px] font-black text-[#111111]">{section.label}</div>
                <div className="text-[11px] font-black text-[#0f8b73]">{section.complete}/{section.total}</div>
              </div>
              <div className="mt-3 h-1.5 bg-[#e4e8e3]">
                <div className="h-full bg-[#0f8b73]" style={{ width: `${section.percent}%` }} />
              </div>
              <div className="mt-3 space-y-2">
                {section.items.slice(0, 4).map((item) => <ProgressItem key={item.key} item={item} />)}
                {section.items.length > 4 ? <div className="text-[10px] text-[#737373]">+ {section.items.length - 4} more tracked items</div> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {progress.next_action ? (
        <div className="border-t border-[#d9d9d9] bg-[#fff9e8] px-5 py-3 text-[12px] text-[#5f4a18] lg:px-7">
          <span className="font-black">Next action:</span> {progress.next_action}
        </div>
      ) : (
        <div className="border-t border-[#d9d9d9] bg-[#effaf5] px-5 py-3 text-[12px] font-semibold text-[#176149] lg:px-7">No blocking items are currently recorded.</div>
      )}
    </section>
  );
}

function ProgressItem({ item }: { item: ReferralProgressItem }) {
  const attention = item.status === "attention";
  const complete = item.status === "complete";
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${complete ? "border-[#0f8b73] bg-[#0f8b73] text-white" : attention ? "border-[#b98b1c] text-[#b98b1c]" : "border-[#b3b3b3] text-transparent"}`}>
        {complete ? <Check size={10} /> : attention ? <AlertTriangle size={10} /> : <Circle size={7} />}
      </span>
      <span className={complete ? "text-[#737373] line-through" : "font-semibold text-[#111111]"}>{item.label}</span>
    </div>
  );
}

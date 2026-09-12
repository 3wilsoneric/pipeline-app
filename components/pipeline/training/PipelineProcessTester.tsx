"use client";

import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FilePlus2,
  ListChecks,
  ShieldCheck,
} from "lucide-react";

export type ProcessTesterStage = "intake" | "schedule" | "assessment" | "review" | "decision";

const stages: ReadonlyArray<{
  id: ProcessTesterStage;
  step: string;
  label: string;
  detail: string;
  action: string;
  icon: typeof FilePlus2;
}> = [
  {
    id: "intake",
    step: "01",
    label: "Referral intake",
    detail: "Blank referral, packet upload, identity, assignment, and intake fields.",
    action: "Open intake",
    icon: FilePlus2,
  },
  {
    id: "schedule",
    step: "02",
    label: "Schedule assessment",
    detail: "Appointment date, time, method, location, and scheduling controls.",
    action: "Open scheduling",
    icon: CalendarDays,
  },
  {
    id: "assessment",
    step: "03",
    label: "Assessment interview",
    detail: "The complete guided assessment with every section and question available.",
    action: "Open assessment",
    icon: ClipboardCheck,
  },
  {
    id: "review",
    step: "04",
    label: "Assessment review",
    detail: "Completion counts, missing answers, edits, and the original assessment view.",
    action: "Open review",
    icon: ListChecks,
  },
  {
    id: "decision",
    step: "05",
    label: "Submittal and decision",
    detail: "Assessor submittal, supervisor review, and the recorded admission decision.",
    action: "Open decision",
    icon: ShieldCheck,
  },
];

export default function PipelineProcessTester({
  onOpenStage,
}: {
  onOpenStage: (stage: ProcessTesterStage) => void;
}) {
  return (
    <section data-process-tester="true" className="min-h-full bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8dfdc] px-5 py-4 sm:px-7">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0c705f]">Admin tools</div>
          <h1 className="mt-1 text-[20px] font-black text-[#1b211e]">Process tester</h1>
        </div>
        <div className="border-l-2 border-[#0f8b73] pl-3 text-[10px] font-bold leading-4 text-[#52605a]">
          Synthetic data only<br />Nothing is saved
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1180px] px-5 py-5 sm:px-7 sm:py-7">
        <div className="border-y border-[#cfd8d3]">
          {stages.map(({ id, step, label, detail, action, icon: Icon }) => (
            <div
              key={id}
              className="grid min-h-[104px] items-center gap-4 border-b border-[#e0e5e2] py-4 last:border-b-0 sm:grid-cols-[44px_minmax(170px,0.75fr)_minmax(240px,1.25fr)_160px]"
            >
              <span className="text-[11px] font-black tabular-nums text-[#0c705f]">{step}</span>
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center bg-[#e7f3ef] text-[#0c705f]">
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <h2 className="text-[14px] font-black text-[#202824]">{label}</h2>
              </div>
              <p className="text-[11px] font-medium leading-5 text-[#626e68]">{detail}</p>
              <button
                type="button"
                onClick={() => onOpenStage(id)}
                className="flex h-11 w-full items-center justify-between bg-[#111111] px-4 text-[10px] font-black text-white outline-none hover:bg-[#0f8b73] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2"
              >
                {action}
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

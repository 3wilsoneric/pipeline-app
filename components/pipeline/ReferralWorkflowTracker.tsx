import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";

export default function ReferralWorkflowTracker({ briefing }: { briefing: HomeBriefingSnapshot }) {
  const counts = briefing.workflow.flow_counts ?? {
    assignment: 0,
    intake: 0,
    ready_to_schedule: 0,
    scheduled: 0,
    assessment: 0,
    review: 0,
  };
  const metrics = [
    ["Intake", counts.assignment + counts.intake],
    ["Scheduling", counts.ready_to_schedule + counts.scheduled],
    ["Assessment", counts.assessment],
    ["Review", counts.review],
  ] as const;

  return (
    <section aria-label="Workflow summary" className="border-y border-[#d8dedb] bg-white">
      <div className="grid min-h-12 grid-cols-2 items-center gap-x-6 gap-y-3 px-1 py-3 sm:grid-cols-5 sm:py-0">
        <div className="col-span-2 flex min-w-0 items-baseline gap-2 sm:col-span-1">
          <span className="text-[11px] font-bold text-[#202320]">Current work</span>
          <span className="text-[10px] font-semibold text-[#69706c]">
            {briefing.workflow.active_total} {briefing.scope === "team" ? "team" : "assigned"}
          </span>
        </div>
        {metrics.map(([label, value]) => (
          <div key={label} className="flex min-w-0 items-baseline justify-between gap-2 sm:justify-start">
            <span className="truncate text-[10px] font-semibold text-[#69706c]">{label}</span>
            <strong className="text-[13px] font-bold tabular-nums text-[#202320]">{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

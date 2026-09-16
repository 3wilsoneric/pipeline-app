"use client";

type AssessmentView = "guided" | "chart";

export default function AssessmentViewToggle({
  value,
  disabled = false,
  fullGuideTarget,
  onChange,
}: {
  value: AssessmentView;
  disabled?: boolean;
  fullGuideTarget?: string;
  onChange: (view: AssessmentView) => void;
}) {
  return (
    <div role="group" aria-label="Assessment view" className="flex h-10 shrink-0 items-center border border-[#c9ceca] bg-[#f2f5f3] p-0.5">
      <button
        type="button"
        aria-label="Guided interview"
        aria-pressed={value === "guided"}
        disabled={disabled}
        onClick={() => onChange("guided")}
        className={`h-8 min-w-[66px] px-3 text-[10px] font-black transition-colors disabled:opacity-50 ${value === "guided" ? "bg-white text-[#0f705f] shadow-sm" : "text-[#5d6560] hover:bg-white/70 hover:text-[#0f705f]"}`}
      >
        Guided
      </button>
      <button
        type="button"
        data-guide-target={fullGuideTarget}
        aria-label="Full assessment"
        aria-pressed={value === "chart"}
        disabled={disabled}
        onClick={() => onChange("chart")}
        className={`h-8 min-w-[66px] px-3 text-[10px] font-black transition-colors disabled:opacity-50 ${value === "chart" ? "bg-white text-[#0f705f] shadow-sm" : "text-[#5d6560] hover:bg-white/70 hover:text-[#0f705f]"}`}
      >
        Full
      </button>
    </div>
  );
}

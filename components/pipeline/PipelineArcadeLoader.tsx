type PipelineArcadeLoaderProps = {
  label?: string;
  compact?: boolean;
  decorative?: boolean;
};

export default function PipelineArcadeLoader({
  label = "Loading workspaces",
  compact = false,
  decorative = false,
}: PipelineArcadeLoaderProps) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-busy={decorative ? undefined : "true"}
      aria-hidden={decorative ? "true" : undefined}
      className={`inline-flex items-center gap-2 ${compact ? "" : "flex-col"}`}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-7 items-center gap-1 border border-[#314139] bg-[#111713] px-2 shadow-[inset_0_0_0_1px_#050806]"
      >
        <span className="grid h-4 w-4 grid-cols-4 grid-rows-4 gap-px motion-safe:animate-pulse">
          {arcadePixels.map((active, index) => (
            <span
              key={index}
              className={active ? "bg-[#b8f238] shadow-[0_0_4px_rgba(184,242,56,0.65)]" : "bg-transparent"}
            />
          ))}
        </span>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 bg-[#7dd8bd] motion-safe:animate-bounce"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </span>
      {!compact ? (
        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#52605a]">{label}</span>
      ) : null}
    </span>
  );
}

const arcadePixels = [
  false, true, true, false,
  true, true, true, true,
  true, false, false, true,
  false, true, true, false,
];

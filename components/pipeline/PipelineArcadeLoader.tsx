type PipelineArcadeLoaderProps = {
  label?: string;
  compact?: boolean;
  decorative?: boolean;
  className?: string;
};

export default function PipelineArcadeLoader({
  label = "Loading workspaces",
  compact = false,
  decorative = false,
  className = "",
}: PipelineArcadeLoaderProps) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-busy={decorative ? undefined : "true"}
      aria-hidden={decorative ? "true" : undefined}
      data-testid="pipeline-directory-loader"
      data-compact={compact ? "true" : "false"}
      className={`pipeline-directory-loader${compact ? " pipeline-directory-loader--compact" : ""}${className ? ` ${className}` : ""}`}
    >
      <span className="pipeline-directory-loader__visual" aria-hidden="true">
        <span className="pipeline-directory-loader__mark">
          {arcadePixels.map((active, index) => (
            <span key={index} className={active ? "pipeline-directory-loader__pixel" : ""} />
          ))}
        </span>
        <span className="pipeline-directory-loader__meter">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className="pipeline-directory-loader__segment" style={{ animationDelay: `${index * 80}ms` }} />
          ))}
        </span>
      </span>
      {!compact ? <span className="pipeline-directory-loader__label">{label}</span> : null}
    </span>
  );
}

const arcadePixels = [
  false, true, true, false,
  true, true, true, true,
  true, false, false, true,
  false, true, true, false,
];

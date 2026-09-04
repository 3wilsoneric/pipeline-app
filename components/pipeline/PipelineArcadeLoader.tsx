import type { CSSProperties } from "react";

type PipelineArcadeLoaderProps = {
  label?: string;
  compact?: boolean;
  decorative?: boolean;
  className?: string;
};

const retroSegments = [
  "#e92f70",
  "#f0444f",
  "#f36a35",
  "#f58a2f",
  "#f7ab32",
  "#f5cd3b",
  "#e5e64b",
  "#c8eb55",
  "#a9e75b",
  "#8edc64",
  "#72cf72",
  "#54bd7e",
] as const;

export default function PipelineArcadeLoader({
  label = "Loading workspaces",
  compact = false,
  decorative = false,
  className = "",
}: PipelineArcadeLoaderProps) {
  const displayLabel = `${label.replace(/[.\s]+$/u, "").toUpperCase()}...`;

  return (
    <span
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-busy={decorative ? undefined : "true"}
      aria-hidden={decorative ? "true" : undefined}
      data-testid="pipeline-retro-loader"
      data-compact={compact ? "true" : "false"}
      className={`pipeline-retro-loader${compact ? " pipeline-retro-loader--compact" : ""}${className ? ` ${className}` : ""}`}
    >
      {!compact ? <span className="pipeline-retro-label" aria-hidden="true">{displayLabel}</span> : null}
      <span className="pipeline-retro-shell" aria-hidden="true">
        <span className="pipeline-retro-track">
          {retroSegments.map((color, index) => (
            <span
              key={color}
              className="pipeline-retro-segment"
              style={{
                "--pipeline-retro-color": color,
                "--pipeline-retro-index": index,
              } as CSSProperties}
            />
          ))}
        </span>
      </span>
    </span>
  );
}

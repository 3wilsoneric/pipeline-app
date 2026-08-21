import Image from "next/image";

import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function PipelineLogoMark({
  size = 44,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const sourceSize = size * 1.8;

  return (
    <span
      aria-hidden="true"
      className={`relative block shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={toPipelinePath("/brand/pipeline-mark.png")}
        alt=""
        width={1254}
        height={1254}
        priority
        unoptimized
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          width: sourceSize,
          height: sourceSize,
          left: -size * 0.42,
          top: -size * 0.38,
        }}
      />
    </span>
  );
}

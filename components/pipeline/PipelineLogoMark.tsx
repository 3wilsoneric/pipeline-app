import Image from "next/image";

import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function PipelineLogoMark({
  size = 44,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative block shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={toPipelinePath("/brand/pipeline-mark.svg")}
        alt=""
        width={491}
        height={672}
        priority
        unoptimized
        draggable={false}
        className="pointer-events-none size-full select-none object-contain"
      />
    </span>
  );
}

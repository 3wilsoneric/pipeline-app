"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";

import { toPipelinePath } from "@/lib/pipeline/base-path";
import { usePipelineLocationSearch } from "@/lib/pipeline/client-navigation";

export default function DemoEnvironmentBanner() {
  const searchParams = useSearchParams();
  const locationSearch = usePipelineLocationSearch(searchParams?.toString() ?? "");
  const params = new URLSearchParams(locationSearch);
  const assessmentMode = params.get("trainingAssessment");
  const active = params.get("screen") === "packet" && (
    params.get("demo") === "1"
    || params.get("trainingIntake") === "1"
    || assessmentMode === "schedule"
    || assessmentMode === "interview"
    || assessmentMode === "guided"
  );

  if (!active) return null;

  return (
    <div role="status" data-pipeline-demo-banner="true" className="flex h-8 shrink-0 items-center justify-center gap-3 border-b border-[#9fc6b9] bg-[#173f35] px-3 text-white">
      <FlaskConical size={13} aria-hidden="true" />
      <span className="text-[9px] font-black uppercase tracking-[0.11em]">Practice workspace · synthetic data only</span>
      <Link href={toPipelinePath("/training")} className="text-[9px] font-black underline-offset-2 hover:underline">Learning Center</Link>
    </div>
  );
}

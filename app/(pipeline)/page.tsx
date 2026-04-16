"use client";

import PipelineOverview from "@/components/pipeline/PipelineOverview";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";

export default function HomePage() {
  const { searchTerm } = usePipelineShell();

  return <PipelineOverview searchTerm={searchTerm} />;
}

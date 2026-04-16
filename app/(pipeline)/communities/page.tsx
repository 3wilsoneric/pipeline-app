"use client";

import Communities from "@/components/pipeline/Communities";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";

export default function CommunitiesPage() {
  const { searchTerm } = usePipelineShell();

  return <Communities searchTerm={searchTerm} />;
}

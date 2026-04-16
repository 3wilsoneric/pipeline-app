"use client";

import Assessments from "@/components/pipeline/Assessments";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";

export default function AssessmentsPage() {
  const { searchTerm } = usePipelineShell();

  return <Assessments searchTerm={searchTerm} />;
}

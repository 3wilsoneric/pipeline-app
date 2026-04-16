"use client";

import Settings from "@/components/pipeline/Settings";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";

export default function SettingsPage() {
  const { searchTerm } = usePipelineShell();

  return <Settings searchTerm={searchTerm} />;
}

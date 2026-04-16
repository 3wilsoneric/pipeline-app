"use client";

import Referrals from "@/components/pipeline/Referrals";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";

export default function ReferralsPage() {
  const { searchTerm } = usePipelineShell();

  return <Referrals searchTerm={searchTerm} />;
}

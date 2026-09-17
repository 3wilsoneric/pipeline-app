"use client";

import { X } from "lucide-react";
import AssessmentViewToggle from "@/components/pipeline/AssessmentViewToggle";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";

export default function AssessmentInterviewHeader({ name, community, view, disabled, onViewChange, onClose }: {
  name: string | null;
  community: string | null;
  view: "guided" | "chart";
  disabled: boolean;
  onViewChange?: (view: "guided" | "chart") => void;
  onClose: () => void;
}) {
  return (
    <div data-assessment-client-header="true" className="flex h-12 shrink-0 items-center gap-3 bg-[#f7faf4] px-3 sm:gap-4 sm:px-5">
      {onViewChange ? <AssessmentViewToggle value={view} disabled={disabled} fullGuideTarget={view === "guided" ? "assessment-guided-exit" : undefined} onChange={onViewChange} /> : null}
      <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold text-[#213629]">{formatClientIdentityTitle({ name: name || "Client", community })}</h2>
      <button type="button" onClick={onClose} disabled={disabled} aria-label="Close assessment" title="Return to assessment workspace" className="flex h-10 w-10 shrink-0 items-center justify-center text-[#4d534f] transition-colors hover:bg-[#f1f4f2] hover:text-[#0f7664] disabled:opacity-50"><X size={20} /></button>
    </div>
  );
}

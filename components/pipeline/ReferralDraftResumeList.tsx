"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, FileClock, Trash2 } from "lucide-react";

import {
  clearServerReferralDraft,
  listServerReferralDrafts,
  usesServerReferralDrafts,
} from "@/lib/pipeline/referral-draft-recovery";
import type { PipelineReferralDraftSummary } from "@/lib/pipeline/user-workspace-state-types";

export default function ReferralDraftResumeList({
  onResume,
  className = "",
}: {
  onResume: (draftKey: `new-${string}`) => void;
  className?: string;
}) {
  const [drafts, setDrafts] = useState<PipelineReferralDraftSummary[]>([]);
  const [error, setError] = useState("");
  const [discarding, setDiscarding] = useState("");

  const refresh = useCallback(async () => {
    if (!usesServerReferralDrafts()) return;
    try {
      setDrafts(await listServerReferralDrafts());
      setError("");
    } catch {
      setError("Unfinished intake could not be checked.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  if (!usesServerReferralDrafts() || (drafts.length === 0 && !error)) return null;

  return (
    <section aria-label="Unfinished referral intake" className={`border border-[#cfd8d4] bg-[#f7faf9] ${className}`}>
      <div className="flex min-h-11 items-center gap-3 border-b border-[#dce3e0] px-3 sm:px-4">
        <FileClock size={15} className="shrink-0 text-[#0f7b68]" aria-hidden="true" />
        <h2 className="text-[12px] font-bold text-[#202320]">Continue intake</h2>
        <span className="text-[10px] text-[#69716c]">Saved before a workspace was created</span>
      </div>
      {error ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-[11px] text-[#753d35]">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()} className="font-bold text-[#0f705f]">Retry</button>
        </div>
      ) : (
        <div className="divide-y divide-[#dce3e0]">
          {drafts.map((draft) => (
            <div key={draft.draft_key} className="flex min-w-0 items-center gap-3 px-3 py-2.5 sm:px-4">
              <button
                type="button"
                onClick={() => onResume(draft.draft_key)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold text-[#202320]">{draft.client_name || draft.packet_name || "New referral"}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#69716c]">
                    {[draft.community, draft.packet_name, savedAge(draft.saved_at)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="hidden shrink-0 text-[10px] font-semibold text-[#69716c] sm:block">{draft.completed_fields}/{draft.total_fields} fields</span>
                <ArrowRight size={15} className="shrink-0 text-[#0f7b68]" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Discard unfinished intake for ${draft.client_name || draft.packet_name || "new referral"}`}
                title="Discard unfinished intake"
                disabled={discarding === draft.draft_key}
                onClick={() => void discardDraft(draft)}
                className="flex h-8 w-8 shrink-0 items-center justify-center text-[#7a817d] hover:text-[#a13f34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:opacity-50"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  async function discardDraft(draft: PipelineReferralDraftSummary) {
    setDiscarding(draft.draft_key);
    try {
      await clearServerReferralDraft(draft.draft_key, draft.version);
      setDrafts((current) => current.filter((item) => item.draft_key !== draft.draft_key));
      setError("");
    } catch {
      setError("That intake changed in another session. Refresh before discarding it.");
      await refresh();
    } finally {
      setDiscarding("");
    }
  }
}

function savedAge(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Saved";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "Saved just now";
  if (minutes < 60) return `Saved ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Saved ${hours}h ago`;
  return `Saved ${Math.floor(hours / 24)}d ago`;
}

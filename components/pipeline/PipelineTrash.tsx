"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Search, Trash2 } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";
import {
  formatClientIdentityTitle,
  presentClientCommunity,
  presentClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";

export default function PipelineTrash() {
  const [query, setQuery] = useState("");
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState<number>();

  const load = useCallback(async (search = query) => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchPipelineJson<{ referrals?: Referral[] }>(`/api/trash/referrals?q=${encodeURIComponent(search)}`, { cache: "no-store" });
      setReferrals(payload.referrals ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Trash could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 200);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  const restore = async (referral: Referral) => {
    setRestoringId(referral.id);
    setError("");
    try {
      await fetchPipelineJson(`/api/trash/referrals/${referral.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: referral.version }),
      });
      setReferrals((current) => current.filter((item) => item.id !== referral.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workspace could not be restored.");
    } finally {
      setRestoringId(undefined);
    }
  };

  return (
    <main aria-busy={loading} className="h-full overflow-y-auto bg-white px-4 pb-8 pt-2 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1240px]">
        <div className="flex min-h-14 flex-col items-stretch gap-2 border-b border-[#d9d9d9] pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="relative min-w-0 flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#737373]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search trash" placeholder="Search deleted workspaces..." className="h-11 w-full border border-[#c9ceca] bg-white pl-10 pr-3 text-[13px] text-[#111111] outline-none focus:border-[#0f8b73]" />
          </div>
          <span role="status" aria-live="polite" className="shrink-0 text-right text-[11px] text-[#737373]">{loading ? "Loading trash..." : `${referrals.length} in trash`}</span>
        </div>
        <div className="mt-3 border-l-2 border-[#a16a16] bg-[#fff8ed] px-4 py-3 text-[11px] text-[#6f4b13]">Workspaces remain restorable for 30 days, then their records and files are permanently removed.</div>
        {error ? <div role="alert" className="mt-3 border-l-2 border-[#a9473d] bg-[#fff3f1] px-4 py-3 text-[11px] text-[#7c3229]">{error}</div> : null}
        {!loading && referrals.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center text-center"><Trash2 size={24} className="text-[#0f8b73]" /><div className="mt-3 text-[13px] font-black text-[#111111]">Trash is empty</div><div className="mt-1 text-[11px] text-[#737373]">Deleted workspaces will appear here for recovery.</div></div>
        ) : (
          <div className="mt-3 divide-y divide-[#d9d9d9] border-y border-[#d9d9d9]">
            {referrals.map((referral) => (
              <div key={referral.id} className="grid gap-3 px-3 py-4 sm:grid-cols-[minmax(0,1fr)_180px_140px_auto] sm:items-center">
                <div className="min-w-0"><div className="truncate text-[13px] font-black text-[#111111]" title={formatClientIdentityTitle(referral)}>{formatClientIdentityTitle(referral)}</div><div className="mt-1 truncate text-[10px] text-[#737373]">{presentClientGender(referral.gender)} · {presentClientCommunity(referral.community)} · {referral.owner || "Unassigned"}</div></div>
                <div><div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">Deleted</div><div className="mt-1 text-[10px] text-[#595959]">{formatDate(referral.deletedAt)}</div></div>
                <div><div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">Removes in</div><div className="mt-1 text-[10px] font-black text-[#a9473d]">{isExpired(referral.deleteAfter) ? "Removal pending" : `${daysRemaining(referral.deleteAfter)} days`}</div></div>
                <button type="button" disabled={restoringId === referral.id || isExpired(referral.deleteAfter)} onClick={() => void restore(referral)} title={isExpired(referral.deleteAfter) ? "The 30-day recovery window has ended." : "Restore workspace"} className="flex h-9 items-center justify-center gap-2 border border-[#0f8b73] px-3 text-[10px] font-black text-[#0f8b73] hover:bg-[#effaf5] disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw size={14} />{restoringId === referral.id ? "Restoring..." : "Restore"}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function formatDate(value: string | undefined) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function daysRemaining(value: string | undefined) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

function isExpired(value: string | undefined) {
  return !value || new Date(value).getTime() <= Date.now();
}

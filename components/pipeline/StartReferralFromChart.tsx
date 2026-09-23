"use client";

import { useRef, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import type { Referral } from "@/lib/pipeline/referral-types";

export default function StartReferralFromChart({ sourceReferralId, allowed, prominent = false, beforeStart }: {
  sourceReferralId?: number;
  allowed: boolean;
  prominent?: boolean;
  beforeStart?: () => Promise<void>;
}) {
  const mutationId = useRef<string | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!sourceReferralId || !allowed) return null;
  async function start() {
    if (busy.current) return;
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setError("Start new referrals from a saved chart outside practice mode.");
      return;
    }
    busy.current = true;
    setSaving(true);
    setError("");
    mutationId.current ??= crypto.randomUUID();
    try {
      await beforeStart?.();
      const result = await fetchPipelineJson<{ referral: Referral }>(`/api/referrals/${sourceReferralId}/new-intake`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_mutation_id: mutationId.current }),
      });
      pushPipelineHistory(`/?view=referrals&screen=packet&referralId=${result.referral.id}&workspaceStage=intake`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The new intake could not be created. Try again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  if (prominent) return <section aria-label="Start another intake" className="my-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#bfd8cb] bg-[#f3faf6] px-4 py-4 shadow-[0_2px_8px_#183b2b0d] sm:px-5">
    <div className="min-w-0 flex-1">
      <h2 className="text-[16px] font-bold text-[#173f31]">New intake for this client</h2>
      <p className="mt-1 text-[13px] leading-5 text-[#496358]">Start a separate referral with available chart details filled in. Review them before continuing; this workspace stays unchanged.</p>
      {error ? <p role="alert" className="mt-2 text-[13px] text-[#a4473c]">{error}</p> : null}
    </div>
    <button type="button" disabled={saving} onClick={() => void start()}
      className="min-h-14 w-full rounded-md bg-[#08735e] px-6 py-3 text-[16px] font-bold text-white shadow-[0_3px_0_#075442] transition-colors hover:bg-[#065f4f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174f43] disabled:opacity-60 sm:w-auto">
      {saving ? "Creating intake..." : "Create new intake from this workspace"}
    </button>
  </section>;
  return <div className="my-3 flex flex-wrap items-center justify-end gap-3">
    {error ? <p role="alert" className="text-[13px] text-[#a4473c]">{error}</p> : null}
    <button type="button" disabled={saving} onClick={() => void start()}
      className="min-h-10 border border-[#0f8b73] bg-white px-4 text-[13px] font-bold text-[#0c705f] hover:bg-[#effaf5] disabled:opacity-60">
      {saving ? "Creating intake..." : "New referral"}
    </button>
  </div>;
}

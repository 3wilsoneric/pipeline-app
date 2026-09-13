"use client";

import { useRef, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import type { Referral } from "@/lib/pipeline/referral-types";

export default function StartReferralFromChart({ sourceReferralId, allowed }: { sourceReferralId?: number; allowed: boolean }) {
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
  return <div className="my-3 flex flex-wrap items-center justify-end gap-3">
    {error ? <p role="alert" className="text-[13px] text-[#a4473c]">{error}</p> : null}
    <button type="button" disabled={saving} onClick={() => void start()}
      className="min-h-10 border border-[#0f8b73] bg-white px-4 text-[13px] font-bold text-[#0c705f] hover:bg-[#effaf5] disabled:opacity-60">
      {saving ? "Creating intake..." : "New referral"}
    </button>
  </div>;
}

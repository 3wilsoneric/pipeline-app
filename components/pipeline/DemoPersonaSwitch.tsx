"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { clearPipelineClientSessionCache, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { saveBeforePersonaSwitch } from "@/lib/demo/persona-switch-save";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function DemoPersonaSwitch({ persona }: { persona: "supervisor" | "assessor" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const target = persona === "supervisor" ? "assessor" : "supervisor";
  const label = persona === "supervisor" ? "Supervisor" : "Assessor";
  const targetLabel = target === "supervisor" ? "Supervisor" : "Assessor";

  useEffect(() => {
    if (busy) dialog.current?.showModal();
    else dialog.current?.close();
  }, [busy]);

  async function switchAccount() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await saveBeforePersonaSwitch();
      await fetchPipelineJson("/api/demo/persona", { method: "POST", body: JSON.stringify({ persona: target }) });
      clearPipelineClientSessionCache();
      // Full navigation discards every in-memory reader and UI state from the
      // previous account. The server keeps the referral and its audit history.
      window.location.replace(toPipelinePath("/"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch accounts. Your work is still open.");
      setBusy(false);
    }
  }

  return <div className="relative mr-1 shrink-0">
    <button type="button" title={`Switch to ${targetLabel}`} aria-label={`Switch to ${targetLabel}`} disabled={busy} onClick={() => void switchAccount()} className="flex h-9 items-center gap-2 rounded border border-[#c8d9d2] bg-white px-2 text-[11px] font-semibold text-[#08745f] hover:bg-[#eff8f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] sm:h-10 sm:px-3 sm:text-[12px]">
      <ArrowLeftRight size={18} aria-hidden="true" /><span>{label}</span>
    </button>
    {error ? <div role="alert" className="absolute right-0 top-full z-50 mt-2 w-72 border border-[#d5aaa5] bg-white p-4 text-[13px] text-[#8b342b]">{error}</div> : null}
    <dialog ref={dialog} aria-label="Switching accounts" onCancel={(event) => event.preventDefault()} className="m-auto rounded border border-[#c8d9d2] bg-white px-6 py-4 text-[15px] text-[#25332c] shadow-lg backdrop:bg-white/50">
      <p role="status">Saving and switching to {targetLabel}...</p>
    </dialog>
  </div>;
}

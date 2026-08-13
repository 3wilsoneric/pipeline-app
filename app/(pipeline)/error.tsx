"use client";

import { RefreshCw } from "lucide-react";

export default function PipelineError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-white px-6 text-[#111111]">
      <div className="max-w-lg text-center">
        <h1 className="text-[22px] font-black">This page could not load.</h1>
        <p className="mt-2 text-[13px] text-[#737373]">Retry the page. Your saved referral data has not been changed.</p>
        <button
          type="button"
          onClick={reset}
          className="mx-auto mt-5 flex h-10 items-center gap-2 bg-[#111111] px-5 text-[11px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73]"
        >
          <RefreshCw size={14} /> Retry
        </button>
        {error.digest ? <p className="mt-4 text-[10px] text-[#8a8a8a]">Reference {error.digest}</p> : null}
      </div>
    </main>
  );
}

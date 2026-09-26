"use client";

import { RefreshCw } from "lucide-react";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function PipelineError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const updateError = error.name === "ChunkLoadError"
    || /Loading chunk|Failed to fetch dynamically imported module|Failed to load chunk/i.test(error.message);
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-white px-6 text-[#111111]">
      <div className="max-w-lg text-center">
        <h1 className="text-[22px] font-black">This page could not load.</h1>
        <p className="mt-2 text-[13px] text-[#737373]">Reload to get the latest page. Saved work remains in Pipeline; check any unsaved edits after reopening.</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-10 items-center gap-2 bg-[#111111] px-5 text-[11px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73]"
          >
            <RefreshCw size={14} /> Reload page
          </button>
          <button type="button" onClick={retry} className="h-10 px-3 text-[11px] font-black uppercase tracking-[0.08em] text-[#174f43] underline underline-offset-2">Try again</button>
          <a href={toPipelinePath("/")} className="flex h-10 items-center px-3 text-[11px] font-black uppercase tracking-[0.08em] text-[#174f43] underline underline-offset-2">Home</a>
        </div>
        <p className="mt-4 text-[10px] text-[#8a8a8a]">Reference {error.digest ?? (updateError ? "APP-UPDATE" : "PAGE")}</p>
      </div>
    </main>
  );
}

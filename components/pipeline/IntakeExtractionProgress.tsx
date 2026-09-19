"use client";

import { Check, FileSearch } from "lucide-react";
import type { IntakeFieldSuggestion } from "@/lib/pipeline/referral-canvas-extraction";
import type { useIntakeFileExtraction } from "./use-intake-file-extraction";

export function IntakeExtractionProgress({ extraction, referralId, suggestionCount }: {
  extraction: ReturnType<typeof useIntakeFileExtraction>;
  referralId?: number;
  suggestionCount: number;
}) {
  if (!extraction.jobs.length) return null;
  const current = extraction.jobs.find((job) => job.status === "reading" || job.status === "queued");
  const completed = extraction.jobs.filter((job) => job.status === "complete").length;
  const failures = extraction.jobs.filter((job) => job.status === "failed");
  const partial = extraction.previews.some((preview) => preview.pagesRead < preview.pageCount);
  return <section aria-label="Reading intake files" className="mb-4 overflow-hidden rounded-md border border-[#bdd9cf] bg-[#f5fbf8]">
    <div className="flex items-start gap-3 px-4 py-3">
      <FileSearch size={20} className="mt-0.5 shrink-0 text-[#087d66]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p role="status" className="break-words text-[14px] font-semibold text-[#173e32]">{current ? `Reading ${current.file.name}` : failures.length ? "Some files need another try" : suggestionCount ? `${suggestionCount} suggested details ready below` : "Files read"}</p>
        <p className="mt-1 text-[12px] leading-5 text-[#51695f]">{current ? `${completed} of ${extraction.jobs.length} files read. Keep entering details while we work.` : "Suggested values are filled into empty fields. Check them before using; your entries stay unchanged."}</p>
        {partial ? <p className="mt-1 text-[12px] text-[#776036]">Quick scan: {extraction.previews.reduce((sum, item) => sum + item.pagesRead, 0)} of {extraction.previews.reduce((sum, item) => sum + item.pageCount, 0)} pages read. Review the full documents for anything else.</p> : null}
        {failures.map((job) => <div key={job.key} className="mt-2 flex flex-wrap items-center gap-x-3 text-[12px] text-[#8b422e]">
          <span role="alert" className="min-w-0 break-words">{job.file.name}: {job.error}</span>
          <button type="button" onClick={() => extraction.start(job.file, job.key, referralId)} className="min-h-11 font-semibold underline underline-offset-2">Retry reading</button>
        </div>)}
      </div>
    </div>
    <div role="progressbar" aria-label="File extraction progress" aria-valuemin={0} aria-valuemax={extraction.jobs.length} aria-valuenow={extraction.busy ? undefined : completed} aria-valuetext={current ? `Reading files, ${completed} of ${extraction.jobs.length} complete` : `${completed} of ${extraction.jobs.length} files read`} className="relative h-1.5 overflow-hidden bg-[#dce9e3]">
      <span className={`block h-full bg-[#087d66] ${extraction.busy ? "motion-safe:animate-pulse" : "transition-[width] motion-reduce:transition-none"}`} style={{ width: extraction.busy ? "35%" : `${completed / extraction.jobs.length * 100}%` }} />
    </div>
  </section>;
}

export function IntakeSuggestionLabel({ suggestion, label, onAccept }: { suggestion: IntakeFieldSuggestion; label: string; onAccept: () => void }) {
  if (suggestion.conflicting) return <p className="mt-2 text-[12px] leading-5 text-[#875c20]">The files disagree. Check the source and enter this detail.</p>;
  return <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-[12px] text-[#85601e]">
    <span className="min-w-0 break-words">Suggested · {suggestion.fileName}{suggestion.page ? ` · p. ${suggestion.page}` : ""}</span>
    <button type="button" aria-label={`Use suggested ${label}`} onClick={onAccept} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 font-semibold text-[#08735e] underline-offset-4 hover:underline focus-visible:outline-2"><Check size={14} aria-hidden="true" />Use</button>
  </div>;
}

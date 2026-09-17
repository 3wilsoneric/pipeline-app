"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export default function WorkspaceMultiFilter({ label, noun, values, options, onChange }: {
  label: string;
  noun: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    // Close after the click completes so inline panels cannot move its target.
    document.addEventListener("click", closeOutside);
    return () => document.removeEventListener("click", closeOutside);
  }, []);
  const choices = [...new Set([...options, ...values])];
  const summary = values.length === 0 ? `All ${noun}` : values.length === 1 ? values[0] : `${values.length} ${noun}`;
  return (
    <details ref={ref} className="group relative min-w-0 text-[12px] text-[#303638]"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}>
      <summary role="button" aria-label={label} aria-describedby={`${panelId}-selection`} aria-expanded={open} aria-controls={panelId} className="flex h-10 cursor-pointer list-none items-center gap-2 rounded border border-[#ccd6d0] bg-white px-3 font-semibold outline-none hover:border-[#86b6a4] focus-visible:ring-2 focus-visible:ring-[#0f8b73] [&::-webkit-details-marker]:hidden">
        <span id={`${panelId}-selection`} className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-[#607269] group-open:rotate-180" />
      </summary>
      <div id={panelId} role="group" aria-label={label} className="left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded border border-[#ccd6d0] bg-white p-1 shadow-lg sm:absolute">
        <button type="button" onClick={() => onChange([])} className="flex min-h-10 w-full items-center rounded px-3 text-left font-semibold text-[#096f54] hover:bg-[#f0f7f3] focus-visible:outline-[#0f8b73]">All {noun}</button>
        {choices.map((value) => <label key={value} className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-3 py-2 hover:bg-[#f0f7f3]">
          <input type="checkbox" checked={values.includes(value)} onChange={(event) => onChange(event.target.checked ? [...values, value] : values.filter((item) => item !== value))} className="h-4 w-4 shrink-0 accent-[#087e64]" />
          <span className="[overflow-wrap:anywhere]">{value}</span>
        </label>)}
        {choices.length === 0 ? <p className="px-3 py-2 text-[#68716c]">No {noun} in this view.</p> : null}
      </div>
    </details>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, PencilLine, X } from "lucide-react";

import type { ReferralCanvasPacketField } from "@/lib/pipeline/referral-canvas-extraction";
import {
  parseStructuredNarrative,
  serializeStructuredNarrative,
  structuredNarrativeSections,
  type StructuredNarrativeKind,
  type StructuredNarrativeSection,
} from "@/lib/pipeline/structured-narrative";

export default function StructuredNarrativeField({
  field,
  kind,
  onChange,
}: {
  field: ReferralCanvasPacketField;
  kind: StructuredNarrativeKind;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sections = structuredNarrativeSections[kind];
  const values = parseStructuredNarrative(field.value, sections);
  const completedSections = sections.filter((section) => values[section.key]?.trim()).length;
  const previewSections = sections
    .map((section) => ({ ...section, value: values[section.key]?.trim() ?? "" }))
    .filter((section) => section.value)
    .slice(0, 2);

  const closeEditor = useCallback(() => {
    setIsOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  return (
    <>
      <section aria-label={`${field.label} chart field`} className="flex min-h-[190px] flex-col border border-[#d7ddd9] bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-[0.08em] text-[#3f4745]">{field.label}</h3>
            <p className="mt-1 text-[11px] font-semibold text-[#737373]">{completedSections} of {sections.length} sections</p>
          </div>
          {field.sourceFile ? <span className="text-[9px] font-black uppercase text-[#317f8f]">Imported</span> : null}
        </div>

        <div className="mt-4 flex-1 space-y-3">
          {previewSections.length ? previewSections.map((section) => (
            <div key={section.key}>
              <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">{section.label}</div>
              <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-5 text-[#303638]">{section.value}</p>
            </div>
          )) : (
            <p className="max-w-[36ch] text-[12px] leading-5 text-[#737373]">No {field.label.toLowerCase()} captured yet.</p>
          )}
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-[#e3e6e4] pt-3">
          <div className="min-w-0 text-[10px] text-[#737373]">
            {field.sourceFile ? <span className="truncate">Source: {field.sourceFile}</span> : "Manual chart entry"}
          </div>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex h-9 shrink-0 items-center gap-2 border border-[#0c705f] px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[#0c705f] hover:bg-[#effaf5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c705f]"
          >
            <PencilLine size={14} />
            Edit {field.label.toLowerCase()}
          </button>
        </div>
      </section>

      {isOpen ? (
        <StructuredNarrativeDialog
          title={field.label}
          sections={sections}
          values={values}
          onChange={(sectionKey, value) => {
            onChange(serializeStructuredNarrative(sections, { ...values, [sectionKey]: value }));
          }}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}

function StructuredNarrativeDialog({
  title,
  sections,
  values,
  onChange,
  onClose,
}: {
  title: string;
  sections: readonly StructuredNarrativeSection[];
  values: Record<string, string>;
  onChange: (sectionKey: string, value: string) => void;
  onClose: () => void;
}) {
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);
  const completedSections = sections.filter((section) => values[section.key]?.trim()).length;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-black/30 p-0 sm:p-5" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`structured-${title.toLowerCase()}-title`}
        className="flex h-full w-full max-w-[1080px] flex-col overflow-hidden bg-white shadow-[0_24px_70px_rgba(17,17,17,0.2)] sm:h-[calc(100vh-40px)]"
      >
        <header className="flex min-h-[76px] items-center justify-between gap-5 border-b-2 border-[#111111] px-5 sm:px-8">
          <div>
            <h2 id={`structured-${title.toLowerCase()}-title`} className="text-[24px] font-black text-[#111111] sm:text-[30px]">{title}</h2>
            <div className="mt-1 text-[11px] font-black uppercase tracking-[0.08em] text-[#0c705f]">{completedSections} of {sections.length} sections complete</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()} editor`}
            title="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#c9ceca] text-[#303638] hover:border-[#111111] hover:bg-[#f7faf9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]"
          >
            <X size={19} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7">
          <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
            {sections.map((section, index) => (
              <label key={section.key} className="block border-t border-[#cfd5d1] pt-3">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-black uppercase tracking-[0.08em] text-[#303638]">{section.label}</span>
                  {values[section.key]?.trim() ? <CheckCircle2 size={15} className="shrink-0 text-[#0c705f]" /> : null}
                </span>
                <textarea
                  ref={index === 0 ? firstFieldRef : undefined}
                  aria-label={`${title}: ${section.label}`}
                  value={values[section.key] ?? ""}
                  placeholder={section.placeholder}
                  onChange={(event) => onChange(section.key, event.target.value)}
                  className="mt-3 min-h-[132px] w-full resize-y border border-[#d7ddd9] bg-[#fbfdfc] p-3 text-[13px] font-medium leading-6 text-[#303638] outline-none placeholder:text-[#9a9a9a] focus:border-[#0f8b73] focus:bg-white"
                />
              </label>
            ))}
          </div>
        </div>

        <footer className="flex min-h-[70px] items-center justify-end border-t border-[#d9d9d9] px-5 sm:px-8">
          <button
            type="button"
            onClick={onClose}
            className="h-10 bg-[#111111] px-6 text-[11px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]"
          >
            Done
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

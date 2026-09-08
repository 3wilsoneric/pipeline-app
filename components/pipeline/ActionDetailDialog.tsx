"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type ActionDetailDialogProps = {
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  confirmLabel: string;
  minimumLength?: number;
  onConfirm: (value: string) => void;
  onClose: () => void;
};

export default function ActionDetailDialog({
  title,
  description,
  label,
  initialValue = "",
  confirmLabel,
  minimumLength = 1,
  onConfirm,
  onClose,
}: ActionDetailDialogProps) {
  const titleId = useId();
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialValue);
  const detail = value.trim();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => fieldRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg border border-[#cfd5d1] bg-white shadow-[0_24px_70px_rgba(17,17,17,0.2)]"
      >
        <header className="flex items-start justify-between gap-5 border-b border-[#d9d9d9] px-5 py-4">
          <div>
            <h2 id={titleId} className="text-[18px] font-black text-[#111111]">{title}</h2>
            {description ? <p className="mt-1 text-[11px] leading-5 text-[#68716c]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center text-[#595959] hover:bg-[#f3f6f4] hover:text-[#111111] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]"
          >
            <X size={17} />
          </button>
        </header>
        <div className="px-5 py-5">
          <label htmlFor={fieldId} className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#3f4745]">{label}</label>
          <textarea
            ref={fieldRef}
            id={fieldId}
            value={value}
            rows={3}
            maxLength={2_000}
            onChange={(event) => setValue(event.target.value)}
            className="mt-2 w-full resize-y border border-[#c9ceca] px-3 py-2 text-[12px] leading-5 text-[#303638] outline-none focus:border-[#0f8b73]"
          />
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-[#d9d9d9] px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 border border-[#bfc8c4] px-4 text-[10px] font-black text-[#174f43] hover:border-[#0f8b73]">Cancel</button>
          <button
            type="button"
            disabled={detail.length < minimumLength}
            onClick={() => onConfirm(detail)}
            className="h-9 bg-[#111111] px-4 text-[10px] font-black text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#c6cbc8]"
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function HomeDialog({ label, title, description, size = "default", onClose, children }: {
  label: string;
  title: string;
  description?: string;
  size?: "default" | "gallery";
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onCancel={(event) => { event.stopPropagation(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto overscroll-contain border border-[#cbd6d2] bg-white p-0 text-[#202723] shadow-2xl backdrop:bg-[#102019]/30 ${size === "gallery" ? "h-[90dvh] max-w-[1360px]" : "max-w-[760px]"}`}
    >
      <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-[#dfe5e2] bg-white px-5">
        <div className={description ? "py-4" : undefined}>
          <h2 className="text-[19px] font-bold">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[#65716b]">{description}</p> : null}
        </div>
        <button type="button" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose} className="flex h-11 w-11 items-center justify-center text-[#58625d] hover:bg-[#f0f4f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

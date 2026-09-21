"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const dialogSizes = {
  default: "max-w-[760px]",
  gallery: "h-[90dvh] max-w-[1360px]",
  browser: "max-sm:m-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full h-[88dvh] max-w-[1120px] overflow-hidden open:flex open:flex-col",
  confirmation: "max-w-[480px] rounded-lg border-t-[3px] border-t-[#087d66]",
} as const;

export type HomeDialogOrigin = Pick<DOMRect, "left" | "top" | "width" | "height">;

export default function HomeDialog({ label, title, description, size = "default", role = "dialog", open = true, className = "", expandFrom, onClose, children }: {
  label: string;
  title: ReactNode;
  description?: string;
  size?: "default" | "gallery" | "browser" | "confirmation";
  role?: "dialog" | "alertdialog";
  open?: boolean;
  className?: string;
  expandFrom?: HomeDialogOrigin;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const closingRef = useRef(false);
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open) { dialog?.close(); return; }
    const previousFocus = document.activeElement;
    dialog?.showModal();
    closingRef.current = false;
    if (dialog && expandFrom && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animationRef.current = dialog.animate([
        { transform: originTransform(dialog, expandFrom) },
        { transform: "none" },
      ], { duration: 260, easing: "cubic-bezier(.2,.85,.25,1)" });
    }
    return () => {
      animationRef.current?.cancel();
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, expandFrom]);

  function requestClose() {
    if (closingRef.current) return;
    const dialog = dialogRef.current;
    if (!dialog || !expandFrom || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    closingRef.current = true;
    const currentTransform = getComputedStyle(dialog).transform;
    animationRef.current?.cancel();
    const animation = dialog.animate([
      { transform: currentTransform },
      { transform: originTransform(dialog, expandFrom) },
    ], { duration: 180, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" });
    animationRef.current = animation;
    void animation.finished.then(onClose, () => undefined);
  }

  return (
    <dialog
      ref={dialogRef}
      role={role}
      aria-label={label}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); requestClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
      }}
      className={`${className} m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto overscroll-contain border border-[#cbd6d2] bg-white p-0 text-[#202723] shadow-2xl backdrop:bg-[#102019]/30 ${dialogSizes[size]}`}
    >
      <div className={`shrink-0 bg-white ${size === "confirmation" ? "px-6 py-6" : "sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-[#dfe5e2] px-5"}`}>
        <div className={description && size !== "confirmation" ? "py-4" : undefined}>
          <h2 className={size === "confirmation" ? "text-[21px] font-bold leading-7 text-[#243b32]" : "text-[19px] font-bold"}>{title}</h2>
          {description ? <p id={descriptionId} className={size === "confirmation" ? "mt-3 text-[15px] leading-6 text-[#53665d]" : "mt-1 max-w-3xl text-[13px] leading-5 text-[#65716b]"}>{description}</p> : null}
        </div>
        {size !== "confirmation" ? <button type="button" aria-label={`Close ${label.toLowerCase()}`} onClick={requestClose} className="flex h-11 w-11 items-center justify-center text-[#58625d] hover:bg-[#f0f4f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
          <X size={19} aria-hidden="true" />
        </button> : null}
      </div>
      {children}
    </dialog>
  );
}

function originTransform(dialog: HTMLDialogElement, origin: HomeDialogOrigin) {
  const bounds = dialog.getBoundingClientRect();
  return `translate(${origin.left - bounds.left}px, ${origin.top - bounds.top}px) scale(${origin.width / bounds.width}, ${Math.min(origin.height, innerHeight) / bounds.height})`;
}

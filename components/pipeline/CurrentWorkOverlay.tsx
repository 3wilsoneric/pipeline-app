"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import ReferralWorkflowTracker from "@/components/pipeline/ReferralWorkflowTracker";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { Referral } from "@/lib/pipeline/referral-types";

const VIEW_STATE_KEY = "pipeline.current-work-view.v1";

export default function CurrentWorkOverlay({
  briefing,
  onClose,
  onOpenPacket,
}: {
  briefing: HomeBriefingSnapshot;
  onClose: () => void;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const portalReady = useSyncExternalStore(subscribeToBrowser, browserSnapshot, serverSnapshot);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!portalReady) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    const scrollContainer = scrollRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const storedState = readViewState();
    const frame = window.requestAnimationFrame(() => {
      if (scrollContainer) scrollContainer.scrollTop = storedState.scrollTop;
      const board = dialog?.querySelector<HTMLElement>("[data-current-work-board]");
      if (board) board.scrollLeft = storedState.boardScrollLeft;
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const board = dialog?.querySelector<HTMLElement>("[data-current-work-board]");
      writeViewState({
        scrollTop: scrollContainer?.scrollTop ?? 0,
        boardScrollLeft: board?.scrollLeft ?? 0,
      });
      previousFocus?.focus();
    };
  }, [portalReady]);

  if (!portalReady) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-[rgba(17,17,17,0.12)] p-0 sm:p-3 lg:p-5">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="current-work-title"
        className="mx-auto flex h-full w-full max-w-[1680px] flex-col overflow-hidden bg-white shadow-[0_18px_54px_rgba(17,17,17,0.18)] sm:border sm:border-[#cfd6d2]"
      >
        <header className="flex h-[64px] shrink-0 items-center justify-between gap-4 border-b border-[#dfe4e1] px-4 sm:h-[70px] sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 id="current-work-title" className="truncate text-[20px] font-black text-[#111111] sm:text-[23px]">Current work</h1>
            <span className="shrink-0 text-[12px] font-bold tabular-nums text-[#68706b]">
              {briefing.workflow.active_total.toLocaleString()} active
            </span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close current work"
            title="Close current work"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#cfd6d2] text-[#4f5752] outline-none transition-colors hover:border-[#0f8b73] hover:bg-[#eff8f5] hover:text-[#0f8b73] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2"
          >
            <X size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-4 sm:px-6 sm:pt-5 lg:px-8 lg:pt-6">
          <ReferralWorkflowTracker briefing={briefing} onOpenPacket={onOpenPacket} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )).filter(
    (element) => !element.hasAttribute("hidden") && element.getClientRects().length > 0,
  );
}

function readViewState() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(VIEW_STATE_KEY) ?? "{}") as Partial<{
      scrollTop: number;
      boardScrollLeft: number;
    }>;
    return {
      scrollTop: finiteNonNegative(value.scrollTop),
      boardScrollLeft: finiteNonNegative(value.boardScrollLeft),
    };
  } catch {
    return { scrollTop: 0, boardScrollLeft: 0 };
  }
}

function writeViewState(value: { scrollTop: number; boardScrollLeft: number }) {
  try {
    window.sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(value));
  } catch {
    // View state is optional when browser storage is unavailable.
  }
}

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function subscribeToBrowser() {
  return () => undefined;
}

function browserSnapshot() {
  return true;
}

function serverSnapshot() {
  return false;
}

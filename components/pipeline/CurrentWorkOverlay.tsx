"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";

import ReferralWorkflowTracker from "@/components/pipeline/ReferralWorkflowTracker";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { Referral } from "@/lib/pipeline/referral-types";
import { fetchPipelineJson, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";

const VIEW_STATE_KEY = "pipeline.current-work-view.v1";

export default function CurrentWorkOverlay({
  briefing,
  onClose,
  onOpenPacket,
  selectedReferralId,
}: {
  briefing?: HomeBriefingSnapshot | null;
  onClose: () => void;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
  selectedReferralId?: number;
}) {
  const [loadedBriefing, setLoadedBriefing] = useState<HomeBriefingSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const dataGeneration = usePipelineDataGeneration();
  const currentBriefing = briefing ?? loadedBriefing;
  const briefingReady = Boolean(currentBriefing);
  const scopeLabel = "Owned by you or assigned to you";
  const portalReady = useSyncExternalStore(subscribeToBrowser, browserSnapshot, serverSnapshot);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    if (briefing) return;
    const controller = new AbortController();
    let pending = false;
    const load = () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      void fetchPipelineJson<HomeBriefingSnapshot>("/api/operations/home", { cache: "no-store", signal: controller.signal })
      .then((payload) => { if (!controller.signal.aborted) { setLoadedBriefing(payload); setLoadError(""); } })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Referrals could not be loaded."); })
      .finally(() => { pending = false; });
    };
    load();
    const interval = window.setInterval(load, 30_000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", load); document.removeEventListener("visibilitychange", load); };
  }, [briefing, retry, dataGeneration]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!portalReady || !briefingReady) return;
    const frame = window.requestAnimationFrame(() => {
      const stored = readViewState();
      if (scrollRef.current) scrollRef.current.scrollTop = stored.scrollTop;
      const board = dialogRef.current?.querySelector<HTMLElement>("[data-current-work-board]");
      if (board) board.scrollLeft = stored.boardScrollLeft;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [portalReady, briefingReady]);

  useEffect(() => {
    if (!portalReady) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const managesOverflow = previousOverflow !== "hidden";
    const dialog = dialogRef.current;
    const scrollContainer = scrollRef.current;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialog));
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    if (managesOverflow) document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
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
      document.removeEventListener("keydown", handleKeyDown);
      if (managesOverflow) document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => { element.inert = previousInert[index]; });
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
    <div className="fixed inset-0 z-[110] bg-[rgba(17,17,17,0.32)] p-0 sm:p-3 lg:p-5">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Current work"
        className="mx-auto flex h-full w-full max-w-[1060px] flex-col overflow-hidden bg-white shadow-[0_18px_54px_rgba(17,17,17,0.18)] sm:border sm:border-[#cfd6d2]"
      >
        <header className="flex h-[64px] shrink-0 items-center justify-between gap-4 border-b border-[#dfe4e1] px-4 sm:h-[70px] sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 id="current-work-title" className="truncate text-[20px] font-black text-[#111111] sm:text-[23px]">Board</h1>
            <span className="shrink-0 text-[12px] font-bold tabular-nums text-[#68706b]">
              {currentBriefing ? `${currentBriefing.workflow.active_total.toLocaleString()} active` : ""}
            </span>
            <span className="hidden shrink-0 text-[11px] font-semibold text-[#68706b] sm:inline">{scopeLabel}</span>
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
          {currentBriefing ? <ReferralWorkflowTracker briefing={currentBriefing} onOpenPacket={onOpenPacket} selectedReferralId={selectedReferralId} layout="board" /> : loadError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 py-8 text-[13px] text-[#9a6115]">
              <span>{loadError}</span>
              <button type="button" onClick={() => { setLoadError(""); setRetry((value) => value + 1); }} className="pipeline-inline-action font-bold underline underline-offset-2">Retry</button>
            </div>
          ) : <div role="status" className="flex items-center gap-2 py-8 text-[13px] text-[#68706b]"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />Loading referrals...</div>}
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

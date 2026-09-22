"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import HomeDialog from "./HomeDialog";

type Confirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export function useConfirmationDialog() {
  const [request, setRequest] = useState<(Confirmation & { id: number }) | null>(null);
  const sequence = useRef(0);
  const pending = useRef<((accepted: boolean) => void) | null>(null);

  useEffect(() => () => {
    // Leaving the owning screen must never approve a pending action.
    pending.current?.(false);
    pending.current = null;
  }, []);

  const confirm = useCallback((options: Confirmation): Promise<boolean> => {
    // Repeated clicks must not create multiple mutations from one approval.
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setRequest({ ...options, id: ++sequence.current });
    });
  }, []);

  const finish = (accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(accepted);
  };

  const confirmationDialog = request ? createPortal(
    <HomeDialog key={request.id} size="confirmation" role="alertdialog" label={request.title} title={request.title} description={request.message} onClose={() => finish(false)}>
      <div className="flex flex-wrap justify-end gap-3 border-t border-[#dfe5e2] bg-[#f7faf8] px-4 py-4 sm:px-6" onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <button type="button" onClick={() => finish(false)} className="min-h-11 rounded-md border border-[#cbd6d2] bg-white px-4 py-2 text-[14px] font-semibold text-[#3d5147] hover:bg-[#edf3ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087d66]">
          {request.cancelLabel ?? "Cancel"}
        </button>
        <button type="button" onClick={() => finish(true)} className={`min-h-11 rounded-md px-4 py-2 text-[14px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087d66] ${request.destructive ? "bg-[#a9473d] hover:bg-[#8d382f]" : "bg-[#087d66] hover:bg-[#06634f]"}`}>
          {request.confirmLabel}
        </button>
      </div>
    </HomeDialog>, document.body
  ) : null;

  return { confirm, confirmationDialog };
}

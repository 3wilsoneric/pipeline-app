"use client";

import { createPortal } from "react-dom";

export default function DeleteWorkspaceDialog({
  name,
  busy,
  onConfirm,
  onClose,
}: {
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-workspace-title"
        className="w-full max-w-md border border-[#cfcfcf] border-t-[3px] border-t-[#a9473d] bg-white p-5 shadow-xl"
      >
        <h2 id="delete-workspace-title" className="text-[16px] font-black text-[#111111]">Move workspace to trash?</h2>
        <p className="mt-2 text-[12px] leading-5 text-[#595959]">
          <strong>{name}</strong> and its files will leave active work immediately. They can be restored from Trash for 30 days.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="h-10 border border-[#c9ceca] px-4 text-[11px] font-black text-[#595959] hover:bg-[#f7faf9]">Cancel</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="h-10 bg-[#a9473d] px-4 text-[11px] font-black text-white hover:bg-[#8d382f] disabled:opacity-50">{busy ? "Moving..." : "Move to trash"}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

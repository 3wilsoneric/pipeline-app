"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, X } from "lucide-react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ReferralFile } from "@/lib/pipeline/referral-types";
import ReferralFilePreviewDialog from "./ReferralFilePreviewDialog";

export default function UploadedDocumentList({ files, readOnly = false, updating = false, onUpdate }: { files: ReferralFile[]; readOnly?: boolean; updating?: boolean; onUpdate?: (file: ReferralFile) => void }) {
  const [preview, setPreview] = useState<ReferralFile | null>(null);
  const [deleting, setDeleting] = useState<ReferralFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);
  const remove = async () => {
    if (!deleting || busy || readOnly) return;
    setBusy(true);
    setError("");
    try {
      await fetchPipelineJson(`/api/files/${deleting.id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
      });
      window.dispatchEvent(new CustomEvent("pipeline:documents-changed", { detail: { referralId: deleting.referralId, deletedFileId: deleting.id } }));
      setDeleting(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The file could not be deleted. Try again."); }
    finally { setBusy(false); }
  };
  if (!files.length && !deleting) return null;
  return <section aria-label="Uploaded documents" className="my-4">
    <ul className="grid gap-2 sm:grid-cols-2">
      {files.map((file) => <li key={file.id} className="flex items-center gap-3 rounded border border-[#cddfd6] bg-white p-3 shadow-sm">
        <button type="button" aria-label={`Preview ${file.name}`} onClick={() => setPreview(file)} className="relative flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-[#dbe5df] bg-[#f6faf8] text-[#0f8b73] focus-visible:outline-2">
          {file.thumbnailUrl ? <Image src={file.thumbnailUrl} alt="" fill sizes="48px" unoptimized className="object-contain" /> : <FileText size={25} />}
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setPreview(file)} title={file.name} className="block max-w-full truncate text-left text-[14px] font-bold text-[#173c2b] underline-offset-2 hover:underline">{file.name}</button>
          <span className="mt-1 block text-[13px] text-[#52655d]">{file.category}</span>
          {/^[0-9a-f-]{36}$/i.test(file.id)
            ? <span className="mt-1 flex items-center gap-1 text-[13px] font-semibold text-[#128049]"><CheckCircle2 size={14} aria-hidden="true" />Uploaded</span>
            : <span className="mt-1 block text-[13px] text-[#5e6763]">Recorded file</span>}
          <div className="mt-1 flex flex-wrap items-center gap-x-4 text-[13px] font-semibold text-[#0f7059]">
            {!readOnly && onUpdate ? <button type="button" aria-label={`Add updated copy of ${file.name}`} disabled={updating} onClick={() => onUpdate(file)} className="min-h-11 underline underline-offset-2 disabled:opacity-50">Add updated copy</button> : null}
            {file.downloadUrl ? <a href={file.downloadUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-2">Open original</a> : <span className="text-[#737373]">{file.previewStatus === "unavailable" ? "Preview unavailable" : "Preview processing"}</span>}
          </div>
        </div>
        {!readOnly && /^[0-9a-f-]{36}$/i.test(file.id) ? <button type="button" aria-label={`Delete ${file.name}`} title="Delete file" onClick={() => { setError(""); setDeleting(file); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-[#737373] hover:bg-[#fff1ee] hover:text-[#9d352a] focus-visible:outline-2"><X size={19} /></button> : null}
      </li>)}
    </ul>
    {preview ? <ReferralFilePreviewDialog key={preview.id} file={preview} onClose={() => setPreview(null)} /> : null}
    <dialog ref={dialog} onCancel={(event) => { if (busy) event.preventDefault(); else setDeleting(null); }} className="m-auto w-[min(92vw,440px)] rounded border border-[#ccd8d0] bg-white p-6 shadow-xl backdrop:bg-black/40" aria-labelledby="delete-document-title">
      <h2 id="delete-document-title" className="text-lg font-bold">Delete this file?</h2>
      <p className="mt-3 break-words text-sm"><strong>{deleting?.name}</strong> will leave this workspace. You can restore it from Change history for 24 hours. Entered chart values stay unchanged.</p>
      {error ? <p role="alert" className="mt-3 border-l-[3px] border-[#9aa7a0] bg-[#f7faf9] px-3 py-2 text-sm leading-6 text-[#59645e]">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" autoFocus disabled={busy} onClick={() => setDeleting(null)} className="min-h-11 rounded border px-4 py-2 text-sm font-bold">Cancel</button>
        <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 rounded bg-[#a63d2f] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{busy ? "Deleting…" : "Delete file"}</button>
      </div>
    </dialog>
  </section>;
}

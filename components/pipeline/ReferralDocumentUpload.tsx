"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FileText, UploadCloud, X } from "lucide-react";
import { documentCategories, type DocumentCategory } from "@/lib/extraction/contracts";
import { referralDocumentLabels, suggestReferralDocumentLabel, validateReferralDocumentFiles, type LabeledReferralFile } from "@/lib/pipeline/referral-document-labels";
import type { ReferralFile } from "@/lib/pipeline/referral-types";
import UploadedDocumentList from "./UploadedDocumentList";
import styles from "./ReferralDocumentUpload.module.css";

type Selection = { file: File; category: DocumentCategory | "" | "workbook" };

export default function ReferralDocumentUpload({ readOnly = false, collapsible = false, queued, files, filesLoading, filesError, onRetryFiles, onAdd, onRemove, uploading, onWorkbook, children }: {
  readOnly?: boolean;
  collapsible?: boolean;
  queued: LabeledReferralFile[];
  files: ReferralFile[];
  filesLoading: boolean;
  filesError: string;
  onRetryFiles: () => void;
  onAdd: (files: LabeledReferralFile[]) => void;
  onRemove: (file: File) => void;
  uploading: boolean;
  onWorkbook?: (file: File) => void;
  children?: ReactNode;
}) {
  const [selection, setSelection] = useState<Selection[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = selection.length > 0;

  const choose = (chosen: File[]) => {
    if (readOnly || !chosen.length) return;
    if (panel.current) panel.current.open = true;
    const invalid = validateReferralDocumentFiles(chosen);
    setError(invalid);
    if (invalid) return;
    setSelection((current) => [...current, ...chosen.map((file): Selection => ({ file, category: /\.xlsx$/i.test(file.name) && /assessment|pipeline/i.test(file.name) ? "workbook" : suggestReferralDocumentLabel(file.name) }))]);
  };
  const canAdd = documentSelectionReady(selection, readOnly, Boolean(onWorkbook));
  const commit = () => {
    if (!canAdd) return;
    const workbook = selection.find((item) => item.category === "workbook");
    if (workbook) onWorkbook?.(workbook.file);
    else onAdd(selection as LabeledReferralFile[]);
    setSelection([]);
    trigger.current?.dispatchEvent(new CustomEvent("pipeline:guide-complete", { bubbles: true }));
  };
  const renderFileStatus = () => <>
    {filesLoading ? <p role="status" className="my-3 text-sm text-[#52655d]">{files.length ? "Refreshing files…" : "Loading files…"}</p> : null}
    {filesError ? <div role="alert" className="my-3 rounded-lg border border-[#c8d5ce] bg-[#f8faf9] p-4 text-sm text-[#253b34]">
      <p>{filesError}{files.length ? " The list below may be out of date." : ""}</p>
      <button type="button" onClick={onRetryFiles} disabled={filesLoading} className="mt-2 min-h-11 rounded border border-[#adbbb3] bg-white px-4 font-semibold text-[#08735e] disabled:opacity-60">Retry file list</button>
    </div> : null}
    {!filesLoading && !filesError && !files.length && !queued.length ? <p className="my-4 text-sm text-[#52655d]">No files added yet.</p> : null}
  </>;
  const content = <>
    {!readOnly ? <>
      <button ref={trigger} type="button" data-guide-target="initial-packet-upload" className={styles.dropzone} onClick={() => input.current?.click()}>
        <span className={styles.uploadIcon}><UploadCloud size={24} aria-hidden="true" /></span>
        <span><strong>{dragging ? "Release to label your files" : "Drop files or choose files"}</strong><span>Choose a document type for each file, then add them together.</span></span>
        <span className={styles.browse}>Choose files</span>
      </button>
      <input ref={input} type="file" multiple data-testid="referral-documents-input" aria-label="Choose referral documents" className="sr-only" tabIndex={-1} disabled={readOnly} onChange={(event) => { choose(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <p className={styles.hint}>Up to 100 MB per file. A combined packet can stay in one file.</p>
    </> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <QueuedDocuments files={queued} onRemove={onRemove} disabled={readOnly || uploading} />
    {renderFileStatus()}
    <UploadedDocumentList files={files} readOnly={readOnly} />
    {children}
  </>;
  return <section data-guide-target="workspace-files-upload" aria-label="Document checklist" className={styles.surface} data-file-drag-active={dragging || undefined}
    onDragEnter={(event) => { if (readOnly || !event.dataTransfer.types.includes("Files")) return; event.preventDefault(); depth.current++; setDragging(true); if (panel.current) panel.current.open = true; }}
    onDragOver={(event) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = readOnly ? "none" : "copy"; }}
    onDragLeave={(event) => { if (!event.dataTransfer.types.includes("Files")) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={(event) => { if (!event.dataTransfer.types.includes("Files") && !event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); choose(Array.from(event.dataTransfer.files)); }}>
    {collapsible ? <details ref={panel} data-testid="document-checklist-panel" className={styles.panel}>
      <summary data-testid="document-checklist-toggle"><strong>Documents</strong><span>{documentCountLabel(dragging, queued.length, files.length)}<ChevronDown size={18} aria-hidden="true" /></span></summary>
      <div className={styles.contents}>{content}</div>
    </details> : content}
    {open ? <FileLabelDialog selection={selection} setSelection={setSelection} onClose={() => setSelection([])} onCommit={commit} readOnly={readOnly} workbookAvailable={Boolean(onWorkbook)} /> : null}
  </section>;
}


function FileLabelDialog({ selection, setSelection, onClose, onCommit, readOnly, workbookAvailable }: {
  selection: Selection[];
  setSelection: React.Dispatch<React.SetStateAction<Selection[]>>;
  onClose: () => void;
  onCommit: () => void;
  readOnly: boolean;
  workbookAvailable: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const workbookCount = selection.filter((item) => item.category === "workbook").length;
  const canAdd = documentSelectionReady(selection, readOnly, workbookAvailable);
  useEffect(() => {
    const current = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    current?.showModal();
    return () => { current?.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={() => onClose()}>
      <header><div><h2 id={titleId}>Label your files</h2><p id={descriptionId}>Check each document type. Nothing is uploaded until you add it.</p></div><button type="button" aria-label="Cancel file upload" onClick={() => onClose()}><X size={21} /></button></header>
      <div className={styles.rows}>
        {selection.map(({ file, category }, index) => <div key={index} className={styles.row}>
          <FileText className={styles.fileIcon} size={22} aria-hidden="true" />
          <div className={styles.filename}><strong>{file.name}</strong><small>{formatSize(file.size)}</small></div>
          <label><span>Document type</span><select autoFocus={index === 0} aria-label={`Document type for ${file.name}`} value={category} onChange={(event) => setSelection((current) => current.map((item, i) => i === index ? { ...item, category: event.target.value as Selection["category"] } : item))}>
            <option value="">Choose a type</option>
            {documentCategories.map((value) => <option key={value} value={value}>{referralDocumentLabels[value]}</option>)}
            {/\.xlsx$/i.test(file.name) ? <option value="workbook">Pipeline assessment workbook</option> : null}
          </select></label>
          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setSelection((current) => current.filter((_, i) => i !== index))}><X size={18} /></button>
        </div>)}
      </div>
      {workbookCount > 0 ? <p className={styles.notice} role="status">{!workbookAvailable ? "To restore workbook answers, first create the referral and open its assessment. Then use Assessment details > Backup & recovery." : selection.length !== 1 ? "Restore a workbook on its own. Add the other documents as a separate batch." : "This opens the assessment import preview. Answers only change after you review and commit them."}</p> : <p className={styles.notice}>Labels organize the chart. They do not verify signatures or approve a document. Original filenames are kept.</p>}
      <footer><span>{selection.length} {selection.length === 1 ? "file" : "files"}</span><button type="button" onClick={() => onClose()}>Cancel</button><button type="button" className={styles.add} disabled={!canAdd} onClick={onCommit}>{workbookCount ? "Preview workbook" : "Add files"}</button></footer>
    </dialog>, document.body);
}

function QueuedDocuments({ files, onRemove, disabled }: { files: LabeledReferralFile[]; onRemove: (file: File) => void; disabled: boolean }) {
  if (!files.length) return null;
  return <ul aria-label="Queued referral files" className={styles.queued}>
    {files.map(({ file, category }, index) => <li key={index}><FileText size={17} aria-hidden="true" /><span><strong>{file.name}</strong><small>{referralDocumentLabels[category]}</small></span><span className={styles.pending}>Pending upload</span><button type="button" disabled={disabled} aria-label={`Remove queued ${file.name}`} onClick={() => onRemove(file)}><X size={18} aria-hidden="true" /></button></li>)}
  </ul>;
}

function documentSelectionReady(selection: Selection[], readOnly: boolean, workbookAvailable: boolean) {
  if (readOnly || !selection.length || selection.some((item) => !item.category)) return false;
  return !selection.some((item) => item.category === "workbook") || (workbookAvailable && selection.length === 1);
}

function documentCountLabel(dragging: boolean, pending: number, uploaded: number) {
  if (dragging) return "Release to add files";
  if (pending) return `${pending} pending`;
  return `${uploaded} ${uploaded === 1 ? "file" : "files"}`;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

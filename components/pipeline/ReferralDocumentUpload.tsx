"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FileText, FileUp, X } from "lucide-react";
import { documentCategories, type DocumentCategory } from "@/lib/extraction/contracts";
import { isBrowserPreviewable } from "@/lib/extraction/document-access-policy";
import { referralDocumentLabels, suggestReferralDocumentLabel, suggestUpdatedReferralDocumentLabel, validateReferralDocumentFiles, type LabeledReferralFile } from "@/lib/pipeline/referral-document-labels";
import type { ReferralFile } from "@/lib/pipeline/referral-types";
import UploadedDocumentList from "./UploadedDocumentList";
import { useDesignV2 } from "@/components/design/DesignSwitch";
import styles from "./ReferralDocumentUpload.module.css";

type Selection = { file: File; category: DocumentCategory | ""; previousName?: string };

export default function ReferralDocumentUpload({ readOnly = false, collapsible = false, queued, files, filesLoading, filesError, onRetryFiles, onAdd, onRemove, uploading, children }: {
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
  children?: ReactNode;
}) {
  const designV2 = useDesignV2();
  const [selection, setSelection] = useState<Selection[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const updateInput = useRef<HTMLInputElement>(null);
  const updateTarget = useRef<ReferralFile | null>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = selection.length > 0;

  useEffect(() => {
    if (!dragging) return;
    const clearDrag = () => { depth.current = 0; setDragging(false); };
    window.addEventListener("drop", clearDrag);
    window.addEventListener("dragend", clearDrag);
    window.addEventListener("blur", clearDrag);
    return () => {
      window.removeEventListener("drop", clearDrag);
      window.removeEventListener("dragend", clearDrag);
      window.removeEventListener("blur", clearDrag);
    };
  }, [dragging]);

  const choose = (chosen: File[], previous?: ReferralFile | null) => {
    if (readOnly || !chosen.length) return;
    if (panel.current) panel.current.open = true;
    const invalid = validateReferralDocumentFiles(chosen);
    setError(invalid);
    if (invalid) return;
    setSelection((current) => [...current, ...chosen.map((file): Selection => ({
      file,
      category: previous ? suggestUpdatedReferralDocumentLabel(previous.category) : suggestReferralDocumentLabel(file.name),
      previousName: previous?.name,
    }))]);
  };
  const canAdd = documentSelectionReady(selection, readOnly);
  const commit = () => {
    if (!canAdd) return;
    onAdd(selection as LabeledReferralFile[]);
    setSelection([]);
    trigger.current?.dispatchEvent(new CustomEvent("pipeline:guide-complete", { bubbles: true }));
  };
  const renderFileStatus = () => <>
    {filesLoading ? <p role="status" className="my-3 text-sm text-[#52655d]">{files.length ? "Refreshing files…" : "Loading files…"}</p> : null}
    {filesError ? <div role="alert" className="my-3 rounded-lg border border-[#c8d5ce] bg-[#f8faf9] p-4 text-sm text-[#253b34]">
      <p>{filesError}{files.length ? " The list below may be out of date." : ""}</p>
      <button type="button" onClick={onRetryFiles} disabled={filesLoading} className="mt-2 min-h-11 rounded border border-[#adbbb3] bg-white px-4 font-semibold text-[#08735e] disabled:opacity-60">Retry file list</button>
    </div> : null}
    {!collapsible && !filesLoading && !filesError && !files.length && !queued.length ? <p className="my-4 text-sm text-[#52655d]">No files added yet.</p> : null}
  </>;
  const uploadControl = <>
    {!readOnly ? <>
      <button ref={trigger} type="button" data-guide-target="initial-packet-upload" className={styles.dropzone} onClick={() => input.current?.click()}>
        <span className={styles.uploadIcon}><FileUp size={24} aria-hidden="true" /></span>
        <span><strong>{dragging ? "Release to label your files" : "Drop files or choose files"}</strong><span>Label before adding. Up to 100 MB per file.</span></span>
        <span className={styles.browse}>Choose files</span>
      </button>
      <input ref={input} type="file" multiple data-testid="referral-documents-input" aria-label="Choose referral documents" className="sr-only" tabIndex={-1} disabled={readOnly} onChange={(event) => { choose(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <input ref={updateInput} type="file" aria-label="Choose updated document" className="sr-only" tabIndex={-1} disabled={readOnly || uploading} onChange={(event) => { choose(Array.from(event.target.files ?? []), updateTarget.current); updateTarget.current = null; event.target.value = ""; }} />
    </> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <QueuedDocuments files={queued} onRemove={onRemove} disabled={readOnly || uploading} />
    {renderFileStatus()}
  </>;
  const content = <>
    <UploadedDocumentList files={files} readOnly={readOnly} updating={uploading} onUpdate={(file) => { updateTarget.current = file; updateInput.current?.click(); }} />
    {children}
  </>;
  return <section data-guide-target="workspace-files-upload" aria-label="Document checklist" className={`${styles.surface} ${collapsible ? styles.compact : ""}`} data-file-drag-active={dragging || undefined}
    onDragEnter={(event) => { if (readOnly || !event.dataTransfer.types.includes("Files")) return; event.preventDefault(); depth.current++; setDragging(true); }}
    onDragOver={(event) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = readOnly ? "none" : "copy"; }}
    onDragLeave={(event) => { if (!event.dataTransfer.types.includes("Files")) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={(event) => { if (!event.dataTransfer.types.includes("Files") && !event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); trigger.current?.focus({ preventScroll: true }); choose(Array.from(event.dataTransfer.files)); }}>
    {uploadControl}
    {collapsible ? <details ref={panel} data-testid="document-checklist-panel" className={styles.panel}>
      <summary data-testid="document-checklist-toggle"><strong>{designV2 ? <FileText size={20} aria-hidden="true" /> : null}Documents</strong><span>{documentCountLabel(dragging, queued.length, files.length)}<ChevronDown size={18} aria-hidden="true" /></span></summary>
      <div className={styles.contents}>{content}</div>
    </details> : content}
    {open ? <FileLabelDialog selection={selection} setSelection={setSelection} onClose={() => setSelection([])} onCommit={commit} readOnly={readOnly} /> : null}
  </section>;
}


function FileLabelDialog({ selection, setSelection, onClose, onCommit, readOnly }: {
  selection: Selection[];
  setSelection: React.Dispatch<React.SetStateAction<Selection[]>>;
  onClose: () => void;
  onCommit: () => void;
  readOnly: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [previewFile, setPreviewFile] = useState<File | null>(selection[0]?.file ?? null);
  const canAdd = documentSelectionReady(selection, readOnly);
  useEffect(() => {
    const current = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    current?.showModal();
    return () => { current?.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={() => onClose()}>
      <header><div><h2 id={titleId}>Label your files</h2><p id={descriptionId}>Check each document type. Nothing is uploaded until you add it.</p></div><button type="button" aria-label="Cancel file upload" onClick={() => onClose()}><X size={21} /></button></header>
      <div className={styles.rows}>
        {selection.map(({ file, category, previousName }, index) => <div key={index} className={styles.row}>
          <FileText className={styles.fileIcon} size={22} aria-hidden="true" />
          <div className={styles.filename}><strong>{file.name}</strong><small>{formatSize(file.size)}</small><button type="button" className={styles.previewToggle} aria-label={`Preview ${file.name}`} aria-expanded={previewFile === file} aria-controls={`${titleId}-preview-${index}`} onClick={() => setPreviewFile((current) => current === file ? null : file)}>Preview <ChevronDown size={16} aria-hidden="true" /></button>{previousName ? <small>Updated copy of {previousName}. The original stays in Files. Existing checklist links and chart answers are unchanged.</small> : null}</div>
          <label><span>Document type</span><select autoFocus={index === 0} aria-label={`Document type for ${file.name}`} value={category} onChange={(event) => setSelection((current) => current.map((item, i) => i === index ? { ...item, category: event.target.value as Selection["category"] } : item))}>
            <option value="">Choose a type</option>
            {documentCategories.map((value) => <option key={value} value={value}>{referralDocumentLabels[value]}</option>)}
          </select></label>
          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => {
            if (previewFile === file) setPreviewFile(selection.find((_, i) => i !== index)?.file ?? null);
            setSelection((current) => current.filter((_, i) => i !== index));
          }}><X size={18} /></button>
          <div id={`${titleId}-preview-${index}`} hidden={previewFile !== file} className={styles.preview}>
            {previewFile === file ? <SelectedFilePreview key={`${file.name}-${file.lastModified}-${index}`} file={file} /> : null}
          </div>
        </div>)}
      </div>
      <p className={styles.notice}>Labels organize the chart. They do not verify signatures or approve a document. Original filenames are kept.</p>
      <footer><span>{selection.length} {selection.length === 1 ? "file" : "files"}</span><button type="button" onClick={() => onClose()}>Cancel</button><button type="button" className={styles.add} disabled={!canAdd} onClick={onCommit}>Add files</button></footer>
    </dialog>, document.body);
}

// Read the selected file on this device. Uploading still belongs to Add files.
function SelectedFilePreview({ file }: { file: File }) {
  const [content, setContent] = useState<{ url?: string; text?: string; error?: string }>({});
  const supported = isBrowserPreviewable(file.type);
  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let objectUrl: string | undefined;
    const load = async () => {
      if (file.type === "text/plain") {
        const text = await file.slice(0, 256_000).text();
        if (!disposed) setContent({ text });
        return;
      }
      // Never frame HTML or another active file mislabeled as a PDF.
      if (file.type === "application/pdf" && await file.slice(0, 5).text() !== "%PDF-") {
        throw new Error("Preview unavailable. You can still add this file.");
      }
      if (disposed) return;
      objectUrl = URL.createObjectURL(file);
      setContent({ url: objectUrl });
    };
    void load().catch(() => {
      if (!disposed) setContent({ error: "Preview unavailable. You can still add this file." });
    });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, supported]);
  if (!supported) return <p className={styles.previewMessage}>Preview isn’t available for this file type. You can still add it.</p>;
  if (content.error) return <p role="status" className={styles.previewMessage}>{content.error}</p>;
  if (content.text !== undefined) return <>
    <pre aria-label={`Preview ${file.name}`} className={styles.textPreview}>{content.text}</pre>
    {file.size > 256_000 ? <p className={styles.previewMessage}>Showing the beginning of this file. The complete file will be added.</p> : null}
  </>;
  if (!content.url) return <p role="status" className={styles.previewMessage}>Loading preview…</p>;
  if (file.type.startsWith("image/")) return <Image src={content.url} alt={`Preview ${file.name}`} width={1200} height={1600} unoptimized className={styles.imagePreview} onError={() => setContent({ error: "Preview unavailable. You can still add this file." })} />;
  return <iframe src={`${content.url}#navpanes=0&view=FitH`} title={`Preview ${file.name}`} className={styles.pdfPreview} />;
}

function QueuedDocuments({ files, onRemove, disabled }: { files: LabeledReferralFile[]; onRemove: (file: File) => void; disabled: boolean }) {
  if (!files.length) return null;
  return <ul aria-label="Queued referral files" className={styles.queued}>
    {files.map(({ file, category }, index) => <li key={index}><FileText size={17} aria-hidden="true" /><span><strong>{file.name}</strong><small>{referralDocumentLabels[category]}</small></span><span className={styles.pending}>Pending upload</span><button type="button" disabled={disabled} aria-label={`Remove queued ${file.name}`} onClick={() => onRemove(file)}><X size={18} aria-hidden="true" /></button></li>)}
  </ul>;
}

function documentSelectionReady(selection: Selection[], readOnly: boolean) {
  return !readOnly && selection.length > 0 && selection.every((item) => Boolean(item.category));
}

function documentCountLabel(dragging: boolean, pending: number, uploaded: number) {
  if (dragging) return "Release to add files";
  if (pending) return `${pending} pending`;
  return `${uploaded} ${uploaded === 1 ? "file" : "files"}`;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

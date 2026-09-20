"use client";

import { useEffect, useEffectEvent, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { assessmentWorkbookChanges, exportAssessmentWorkbook, importAssessmentWorkbook, type AssessmentWorkbookCopy, type WorkbookChange } from "@/lib/assessment/assessment-excel-backup";
import { assessmentWorkbookFingerprint, assessmentWorkbookTemplatePath } from "@/lib/assessment/assessment-workbook-contract";
import { assessmentWorkbookPresentationVersion } from "@/lib/assessment/assessment-workbook-presentation";
import { assessmentInterviewOptionLabel } from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentPatchInput, PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { AssessmentToolData, AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import ClientAssessmentRecord from "./ClientAssessmentRecord";
import styles from "./AssessmentExcelBackup.module.css";

export default function AssessmentExcelBackup({ assessment, data, readOnly, onApply, toolsOpen, onCloseTools, saveStatus, importFile, onImportFileRead }: {
  importFile?: File | null;
  onImportFileRead?: () => void;
  assessment: PipelineAssessmentRecord;
  data: AssessmentToolData;
  readOnly: boolean;
  onApply: (patch: Partial<AssessmentToolData>, expected: AssessmentToolData, source: NonNullable<AssessmentPatchInput["workbook_restore"]>) => Promise<void>;
  toolsOpen: boolean;
  onCloseTools: () => void;
  saveStatus: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [copy, setCopy] = useState<AssessmentWorkbookCopy | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const template = useRef<Uint8Array | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(data); latest.current = data;
  const receivedImport = useRef<File | null>(null);
  const changes = copy ? assessmentWorkbookChanges(copy, data) : [];
  const importDisabled = readOnly || Boolean(busy);
  const selected = changes.filter((change) => approved[changeKey(change)] ?? (!change.conflict && !change.clearing));
  const patch = Object.fromEntries(selected.map((change) => [change.field, change.value])) as Partial<AssessmentToolData>;

  useEffect(() => { void loadTemplate().then((bytes) => { template.current = bytes; }).catch(() => undefined); }, []);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  useEffect(() => {
    if (!open && !busy && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus({ preventScroll: true });
    }
  }, [open, busy]);
  const dismiss = () => {
    returnFocus.current = true;
    dialog.current?.close(); setOpen(false); setCopy(null);
  };
  const close = () => { if (!busy) dismiss(); };
  const workbookIdentity = () => ({ assessmentId: assessment.assessment_id, referralId: assessment.referral_id, origin: window.location.origin });
  const download = async () => {
    setBusy("Preparing Excel copy..."); setMessage("");
    const snapshot = structuredClone(latest.current);
    const owner = workbookIdentity();
    try {
      const bytes = template.current ?? await loadTemplate(); template.current = bytes;
      const result = await exportAssessmentWorkbook(bytes, owner, snapshot);
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = url; link.download = `assessment-${result.exportedAt.replace(/[:.]/g, "-")}.xlsx`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`Copy downloaded at ${new Date(result.exportedAt).toLocaleTimeString()}. Save private client information only to approved secure storage.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not download the Excel copy. Your answers are unchanged."); setOpen(true); }
    finally { setBusy(""); }
  };
  const read = async (file?: File) => {
    if (!file || busy || readOnly) return;
    setCopy(null); setApproved({}); setError(""); setMessage(""); setFilename(file.name); setOpen(true); setBusy("Reading mapped answers...");
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) throw new Error("Choose a Pipeline .xlsx working copy smaller than 5 MB.");
      setCopy(await importAssessmentWorkbook(new Uint8Array(await file.arrayBuffer()), workbookIdentity()));
    } catch (e) { setError(e instanceof Error ? e.message : "This file could not be restored. Your answers are unchanged."); }
    finally { setBusy(""); if (input.current) input.current.value = ""; }
  };
  const receiveImport = useEffectEvent((file: File) => {
    if (readOnly) {
      setError("This assessment is read-only. No workbook answers were changed.");
      setOpen(true);
      onImportFileRead?.();
    } else void read(file).finally(() => onImportFileRead?.());
  });
  useEffect(() => {
    if (!importFile || busy || receivedImport.current === importFile) return;
    receivedImport.current = importFile;
    receiveImport(importFile);
  }, [importFile, busy]);
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault(); setDragging(false);
    if (readOnly || busy) return;
    if (event.dataTransfer.files.length !== 1) {
      setCopy(null); setError("Drop one workbook at a time. No answers were changed."); setOpen(true); return;
    }
    void read(event.dataTransfer.files[0]);
  };
  const apply = async () => {
    if (!copy || !selected.length || readOnly) return;
    setBusy("Committing changes..."); setError("");
    try {
      const owner = workbookIdentity();
      if (copy.assessmentId !== owner.assessmentId || copy.referralId !== owner.referralId || copy.origin !== owner.origin) throw new Error("The open assessment changed. Choose its own workbook before restoring.");
      await onApply(patch, structuredClone(data), { export_id: copy.exportId, exported_at: copy.exportedAt });
      setMessage(`${selected.length} workbook change${selected.length === 1 ? "" : "s"} applied. Check the assessment save status for server sync.`);
      dismiss();
    } catch (e) { setError(e instanceof Error ? e.message : "Restore could not finish. Keep your workbook and check the save status."); }
    finally { setBusy(""); }
  };
  return <>
    {toolsOpen ? <AssessmentRecoveryPanel name={data.resident_name} busy={Boolean(busy) || open} onClose={onCloseTools}>
    <section className={styles.sync} aria-label="Save and sync">
      <h3>Save & sync</h3>
      {saveStatus}
    </section>
    <div className={styles.copyHeading}><h3>Excel working copy</h3><p>Continue in Excel if you need to, then bring your answers back here.</p></div>
    <section data-excel-strip aria-label="Restore Excel workbook" className={styles.strip} data-dragging={dragging || undefined}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = readOnly ? "none" : "copy"; setDragging(true); }}
      onDragLeave={() => setDragging(false)} onDrop={drop}>
      <FileSpreadsheet size={24} className={styles.fileIcon} aria-hidden="true" />
      <button ref={trigger} type="button" className={styles.import} disabled={importDisabled} onClick={() => input.current?.click()} aria-label="Import workbook">
        <Upload size={18} className={styles.uploadIcon} aria-hidden="true" />
        <WorkbookImportPrompt readOnly={readOnly} />
      </button>
      <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Choose workbook" accept=".xlsx" disabled={importDisabled} onChange={(event) => void read(event.target.files?.[0])} />
      <button type="button" className={styles.download} disabled={Boolean(busy)} onClick={() => void download()} aria-label="Download current assessment"><Download size={17} aria-hidden="true" /><span>Download copy</span></button>
      <WorkbookStatus busy={busy} message={message} />
    </section>
    <p className={styles.storageNote}>A download contains your answers at that moment; it does not update itself. Store client information only on approved secure devices.</p>
    </AssessmentRecoveryPanel> : null}
    {open ? createPortal(<dialog ref={dialog} className={styles.panel} aria-labelledby="excel-backup-title" aria-describedby="excel-preview-description" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>Excel import preview</p><h2 id="excel-backup-title">{data.resident_name || "Review assessment"}</h2><p id="excel-preview-description">Nothing changes until you commit. Only selected answers will be replaced.</p></div>
        <button type="button" aria-label="Cancel workbook import" disabled={Boolean(busy)} onClick={close}><X size={22} aria-hidden="true" /></button>
      </header>
      <div className={styles.body}>
        {busy ? <p role="status">{busy}</p> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {copy ? <WorkbookPreview assessment={assessment} data={{ ...data, ...patch }} changes={changes} selected={selected} busy={importDisabled} filename={filename} exportedAt={copy.exportedAt}
          onSelect={(change, checked) => setApproved((current) => ({ ...current, [changeKey(change)]: checked }))} /> : null}
      </div>
      <footer className={styles.footer}>
        <CommitSummary count={selected.length} />
        <button type="button" className={styles.cancel} disabled={Boolean(busy)} onClick={close}>Cancel</button>
        <button type="button" className={styles.commit} disabled={importDisabled || !selected.length} onClick={() => void apply()}>{commitLabel(selected.length)}</button>
      </footer>
    </dialog>, document.body) : null}
  </>;
}

function AssessmentRecoveryPanel({ name, busy, onClose, children }: { name: string | null; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={dialog} className={`${styles.panel} ${styles.toolsPanel}`} aria-labelledby="assessment-recovery-title"
    onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={styles.heading}>
      <div><h2 id="assessment-recovery-title">Backup & recovery</h2><p>{name || "Current assessment"}</p></div>
      <button type="button" aria-label="Close backup and recovery" disabled={busy} onClick={onClose}><X size={22} aria-hidden="true" /></button>
    </header>
    <div className={styles.body}>{children}</div>
    <footer className={styles.footer}><button type="button" className={styles.cancel} disabled={busy} onClick={onClose}>Return to assessment</button></footer>
  </dialog>, document.body);
}

function WorkbookImportPrompt({ readOnly }: { readOnly: boolean }) {
  return <>
    <strong>{readOnly ? "Excel working copy" : "Drop an updated Excel workbook"}</strong>
    <span>{readOnly ? "Download the current assessment." : "or choose a file. Review before replacing any answers."}</span>
  </>;
}

function WorkbookStatus({ busy, message }: { busy: string; message: string }) {
  if (!message && !busy) return null;
  return <p role="status" className={styles.stripStatus}>{busy || message}</p>;
}

function CommitSummary({ count }: { count: number }) {
  return <p>{count ? <><strong>{count}</strong> selected. All other answers stay unchanged.</> : "Your current assessment is unchanged."}</p>;
}

function commitLabel(count: number) { return count ? `Commit ${count} change${count === 1 ? "" : "s"}` : "Commit changes"; }

function WorkbookPreview({ assessment, data, changes, selected, busy, filename, exportedAt, onSelect }: {
  assessment: PipelineAssessmentRecord; data: AssessmentToolData; changes: WorkbookChange[]; selected: WorkbookChange[];
  busy: boolean; filename: string; exportedAt: string; onSelect: (change: WorkbookChange, checked: boolean) => void;
}) {
  return <div className={styles.reviewLayout}>
    <aside aria-label="Proposed changes" className={styles.changes}>
      <h3>{changes.length ? `${changes.length} proposed change${changes.length === 1 ? "" : "s"}` : "No new changes"}</h3>
      <p className={styles.fileInfo}>{filename}<br />Copy saved {new Date(exportedAt).toLocaleString()}</p>
      {changes.map((change) => <WorkbookChangeRow key={changeKey(change)} change={change} checked={selected.includes(change)} disabled={busy} onSelect={onSelect} />)}
    </aside>
    <section aria-label="Populated assessment preview" className={styles.preview}>
      <div className={styles.previewHeading}><Upload size={17} aria-hidden="true" /><span>Assessment after your selected changes</span><b>Not committed</b></div>
      <ClientAssessmentRecord assessment={{ ...assessment, ...data }} />
    </section>
  </div>;
}

function WorkbookChangeRow({ change, checked, disabled, onSelect }: { change: WorkbookChange; checked: boolean; disabled: boolean; onSelect: (change: WorkbookChange, checked: boolean) => void }) {
  return <div className={styles.change} data-selected={checked || undefined} data-conflict={change.conflict || change.clearing || undefined}>
    <label><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onSelect(change, event.target.checked)} aria-label={`Use workbook answer for ${change.label}`} /><strong>{change.label}</strong></label>
    {change.conflict || change.clearing ? <p className={styles.caution}>{change.clearing ? "Clears an existing answer. Select to approve." : "Changed in both copies. Choose which answer to keep."}</p> : null}
    <div className={styles.compare}><div><b>Current</b><p>{format(change.before, change.field)}</p></div><div><b>Workbook</b><p>{format(change.value, change.field)}</p></div></div>
    <span className={styles.choiceStatus}>{checked ? "Use workbook answer" : "Keep current answer"}</span>
  </div>;
}

function changeKey(change: WorkbookChange) { return `${change.field}:${JSON.stringify(change.before)}:${JSON.stringify(change.value)}`; }

function format(value: unknown, field: AssessmentToolFieldKey): string {
  if (value === null || value === "" || value === undefined) return "Blank";
  if (Array.isArray(value)) return value.map((item) => assessmentInterviewOptionLabel(field, item) ?? item).join("\n") || "Blank";
  if (typeof value === "object") return Object.entries(value).map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`).join("\n") || "Blank";
  return assessmentInterviewOptionLabel(field, String(value)) ?? String(value);
}

async function loadTemplate() {
  const url = `${toPipelinePath(assessmentWorkbookTemplatePath)}?schema=${await assessmentWorkbookFingerprint()}&layout=${assessmentWorkbookPresentationVersion}`;
  const cache = typeof caches !== "undefined" ? await caches.open("pipeline-assessment-blank-workbook").catch(() => null) : null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Template download failed.");
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    await cache?.put(url, response).catch(() => undefined);
    return bytes;
  } catch {
    const cached = await cache?.match(url);
    if (cached) return new Uint8Array(await cached.arrayBuffer());
    throw new Error("The blank Excel template is not available on this device yet. Reconnect once, then download your current answers. Your assessment is unchanged.");
  }
}

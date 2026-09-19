"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { assessmentWorkbookChanges, exportAssessmentWorkbook, importAssessmentWorkbook, type AssessmentWorkbookCopy, type WorkbookIdentity } from "@/lib/assessment/assessment-excel-backup";
import { assessmentWorkbookFingerprint, assessmentWorkbookTemplatePath } from "@/lib/assessment/assessment-workbook-contract";
import type { AssessmentPatchInput } from "@/lib/assessment/assessment-records";
import type { AssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import styles from "./AssessmentExcelBackup.module.css";

export default function AssessmentExcelBackup({ identity, data, readOnly, onApply }: {
  identity: Omit<WorkbookIdentity, "origin">;
  data: AssessmentToolData;
  readOnly: boolean;
  onApply: (patch: Partial<AssessmentToolData>, expected: AssessmentToolData, source: NonNullable<AssessmentPatchInput["workbook_restore"]>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copy, setCopy] = useState<AssessmentWorkbookCopy | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const template = useRef<Uint8Array | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(data); latest.current = data;
  const changes = copy ? assessmentWorkbookChanges(copy, data) : [];
  const selected = changes.filter((c) => !c.conflict && !c.clearing || approved[`${c.field}:${JSON.stringify(c.before)}:${JSON.stringify(c.value)}`]);

  useEffect(() => { void loadTemplate().then((bytes) => { template.current = bytes; }).catch(() => undefined); }, []);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const close = () => {
    if (busy) return;
    dialog.current?.close();
    setOpen(false);
    const menu = button.current?.closest("details");
    if (menu && !menu.open) menu.querySelector("summary")?.focus();
    else button.current?.focus();
  };
  const workbookIdentity = () => ({ ...identity, origin: window.location.origin });
  const download = async () => {
    setBusy("Preparing Excel copy..."); setError("");
    const snapshot = structuredClone(latest.current);
    const owner = workbookIdentity();
    try {
      const bytes = template.current ?? await loadTemplate(); template.current = bytes;
      const result = await exportAssessmentWorkbook(bytes, owner, snapshot);
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = url; link.download = `assessment-${result.exportedAt.replace(/[:.]/g, "-")}.xlsx`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`Copy downloaded at ${new Date(result.exportedAt).toLocaleTimeString()}. Includes your current answers, even those waiting to sync.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not download the Excel copy. Your answers are unchanged."); }
    finally { setBusy(""); }
  };
  const read = async (file?: File) => {
    if (!file || busy || readOnly) return;
    setCopy(null); setApproved({}); setError(""); setMessage(""); setBusy("Reading mapped answers...");
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) throw new Error("Choose a Pipeline .xlsx working copy smaller than 5 MB.");
      setCopy(await importAssessmentWorkbook(new Uint8Array(await file.arrayBuffer()), workbookIdentity()));
    } catch (e) { setError(e instanceof Error ? e.message : "This file could not be restored. Your answers are unchanged."); }
    finally { setBusy(""); if (input.current) input.current.value = ""; }
  };
  const apply = async () => {
    if (!copy || !selected.length || readOnly) return;
    setBusy("Restoring answers..."); setError("");
    try {
      const owner = workbookIdentity();
      if (copy.assessmentId !== owner.assessmentId || copy.referralId !== owner.referralId || copy.origin !== owner.origin) throw new Error("The open assessment changed. Choose its own workbook before restoring.");
      await onApply(Object.fromEntries(selected.map((c) => [c.field, c.value])) as Partial<AssessmentToolData>, structuredClone(data), { export_id: copy.exportId, exported_at: copy.exportedAt });
      setMessage("Answers restored to this assessment. Check the save status for server sync."); setCopy(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Restore could not finish. Keep your workbook and check the save status."); }
    finally { setBusy(""); }
  };
  return <>
    <button ref={button} type="button" className={styles.trigger} onClick={() => setOpen(true)}><FileSpreadsheet size={15} aria-hidden="true" />Excel backup</button>
    {open ? createPortal(<dialog ref={dialog} className={styles.panel} aria-labelledby="excel-backup-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); close(); }}>
      <header><div><h2 id="excel-backup-title">Excel backup</h2><p>{data.resident_name || "Current assessment"}</p></div><button type="button" aria-label="Close Excel backup" disabled={Boolean(busy)} onClick={close}><X size={22} /></button></header>
      <div className={styles.body}>
        <p>Take the current answers with you. Continue in Excel, then bring your changes back here.</p>
        <button type="button" className={styles.download} disabled={Boolean(busy)} onClick={() => void download()}><Download size={20} />Download current assessment</button>
        <p className={styles.note}>Private client information. Save only to approved secure storage. A downloaded copy does not update itself.</p>
        {readOnly ? <p>This assessment is read-only. You can download it, but Excel cannot change a signed or sent assessment.</p> : <section className={styles.drop} aria-label="Restore Excel workbook" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length !== 1) { setError("Drop one workbook at a time."); return; } void read(e.dataTransfer.files[0]); }}>
          <Upload size={22} aria-hidden="true" /><strong>Drop your updated workbook here</strong><span>Or choose the .xlsx file from this device.</span>
          <label className={styles.choose}>Choose workbook<input ref={input} type="file" accept=".xlsx" disabled={Boolean(busy)} onChange={(e) => void read(e.target.files?.[0])} /></label>
        </section>}
        {busy ? <p role="status">{busy}</p> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {message ? <p role="status" className={styles.message}>{message}</p> : null}
        {copy ? <section aria-label="Workbook changes" className={styles.changes}>
          <h3>{changes.length ? `${changes.length} changed answer${changes.length === 1 ? "" : "s"}` : "No new changes"}</h3>
          <p>Copy saved {new Date(copy.exportedAt).toLocaleString()}. Unchanged workbook answers leave the current assessment alone.</p>
          {changes.map((change) => {
            const key = `${change.field}:${JSON.stringify(change.before)}:${JSON.stringify(change.value)}`;
            return <details key={key} open={change.conflict || change.clearing}><summary>{change.label}{change.clearing ? " - clearing an answer" : change.conflict ? " - changed in both copies" : ""}</summary>
              <div className={styles.compare}><div><b>Current assessment</b><p>{format(change.before)}</p></div><div><b>Workbook</b><p>{format(change.value)}</p></div></div>
              {change.conflict || change.clearing ? <label><input type="checkbox" checked={Boolean(approved[key])} onChange={(e) => setApproved((state) => ({ ...state, [key]: e.target.checked }))} />{change.clearing ? "Clear this answer" : "Use the workbook answer"}</label> : null}
            </details>;
          })}
          {changes.length ? <button type="button" className={styles.download} disabled={Boolean(busy) || !selected.length || readOnly} onClick={() => void apply()}>Apply {selected.length} answer{selected.length === 1 ? "" : "s"}</button> : null}
        </section> : null}
      </div>
    </dialog>, document.body) : null}
  </>;
}

function format(value: unknown): string {
  if (value === null || value === "" || value === undefined) return "Blank";
  if (Array.isArray(value)) return value.join("\n") || "Blank";
  if (typeof value === "object") return Object.entries(value).map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`).join("\n") || "Blank";
  return String(value);
}

async function loadTemplate() {
  const url = `${toPipelinePath(assessmentWorkbookTemplatePath)}?schema=${await assessmentWorkbookFingerprint()}`;
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

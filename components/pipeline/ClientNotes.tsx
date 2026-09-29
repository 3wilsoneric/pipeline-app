"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CloudUpload, LoaderCircle, NotebookPen, PanelRightClose, X } from "lucide-react";

import { combinedClientNote, noteHeadings, unifiedNoteKey, unifiedNoteMaxLength } from "@/lib/pipeline/client-notes";
import { useClientNotes, type NotesStatus } from "@/components/pipeline/useClientNotes";
import { useLatestNotes } from "@/components/pipeline/useLatestNotes";
import { useMobileViewport } from "./use-mobile-viewport";
import styles from "./ClientNotes.module.css";

// One shared note follows the client through preparation and interview. Existing
// topic notes appear together here until the first edit consolidates them.

const statusText: Record<NotesStatus, string> = {
  loading: "Loading…",
  saved: "All notes saved",
  saving: "Saving…",
  waiting: "Waiting to sync",
  failed: "Not saved",
};

export default function ClientNotes({ referralId, readOnly, onCollapse, onClose }: {
  referralId: number;
  readOnly: boolean;
  /** Beside the questions while preparing: hide the column. */
  onCollapse?: () => void;
  /** In the floating panel: close it. */
  onClose?: () => void;
}) {
  const notes = useClientNotes(referralId, readOnly);
  const instance = useId();
  const body = combinedClientNote(notes.entries);
  const labels = new Map(noteHeadings().map(({ key, label }) => [key, label]));
  const fieldId = `notes-${instance}`;

  const StatusIcon = notes.status === "failed" ? AlertTriangle : notes.status === "waiting" ? CloudUpload : notes.status === "saved" ? Check : LoaderCircle;
  return <section aria-labelledby={`notes-title-${instance}`} className={styles.notes} data-client-notes data-status={notes.status}>
    <header className={styles.head}>
      <h3 id={`notes-title-${instance}`}><NotebookPen size={16} aria-hidden="true" />Notes</h3>
      <span role="status" aria-live="polite" className={styles.status}>
        <StatusIcon size={14} aria-hidden="true" className={notes.status === "saving" || notes.status === "loading" ? "motion-safe:animate-spin" : undefined} />{statusText[notes.status]}
      </span>
      {notes.failed._recovery && !notes.loadFailed ? <button type="button" onClick={notes.reload}>Retry</button> : null}
      {onCollapse ? <button type="button" aria-label="Hide notes" title="Hide notes" onClick={onCollapse} className={styles.iconButton}><PanelRightClose size={16} aria-hidden="true" /></button> : null}
      {onClose ? <button type="button" aria-label="Close notes" title="Close notes" onClick={onClose} className={styles.iconButton}><X size={16} aria-hidden="true" /></button> : null}
    </header>
    {notes.loadFailed ? <p role="alert" className={styles.notice}>Notes could not be loaded. <button type="button" onClick={notes.reload}>Retry</button></p> : null}
    <div className={styles.blocks}>
      <div data-note-heading={unifiedNoteKey} className={styles.block}>
        <NoteField id={fieldId} value={body} disabled={notes.readOnly || !notes.loaded}
          onChange={(value) => notes.change(unifiedNoteKey, value)} onBlur={() => notes.flush(unifiedNoteKey)} />
        {Object.entries(notes.conflicts).map(([key, conflict]) => <div key={key} role="alert" className={styles.conflict}>
          <p>{labels.get(key) ?? "These notes"} changed on another screen by {conflict.theirs.updated_by_name}.</p>
          <div>
            <button type="button" onClick={() => notes.resolve(key, "mine")}>Keep mine</button>
            <button type="button" onClick={() => notes.resolve(key, "theirs")}>Use theirs</button>
          </div>
        </div>)}
        {Object.entries(notes.failed).filter(([key]) => key !== "_recovery").map(([key, error]) => <p key={key} role="alert" className={styles.error}>{labels.get(key) ? `${labels.get(key)}: ` : ""}{error}</p>)}
      </div>
    </div>
  </section>;
}

// Grows with its text so a heading's notes read as a page, not a scrolling box.
function NoteField({ id, value, disabled, onChange, onBlur }: {
  id: string; value: string; disabled: boolean;
  onChange: (value: string) => void; onBlur: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(88, element.scrollHeight)}px`;
  }, [value]);
  return <textarea ref={field} id={id} aria-label="Notes" value={value} disabled={disabled}
    maxLength={unifiedNoteMaxLength} placeholder="Type notes" spellCheck className={styles.field}
    onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />;
}

// Shown in place of the column while it is hidden.
export function ClientNotesReopen({ onOpen }: { onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className={styles.reopen}><NotebookPen size={16} aria-hidden="true" />Notes</button>;
}

// On steps without notes beside the questions: a round button at the bottom right that opens the same notes
// upward from it. Rendered after the referral loads, so it portals to <body>.
export function ClientNotesButton({ referralId, readOnly }: { referralId: number; readOnly: boolean }) {
  const viewport = useMobileViewport();
  const [open, setOpen] = useState(false);
  const latest = useLatestNotes([referralId]).get(referralId);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) panel.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [open]);
  const close = () => { setOpen(false); requestAnimationFrame(() => button.current?.focus()); };
  return createPortal(<div ref={viewport} className={styles.floating}>
    {open ? <div ref={panel} role="dialog" aria-label="Notes" className={styles.panel}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <ClientNotes referralId={referralId} readOnly={readOnly} onClose={close} />
    </div> : null}
    <button ref={button} type="button" aria-label="Notes" aria-expanded={open} title={latest?.text} onClick={() => (open ? close() : setOpen(true))}
      className={styles.fab} data-has-note={latest ? true : undefined}>
      <NotebookPen size={20} aria-hidden="true" />
    </button>
  </div>, document.body);
}

// The latest note on a referral, one or two lines, for the Home board and Workspaces.
export function ClientNoteLine({ note, id, compact = false }: { note?: { text: string }; id?: string; compact?: boolean }) {
  if (!note) return null;
  return <span id={id} data-client-note className={compact ? `${styles.line} ${styles.compact}` : styles.line} title={note.text}>
    <NotebookPen size={13} aria-hidden="true" className={styles.lineIcon} />
    <span className={styles.lineText}><span className={styles.srOnly}>Latest note: </span>{note.text}</span>
  </span>;
}

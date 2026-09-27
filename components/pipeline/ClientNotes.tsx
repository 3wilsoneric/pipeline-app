"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, CloudUpload, LoaderCircle, NotebookPen, PanelRightClose, X } from "lucide-react";

import { noteBlockMaxLength, noteHeadings } from "@/lib/pipeline/client-notes";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { useClientNotes, type NotesStatus } from "@/components/pipeline/useClientNotes";
import { useLatestNotes } from "@/components/pipeline/useLatestNotes";
import styles from "./ClientNotes.module.css";

// Client notes (docs/design/DECISIONS.md, "Notes"): the assessor's notes on this client, taken while
// preparing for and doing the interview, attached to the referral for anyone who opens it. The heading for
// the topic in view opens by itself, so what is typed lands in the right place without filing.

const statusText: Record<NotesStatus, string> = {
  loading: "Loading…",
  saved: "All notes saved",
  saving: "Saving…",
  waiting: "Waiting to sync",
  failed: "Not saved",
};

export default function ClientNotes({ referralId, readOnly, currentTopics = [], onCollapse, onClose }: {
  referralId: number;
  readOnly: boolean;
  /** Interview topics in view: one in the interview, a preparation group's topics while preparing. */
  currentTopics?: readonly AssessmentToolSection[];
  /** Beside the questions while preparing: hide the column. */
  onCollapse?: () => void;
  /** In the floating panel: close it. */
  onClose?: () => void;
}) {
  const notes = useClientNotes(referralId, readOnly);
  const headings = noteHeadings();
  const currentKeys = currentTopics.map((topic) => `topic:${topic}`);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  // Beside the questions, only the topic in view shows, so the notes read as a page to write on, not another
  // list to navigate (owner, 2026-09-26); "View all" opens every heading.
  const [viewAll, setViewAll] = useState(false);
  const focused = currentKeys.length > 0 && !viewAll;
  // The note being typed in stays on screen while the questions scroll to another topic, so it never swaps
  // out from under the cursor; the new topic's note appears once the person leaves this one.
  const [typingIn, setTypingIn] = useState<string | null>(null);
  const shownKeys = focused ? (typingIn && !currentKeys.includes(typingIn) ? [typingIn] : currentKeys) : null;
  const list = useRef<HTMLDivElement>(null);
  const current = currentKeys[0];

  // Follow the interview: bring the current topic's heading into view inside the notes, not the page.
  useLayoutEffect(() => {
    if (!current || !list.current || focused) return;
    const heading = list.current.querySelector<HTMLElement>(`[data-note-heading="${current}"]`);
    if (!heading) return;
    const top = heading.getBoundingClientRect().top - list.current.getBoundingClientRect().top + list.current.scrollTop;
    list.current.scrollTo({ top: Math.max(0, top - 6), behavior: "smooth" });
  }, [current, focused]);

  const StatusIcon = notes.status === "failed" ? AlertTriangle : notes.status === "waiting" ? CloudUpload : notes.status === "saved" ? Check : LoaderCircle;
  return <section aria-labelledby={`notes-title-${referralId}`} className={styles.notes} data-client-notes data-status={notes.status}>
    <header className={styles.head}>
      <h3 id={`notes-title-${referralId}`}><NotebookPen size={16} aria-hidden="true" />Notes</h3>
      <span role="status" aria-live="polite" className={styles.status}>
        <StatusIcon size={14} aria-hidden="true" className={notes.status === "saving" || notes.status === "loading" ? "motion-safe:animate-spin" : undefined} />{statusText[notes.status]}
      </span>
      {currentKeys.length ? <button type="button" aria-pressed={viewAll} onClick={() => setViewAll(!viewAll)} className={styles.viewAll}>View all</button> : null}
      {onCollapse ? <button type="button" aria-label="Hide notes" title="Hide notes" onClick={onCollapse} className={styles.iconButton}><PanelRightClose size={16} aria-hidden="true" /></button> : null}
      {onClose ? <button type="button" aria-label="Close notes" title="Close notes" onClick={onClose} className={styles.iconButton}><X size={16} aria-hidden="true" /></button> : null}
    </header>
    {notes.loadFailed ? <p role="alert" className={styles.notice}>Notes could not be loaded. Reload to try again.</p> : null}
    <div ref={list} className={styles.blocks} data-focused={focused || undefined}>
      {headings.filter((heading) => !shownKeys || shownKeys.includes(heading.key)).map((heading) => {
        const body = notes.entries[heading.key]?.body ?? "";
        const isCurrent = currentKeys.includes(heading.key);
        const open = focused || (opened[heading.key] ?? (isCurrent || (heading.key === "before" && !current)));
        const conflict = notes.conflicts[heading.key];
        const error = notes.failed[heading.key];
        const fieldId = `notes-${referralId}-${heading.key}`;
        return <section key={heading.key} data-note-heading={heading.key} data-current={isCurrent || undefined} data-open={open || undefined} className={styles.block}>
          {focused ? <p className={styles.blockHead}><span className={styles.blockLabel}>{heading.label}</span></p>
          : <button type="button" aria-expanded={open} aria-controls={fieldId} onClick={() => setOpened((existing) => ({ ...existing, [heading.key]: !open }))} className={styles.blockHead}>
            <ChevronDown size={14} aria-hidden="true" className={styles.chevron} />
            <span className={styles.blockLabel}>{heading.label}</span>
            {!open && body ? <span className={styles.preview}>{body.split("\n").find((line) => line.trim())}</span> : null}
          </button>}
          {open ? <NoteField id={fieldId} label={heading.label} value={body} disabled={notes.readOnly || !notes.loaded}
            onChange={(value) => notes.change(heading.key, value)} onFocus={() => setTypingIn(heading.key)} onBlur={() => { setTypingIn(null); notes.flush(heading.key); }} /> : null}
          {conflict ? <div role="alert" className={styles.conflict}>
            <p>These notes were changed on another screen by {conflict.theirs.updated_by_name}.</p>
            <div>
              <button type="button" onClick={() => notes.resolve(heading.key, "mine")}>Keep mine</button>
              <button type="button" onClick={() => notes.resolve(heading.key, "theirs")}>Use theirs</button>
            </div>
          </div> : null}
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </section>;
      })}
    </div>
  </section>;
}

// Grows with its text so a heading's notes read as a page, not a scrolling box.
function NoteField({ id, label, value, disabled, onChange, onFocus, onBlur }: {
  id: string; label: string; value: string; disabled: boolean;
  onChange: (value: string) => void; onFocus?: () => void; onBlur: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(88, element.scrollHeight)}px`;
  }, [value]);
  return <textarea ref={field} id={id} aria-label={`${label} notes`} value={value} disabled={disabled}
    maxLength={noteBlockMaxLength} placeholder="Type notes" spellCheck className={styles.field}
    onChange={(event) => onChange(event.target.value)} onFocus={onFocus} onBlur={onBlur} />;
}

// Shown in place of the column while it is hidden.
export function ClientNotesReopen({ onOpen }: { onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className={styles.reopen}><NotebookPen size={16} aria-hidden="true" />Notes</button>;
}

// On steps without notes beside the questions: a round button at the bottom right that opens the same notes
// upward from it. Rendered after the referral loads, so it portals to <body>.
export function ClientNotesButton({ referralId, readOnly }: { referralId: number; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const latest = useLatestNotes([referralId]).get(referralId);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => button.current?.focus()); };
  return createPortal(<div className={styles.floating}>
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

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StickyNote, X } from "lucide-react";

import { quickNoteMaxLength } from "@/lib/pipeline/referral-quick-notes";
import { saveQuickNote, useQuickNote, useQuickNotes } from "@/components/pipeline/useQuickNotes";
import styles from "./QuickNote.module.css";

// Quick note (docs/design/DECISIONS.md, "Quick note"): each person's own private reminder of where a
// referral stands. Written in the record rail; read on the Home board and the workspace list.

// `tab`: one line shaped as a folder tab, for the stacked Home board where only the tab row shows.
export function QuickNoteLine({ referralId, id, compact = false, tab = false }: { referralId: number; id?: string; compact?: boolean; tab?: boolean }) {
  const note = useQuickNotes().get(referralId);
  if (!note) return null;
  return <span id={id} data-quick-note className={`${styles.line}${compact ? ` ${styles.compact}` : ""}${tab ? ` ${styles.tab}` : ""}`} title={note.text}>
    <StickyNote size={13} aria-hidden="true" className={styles.icon} />
    <span className={styles.lineText}><span className={styles.srOnly}>Quick note: </span>{note.text}</span>
  </span>;
}

const saveDelayMs = 800;

// Render with key={referralId}: an instance only ever saves to its own referral.
// A floating button at the bottom right of the record opens the writing panel upward from it
// (owner, 2026-09-26). Rendered client-side only, after the referral loads, so it portals to <body>.
export function QuickNoteEditor({ referralId }: { referralId: number }) {
  const note = useQuickNote(referralId);
  const saved = note?.text ?? "";
  // null: showing the saved note. A string: the person's unsaved typing, kept until it saves.
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLButtonElement>(null);
  const value = draft ?? saved;
  const fieldId = `quick-note-${referralId}`;

  const save = async (text: string) => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    pending.current = null;
    try {
      await saveQuickNote(referralId, text);
      setError("");
      if (document.activeElement !== field.current) setDraft(null);
    } catch {
      pending.current = text;
      setError("Could not save. Your edits are still here; try again.");
    }
  };

  // Save what was typed when the person moves to another record.
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current !== null) void saveQuickNote(referralId, pending.current).catch(() => undefined);
  }, [referralId]);

  useEffect(() => {
    if (!open || !field.current) return;
    const element = field.current;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [open]);

  const panel = useRef<HTMLDivElement>(null);
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (pending.current !== null) void save(pending.current);
    else if (!error) setDraft(null);
    if (returnFocus) requestAnimationFrame(() => preview.current?.focus());
  };

  return createPortal(<div className={styles.floating} data-quick-note-editor>
    {open ? <div ref={panel} role="dialog" aria-labelledby={`${fieldId}-title`} className={styles.panel} onBlur={(event) => { if (!panel.current?.contains(event.relatedTarget as Node | null)) close(false); }}>
      <div className={styles.panelHead}>
        <span id={`${fieldId}-title`} className={styles.panelTitle}><StickyNote size={15} aria-hidden="true" />Quick note</span>
        {note?.updatedAt ? <time dateTime={note.updatedAt} className={styles.panelMeta}>{formatNoteTime(note.updatedAt)}</time> : null}
        <button type="button" aria-label="Close" onClick={() => close(true)} className={styles.panelClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <textarea
        ref={field}
        id={fieldId}
        aria-labelledby={`${fieldId}-title`}
        maxLength={quickNoteMaxLength}
        value={value}
        placeholder="Add quick note"
        className={styles.field}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          pending.current = text;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(text), saveDelayMs);
        }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(true); } }}
      />
      <div className={styles.panelFoot} aria-hidden="true">{value.length.toLocaleString()} / {quickNoteMaxLength.toLocaleString()}</div>
    </div> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <button ref={preview} type="button" aria-label="Quick note" aria-describedby={value ? `${fieldId}-preview` : undefined} aria-expanded={open} title={value || undefined}
      onClick={() => (open ? close(true) : setOpen(true))} className={styles.fab} data-has-note={value ? true : undefined}>
      <StickyNote size={20} aria-hidden="true" />
      {value ? <span id={`${fieldId}-preview`} className={styles.srOnly}>{value}</span> : null}
    </button>
  </div>, document.body);
}

function formatNoteTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

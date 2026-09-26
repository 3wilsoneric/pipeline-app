"use client";

import { useEffect, useRef, useState } from "react";
import { StickyNote } from "lucide-react";

import { quickNoteMaxLength } from "@/lib/pipeline/referral-quick-notes";
import { saveQuickNote, useQuickNote, useQuickNotes } from "@/components/pipeline/useQuickNotes";
import styles from "./QuickNote.module.css";

// Quick note (docs/design/DECISIONS.md, "Quick note"): each person's own private reminder of where a
// referral stands. Written in the record rail; read on the Home board and the workspace list.

export function QuickNoteLine({ referralId, id, compact = false }: { referralId: number; id?: string; compact?: boolean }) {
  const note = useQuickNotes().get(referralId);
  if (!note) return null;
  return <span id={id} data-quick-note className={compact ? `${styles.line} ${styles.compact}` : styles.line} title={note.text}>
    <StickyNote size={13} aria-hidden="true" className={styles.icon} />
    <span className={styles.lineText}><span className={styles.srOnly}>Quick note: </span>{note.text}</span>
  </span>;
}

const saveDelayMs = 800;

// Render with key={referralId}: an instance only ever saves to its own referral.
export function QuickNoteEditor({ referralId }: { referralId: number }) {
  const saved = useQuickNote(referralId)?.text ?? "";
  // null: showing the saved note. A string: the person's unsaved typing, kept until it saves.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const value = draft ?? saved;

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
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return <div className={styles.editor} data-quick-note-editor>
    <label className={styles.label} htmlFor={`quick-note-${referralId}`}><StickyNote size={13} aria-hidden="true" />Quick note</label>
    <textarea
      ref={field}
      id={`quick-note-${referralId}`}
      rows={2}
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
      onBlur={() => {
        if (pending.current !== null) void save(pending.current);
        else if (!error) setDraft(null);
      }}
    />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </div>;
}

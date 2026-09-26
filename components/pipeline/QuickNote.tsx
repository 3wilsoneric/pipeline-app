"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StickyNote, X } from "lucide-react";

import { quickNoteMaxLength, quickNoteStepLabels, quickNoteSteps, type QuickNoteEntry, type QuickNoteEntryInput, type QuickNoteStep } from "@/lib/pipeline/referral-quick-notes";
import { saveQuickNote, useQuickNote, useQuickNotes } from "@/components/pipeline/useQuickNotes";
import styles from "./QuickNote.module.css";

// Quick note (docs/design/DECISIONS.md, "Quick note"): each person's own private reminder of where a
// referral stands. Written in the record rail; read on the Home board and the workspace list.

export function QuickNoteLine({ referralId, id, compact = false }: { referralId: number; id?: string; compact?: boolean }) {
  const latest = useQuickNotes().get(referralId)?.entries[0];
  if (!latest) return null;
  return <span id={id} data-quick-note className={compact ? `${styles.line} ${styles.compact}` : styles.line} title={latest.text}>
    <StickyNote size={13} aria-hidden="true" className={styles.icon} />
    <span className={styles.lineText}><span className={styles.srOnly}>Quick note: </span>{latest.text}</span>
  </span>;
}

const saveDelayMs = 800;
const newEntryId = () => crypto.randomUUID();
const inputOf = ({ id, text, step }: QuickNoteEntry): QuickNoteEntryInput => ({ id, text, step });
const isToday = (value: string) => new Date(value).toDateString() === new Date().toDateString();

// Render with key={`${referralId}-${step}`}: an instance only ever saves to its own referral and step.
// A floating button at the bottom right of the record opens the writing panel upward from it
// (owner, 2026-09-26). Rendered client-side only, after the referral loads, so it portals to <body>.
// Notes structure themselves (owner, 2026-09-26): typing continues today's entry for this step, or
// starts a new one; earlier entries list below, newest first, each with its date and step.
export function QuickNoteEditor({ referralId, step }: { referralId: number; step: QuickNoteStep | null }) {
  const note = useQuickNote(referralId);
  const entries = note?.entries ?? [];
  const current = entries.find((entry) => entry.step === step && isToday(entry.at));
  const [freshId] = useState(newEntryId);
  const currentId = current?.id ?? freshId;
  const earlier = entries.filter((entry) => entry.id !== currentId);
  // Every note is listed below the entry box, from all steps; chips narrow it to one step.
  const [filter, setFilter] = useState<QuickNoteStep | "all">("all");
  const stepCounts = quickNoteSteps.map((key) => [key, earlier.filter((entry) => entry.step === key).length] as const).filter(([, count]) => count > 0);
  // A step whose last note was deleted falls back to All.
  const activeFilter = filter !== "all" && !stepCounts.some(([key]) => key === filter) ? "all" : filter;
  const shown = activeFilter === "all" ? earlier : earlier.filter((entry) => entry.step === activeFilter);
  // null: showing the saved entry. A string: the person's unsaved typing, kept until it saves.
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<QuickNoteEntryInput[] | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLButtonElement>(null);
  const value = draft ?? current?.text ?? "";
  const latest = entries[0]?.text ?? "";
  const fieldId = `quick-note-${referralId}`;
  const withCurrent = (text: string, without?: string): QuickNoteEntryInput[] =>
    [{ id: currentId, text, step }, ...earlier.map(inputOf)].filter((entry) => entry.id !== without);

  const save = async (input: QuickNoteEntryInput[]) => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    pending.current = null;
    try {
      await saveQuickNote(referralId, input);
      setError("");
      if (document.activeElement !== field.current) setDraft(null);
    } catch {
      pending.current = input;
      setError("Could not save. Your edits are still here; try again.");
    }
  };

  // Save what was typed when the person moves to another record or step.
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
  const remove = (entry: QuickNoteEntry) => {
    const input = withCurrent(value, entry.id);
    pending.current = input;
    void save(input);
  };

  return createPortal(<div className={styles.floating} data-quick-note-editor>
    {open ? <div ref={panel} role="dialog" aria-labelledby={`${fieldId}-title`} className={styles.panel} onBlur={(event) => { if (!panel.current?.contains(event.relatedTarget as Node | null)) close(false); }}>
      <div className={styles.panelHead}>
        <span id={`${fieldId}-title`} className={styles.panelTitle}><StickyNote size={15} aria-hidden="true" />Quick note</span>
        <button type="button" aria-label="Close" onClick={() => close(true)} className={styles.panelClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <div className={styles.entryMeta}><EntryStamp at={current?.at ?? new Date().toISOString()} step={step} /></div>
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
          const input = withCurrent(text);
          setDraft(text);
          pending.current = input;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(input), saveDelayMs);
        }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(true); } }}
      />
      <div className={styles.panelFoot} aria-hidden="true">{value.length.toLocaleString()} / {quickNoteMaxLength.toLocaleString()}</div>
      {earlier.length ? <div className={styles.filters} role="group" aria-label="Show notes from">
        <button type="button" aria-pressed={activeFilter === "all"} onClick={() => setFilter("all")} className={styles.filter}>All <span>{earlier.length}</span></button>
        {stepCounts.map(([key, count]) => <button key={key} type="button" aria-pressed={activeFilter === key} onClick={() => setFilter(key)} className={styles.filter} data-step={key}>{quickNoteStepLabels[key]} <span>{count}</span></button>)}
      </div> : null}
      {earlier.length ? <ol className={styles.entries}>
        {shown.map((entry) => <li key={entry.id} className={styles.entry}>
          <div className={styles.entryMeta}>
            <EntryStamp at={entry.at} step={entry.step} />
            <button type="button" aria-label={`Delete note from ${formatNoteDate(entry.at)}`} onClick={() => remove(entry)} className={styles.entryDelete}><X size={14} aria-hidden="true" /></button>
          </div>
          <p className={styles.entryText}>{entry.text}</p>
        </li>)}
      </ol> : null}
    </div> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <button ref={preview} type="button" aria-label="Quick note" aria-describedby={latest ? `${fieldId}-preview` : undefined} aria-expanded={open} title={latest || undefined}
      onClick={() => (open ? close(true) : setOpen(true))} className={styles.fab} data-has-note={latest ? true : undefined}>
      <StickyNote size={20} aria-hidden="true" />
      {latest ? <span id={`${fieldId}-preview`} className={styles.srOnly}>{latest}</span> : null}
    </button>
  </div>, document.body);
}

function EntryStamp({ at, step }: { at: string; step: QuickNoteStep | null }) {
  return <>
    <time dateTime={at} className={styles.entryDate}>{formatNoteDate(at)}</time>
    {step ? <span className={styles.stepTag} data-step={step}>{quickNoteStepLabels[step]}</span> : null}
  </>;
}

function formatNoteDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

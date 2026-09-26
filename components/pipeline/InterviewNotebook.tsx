"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, CloudUpload, LoaderCircle, NotebookPen, PanelRightClose } from "lucide-react";

import { notebookBlockMaxLength, notebookHeadings } from "@/lib/assessment/assessment-notebook";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { useInterviewNotebook, type NotebookStatus } from "@/components/pipeline/useInterviewNotebook";
import styles from "./InterviewNotebook.module.css";

// Interview notebook (docs/design/DECISIONS.md, "Interview notebook"): the assessor's preparation and
// interview notes, beside the questions, part of the assessment record. The heading for the topic in view
// opens by itself, so what is typed lands in the right place without filing.

const statusText: Record<NotebookStatus, string> = {
  loading: "Loading…",
  saved: "All notes saved",
  saving: "Saving…",
  waiting: "Waiting to sync",
  failed: "Not saved",
};

export default function InterviewNotebook({ assessmentId, locked, currentTopics, onCollapse }: {
  assessmentId: string;
  locked: boolean;
  /** Interview topics in view: one in the interview, a preparation group's topics while preparing. */
  currentTopics: readonly AssessmentToolSection[];
  /** Where the notebook can be hidden (preparing); in the interview it lives in a tab instead. */
  onCollapse?: () => void;
}) {
  const notebook = useInterviewNotebook(assessmentId, locked);
  const headings = notebookHeadings();
  const currentKeys = currentTopics.map((topic) => `topic:${topic}`);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const list = useRef<HTMLDivElement>(null);
  const current = currentKeys[0];

  // Follow the interview: bring the current topic's heading into view inside the notebook, not the page.
  useLayoutEffect(() => {
    if (!current || !list.current) return;
    const heading = list.current.querySelector<HTMLElement>(`[data-notebook-block="${current}"]`);
    if (heading) list.current.scrollTo({ top: heading.offsetTop - 8, behavior: "smooth" });
  }, [current]);

  const StatusIcon = notebook.status === "failed" ? AlertTriangle : notebook.status === "waiting" ? CloudUpload : notebook.status === "saved" ? Check : LoaderCircle;
  return <aside aria-labelledby={`notebook-title-${assessmentId}`} className={styles.notebook} data-interview-notebook data-status={notebook.status}>
    <header className={styles.head}>
      <h3 id={`notebook-title-${assessmentId}`}><NotebookPen size={16} aria-hidden="true" />Interview notes</h3>
      <span role="status" aria-live="polite" className={styles.status}>
        <StatusIcon size={14} aria-hidden="true" className={notebook.status === "saving" || notebook.status === "loading" ? "motion-safe:animate-spin" : undefined} />{statusText[notebook.status]}
      </span>
      {onCollapse ? <button type="button" aria-label="Hide interview notes" title="Hide interview notes" onClick={onCollapse} className={styles.collapse}><PanelRightClose size={16} aria-hidden="true" /></button> : null}
    </header>
    {notebook.loadFailed ? <p role="alert" className={styles.notice}>Interview notes could not be loaded. Reload to try again.</p> : null}
    {notebook.locked ? <p className={styles.notice}>Signed. Add an addendum to change the record.</p> : null}
    <div ref={list} className={styles.blocks}>
      {headings.map((heading) => {
        const entry = notebook.entries[heading.key];
        const body = entry?.body ?? "";
        const isCurrent = currentKeys.includes(heading.key);
        const open = opened[heading.key] ?? (isCurrent || heading.key === "before" && !body && !current);
        const conflict = notebook.conflicts[heading.key];
        const error = notebook.failed[heading.key];
        const fieldId = `notebook-${assessmentId}-${heading.key}`;
        return <section key={heading.key} data-notebook-block={heading.key} data-current={isCurrent || undefined} data-open={open || undefined} className={styles.block}>
          <button type="button" aria-expanded={open} aria-controls={fieldId} onClick={() => setOpened((existing) => ({ ...existing, [heading.key]: !open }))} className={styles.blockHead}>
            <ChevronDown size={14} aria-hidden="true" className={styles.chevron} />
            <span className={styles.blockLabel}>{heading.label}</span>
            {!open && body ? <span className={styles.preview}>{body.split("\n").find((line) => line.trim())}</span> : null}
          </button>
          {open ? <NotebookField id={fieldId} label={heading.label} value={body} disabled={notebook.locked || !notebook.loaded} autoFocus={false}
            onChange={(value) => notebook.change(heading.key, value)} onBlur={() => notebook.flush(heading.key)} /> : null}
          {conflict ? <div role="alert" className={styles.conflict}>
            <p>These notes were changed on another screen by {conflict.theirs.updated_by_name}.</p>
            <div>
              <button type="button" onClick={() => notebook.resolve(heading.key, "mine")}>Keep mine</button>
              <button type="button" onClick={() => notebook.resolve(heading.key, "theirs")}>Use theirs</button>
            </div>
          </div> : null}
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </section>;
      })}
    </div>
  </aside>;
}

// Grows with its text so a heading's notes read as a page, not a scrolling box.
function NotebookField({ id, label, value, disabled, autoFocus, onChange, onBlur }: {
  id: string; label: string; value: string; disabled: boolean; autoFocus: boolean;
  onChange: (value: string) => void; onBlur: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(88, element.scrollHeight)}px`;
  }, [value]);
  return <textarea ref={field} id={id} aria-label={`${label} notes`} value={value} disabled={disabled} autoFocus={autoFocus}
    maxLength={notebookBlockMaxLength} placeholder="Type notes" spellCheck className={styles.field}
    onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />;
}

// Shown in the notebook's place while it is hidden.
export function InterviewNotebookReopen({ onOpen }: { onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className={styles.reopen}><NotebookPen size={16} aria-hidden="true" />Interview notes</button>;
}

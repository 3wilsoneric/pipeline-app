"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CloudUpload, GripVertical, LoaderCircle, MoveDiagonal2, NotebookPen, PanelRightClose, PanelRightOpen, X } from "lucide-react";

import { combinedClientNote, noteHeadings, unifiedNoteKey } from "@/lib/pipeline/client-notes";
import ClientNoteEditor from "./ClientNoteEditor";
import { useClientNotes, type NotesStatus } from "@/components/pipeline/useClientNotes";
import { useLatestNotes } from "@/components/pipeline/useLatestNotes";
import { useMobileViewport } from "./use-mobile-viewport";
import styles from "./ClientNotes.module.css";

// One shared note follows the client through preparation and interview. Existing
// topic notes appear together here until the first edit consolidates them.

const statusText: Record<NotesStatus, string> = {
  loading: "Loading…",
  saved: "All notes saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  waiting: "Waiting to sync",
  failed: "Not saved",
};

type NotePosition = { x: number; y: number };

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
  const panel = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const dockTarget = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<NotePosition | null>(null);
  const [moving, setMoving] = useState(false);
  const [overDock, setOverDock] = useState(false);
  const drag = useRef<{ cleanup: () => void; cancel: () => void } | null>(null);
  const suppressClick = useRef(false);
  const floating = Boolean(onClose) || position !== null;

  const constrain = (point: NotePosition) => ({
    x: Math.max(12, Math.min(point.x, window.innerWidth - (panel.current?.offsetWidth ?? 440) - 12)),
    y: Math.max(12, Math.min(point.y, window.innerHeight - (panel.current?.offsetHeight ?? 480) - 12)),
  });
  useLayoutEffect(() => {
    if (!floating) return;
    const target = window.matchMedia("(max-width: 767px)").matches ? panel.current?.querySelector<HTMLButtonElement>('button[aria-label="Close notes"]') : handle.current;
    target?.focus({ preventScroll: true });
    const resize = () => setPosition((current) => {
      const rect = panel.current?.getBoundingClientRect();
      if (!rect) return current;
      const point = current ?? { x: rect.x, y: rect.y };
      const next = constrain(point);
      return next.x === point.x && next.y === point.y ? current : next;
    });
    const observer = new ResizeObserver(resize);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, [floating]);
  useEffect(() => () => drag.current?.cleanup(), []);

  const dock = () => {
    drag.current?.cleanup();
    setMoving(false);
    setOverDock(false);
    suppressClick.current = false;
    setPosition(null);
    requestAnimationFrame(() => handle.current?.focus({ preventScroll: true }));
  };
  const close = () => {
    notes.flush(unifiedNoteKey);
    if (onClose) onClose(); else dock();
  };
  const lift = () => {
    if (floating || !panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    setPosition({ x: rect.x, y: rect.y });
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const button = (event.target as Element).closest("button");
    if (button && button !== handle.current) return;
    if (!event.isPrimary || event.button !== 0 || !panel.current || window.matchMedia("(max-width: 767px)").matches) return;
    event.preventDefault();
    drag.current?.cleanup();
    suppressClick.current = false;
    const origin = position;
    const rect = panel.current.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const isOverDock = (point: globalThis.PointerEvent) => {
      const target = dockTarget.current?.getBoundingClientRect();
      return Boolean(target && point.clientX >= target.left && point.clientX <= target.right && point.clientY >= target.top && point.clientY <= target.bottom);
    };
    let lifted = false;
    let traveled = false;
    const begin = () => {
      lifted = true;
      suppressClick.current = true;
      setMoving(true);
      setPosition({ x: rect.x, y: rect.y });
    };
    const timer = window.setTimeout(begin, 300);
    const change = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const dx = next.clientX - start.x;
      const dy = next.clientY - start.y;
      if (!lifted && Math.hypot(dx, dy) < 5) return;
      if (Math.hypot(dx, dy) >= 5) traveled = true;
      clearTimeout(timer);
      if (!lifted) begin();
      next.preventDefault();
      setPosition(constrain({ x: rect.x + dx, y: rect.y + dy }));
      setOverDock(isOverDock(next));
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", change);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      drag.current = null;
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      cleanup();
      setMoving(false);
      setOverDock(false);
      if (traveled && isOverDock(next)) dock();
    };
    const cancel = () => { cleanup(); setMoving(false); setOverDock(false); setPosition(origin); };
    drag.current = { cleanup, cancel };
    window.addEventListener("pointermove", change, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  };

  const StatusIcon = notes.status === "failed" ? AlertTriangle : notes.status === "waiting" ? CloudUpload : notes.status === "saved" ? Check : LoaderCircle;
  const editor = <section ref={panel} role={floating ? "dialog" : undefined} aria-labelledby={`notes-title-${instance}`} className={styles.notes} data-client-notes data-status={notes.status} data-moving={moving || undefined}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (drag.current) { event.preventDefault(); event.stopPropagation(); drag.current.cancel(); }
      else if (floating) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <header className={styles.head} onPointerDown={move} data-notes-drag-header>
      <h3 id={`notes-title-${instance}`} aria-label="Notes"><span className={styles.mobileTitle}>Notes</span><button ref={handle} type="button" aria-label="Move notes" title="Drag to move · Enter to lift · arrow keys to reposition" className={styles.move}
        onClick={(event) => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; } suppressClick.current = false; lift(); }}
        onKeyDown={(event) => {
          const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!direction || !floating || !panel.current) return;
          event.preventDefault();
          const rect = panel.current.getBoundingClientRect();
          const step = event.shiftKey ? 48 : 16;
          setPosition(constrain({ x: rect.x + direction[0] * step, y: rect.y + direction[1] * step }));
        }}><GripVertical size={16} aria-hidden="true" />Notes</button></h3>
      <span role="status" aria-live="polite" className={styles.status}>
        {notes.status !== "unsaved" ? <StatusIcon size={14} aria-hidden="true" className={notes.status === "saving" || notes.status === "loading" ? "motion-safe:animate-spin" : undefined} /> : null}{statusText[notes.status]}
      </span>
      {notes.failed._recovery && !notes.loadFailed ? <button type="button" onClick={notes.reload}>Retry</button> : null}
      {floating && !onClose ? <button type="button" aria-label="Dock notes" title="Dock notes" onClick={dock} className={styles.iconButton}><PanelRightOpen size={16} aria-hidden="true" /></button> : null}
      {onCollapse && !floating ? <button type="button" aria-label="Hide notes" title="Hide notes" onClick={onCollapse} className={styles.iconButton}><PanelRightClose size={16} aria-hidden="true" /></button> : null}
      {onClose ? <button type="button" aria-label="Close notes" title="Close notes" onClick={close} className={styles.iconButton}><X size={16} aria-hidden="true" /></button> : null}
    </header>
    {notes.loadFailed ? <p role="alert" className={styles.notice}>Notes could not be loaded. <button type="button" onClick={notes.reload}>Retry</button></p> : null}
    <div className={styles.blocks}>
      <div data-note-heading={unifiedNoteKey} className={styles.block}>
        <ClientNoteEditor id={fieldId} value={body} disabled={notes.readOnly || !notes.loaded}
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
  return floating ? <>
    {!onClose ? <button ref={dockTarget} type="button" className={styles.reopen} data-notes-detached data-drop-target={moving || undefined} data-drop-over={overDock || undefined} onClick={dock} aria-label="Dock notes"><PanelRightOpen size={16} aria-hidden="true" />Notes</button> : null}
    <NotesWindow position={position} moving={moving} onClose={close}>{editor}</NotesWindow>
  </> : editor;
}

function NotesWindow({ position, moving, children, onClose }: { position: NotePosition | null; moving: boolean; children: ReactNode; onClose: () => void }) {
  const viewport = useMobileViewport();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const sizing = useRef<{ pointer: number; x: number; y: number; width: number; height: number } | null>(null);
  const fit = (width: number, height: number) => ({
    width: Math.min(window.innerWidth - 24, Math.max(320, width)),
    height: Math.min(window.innerHeight - 24, Math.max(240, height)),
  });
  return createPortal(<div ref={viewport} className={styles.window} data-moving={moving || undefined} data-positioned={position ? true : undefined}
    style={{ ...(position ? { left: position.x, top: position.y } : {}), ...size }}>
    {children}
    <button type="button" className={styles.resize} aria-label="Resize notes" title="Drag to resize · arrow keys to resize"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        const rect = event.currentTarget.parentElement!.getBoundingClientRect();
        sizing.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
      }}
      onPointerMove={(event) => {
        const start = sizing.current;
        if (start?.pointer !== event.pointerId) return;
        setSize(fit(start.width + event.clientX - start.x, start.height + event.clientY - start.y));
      }}
      onPointerUp={() => { sizing.current = null; }}
      onPointerCancel={() => { if (sizing.current) setSize(fit(sizing.current.width, sizing.current.height)); sizing.current = null; }}
      onLostPointerCapture={() => { sizing.current = null; }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && sizing.current) {
          event.preventDefault(); event.stopPropagation();
          setSize(fit(sizing.current.width, sizing.current.height)); sizing.current = null; return;
        }
        if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction) return;
        event.preventDefault();
        const rect = event.currentTarget.parentElement!.getBoundingClientRect();
        const step = event.shiftKey ? 48 : 16;
        setSize(fit(rect.width + direction[0] * step, rect.height + direction[1] * step));
      }}><MoveDiagonal2 size={16} aria-hidden="true" /></button>
  </div>, document.body);
}

// Shown in place of the column while it is hidden.
export function ClientNotesReopen({ onOpen }: { onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className={styles.reopen}><NotebookPen size={16} aria-hidden="true" />Notes</button>;
}

// On steps without notes beside the questions: a round button at the bottom right that opens the same notes
// upward from it. Rendered after the referral loads, so it portals to <body>.
export function ClientNotesButton({ referralId, readOnly, inline = false }: { referralId: number; readOnly: boolean; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const latest = useLatestNotes([referralId]).get(referralId);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => button.current?.focus()); };
  const trigger = <button ref={button} type="button" aria-label="Notes" aria-expanded={open} title={latest?.text} onClick={() => (open ? close() : setOpen(true))}
    className={`${styles.fab} ${inline ? styles.docked : ""}`} data-workspace-notes={inline || undefined} data-has-note={latest ? true : undefined}>
    <NotebookPen size={20} aria-hidden="true" />{inline ? <span>Notes</span> : null}
  </button>;
  return <>
    {inline ? trigger : null}
    {open ? <ClientNotes referralId={referralId} readOnly={readOnly} onClose={close} /> : null}
    {createPortal(<div className={styles.floating} data-inline-notes={inline || undefined}>
      {inline ? null : trigger}
    </div>, document.body)}
  </>;
}

// The latest note on a referral, one or two lines, for the Home board and Workspaces.
export function ClientNoteLine({ note, id, compact = false }: { note?: { text: string }; id?: string; compact?: boolean }) {
  if (!note) return null;
  return <span id={id} data-client-note className={compact ? `${styles.line} ${styles.compact}` : styles.line} title={note.text}>
    <NotebookPen size={13} aria-hidden="true" className={styles.lineIcon} />
    <span className={styles.lineText}><span className={styles.srOnly}>Latest note: </span>{note.text}</span>
  </span>;
}

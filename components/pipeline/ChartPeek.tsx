"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, X } from "lucide-react";

import WorkspaceClientChart from "@/components/pipeline/TransferredWorkspaceChart";
import PipelineIllustration from "@/components/pipeline/PipelineIllustration";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { Referral } from "@/lib/pipeline/referral-types";
import styles from "./ChartPeek.module.css";

type Point = { x: number; y: number };

// The assessment remains the only editor. This view reads its live draft and the canonical Chart.
// Nothing is saved by opening, moving or closing the reference.
export default function ChartPeek({ referral, assessment, source }: { referral: Referral; assessment: PipelineAssessmentRecord; source?: HTMLElement | null }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Point | null>(null);
  const [ghost, setGhost] = useState<Point | null>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const releaseDrag = useRef<(() => void) | null>(null);
  const panelId = useId();
  const headingId = useId();

  const close = () => {
    releaseDrag.current?.();
    setOpen(false);
    const target = previousFocus.current?.isConnected ? previousFocus.current : trigger.current;
    target?.focus({ preventScroll: true });
  };
  const show = (point?: Point) => {
    if (document.activeElement instanceof HTMLElement) previousFocus.current = document.activeElement;
    setPosition(point && open ? constrain(point) : point ?? null);
    setOpen(true);
  };
  const constrain = (point: Point) => {
    // Layout dimensions stay stable while the opening transform is animating.
    return {
      x: Math.max(12, Math.min(point.x, window.innerWidth - (panel.current?.offsetWidth ?? 0) - 12)),
      y: Math.max(12, Math.min(point.y, window.innerHeight - (panel.current?.offsetHeight ?? 0) - 12)),
    };
  };
  useLayoutEffect(() => {
    if (!open) return;
    const { offsetWidth: width, offsetHeight: height } = panel.current!;
    setPosition((current) => constrain(current ?? { x: window.innerWidth - width - 24, y: Math.max(24, (window.innerHeight - height) / 2) }));
    panel.current?.focus({ preventScroll: true });
    const resize = () => setPosition((current) => current ? constrain(current) : current);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);

  const shortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== "KeyC") return;
    // Do not reach through a scheduling/confirmation dialog.
    if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
    event.preventDefault();
    if (open) close(); else show();
  });
  const drop = useEffectEvent((point?: Point) => show(point));
  useEffect(() => {
    window.addEventListener("keydown", shortcut);
    return () => { window.removeEventListener("keydown", shortcut); releaseDrag.current?.(); };
  }, []);

  // Ordinary clicks still navigate to Chart. Holding and dragging pulls out a reference instead.
  useEffect(() => {
    const button = source?.querySelector<HTMLButtonElement>('button[data-guide-target="chart-stage"]');
    if (!source || !button) return;
    const oldTitle = button.getAttribute("title");
    button.title = "Chart · hold and drag for a reference";
    button.classList.add(styles.source);
    const oldShortcut = button.getAttribute("aria-keyshortcuts");
    button.setAttribute("aria-keyshortcuts", "Alt+C");
    let cancel: (() => void) | undefined;
    let suppressClick = false;
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) { suppressClick = false; return; }
      event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      cancel?.(); suppressClick = false;
      const start = { x: event.clientX, y: event.clientY };
      let point = start;
      let lifted = false;
      const timer = setTimeout(() => {
        lifted = true;
        setGhost(point);
        button.setAttribute("data-chart-lifted", "true");
      }, 300);
      const cleanup = () => {
        clearTimeout(timer); setGhost(null); button.removeAttribute("data-chart-lifted");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", abort);
        window.removeEventListener("keydown", key);
        window.removeEventListener("blur", abort);
        cancel = undefined;
      };
      const moved = () => Math.hypot(point.x - start.x, point.y - start.y) > 8;
      const move = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        point = { x: next.clientX, y: next.clientY };
        if (lifted) { next.preventDefault(); setGhost(point); }
      };
      const blockClick = () => {
        suppressClick = true;
      };
      const up = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        if (lifted) {
          blockClick();
          point = { x: next.clientX, y: next.clientY };
          if (point.x >= 0 && point.x <= window.innerWidth && point.y >= 0 && point.y <= window.innerHeight) drop(moved() ? point : undefined);
        }
        cleanup();
      };
      const abort = () => { if (lifted) blockClick(); cleanup(); };
      const key = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); abort(); } };
      cancel = cleanup;
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", abort);
      window.addEventListener("keydown", key);
      window.addEventListener("blur", abort);
    };
    button.addEventListener("pointerdown", down);
    button.addEventListener("click", click, true);
    return () => {
      cancel?.();
      button.removeEventListener("pointerdown", down); button.removeEventListener("click", click, true);
      button.classList.remove(styles.source);
      if (oldShortcut === null) button.removeAttribute("aria-keyshortcuts"); else button.setAttribute("aria-keyshortcuts", oldShortcut);
      if (oldTitle === null) button.removeAttribute("title"); else button.title = oldTitle;
    };
  }, [source]);

  const movePanel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || !panel.current) return;
    const handle = event.currentTarget;
    const rect = panel.current.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => setPosition(constrain({ x: rect.x + next.clientX - start.x, y: rect.y + next.clientY - start.y }));
    const end = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      releaseDrag.current = null;
    };
    releaseDrag.current?.(); releaseDrag.current = end;
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  };
  const control = <button ref={trigger} type="button" aria-label="Open Chart reference" aria-keyshortcuts="Alt+C" aria-controls={open ? panelId : undefined} aria-expanded={open}
    title="Chart reference (Alt+C)" onClick={() => open ? close() : show()} className={styles.trigger}>
    Chart
  </button>;

  return <>
    {source ? null : control}
    {ghost ? createPortal(<div aria-hidden="true" className={styles.ghost} style={{ left: ghost.x, top: ghost.y }}><PipelineIllustration kind="chart" size={52} /></div>, document.body) : null}
    {open ? createPortal(<aside ref={panel} id={panelId} tabIndex={-1} aria-labelledby={headingId} className={styles.panel}
      style={position ? { left: position.x, top: position.y } : undefined}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); close(); } }}>
      <header className={styles.head}>
        <button type="button" aria-label="Move Chart reference" title="Drag to move · arrow keys to reposition" className={styles.handle} onPointerDown={movePanel}
          onKeyDown={(event) => {
            const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (!direction || !position) return;
            event.preventDefault(); const step = event.shiftKey ? 48 : 16;
            setPosition(constrain({ x: position.x + direction[0] * step, y: position.y + direction[1] * step }));
          }}><GripHorizontal size={18} aria-hidden="true" /></button>
        <h2 id={headingId}>Chart<span className="sr-only"> reference</span></h2>
        <button type="button" aria-label="Close Chart reference" onClick={close} className={styles.close}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className={styles.body}><WorkspaceClientChart referral={referral} assessment={assessment} reference /></div>
    </aside>, document.body) : null}
  </>;
}

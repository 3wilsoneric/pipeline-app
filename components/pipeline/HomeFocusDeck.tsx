"use client";

import { useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { BriefcaseBusiness, CalendarClock, UserPlus } from "lucide-react";
import type { PipelineHomeModuleId } from "@/lib/pipeline/home-dashboard-layout";
import styles from "./HomeFocusDeck.module.css";

export const homeFocusModules = ["current-work", "upcoming-assessments", "new-assignments"] as const;
type FocusModule = typeof homeFocusModules[number];
const labels = {
  "current-work": { title: "Board", short: "Board", icon: BriefcaseBusiness },
  "upcoming-assessments": { title: "Upcoming assessments", short: "Upcoming", icon: CalendarClock },
  "new-assignments": { title: "New assignments", short: "New", icon: UserPlus },
};

export default function HomeFocusDeck({ modules, moduleIds, counts }: {
  modules: Record<PipelineHomeModuleId, ReactNode>;
  moduleIds: FocusModule[];
  counts: Partial<Record<PipelineHomeModuleId, number>>;
}) {
  const id = useId();
  const [selected, setSelected] = useState<FocusModule>("current-work");
  const active = moduleIds.includes(selected) ? selected : "current-work";
  const index = moduleIds.indexOf(active);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const gesture = useRef<{ x: number; y: number; pointerId: number; captured: boolean } | null>(null);

  function select(next: number, focus = false) {
    const target = (next + moduleIds.length) % moduleIds.length;
    setSelected(moduleIds[target]);
    if (focus) tabs.current[target]?.focus({ preventScroll: true });
  }

  function startGesture(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || moduleIds.length < 2) return;
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea, summary, dialog, [role=dialog], [contenteditable]")) return;
    gesture.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, captured: false };
  }

  function moveGesture(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    // Leave vertical scrolling and every record control to their existing owners.
    if (!current.captured && Math.abs(dy) > Math.max(8, Math.abs(dx))) { gesture.current = null; return; }
    if (!current.captured && Math.abs(dx) > 10) {
      current.captured = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = "true";
    }
    if (current.captured) {
      event.preventDefault();
      event.currentTarget.style.setProperty("--drag", `${Math.max(-56, Math.min(56, dx * .35))}px`);
    }
  }

  function endGesture(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (current && current.pointerId !== event.pointerId) return;
    gesture.current = null;
    delete event.currentTarget.dataset.dragging;
    event.currentTarget.style.removeProperty("--drag");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && current?.captured && Math.abs(event.clientX - current.x) > 60) select(index + (event.clientX < current.x ? 1 : -1), true);
  }

  return <section className={styles.deck} aria-label="Home focus" aria-roledescription="carousel" data-testid="home-focus-deck">
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="tablist" aria-label="Home panels" onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); select(index + 1, true); }
        if (event.key === "ArrowLeft") { event.preventDefault(); select(index - 1, true); }
        if (event.key === "Home") { event.preventDefault(); select(0, true); }
        if (event.key === "End") { event.preventDefault(); select(moduleIds.length - 1, true); }
      }}>
        {moduleIds.map((moduleId, position) => {
          const { title, short, icon: Icon } = labels[moduleId];
          return <button key={moduleId} ref={(element) => { tabs.current[position] = element; }} type="button" role="tab"
            id={`${id}-tab-${moduleId}`} aria-controls={`${id}-panel-${moduleId}`} aria-label={title}
            aria-selected={active === moduleId} tabIndex={active === moduleId ? 0 : -1} data-tone={moduleId}
            className={styles.tab} onClick={() => select(position)}>
            <Icon size={18} aria-hidden="true" />
            <span className={styles.fullLabel}>{title}</span><span className={styles.shortLabel}>{short}</span>
            {counts[moduleId] !== undefined ? <span className={styles.count}>{counts[moduleId]}</span> : null}
          </button>;
        })}
      </div>
    </div>
    <span className="sr-only" role="status">{labels[active].title}, panel {index + 1} of {moduleIds.length}</span>
    <div className={styles.stage} data-testid="home-focus-stage" onPointerDown={startGesture} onPointerMove={moveGesture}
      onPointerUp={endGesture} onPointerCancel={(event) => endGesture(event, true)} onLostPointerCapture={(event) => endGesture(event, true)}>
      {moduleIds.map((moduleId, position) => {
        const distance = (position - index + moduleIds.length) % moduleIds.length;
        const front = distance === 0;
        return <div key={moduleId} id={`${id}-panel-${moduleId}`} role="tabpanel"
          aria-labelledby={`${id}-tab-${moduleId}`} aria-hidden={!front} inert={!front} tabIndex={front ? 0 : -1}
          data-home-module={moduleId} data-home-surface="true" data-position={front ? "front" : distance === 1 ? "next" : "previous"}
          className={styles.panel}>
          <div className={styles.grip} aria-hidden="true"><span /><span /><span /></div>
          {modules[moduleId]}
        </div>;
      })}
    </div>
  </section>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import { acknowledgePipelineAssignments, initializePipelineAssignmentTracking } from "@/lib/pipeline/work-continuity-client";
import { SinceLastVisitAssignments } from "./WorkspaceActivityFeed";
import styles from "./PipelineMobileShell.module.css";

export default function PipelinePhoneNotifications({ onOpenWorkspace }: {
  onOpenWorkspace: (id: number, location?: PipelineWorkspaceLocation) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [briefing, setBriefing] = useState<HomeBriefingSnapshot | null>(null);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible" || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const started = revision.current;
    try {
      const next = await fetchPipelineJson<HomeBriefingSnapshot>("/api/operations/home", { signal: controller.signal }, { cacheTtlMs: 5_000 });
      if (!controller.signal.aborted && started === revision.current) { setBriefing(next); setError(""); }
      const continuity = next.continuity;
      if (!controller.signal.aborted && continuity.needs_assignment_tracking_initialization && continuity.assignment_tracking_started_at) {
        await initializePipelineAssignmentTracking(continuity.assignment_tracking_started_at);
      }
    } catch {
      if (!controller.signal.aborted) setError("Could not refresh notifications. Try again.");
    } finally { if (request.current === controller) request.current = null; }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const timer = window.setInterval(onFocus, 60_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { request.current?.abort(); clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [refresh]);
  const acknowledge = async (ids: string[], through?: string) => {
    await acknowledgePipelineAssignments(ids, through);
    revision.current += 1;
    setBriefing((current) => current ? { ...current, continuity: { ...current.continuity, new_assignments: current.continuity.new_assignments.filter((item) => !ids.includes(item.event_id)) } } : current);
  };
  const unread = briefing?.continuity.new_assignments.length ?? 0;
  return <>
    <button type="button" className={styles.phoneBell} aria-label={`Notifications${unread ? `, ${unread} new assignments` : ""}`} aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus(); dialog.current?.showModal(); void refresh(); }}>
      <Bell size={21} aria-hidden="true" />{unread > 0 ? <span className={styles.phoneBadge}>{unread > 99 ? "99+" : unread}</span> : null}
    </button>
    <dialog ref={dialog} aria-label="Notifications" className={styles.phoneMenu} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className={styles.phoneMenuHeading}><h2>Notifications</h2><button type="button" aria-label="Close notifications" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <div className={styles.phoneUpdates}>
        {error ? <p role="alert">{error} <button type="button" onClick={() => void refresh()}>Retry</button></p> : null}
        {briefing ? <SinceLastVisitAssignments items={briefing.continuity.new_assignments} unavailable={briefing.continuity.unavailable} onAcknowledge={acknowledge} onOpenPacket={(referral, location) => { onOpenWorkspace(referral.id, location); dialog.current?.close(); }} /> : !error ? <p role="status">Loading notifications…</p> : null}
      </div>
    </dialog>
  </>;
}

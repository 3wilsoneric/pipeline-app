"use client";

import { useEffect, useRef, useState } from "react";
import { PanelRight, X } from "lucide-react";

import WorkspaceClientChart from "@/components/pipeline/TransferredWorkspaceChart";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { Referral } from "@/lib/pipeline/referral-types";
import styles from "./ChartPeek.module.css";

// Chart drawer (docs/design/DECISIONS.md, "Interview context"): the whole Chart, read-only, over the
// interview. A native modal dialog keeps focus inside, closes on Escape, and returns focus to where the
// person was, so they come back to the same question. Alt+C opens and closes it from anywhere in the interview.
export default function ChartPeek({ referral, assessment }: { referral: Referral; assessment: PipelineAssessmentRecord }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  // The dialog stays mounted; its content renders only while open. Listen for the native close event
  // (Escape, the close button, a backdrop click) so reopening always works.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const onClose = () => setOpen(false);
    element.addEventListener("close", onClose);
    return () => element.removeEventListener("close", onClose);
  }, []);
  const show = () => { setOpen(true); if (dialog.current && !dialog.current.open) dialog.current.showModal(); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== "KeyC") return;
      event.preventDefault();
      if (dialog.current?.open) dialog.current.close(); else show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <>
    <button type="button" aria-haspopup="dialog" aria-keyshortcuts="Alt+C" title="Chart (Alt+C)" onClick={show} className={styles.trigger}>
      <PanelRight size={16} aria-hidden="true" />Chart
    </button>
    <dialog ref={dialog} aria-labelledby="chart-peek-title" className={styles.drawer}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className={styles.head}>
        <h2 id="chart-peek-title">Chart</h2>
        <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className={styles.close}><X size={18} aria-hidden="true" /></button>
      </div>
      <div className={styles.body}>
        {open ? <WorkspaceClientChart referral={referral} assessment={assessment} /> : null}
      </div>
    </dialog>
  </>;
}

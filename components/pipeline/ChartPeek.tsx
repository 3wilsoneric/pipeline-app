"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { Referral } from "@/lib/pipeline/referral-types";
import { referralCanvasValue, type PersistedCanvasFieldKey } from "@/lib/pipeline/referral-canvas-persistence";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { presentClientName } from "@/lib/pipeline/client-identity-presentation.mjs";
import styles from "./ChartPeek.module.css";

/** Sent by the rail's Chart step; a visible assessment answers it with the mini folder instead of leaving the page. */
export const chartPeekEvent = "pipeline:chart-peek";
export type ChartPeekDetail = { openChart: () => void };

// Chart mini folder (docs/design/DECISIONS.md, "Interview context"): during the assessment, the rail's Chart step
// slides a small manila folder out from the rail with only the chart details that are filled in. "Open chart" goes
// to the full Chart. A native modal dialog keeps focus inside, closes on Escape, and returns focus to where the
// person was, so they come back to the same question. Alt+C opens and closes it while the assessment is on screen.
export default function ChartPeek({ referral }: { referral: Referral; assessment?: PipelineAssessmentRecord }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [openChart, setOpenChart] = useState<(() => void) | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const onClose = () => setOpen(false);
    element.addEventListener("close", onClose);
    return () => element.removeEventListener("close", onClose);
  }, []);

  useEffect(() => {
    // Kept-mounted steps: only the assessment that is on screen answers.
    const visible = () => Boolean(anchor.current?.offsetParent);
    const toggle = () => {
      if (dialog.current?.open) { dialog.current.close(); return; }
      setOpen(true);
      dialog.current?.showModal();
    };
    const onPeek = (event: Event) => {
      if (!visible()) return;
      event.preventDefault();
      const next = (event as CustomEvent<ChartPeekDetail>).detail?.openChart ?? null;
      setOpenChart(() => next);
      toggle();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== "KeyC" || !visible()) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener(chartPeekEvent, onPeek);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(chartPeekEvent, onPeek); window.removeEventListener("keydown", onKey); };
  }, []);

  return <>
    <span ref={anchor} aria-hidden="true" className={styles.anchor} />
    <dialog ref={dialog} aria-labelledby="chart-peek-title" className={styles.drawer}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className={styles.folder}>
        <div className={styles.tab}><h2 id="chart-peek-title">Chart</h2></div>
        <div className={styles.front}>
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className={styles.close}><X size={18} aria-hidden="true" /></button>
          {open ? <FilledChart referral={referral} /> : null}
          {openChart ? <button type="button" className={styles.openChart} onClick={() => { dialog.current?.close(); openChart(); }}>Open chart</button> : null}
        </div>
      </div>
    </dialog>
  </>;
}

// The chart's own labels and groups, keeping only what is filled in.
function FilledChart({ referral }: { referral: Referral }) {
  const value = (key: PersistedCanvasFieldKey) => {
    const raw = referralCanvasValue(referral, key)?.trim() ?? "";
    if (!raw) return "";
    return key === "dob" || key === "referralReceived" ? formatProfileDate(raw) ?? raw : raw;
  };
  const name = presentClientName(referralCanvasValue(referral, "name"), referral.id);
  const groups: { title: string; facts: [string, string][] }[] = [
    { title: "", facts: [["Date of birth", value("dob")], ["Gender", value("gender")]] },
    { title: "Referral summary", facts: [["", value("summary")]] },
    { title: "Referral details", facts: [["Assigned assessor", value("owner")], ["Community", value("community")], ["County", value("county")], ["Referral source", value("referent")], ["Responsible person", value("responsiblePerson")]] },
    { title: "Contact information", facts: [["Referrer name", value("referrerName")], ["Phone", value("phone")], ["Email", value("email")]] },
    { title: "Intake information", facts: [["Medications on record", value("currentMedications")], ["Conserved status", referral.conserved === "yes" ? "Yes" : referral.conserved === "no" ? "No" : ""]] },
  ];
  return <div className={styles.paper}>
    <p className={styles.name}>{name}</p>
    {groups.map((group) => {
      const facts = group.facts.filter(([, text]) => text);
      if (!facts.length) return null;
      return <section key={group.title || "identity"} aria-label={group.title || undefined} className={styles.group}>
        {group.title ? <h3>{group.title}</h3> : null}
        <dl>{facts.map(([label, text]) => <div key={label || group.title}>{label ? <dt>{label}</dt> : null}<dd>{text}</dd></div>)}</dl>
      </section>;
    })}
  </div>;
}

"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Minus } from "lucide-react";
import type { AdmissionDecision } from "@/lib/pipeline/referral-types";
import styles from "./DecisionFeedback.module.css";

export function DecisionStamp({ outcome }: { outcome: AdmissionDecision["outcome"] }) {
  const Icon = outcome === "accepted" ? Check : Minus;
  return <span className={styles.stamp} data-outcome={outcome} aria-hidden="true"><Icon size={32} /></span>;
}

/** Appears only after the mutation confirms a saved decision. Never delays navigation. */
export default function DecisionFeedback({ decision, onDismiss }: { decision: AdmissionDecision; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (!ref.current) return;
    // CSS optimization may serialize the millisecond token as seconds.
    const duration = getComputedStyle(ref.current).getPropertyValue("--duration-feedback").trim();
    const milliseconds = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
    const timer = window.setTimeout(() => dismiss(), milliseconds);
    return () => window.clearTimeout(timer);
  }, [decision.decisionId]);

  return createPortal(<div ref={ref} role="status" aria-atomic="true" className={styles.feedback} data-outcome={decision.outcome}>
    <DecisionStamp outcome={decision.outcome} />
    <div><strong>{decision.outcome === "accepted" ? "Accepted" : "Denied"}</strong><span>Decision recorded</span></div>
  </div>, document.body);
}

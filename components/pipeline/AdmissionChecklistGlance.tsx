"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Circle } from "lucide-react";

import { fetchPipelineJson, readPipelineJsonCache, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import { isRequirementComplete } from "@/lib/pipeline/workflow-records";
import {
  admissionRequirementSummary,
  requirementGroups,
  resolvedRequirementCount,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import styles from "./AdmissionChecklistGlance.module.css";

// Read-only admission checklist for the Chart home page (docs/design/DECISIONS.md, "Chart as home").
// It shows the same requirements the Decision tab edits, from the same endpoint, so there is one
// source of truth and one place to change them.
export default function AdmissionChecklistGlance({ referralId, onOpenDecision }: { referralId: number; onOpenDecision?: () => void }) {
  const path = `/api/referrals/${referralId}/workflow`;
  const [workflow, setWorkflow] = useState<WorkflowResponse | null>(() => readPipelineJsonCache<WorkflowResponse>(path) ?? null);
  const dataGeneration = usePipelineDataGeneration();
  useEffect(() => {
    const controller = new AbortController();
    void fetchPipelineJson<WorkflowResponse>(path, { signal: controller.signal, cache: "no-store" }, { cacheTtlMs: 30_000 })
      .then((payload) => { if (!controller.signal.aborted) setWorkflow(payload); })
      // The checklist is a convenience on the Chart; the Decision tab reports load errors.
      .catch(() => undefined);
    return () => controller.abort();
  }, [path, dataGeneration]);

  const groups = workflow ? requirementGroups(workflow.work_items) : [];
  if (!workflow || groups.length === 0) return null;
  return <section aria-label="Admission requirements" className={styles.glance}>
    <header className={styles.header}>
      <div>
        <h2>Admission requirements</h2>
        <p>{admissionRequirementSummary(workflow.work_items)}</p>
      </div>
      {onOpenDecision ? <button type="button" onClick={onOpenDecision} className={styles.open}>Open decision<ArrowRight size={16} aria-hidden="true" /></button> : null}
    </header>
    <div className={styles.groups}>
      {groups.map((group) => <section key={group.label} aria-label={`${group.label} requirements`} className={styles.group}>
        <div className={styles.groupHead}>
          <h3>{group.label}</h3>
          <span>{resolvedRequirementCount(group.items)} / {group.items.length} resolved</span>
        </div>
        <ul>
          {group.items.map((item) => {
            const complete = isRequirementComplete(item.status);
            return <li key={item.id} data-complete={complete}>
              <span aria-hidden="true" className={styles.mark}>{complete ? <Check size={13} strokeWidth={3} /> : <Circle size={10} />}</span>
              <span className={styles.item}><strong>{item.label}</strong></span>
            </li>;
          })}
        </ul>
      </section>)}
    </div>
  </section>;
}

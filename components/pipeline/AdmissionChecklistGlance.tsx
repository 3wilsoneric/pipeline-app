"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, Circle, ClipboardCheck, Minus } from "lucide-react";

import { fetchPipelineJson, readPipelineJsonCache, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import { isRequirementComplete } from "@/lib/pipeline/workflow-records";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { assessmentInterviewFieldLabel, assessmentInterviewOptionLabel } from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import {
  decisionProgressSteps,
  handoffDescriptions,
  requirementGroups,
  resolvedRequirementCount,
  type WorkflowResponse,
} from "@/components/pipeline/referral-workflow-panel-model";
import styles from "./AdmissionChecklistGlance.module.css";

// Read-only admission checklist for the Chart home page (docs/design/DECISIONS.md, "Chart as home").
// It shows the same requirements the Decision tab edits, from the same endpoint, so there is one
// source of truth and one place to change them.
// One workflow read shared by the Chart's status and checklist cards.
function useReferralWorkflow(referralId: number) {
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
  return workflow;
}

export default function AdmissionChecklistGlance({ referralId, onOpenDecision }: { referralId: number; onOpenDecision?: () => void }) {
  const workflow = useReferralWorkflow(referralId);
  const groups = workflow ? requirementGroups(workflow.work_items) : [];
  if (!workflow || groups.length === 0) return null;
  const items = groups.flatMap((group) => group.items);
  const resolved = resolvedRequirementCount(items);
  return <section aria-label="Admission requirements" className={styles.glance}>
    <header className={styles.header}>
      <div>
        <h2><ClipboardCheck size={20} aria-hidden="true" />Admission requirements</h2>
      </div>
      {onOpenDecision ? <button type="button" onClick={onOpenDecision} className={styles.open}>Open decision<ArrowRight size={16} aria-hidden="true" /></button> : null}
    </header>
    <div className={styles.progressSummary}>
      <progress aria-label="Admission requirements resolved" value={resolved} max={items.length} />
      <strong>{resolved} / {items.length} resolved</strong>
    </div>
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

// "Where this referral stands" (docs/design/DECISIONS.md, "Chart as home"): the Decision page's own
// milestones, plus the recommendation, admission date, and EHR handoff, so the Chart ends as the whole story.
export function ReferralStandingGlance({ referralId, children }: { referralId: number; children?: ReactNode }) {
  const workflow = useReferralWorkflow(referralId);
  // The appointment (children) never waits on the workflow read.
  if (!workflow) return children ? <section className={styles.glance}><div className={styles.appointment}>{children}</div></section> : null;
  const steps = decisionProgressSteps(workflow);
  const { recommendation, decision, referral } = workflow;
  const handoff = referral.ehrHandoff;
  return <section aria-labelledby={`standing-${referralId}`} className={styles.glance} data-chart-standing>
    <header className={styles.header}><div><h2 id={`standing-${referralId}`}>Where this referral stands</h2></div></header>
    <ol className={styles.steps}>
      {steps.map((step) => <li key={step.key} data-state={step.state}>
        <span aria-hidden="true" className={styles.mark}>{step.state === "done" ? <Check size={13} strokeWidth={3} /> : step.state === "not_needed" ? <Minus size={12} /> : <Circle size={10} />}</span>
        <span className={styles.item}>
          <strong>{step.label}</strong>
          {/* Dates and names only; the Decision page keeps the explanations. */}
          {step.state === "done" && (step.key === "decision" || step.key === "packet") ? <span>{step.detail}</span> : null}
        </span>
      </li>)}
    </ol>
    {recommendation || referral.admissionDate || (decision?.outcome === "accepted" && handoff) ? <dl className={styles.facts}>
      {recommendation ? <div><dt>Placement recommendation</dt><dd>{recommendation.outcome === "accept" ? "Accept" : recommendation.outcome === "decline" ? "Deny" : "Under review"}{recommendation.reasonNote ? <span>{recommendation.reasonNote}</span> : null}</dd></div> : null}
      {decision?.reasonNote ? <div><dt>Decision reason</dt><dd>{decision.reasonNote}</dd></div> : null}
      {referral.admissionDate ? <div><dt>Admission date</dt><dd>{formatProfileDate(referral.admissionDate) ?? referral.admissionDate}</dd></div> : null}
      {decision?.outcome === "accepted" && handoff ? <div><dt>EHR handoff</dt><dd>{handoffDescriptions[handoff.status]}{handoff.sentAt ? <span>{formatProfileDate(handoff.sentAt)}</span> : null}</dd></div> : null}
    </dl> : null}
    {children ? <div className={styles.appointment}>{children}</div> : null}
  </section>;
}

// Key findings of the signed assessment. The full answers stay on the Assessment tab.
const summaryFields: readonly AssessmentToolFieldKey[] = [
  "primary_diagnosis", "secondary_diagnoses", "diagnosis_categories", "acuity_level",
  "aggression_risk", "elopement_risk", "current_self_harm_ideation", "active_substance_use",
  "medications_at_intake", "medication_adherence", "adl_needs", "mobility", "ambulatory",
  "conservatorship_type", "special_diet", "family_involvement",
];

export function AssessmentSummaryGlance({ assessment }: { assessment?: PipelineAssessmentRecord }) {
  if (!assessment?.signed_at) return null;
  const facts = summaryFields
    .map((field) => ({ field, text: summaryText(field, assessment[field as keyof PipelineAssessmentRecord]) }))
    .filter((fact) => fact.text);
  if (!facts.length) return null;
  return <section aria-labelledby={`assessment-summary-${assessment.assessment_id}`} className={styles.glance} data-chart-assessment-summary>
    <header className={styles.header}>
      <div>
        <h2 id={`assessment-summary-${assessment.assessment_id}`}>Assessment summary</h2>
        <p>Assessment signed {formatProfileDate(assessment.signed_at) ?? ""}</p>
      </div>
    </header>
    <dl className={`${styles.facts} ${styles.summaryFacts}`}>
      {facts.map((fact) => <div key={fact.field}><dt>{assessmentInterviewFieldLabel(fact.field)}</dt><dd>{fact.text}</dd></div>)}
    </dl>
  </section>;
}

function summaryText(field: AssessmentToolFieldKey, value: unknown) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => assessmentInterviewOptionLabel(field, String(item)) ?? String(item)).join(", ");
  if (typeof value === "object") return "";
  const text = String(value).trim();
  return text ? assessmentInterviewOptionLabel(field, text) ?? text : "";
}

// Chart built by the process (docs/design/DECISIONS.md, "Chart built by the process"; owner, 2026-09-27): the
// Chart reads in the order of the work — Assessment, Decision, Finish & send — and each finished step is filed
// here with its stamp (what and when), while every step remains reachable in the rail. A step still under way
// shows its status in one line, with the way into it. All wording is existing.
export function ChartProcess({ referralId, assessment, record, entry, appointment, onOpenAssessment, onOpenDecision, onOpenFinish }: {
  referralId: number;
  assessment?: PipelineAssessmentRecord;
  /** The full assessment record (closed by default). */
  record?: ReactNode;
  /** The recorded-answers line and its review link. */
  entry?: ReactNode;
  /** The assessment appointment row, until the assessment is signed. */
  appointment?: ReactNode;
  onOpenAssessment?: () => void;
  onOpenDecision?: () => void;
  onOpenFinish?: () => void;
}) {
  const workflow = useReferralWorkflow(referralId);
  const steps = workflow ? decisionProgressSteps(workflow) : [];
  const signed = steps.find((step) => step.key === "signed");
  const decided = steps.find((step) => step.key === "decision");
  const packet = steps.find((step) => step.key === "packet");
  const assessmentFiled = Boolean(assessment?.signed_at) || signed?.state === "done";
  const decisionFiled = decided?.state === "done";
  const referral = workflow?.referral;
  const handoff = referral?.ehrHandoff;
  const accepted = workflow?.decision?.outcome === "accepted";
  return <div className={styles.process} data-chart-process>
    <ChartStage id={`chart-assessment-${referralId}`} title="Assessment" filed={assessmentFiled}
      status={assessmentFiled ? `Assessment signed ${formatProfileDate(assessment?.signed_at ?? null) ?? ""}`.trim() : signed?.label}
      action={onOpenAssessment ? <button type="button" onClick={onOpenAssessment} className={styles.open}>Open assessment<ArrowRight size={16} aria-hidden="true" /></button> : null}>
      {assessmentFiled ? <AssessmentSummaryGlance assessment={assessment} /> : appointment ? <div className={styles.appointment}>{appointment}</div> : null}
      {entry}
      {record}
    </ChartStage>
    <ChartStage id={`chart-decision-${referralId}`} title="Decision" filed={decisionFiled}
      status={decided ? (decisionFiled ? `${decided.label} · ${decided.detail}` : decided.label) : undefined}
      action={onOpenDecision ? <button type="button" onClick={onOpenDecision} className={styles.open}>Open decision<ArrowRight size={16} aria-hidden="true" /></button> : null}>
      {workflow && (workflow.recommendation || workflow.decision?.reasonNote) ? <dl className={styles.facts}>
        {workflow.recommendation ? <div><dt>Placement recommendation</dt><dd>{workflow.recommendation.outcome === "accept" ? "Accept" : workflow.recommendation.outcome === "decline" ? "Deny" : "Under review"}{workflow.recommendation.reasonNote ? <span>{workflow.recommendation.reasonNote}</span> : null}</dd></div> : null}
        {workflow.decision?.reasonNote ? <div><dt>Decision reason</dt><dd>{workflow.decision.reasonNote}</dd></div> : null}
      </dl> : null}
    </ChartStage>
    {accepted || packet?.state === "done" ? <ChartStage id={`chart-finish-${referralId}`} title="Finish & send" filed={packet?.state === "done"}
      status={packet ? (packet.state === "done" ? `${packet.label} · ${packet.detail}` : packet.label) : undefined}
      action={onOpenFinish ? <button type="button" onClick={onOpenFinish} className={styles.open}>Finish & send<ArrowRight size={16} aria-hidden="true" /></button> : null}>
      {referral?.admissionDate || (accepted && handoff) ? <dl className={styles.facts}>
        {referral?.admissionDate ? <div><dt>Admission date</dt><dd>{formatProfileDate(referral.admissionDate) ?? referral.admissionDate}</dd></div> : null}
        {accepted && handoff ? <div><dt>EHR handoff</dt><dd>{handoffDescriptions[handoff.status]}{handoff.sentAt ? <span>{formatProfileDate(handoff.sentAt)}</span> : null}</dd></div> : null}
      </dl> : null}
    </ChartStage> : null}
  </div>;
}

// One step's place in the Chart: its name, a filed stamp (or its status while under way), the way back in, and
// what it produced.
function ChartStage({ id, title, filed, status, action, children }: { id: string; title: string; filed: boolean; status?: string; action?: ReactNode; children?: ReactNode }) {
  return <section aria-labelledby={id} className={styles.stage} data-chart-stage={title} data-filed={filed || undefined}>
    <header className={styles.stageHead}>
      <h2 id={id}>{title}</h2>
      {status ? <span className={styles.stamp}>{filed ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}{status}</span> : null}
      {action}
    </header>
    {children ? <div className={styles.stageBody}>{children}</div> : null}
  </section>;
}

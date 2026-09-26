"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ClientChartRecord } from "@/components/pipeline/ClientProfileView";
import { ClientChartHeader } from "@/components/pipeline/ClientMedicalChart";
import { fetchPipelineJson, readPipelineJsonCache, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import ClientAssessmentRecord from "@/components/pipeline/ClientAssessmentRecord";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { UnifiedClientProfileResponse } from "@/lib/pipeline/unified-profile-contracts";
import type { ReferralChartEditField } from "@/lib/pipeline/client-chart-context";
import type { AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import { isClientChartWorkspace } from "@/lib/pipeline/workspace-presentation";
import ReferralIntakeSummary from "@/components/pipeline/ReferralIntakeSummary";
import folderStyles from "./ClientFolder.module.css";
import AdmissionChecklistGlance, { AssessmentSummaryGlance, ReferralStandingGlance } from "@/components/pipeline/AdmissionChecklistGlance";
import { useRedesignFeatures } from "@/components/design/DesignSwitch";

export default function WorkspaceClientChart({ referral, headerActions, contactActions, assessmentEntry, assessment, practice = false, assessmentOnly = false, onEditReferralField, onEditAssessmentField, onOpenDecision }: {
  referral: Referral | null;
  headerActions?: ReactNode;
  contactActions?: ReactNode;
  /** Redesign: the recorded-answers count and review link, placed with the Assessment section. */
  assessmentEntry?: ReactNode;
  assessment?: PipelineAssessmentRecord;
  practice?: boolean;
  assessmentOnly?: boolean;
  onEditReferralField?: (field: ReferralChartEditField) => void;
  onEditAssessmentField?: (field: AssessmentToolFieldKey) => void;
  onOpenDecision?: () => void;
}) {
  if (practice || assessmentOnly) return assessment ? <ClientAssessmentRecord assessment={assessment} onEditField={onEditAssessmentField} /> : null;
  return <WorkspaceClientChartLoader key={referral?.clientId ?? "unlinked"} referral={referral} headerActions={headerActions} contactActions={contactActions} assessmentEntry={assessmentEntry} assessment={assessment} onEditReferralField={onEditReferralField} onEditAssessmentField={onEditAssessmentField} onOpenDecision={onOpenDecision} />;
}

function WorkspaceClientChartLoader({ referral, headerActions, contactActions, assessmentEntry, assessment, onEditReferralField, onEditAssessmentField, onOpenDecision }: {
  referral: Referral | null;
  headerActions?: ReactNode;
  contactActions?: ReactNode;
  assessmentEntry?: ReactNode;
  assessment?: PipelineAssessmentRecord;
  onEditReferralField?: (field: ReferralChartEditField) => void;
  onEditAssessmentField?: (field: AssessmentToolFieldKey) => void;
  onOpenDecision?: () => void;
}) {
  const designV2 = useRedesignFeatures();
  const profilePath = referral?.clientId ? `/api/profiles/${encodeURIComponent(`pipeline:${referral.clientId}`)}` : "";
  const intakeReferral = referral && !isClientChartWorkspace(referral) ? referral : undefined;
  // Keep the intake summary mounted while supporting records load or refresh.
  // Redesign: the appointment sits with "Where this referral stands" instead of under the contacts.
  const homeChart = designV2 && intakeReferral;
  const intakeChart = intakeReferral ? <div className={folderStyles.chartSummary}><ReferralIntakeSummary referral={intakeReferral} assessment={assessment} headerActions={headerActions} contactActions={homeChart ? undefined : contactActions} onEditField={onEditReferralField} /></div> : null;
  // Redesign: the Chart is the record's home, so it leads with the admission checklist and leaves
  // this referral's assessment answers to the Assessment tab (docs/design/DECISIONS.md, "Chart as home").
  const checklist = designV2 && referral && !isClientChartWorkspace(referral) ? <AdmissionChecklistGlance referralId={referral.id} onOpenDecision={onOpenDecision} /> : null;
  // It opens with where the referral stands and, once signed, the assessment's key findings.
  // Order follows staff feedback: where it stands, then the admission checklist, then (once signed) the assessment summary.
  const standing = designV2 && referral && !isClientChartWorkspace(referral) ? <><ReferralStandingGlance referralId={referral.id}>{homeChart ? contactActions : null}</ReferralStandingGlance>{checklist}<AssessmentSummaryGlance assessment={assessment} /></> : null;
  // Every recorded answer, closed at the bottom so the Chart holds the full picture (docs/design/DECISIONS.md, "Chart assessment section").
  const answers = homeChart && assessment ? <>{assessmentEntry}<ClientAssessmentRecord assessment={assessment} onEditField={onEditAssessmentField} collapsible /></> : null;
  const [profile, setProfile] = useState<UnifiedClientProfileResponse | null>(() => readPipelineJsonCache<UnifiedClientProfileResponse>(profilePath) ?? null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const dataGeneration = usePipelineDataGeneration();
  useEffect(() => {
    if (!profilePath) return;
    const controller = new AbortController();
    void fetchPipelineJson<UnifiedClientProfileResponse>(profilePath, { signal: controller.signal, cache: "no-store", ...(retry || dataGeneration ? { headers: { "x-pipeline-refresh": "1" } } : {}) }, { cacheTtlMs: 60_000, bypassCache: retry > 0 })
      .then((value) => { if (!controller.signal.aborted) { setProfile(value); setError(""); } })
      .catch(() => { if (!controller.signal.aborted) setError("The complete client chart could not be loaded."); });
    return () => controller.abort();
  }, [profilePath, retry, dataGeneration]);
  if (!profilePath || error || !profile) return <>
    {standing}
    {intakeChart}
    {standing ? null : checklist}
    {!intakeReferral ? <ClientChartHeader title="Client chart" actions={headerActions}>{null}</ClientChartHeader> : null}
    {!profilePath ? <p role="alert">{intakeReferral ? "Supporting records need a client connection. Referral details remain available." : "This workspace needs its client identity connected before the chart can be loaded."}</p>
      : error ? <div role="alert" className="py-4 text-[13px] text-[#59645e]">{intakeReferral ? "Supporting records could not be loaded. Referral details remain available." : error} <button type="button" className="ml-3 underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>
      : <p role="status" className="py-4 text-[12px] text-[#68716d]">{intakeReferral ? "Loading supporting records..." : "Loading client chart..."}</p>}
    {assessment && !designV2 ? <ClientAssessmentRecord assessment={assessment} onEditField={onEditAssessmentField} /> : answers}
  </>;
  return <>{standing}{intakeChart}{standing ? null : checklist}<ClientChartRecord profile={profile} sourceReferralId={referral!.id} headerActions={headerActions} assessment={assessment} onEditReferralField={onEditReferralField} onEditAssessmentField={onEditAssessmentField}
    intakeReferral={intakeReferral} excludeReferralAssessments={designV2} />{answers}</>;
}

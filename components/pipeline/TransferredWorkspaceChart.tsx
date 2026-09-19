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

export default function WorkspaceClientChart({ referral, headerActions, assessment, practice = false, onEditReferralField, onEditAssessmentField }: {
  referral: Referral | null;
  headerActions?: ReactNode;
  assessment?: PipelineAssessmentRecord;
  practice?: boolean;
  onEditReferralField?: (field: ReferralChartEditField) => void;
  onEditAssessmentField?: (field: AssessmentToolFieldKey) => void;
}) {
  if (practice) return assessment ? <ClientAssessmentRecord assessment={assessment} onEditField={onEditAssessmentField} /> : null;
  return <WorkspaceClientChartLoader key={referral?.clientId ?? "unlinked"} referral={referral} headerActions={headerActions} assessment={assessment} onEditReferralField={onEditReferralField} onEditAssessmentField={onEditAssessmentField} />;
}

function WorkspaceClientChartLoader({ referral, headerActions, assessment, onEditReferralField, onEditAssessmentField }: {
  referral: Referral | null;
  headerActions?: ReactNode;
  assessment?: PipelineAssessmentRecord;
  onEditReferralField?: (field: ReferralChartEditField) => void;
  onEditAssessmentField?: (field: AssessmentToolFieldKey) => void;
}) {
  const profilePath = referral?.clientId ? `/api/profiles/${encodeURIComponent(`pipeline:${referral.clientId}`)}` : "";
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
    <ClientChartHeader title="Client chart" actions={headerActions}>{null}</ClientChartHeader>
    {!profilePath ? <p role="alert">This workspace needs its client identity connected before the chart can be loaded.</p>
      : error ? <div role="alert" className="py-4 text-[13px] text-[#59645e]">{error} <button type="button" className="ml-3 underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>
      : <p role="status" className="py-4 text-[12px] text-[#68716d]">Loading client chart...</p>}
    {assessment ? <ClientAssessmentRecord assessment={assessment} onEditField={onEditAssessmentField} /> : null}
  </>;
  return <ClientChartRecord profile={profile} sourceReferralId={referral!.id} headerActions={headerActions} assessment={assessment} onEditReferralField={onEditReferralField} onEditAssessmentField={onEditAssessmentField} />;
}

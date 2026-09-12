"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ClientChartRecord } from "@/components/pipeline/ClientProfileView";
import { fetchPipelineJson, readPipelineJsonCache } from "@/lib/auth/authenticated-fetch";
import type { ReferralCanvasPacketField } from "@/lib/pipeline/referral-canvas-extraction";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { UnifiedClientProfileResponse } from "@/lib/pipeline/unified-profile-contracts";
import type { HistoricalProfileResponse, HistoricalProfileSource } from "@/lib/pipeline/historical-profile-contracts";
import type { ClientProfileSection } from "@/lib/pipeline/client-profile-presentation";
import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import { isImportedWorkspace } from "@/lib/pipeline/workspace-presentation";

export default function WorkspaceClientChart({ referral, fields, children }: {
  referral: Referral | null;
  fields: ReferralCanvasPacketField[];
  children?: ReactNode;
}) {
  const profilePath = referral ? `/api/profiles/${encodeURIComponent(`pipeline:${referral.clientId}`)}` : "";
  const [profile, setProfile] = useState<UnifiedClientProfileResponse | null>(() => readPipelineJsonCache<UnifiedClientProfileResponse>(profilePath) ?? null);
  const [error, setError] = useState("");
  const source = useWorkspaceSource(referral);
  useEffect(() => {
    if (!profilePath) return;
    const controller = new AbortController();
    void fetchPipelineJson<UnifiedClientProfileResponse>(profilePath, { signal: controller.signal, cache: "no-store" }, { cacheTtlMs: 60_000 })
      .then((value) => { if (!controller.signal.aborted) setProfile(value); })
      .catch(() => { if (!controller.signal.aborted) setError("The client chart could not be loaded. Reopen this workspace to retry."); });
    return () => controller.abort();
  }, [profilePath]);
  if (!referral) return <>{children}</>;
  if (!profile) return <p role={error ? "alert" : "status"} className="py-4 text-[12px] text-[#68716d]">{error || "Loading client chart..."}</p>;
  return <>
    <ClientChartRecord profile={scopeWorkspaceClientProfile(profile, referral, fields, source.profile)}
      supplementalSections={workspaceClientSections(referral, fields)}
      sourceSections={workspaceSourceSections(source.profile)} sourceLabel={workspaceSourceLabel(referral)}>
      {children}
    </ClientChartRecord>
    {source.error ? <p role="alert" className="mt-3 text-[12px] text-[#a4473c]">{source.error}</p> : null}
  </>;
}

function useWorkspaceSource(referral: Referral | null) {
  const path = referral && isImportedWorkspace(referral) ? `/api/referrals/${referral.id}/historical-profile` : "";
  const [profile, setProfile] = useState<HistoricalProfileResponse | null>(() => readPipelineJsonCache<HistoricalProfileResponse>(path) ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void fetchPipelineJson<HistoricalProfileResponse>(path, { signal: controller.signal, cache: "no-store" }, { cacheTtlMs: 60_000 })
      .then((value) => { if (!controller.signal.aborted) setProfile(value); })
      .catch(() => { if (!controller.signal.aborted) setError("Original source notes could not be loaded. Files remain available in the client chart."); });
    return () => controller.abort();
  }, [path]);
  return { profile, error };
}

const clinicalFields: Record<string, string> = {
  DOB: "date_of_birth", AGE: "age", GENDER: "gender",
  "Client phone:": "phone", "Client email:": "email", "County:": "county",
  "Current medications": "medications_at_intake", Conserved: "conservatorship",
};
const sourceClinicalFields: Record<string, string> = {
  primary_diagnosis: "primary_diagnosis", medications_at_intake: "medications_at_intake",
  allergies: "active_allergies", mobility: "mobility", adl_needs: "adl_needs",
  conservatorship_type: "conservatorship",
};
const sourceIdentityFields: Record<string, string> = { dob: "date_of_birth", age: "age", gender: "gender", county: "county", admission_date: "admit_date" };

export function scopeWorkspaceClientProfile(profile: UnifiedClientProfileResponse, referral: Referral, fields: ReferralCanvasPacketField[], source: HistoricalProfileResponse | null) {
  const enrichment = { ...profile.client.enrichment, ...sourceClinicalRecord(source) };
  for (const field of fields) {
    const key = clinicalFields[field.label];
    if (key && field.value.trim()) enrichment[key] = field.value;
  }
  return {
    ...profile,
    client: { ...profile.client, display_name: referral.name, gender: referral.gender ?? profile.client.gender,
      current_community: referral.community || null, enrichment },
    pipeline: { ...profile.pipeline,
      referrals: [],
      assessments: profile.pipeline.assessments.filter((assessment) => assessment.referral_id === referral.id),
      documents: profile.pipeline.documents.filter((document) => document.referralId === referral.id),
    },
  };
}

function sourceClinicalRecord(source: HistoricalProfileResponse | null) {
  const record: Record<string, string> = {};
  for (const fact of source?.facts ?? []) {
    const key = sourceIdentityFields[fact.key];
    if (key && fact.value.trim()) record[key] = fact.value;
  }
  for (const field of source?.sections.flatMap((section) => section.fields) ?? []) {
    const key = sourceClinicalFields[field.targetField];
    const statements = field.evidence.filter((item) => item.confidence === "high").map((item) => item.text);
    if (key && statements.length) record[key] = statements.join("\n\n");
  }
  return record;
}

const promotedWorkspaceLabels = new Set(["NAME", "GENDER", "DOB", "Community:", "Current medications", "Owner (@name):"]);
const workspaceLabels: Record<string, string> = { AGE: "Age", "Referent:": "Referral source", Summary: "Referral summary" };

export function workspaceClientSections(referral: Referral, fields: ReferralCanvasPacketField[]): ClientProfileSection[] {
  const facts = [
    { label: "Owner", value: normalizeOwnerName(referral.owner) },
    ...fields.filter((field) => field.value.trim() && !promotedWorkspaceLabels.has(field.label))
      .map((field) => ({ label: workspaceLabels[field.label] ?? field.label.replace(/:$/, ""), value: field.value })),
  ];
  return [{ key: "workspace-referral", label: "Referral information", facts }];
}

function sourceDescription(source: HistoricalProfileSource) {
  return [source.sourceCanvasName, source.sourceProjectName, source.capturedAt].filter(Boolean).join(" · ");
}

export function workspaceSourceSections(source: HistoricalProfileResponse | null): ClientProfileSection[] {
  if (!source) return [];
  return [
    { key: "imported-facts", label: "Recorded source information", facts: source.facts.map((fact) => ({
      label: fact.key === "assessment_date" ? "ALLO assessment date (imported)" : fact.label,
      value: `${fact.value}\nSource: ${sourceDescription(fact.source)}`,
    })) },
    ...source.sections.map((section) => ({ key: `source:${section.section}`, label: section.label,
      facts: section.fields.map((field) => ({ label: field.label, value: field.evidence.map((item) =>
        `${item.text}\nSource: ${sourceDescription(item.source)}\n${item.confidence === "high" ? "Stronger field match" : "Possible field match"}`).join("\n\n") })),
    })),
    { key: "unmapped-source", label: "Other source notes", facts: source.unmappedEvidence.map((item, index) => ({
      label: `Note ${index + 1}`, value: `${item.text}\nSource: ${sourceDescription(item.source)}`,
    })) },
    ...source.sourceSections.map((section) => ({ key: `blocks:${section.sectionId}`, label: section.label,
      facts: section.blocks.map((block) => ({ label: `Source block ${block.ordinal}`, value: `${block.text}\nSource: ${sourceDescription(section.source)}` })),
    })),
  ].filter((section) => section.facts.length);
}

function workspaceSourceLabel(referral: Referral) {
  return isImportedWorkspace(referral) ? "ALLO (imported)" : "Pipeline";
}

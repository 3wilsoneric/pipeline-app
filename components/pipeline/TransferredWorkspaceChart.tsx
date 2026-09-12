"use client";

import { useEffect, useState } from "react";

import { CompleteAssessmentChart } from "@/components/pipeline/AssessmentChartWorkspace";
import { buildAssessmentSummaryReport } from "@/lib/assessment/assessment-summary";
import type { AssessmentListResponse, PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ReferralCanvasPacketField } from "@/lib/pipeline/referral-canvas-extraction";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import { ClientDocumentGallery } from "@/components/pipeline/ClientProfileView";
import ClientMedicalChart from "@/components/pipeline/ClientMedicalChart";
import type { ClientChartFact, ClientMedicalChartModel } from "@/lib/pipeline/client-medical-chart";
import { parseStructuredNarrative, structuredNarrativeSections } from "@/lib/pipeline/structured-narrative";

// Pre-launch Pipeline records retain their actual intake and saved assessments,
// rather than being projected onto the ALLO source format or a new workflow.
export default function TransferredWorkspaceChart({ referral, fields }: {
  referral: Referral;
  fields: ReferralCanvasPacketField[];
}) {
  const referralId = referral.id;
  const [assessments, setAssessments] = useState<PipelineAssessmentRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<ReferralFile[]>([]);
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetchPipelineJson<{ pipeline: { documents: ReferralFile[] } }>(
      `/api/profiles/${encodeURIComponent(`pipeline:${referral.clientId}`)}`,
      { signal: controller.signal, cache: "no-store" },
      { cacheTtlMs: 30_000 },
    ).then((profile) => {
      if (!controller.signal.aborted) setFiles(profile.pipeline.documents.filter((file) => file.referralId === referralId));
    }).catch(() => { if (!controller.signal.aborted) setFileError("Chart files could not be loaded."); });
    return () => controller.abort();
  }, [referral.clientId, referralId]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const records: PipelineAssessmentRecord[] = [];
      let cursor: string | null = null;
      do {
        const params: URLSearchParams = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
        const page: AssessmentListResponse = await fetchPipelineJson<AssessmentListResponse>(`/api/referrals/${referralId}/assessments?${params}`, { signal: controller.signal, cache: "no-store" });
        records.push(...page.assessments);
        cursor = page.next_cursor;
      } while (cursor);
      if (!controller.signal.aborted) setAssessments(records);
    };
    void load().catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Assessment records could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [referralId]);

  return (
    <div className="space-y-6" data-testid="transferred-workspace-chart">
      <ClientMedicalChart chart={buildTransferredClientChart(fields)} dataAsOf={referral.updatedAt ?? referral.createdAt} sourceLabel="Pipeline" careTitle="Referral information" />
      {files.length ? <section aria-label="Chart files"><h2 className="mb-2 text-[13px] font-bold text-[#202522]">Files</h2><ClientDocumentGallery documents={files} /></section> : null}
      {fileError ? <p role="alert" className="text-[12px] text-[#a4473c]">{fileError}</p> : null}
      {fields.filter((field) => field.label === "Summary" && field.value.trim()).map((field) => <RecordedSummary key={field.label} field={field} />)}
      {loading ? <p role="status" className="text-[12px] text-[#68716d]">Loading assessment records...</p> : null}
      {error ? <p role="alert" className="text-[12px] text-[#a4473c]">{error}</p> : null}
      {assessments.filter((assessment) => assessment.status === "complete" && assessment.signed_at).map((assessment) => (
        <section key={assessment.assessment_id}>
          <p className="mb-2 text-[11px] text-[#68716d]">
            {assessment.signed_at ? "Signed" : "Saved, unsigned"} · {assessment.updated_by.name} · {new Date(assessment.updated_at).toLocaleDateString("en-US")}
          </p>
          <CompleteAssessmentChart report={buildAssessmentSummaryReport(assessment, referral)} />
          {assessment.unmapped_fields.length ? <RecordedFields title="Additional recorded assessment information" fields={assessment.unmapped_fields.map((field) => ({ label: field.source_field_key, value: field.value ?? "" }))} /> : null}
          {assessment.addenda?.length ? <RecordedFields title="Addenda" fields={assessment.addenda.map((addendum) => ({ label: addendum.authored_by_name, value: addendum.note }))} /> : null}
        </section>
      ))}
    </div>
  );
}

const identityLabels = new Set(["NAME", "GENDER", "AGE", "DOB", "SSN", "Community:"]);
const chartLabels: Record<string, string> = {
  NAME: "Client", GENDER: "Gender", AGE: "Age", DOB: "Date of birth",
  "Owner (@name):": "Owner", "Referent:": "Referral source",
};

export function buildTransferredClientChart(fields: ReferralCanvasPacketField[]): ClientMedicalChartModel {
  const recorded = fields.filter((field) => field.value.trim());
  return {
    identity: recorded.filter((field) => identityLabels.has(field.label)).map(recordedChartFact),
    priorities: recorded.filter((field) => field.label === "Current medications").map(recordedChartFact),
    care: recorded.filter((field) => !identityLabels.has(field.label) && field.label !== "Summary" && field.label !== "Current medications").map(recordedChartFact),
    assessmentDate: null,
  };
}

function recordedChartFact(field: ReferralCanvasPacketField): ClientChartFact {
  const label = chartLabels[field.label] ?? field.label.replace(/:$/, "");
  return { label, value: field.value, ...(label === "Client" || label === "Community" ? { span: "wide" as const } : {}) };
}

function RecordedSummary({ field }: { field: ReferralCanvasPacketField }) {
  const sections = structuredNarrativeSections.summary;
  const values = parseStructuredNarrative(field.value, sections);
  const headingPositions = sections.map((section) => field.value.indexOf(`## ${section.label}`)).filter((index) => index >= 0);
  const preamble = headingPositions.length ? field.value.slice(0, Math.min(...headingPositions)).trim() : "";
  return <section aria-label="Referral summary" className="border border-[#cfd7d4] bg-white px-5 py-4">
    <h2 className="mb-3 text-[14px] font-bold text-[#202522]">Referral summary</h2>
    {preamble ? <p className="mb-4 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#303638]">{preamble}</p> : null}
    <div className="space-y-4">
      {sections.filter((section) => values[section.key]?.trim()).map((section) => <div key={section.key}>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#68716d]">{section.label}</h3>
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#303638]">{values[section.key]}</p>
      </div>)}
    </div>
  </section>;
}

function RecordedFields({ title, fields }: { title: string; fields: ReferralCanvasPacketField[] }) {
  const recorded = fields.filter((field) => field.value.trim());
  if (!recorded.length) return null;
  return <section aria-label={title}>
    <h2 className="mb-2 text-[13px] font-bold text-[#202522]">{title}</h2>
    <dl className="grid border-l border-t border-[#d7ddd9] sm:grid-cols-2 lg:grid-cols-3">
      {recorded.map((field, index) => <div key={`${field.label}:${index}`} className={`min-w-0 border-b border-r border-[#d7ddd9] px-4 py-3 ${field.value.length > 160 ? "sm:col-span-2 lg:col-span-3" : ""}`}>
        <dt className="text-[10px] font-bold text-[#68716d]">{field.label}</dt>
        <dd className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-[#202522]">{field.value}</dd>
      </div>)}
    </dl>
  </section>;
}

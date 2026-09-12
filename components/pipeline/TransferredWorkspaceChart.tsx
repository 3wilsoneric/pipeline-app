"use client";

import { useEffect, useState } from "react";

import { assessmentToolFieldDefinitions } from "@/lib/assessment/assessment-tool-schema";
import type { AssessmentListResponse, PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ReferralCanvasPacketField } from "@/lib/pipeline/referral-canvas-extraction";

// Pre-launch Pipeline records retain their actual intake and saved assessments,
// rather than being projected onto the ALLO source format or a new workflow.
export default function TransferredWorkspaceChart({ referralId, fields }: {
  referralId: number;
  fields: ReferralCanvasPacketField[];
}) {
  const [assessments, setAssessments] = useState<PipelineAssessmentRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
      <RecordedFields title="Client information" fields={fields} />
      {loading ? <p role="status" className="text-[12px] text-[#68716d]">Loading assessment records...</p> : null}
      {error ? <p role="alert" className="text-[12px] text-[#a4473c]">{error}</p> : null}
      {assessments.map((assessment, index) => (
        <section key={assessment.assessment_id}>
          <p className="mb-2 text-[11px] text-[#68716d]">
            {assessment.signed_at ? "Signed" : "Saved, unsigned"} · {assessment.updated_by.name} · {new Date(assessment.updated_at).toLocaleDateString("en-US")}
          </p>
          <RecordedFields title={`Assessment ${index + 1}`} fields={assessmentToolFieldDefinitions.map(({ key, label }) => ({ label, value: displayValue(assessment[key]) }))} />
          {assessment.unmapped_fields.length ? <RecordedFields title="Additional recorded assessment information" fields={assessment.unmapped_fields.map((field) => ({ label: field.source_field_key, value: field.value ?? "" }))} /> : null}
          {assessment.addenda?.length ? <RecordedFields title="Addenda" fields={assessment.addenda.map((addendum) => ({ label: addendum.authored_by_name, value: addendum.note }))} /> : null}
        </section>
      ))}
    </div>
  );
}

function RecordedFields({ title, fields }: { title: string; fields: ReferralCanvasPacketField[] }) {
  const recorded = fields.filter((field) => field.value.trim());
  if (!recorded.length) return null;
  return <section aria-label={title}>
    <h2 className="mb-2 text-[13px] font-bold text-[#202522]">{title}</h2>
    <dl className="grid border-l border-t border-[#d7ddd9] sm:grid-cols-2">
      {recorded.map((field, index) => <div key={`${field.label}:${index}`} className="border-b border-r border-[#d7ddd9] p-4">
        <dt className="text-[10px] font-bold text-[#68716d]">{field.label}</dt>
        <dd className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-[#202522]">{field.value}</dd>
      </div>)}
    </dl>
  </section>;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

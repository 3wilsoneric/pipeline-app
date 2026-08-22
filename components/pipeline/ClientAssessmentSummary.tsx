"use client";

import { useMemo } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";

import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import {
  assessmentToolFieldDefinitions,
  getAssessmentToolCoverage,
} from "@/lib/assessment/assessment-tool-schema";
import type { UnifiedProfileConnection } from "@/lib/pipeline/unified-profile-contracts";

export default function ClientAssessmentSummary({
  assessments,
  connection,
}: {
  assessments: PipelineAssessmentRecord[];
  connection: UnifiedProfileConnection;
}) {
  const latest = assessments[0] ?? null;
  const coverage = useMemo(() => latest ? getAssessmentToolCoverage(latest) : null, [latest]);
  const missing = useMemo(() => {
    if (!coverage) return [];
    return coverage.missing_fields
      .filter((field) => !["source_file", "match_confidence", "extraction_date"].includes(field))
      .slice(0, 6)
      .map((field) => assessmentToolFieldDefinitions.find((definition) => definition.key === field)?.label ?? field);
  }, [coverage]);

  if (!latest) {
    const connected = connection.status === "confirmed" || connection.status === "pipeline_only";
    return (
      <div className="flex gap-3 py-3">
        <ClipboardList size={17} className="mt-0.5 shrink-0 text-[#0f8b73]" />
        <div>
          <div className="text-[12px] font-black">No assessments yet</div>
          <div className="mt-1 max-w-xl text-[11px] leading-5 text-[#737373]">
            {connected
              ? "No assessment has been captured for this client."
              : connection.message}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-px bg-[#d9dfdb] sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric label="Assessment history" value={String(assessments.length)} detail="Separate dated records" />
        <SummaryMetric label="Latest captured" value={`${coverage?.captured ?? 0} / ${coverage?.total ?? 52}`} detail={`${coverage?.percent ?? 0}% complete`} />
        <SummaryMetric label="Latest status" value={formatAssessmentStatus(latest.status)} detail={formatDate(latest.assessment_date)} />
        <SummaryMetric label="Assigned assessor" value={latest.assessor || "Unassigned"} detail={latest.status === "complete" ? "Recorded at completion" : "Current assignment"} />
      </div>
      <div className="mt-4 h-2 bg-[#e8eeeb]"><div className="h-full bg-[#0f8b73]" style={{ width: `${coverage?.percent ?? 0}%` }} /></div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-black"><CheckCircle2 size={14} className="text-[#0f8b73]" /> Latest assessment</div>
          <div className="mt-2 text-[11px] text-[#737373]">Updated {formatTimestamp(latest.updated_at)} by {latest.updated_by.name}</div>
        </div>
        {missing.length > 0 ? (
          <div className="max-w-lg text-[11px] leading-5 text-[#737373]"><span className="font-black text-[#8a5a10]">Still missing:</span> {missing.join(", ")}{(coverage?.missing_fields.length ?? 0) > missing.length ? " and more" : ""}</div>
        ) : <div className="text-[11px] font-black text-[#0f8b73]">All assessment fields captured</div>}
      </div>
    </div>
  );
}

function formatAssessmentStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="bg-white px-4 py-3"><div className="text-[9px] font-black uppercase text-[#737373]">{label}</div><div className="mt-1 text-[17px] font-black capitalize">{value}</div><div className="mt-1 text-[10px] text-[#737373]">{detail}</div></div>;
}

function formatDate(value: string | null) {
  if (!value) return "Date not entered";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "recently" : parsed.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { assessmentToolFieldDefinitions } from "@/lib/assessment/assessment-tool-schema";
import { assessmentInterviewOptionLabel, assessmentInterviewSections } from "@/lib/assessment/assessment-interview-schema";
import { ChartFacts } from "@/components/pipeline/ClientMedicalChart";

export function ClientAssessmentRecords({ assessments }: { assessments: PipelineAssessmentRecord[] }) {
  return assessments.map((assessment) => <ClientAssessmentRecord key={assessment.assessment_id} assessment={assessment} />);
}

export default function ClientAssessmentRecord({ assessment }: { assessment: PipelineAssessmentRecord }) {
  const signed = Boolean(assessment.signed_at);
  return <article aria-label="Assessment record" data-assessment-record={assessment.assessment_id} className="min-w-0 border border-[#d4dcd8] bg-white">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#d4dcd8] bg-[#f5f7f6] px-5 py-4 sm:px-7">
      <h2 className="text-[19px] font-bold text-[#23362f]">Assessment{assessment.assessment_date ? ` · ${assessment.assessment_date}` : ""}</h2>
      <span className={`text-[13px] font-semibold ${signed ? "text-[#12765f]" : "text-[#865e20]"}`}>{signed ? "Signed" : "In progress, not signed"}</span>
    </header>
    {assessmentInterviewSections.map((section) => {
      const facts = assessmentToolFieldDefinitions.filter((field) => field.section === section.key).flatMap((field) => {
        const value = assessment[field.key];
        if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return [];
        const display = Array.isArray(value) ? value.map((item) => assessmentInterviewOptionLabel(field.key, item) ?? item).join("\n")
          : typeof value === "object" ? Object.entries(value).map(([key, reason]) => `${assessmentToolFieldDefinitions.find((item) => item.key === key)?.label ?? key}: ${reason}`).join("\n")
          : assessmentInterviewOptionLabel(field.key, String(value)) ?? String(value);
        return display.trim() ? [{ label: field.label, value: display }] : [];
      });
      if (!facts.length) return null;
      return <section key={section.key} aria-label={section.label} className="border-b border-[#e0e5e2] px-5 py-5 sm:px-7 sm:py-6">
        <h3 className="mb-5 text-[17px] font-bold text-[#29483d]">{section.label}</h3>
        <ChartFacts facts={facts} />
      </section>;
    })}
    <footer className="flex flex-wrap justify-between gap-2 px-5 py-4 text-[12px] leading-5 text-[#59675f] sm:px-7">
      <span className="break-all">Assessment {assessment.assessment_id} · Version {assessment.version}</span>
      <span>{signed ? `Signed ${assessment.signed_at}${assessment.signed_by?.name ? ` by ${assessment.signed_by.name}` : ""}` : "Working answers. Not a signed clinical record."}</span>
    </footer>
  </article>;
}

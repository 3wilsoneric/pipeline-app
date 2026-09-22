import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { assessmentToolFieldDefinitions, type AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import { assessmentInterviewOptionLabel, assessmentInterviewSections, assessmentInterviewQuestions, isAssessmentQuestionVisible } from "@/lib/assessment/assessment-interview-schema";
import { ChartFacts } from "@/components/pipeline/ClientMedicalChart";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";

export function ClientAssessmentRecords({ assessments, editableAssessmentId, onEditField }: { assessments: PipelineAssessmentRecord[]; editableAssessmentId?: string; onEditField?: (field: AssessmentToolFieldKey) => void }) {
  return assessments.map((assessment) => <ClientAssessmentRecord key={assessment.assessment_id} assessment={assessment} onEditField={assessment.assessment_id === editableAssessmentId ? onEditField : undefined} />);
}

export default function ClientAssessmentRecord({ assessment, onEditField }: { assessment: PipelineAssessmentRecord; onEditField?: (field: AssessmentToolFieldKey) => void }) {
  const signed = Boolean(assessment.signed_at);
  const editableFields = new Set(assessmentInterviewQuestions.filter((question) => isAssessmentQuestionVisible(question, assessment)).map((question) => question.field));
  return <article aria-label="Assessment record" data-assessment-record={assessment.assessment_id} className="min-w-0 border border-[#d4dcd8] bg-white">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#d4dcd8] bg-[#f5f7f6] px-5 py-4 sm:px-7">
      <h2 className="text-[19px] font-bold text-[#23362f]">Assessment{assessment.assessment_date ? ` · ${formatProfileDate(assessment.assessment_date)}` : ""}</h2>
      <span className={`text-[13px] font-semibold ${signed ? "text-[#12765f]" : "text-[#865e20]"}`}>{signed ? "Signed" : "In progress, not signed"}</span>
    </header>
    {assessmentInterviewSections.map((section) => {
      const facts = assessmentToolFieldDefinitions.filter((field) => field.section === section.key && field.key !== "resident_number").flatMap((field) => {
        const value = assessment[field.key];
        if (isEmptyRecordedValue(value)) return [];
        const display = recordedFieldValue(field, value);
        const question = assessmentInterviewQuestions.find((item) => item.field === field.key);
        const inactive = question && !isAssessmentQuestionVisible(question, assessment);
        return display.trim() ? [{ label: inactive ? `${field.label} (previous answer)` : field.label, value: inactive ? `Not applicable to the current answers. Retained for review.\n${display}` : display, onEdit: onEditField && editableFields.has(field.key) ? () => onEditField(field.key) : undefined }] : [];
      });
      if (!facts.length) return null;
      return <section key={section.key} aria-label={section.label} className="border-b border-[#e0e5e2] px-5 py-5 sm:px-7 sm:py-6">
        <h3 className="mb-5 text-[17px] font-bold text-[#29483d]">{section.label}</h3>
        <ChartFacts facts={facts} editHint="Edit answer" />
      </section>;
    })}
    <footer className="flex flex-wrap justify-between gap-2 px-5 py-4 text-[12px] leading-5 text-[#59675f] sm:px-7">
      <details className="min-w-0">
        <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-2">Record details</summary>
        <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3">
          <dt>Assessment ID</dt><dd className="break-all font-mono">{assessment.assessment_id}</dd>
          <dt>Version</dt><dd>{assessment.version}</dd>
          <dt>Created</dt><dd>{readableTimestamp(assessment.created_at)}{assessment.created_by?.name ? ` by ${assessment.created_by.name}` : ""}</dd>
        </dl>
      </details>
      <span>{signed ? `Signed ${readableTimestamp(assessment.signed_at!)}${assessment.signed_by?.name ? ` by ${assessment.signed_by.name}` : ""}` : "Working answers. Not a signed clinical record."}</span>
    </footer>
  </article>;
}

function readableTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function recordedFieldValue(field: (typeof assessmentToolFieldDefinitions)[number], value: NonNullable<PipelineAssessmentRecord[AssessmentToolFieldKey]>): string {
  return Array.isArray(value) ? value.map((item) => assessmentInterviewOptionLabel(field.key, item) ?? item).join("\n")
          : typeof value === "object" ? Object.entries(value).map(([key, reason]) => `${assessmentToolFieldDefinitions.find((item) => item.key === key)?.label ?? key}: ${reason}`).join("\n")
          : field.value_type === "date" ? formatProfileDate(String(value)) ?? String(value)
          : field.value_type === "timestamp" ? readableTimestamp(String(value))
          : assessmentInterviewOptionLabel(field.key, String(value)) ?? String(value);
}

function isEmptyRecordedValue(value: unknown): value is null | undefined | "" | [] {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);
}

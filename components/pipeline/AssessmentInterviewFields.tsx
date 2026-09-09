import { Check, ChevronDown, Sparkles } from "lucide-react";

import { getAssessmentFieldWritingSpec } from "@/lib/assessment/assessment-field-writing-spec";
import {
  assessmentInterviewSections,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import {
  type AssessmentFieldProvenance,
  type AssessmentToolData,
  type AssessmentToolFieldDefinition,
  type AssessmentToolFieldKey,
} from "@/lib/assessment/assessment-tool-schema";
import { extractionOwnedFields } from "@/components/pipeline/assessment-workspace-state";
import { type getAssessmentPracticeReview } from "@/lib/training/assessment-practice";

type AssessmentFieldProps = {
  definition: AssessmentToolFieldDefinition;
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  required: boolean;
  pending: boolean;
  pendingProvenance?: AssessmentFieldProvenance;
  disabled: boolean;
  reviewDisabled: boolean;
  onChange: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  onReview: (action: "accept" | "reject") => void;
  onUnableReasonChange: (reason: string) => void;
};

export function AssessmentField(props: AssessmentFieldProps) {
  const { definition, question, value, required, pending, disabled } = props;
  const id = `assessment-${definition.key}`;
  const readOnly = disabled || extractionOwnedFields.has(definition.key);

  return (
    <div className={question.span === "full" ? "md:col-span-2" : ""}>
      <AssessmentFieldHeader id={id} definition={definition} value={value} required={required} pending={pending} />
      <PendingAssessmentSuggestion {...props} />
      <AssessmentFieldControl {...props} id={id} readOnly={readOnly} />
      {question.help ? <p className="mt-1.5 text-[10px] leading-4 text-[#737373]">{question.help}</p> : null}
    </div>
  );
}

function AssessmentFieldHeader({ id, definition, value, required, pending }: Pick<AssessmentFieldProps, "definition" | "value" | "required" | "pending"> & { id: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-[11px] font-black text-[#444444]">{definition.label}{required ? " *" : ""}</label>
      {pending ? <span className="bg-[#fff3dc] px-2 py-0.5 text-[9px] font-black uppercase text-[#9a6115]">Review</span> : hasValue(value) ? <Check size={12} className="text-[#0f8b73]" /> : required ? <span className="text-[9px] font-semibold uppercase text-[#9a6115]">Required</span> : <span className="text-[9px] font-semibold uppercase text-[#999999]">Optional</span>}
    </div>
  );
}

function PendingAssessmentSuggestion({ pending, pendingProvenance, reviewDisabled, disabled, onReview }: AssessmentFieldProps) {
  if (!pending || !pendingProvenance) return null;
  return (
    <div className="mb-2 border-l-2 border-[#c9892a] bg-[#fffaf0] px-3 py-2">
      <div className="text-[10px] leading-4 text-[#70480d]">
        Suggested from <strong>{assessmentEvidenceSource(pendingProvenance)}</strong>
        {assessmentEvidenceLocation(pendingProvenance)}
        {Number.isFinite(pendingProvenance.confidence) ? ` · ${Math.round(pendingProvenance.confidence * 100)}% confidence` : ""}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={reviewDisabled} onClick={() => onReview("accept")} className="h-8 bg-[#0f8b73] px-3 text-[10px] font-black text-white hover:bg-[#0b6d5b] disabled:opacity-50">Use</button>
        <button type="button" disabled={reviewDisabled} onClick={() => onReview("reject")} className="h-8 border border-[#c9a978] bg-white px-3 text-[10px] font-black text-[#70480d] hover:border-[#9a6115] disabled:opacity-50">Reject</button>
        {!disabled ? <span className="self-center text-[9px] text-[#8a6c43]">Or correct the answer below.</span> : null}
      </div>
    </div>
  );
}

function AssessmentFieldControl(props: AssessmentFieldProps & { id: string; readOnly: boolean }) {
  switch (props.question.control) {
    case "yes_no": return <YesNoAssessmentField {...props} />;
    case "rating": return <RatingAssessmentField {...props} />;
    case "select": return <SelectAssessmentField {...props} />;
    case "multi_select": return <MultiSelectAssessmentField {...props} />;
    case "textarea": return <TextareaAssessmentField {...props} />;
    default: return <BasicAssessmentField {...props} />;
  }
}

type AssessmentFieldControlProps = AssessmentFieldProps & { id: string; readOnly: boolean };

function YesNoAssessmentField({ id, definition, question, value, unableReason, readOnly, onChange, onUnableReasonChange }: AssessmentFieldControlProps) {
  return (
    <>
      <div id={id} className="grid min-h-10 grid-cols-[0.7fr_0.7fr_1.35fr]" role="group" aria-label={definition.label}>
        {(question.options ?? []).map((option) => {
          const active = value === option.value;
          return <button key={option.value} type="button" disabled={readOnly} aria-pressed={active} onClick={() => {
            if (option.value !== "unable_to_assess" && value === "unable_to_assess") onUnableReasonChange("");
            onChange(option.value);
          }} className={`border border-r-0 px-2 py-2 text-[10px] font-black leading-4 transition-colors last:border-r ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-[#c9ceca] bg-white text-[#737373] hover:bg-[#f4f7f5]"} disabled:cursor-not-allowed disabled:opacity-60`}>{option.label}</button>;
        })}
      </div>
      {value === "unable_to_assess" ? (
        <div className="mt-2 border-l-2 border-[#c9892a] bg-[#fffaf0] px-3 py-2.5">
          <label htmlFor={`${id}-unable-reason`} className="text-[10px] font-black text-[#70480d]">Why could this not be assessed? *</label>
          <textarea id={`${id}-unable-reason`} value={unableReason} readOnly={readOnly} required rows={3} maxLength={2000} onChange={(event) => onUnableReasonChange(event.target.value)} placeholder="Record the missing source, unavailable client response, or other reason." className="mt-1.5 w-full resize-y border border-[#d7bd8e] bg-white px-3 py-2 text-[11px] leading-5 outline-none placeholder:text-[#a58b65] focus:border-[#9a6115] read-only:bg-[#f5f1e9]" />
          {!unableReason.trim() ? <p className="mt-1 text-[9px] font-semibold text-[#9a6115]">An explanation is required before this assessment can be signed.</p> : null}
        </div>
      ) : null}
    </>
  );
}

function RatingAssessmentField({ id, definition, value, readOnly, onChange }: AssessmentFieldControlProps) {
  return <div id={id} className="grid h-10 grid-cols-5" role="group" aria-label={`${definition.label}, 1 through 5`}>{[1, 2, 3, 4, 5].map((rating) => {
    const active = value === rating;
    return <button key={rating} type="button" disabled={readOnly} aria-pressed={active} onClick={() => onChange(rating)} className={`border border-r-0 text-[11px] font-black last:border-r ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-[#c9ceca] bg-white text-[#737373] hover:bg-[#f4f7f5]"} disabled:cursor-not-allowed disabled:opacity-60`}>{rating}</button>;
  })}</div>;
}

function SelectAssessmentField({ id, question, value, readOnly, onChange }: AssessmentFieldControlProps) {
  const options = question.options ?? [];
  const stringValue = fieldStringValue(value);
  const hasUnlistedValue = typeof value === "string" && value.length > 0 && !options.some((option) => option.value === value);
  return <div className="relative"><select id={id} value={stringValue} disabled={readOnly} onChange={(event) => onChange(event.target.value || null)} className="h-10 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none transition-colors hover:border-[#8ca59c] focus:border-[#0f8b73] disabled:bg-[#f4f6f5] disabled:text-[#737373]"><option value="">Select...</option>{hasUnlistedValue ? <option value={stringValue}>{stringValue}</option> : null}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" /></div>;
}

function MultiSelectAssessmentField({ id, definition, question, value, readOnly, onChange }: AssessmentFieldControlProps) {
  const options = question.options ?? [];
  const selectedValues = Array.isArray(value) ? value : [];
  const extraOptions = selectedValues.filter((selected) => !options.some((option) => option.value === selected)).map((selected) => ({ value: selected, label: selected }));
  return <div id={id} className="grid gap-px border border-[#c9ceca] bg-[#d9dfdb] sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={definition.label}>{[...options, ...extraOptions].map((option) => {
    const active = selectedValues.includes(option.value);
    return <label key={option.value} className={`flex min-h-10 items-center gap-2 bg-white px-3 text-[11px] font-semibold ${readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[#f4f7f5]"}`}><input type="checkbox" checked={active} disabled={readOnly} onChange={() => onChange(active ? selectedValues.filter((item) => item !== option.value) : [...selectedValues, option.value])} className="h-4 w-4 accent-[#0f8b73]" /><span>{option.label}</span></label>;
  })}</div>;
}

function TextareaAssessmentField({ id, definition, question, value, readOnly, onChange }: AssessmentFieldControlProps) {
  const isList = definition.value_type === "string_list";
  return <><textarea data-guide-target="assessment-answer" id={id} value={fieldStringValue(value)} readOnly={readOnly} rows={isList ? 3 : 4} onChange={(event) => onChange(isList ? listFromLines(event.target.value) : event.target.value || null)} placeholder={question.placeholder ?? (isList ? "One item per line" : "Enter assessment detail")} className="w-full resize-y border border-[#c9ceca] bg-white px-3 py-2 text-[12px] leading-5 outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73] read-only:bg-[#f4f6f5]" /><AssessmentFieldWritingGuidePanel field={definition.key} /></>;
}

function BasicAssessmentField({ id, definition, question, value, readOnly, onChange }: AssessmentFieldControlProps) {
  const isNumeric = definition.value_type === "integer" || definition.value_type === "confidence";
  const type = question.control === "date" ? "date" : question.control === "number" ? "number" : "text";
  return <input id={id} type={type} min={question.min ?? (isNumeric ? 0 : undefined)} max={question.max ?? (definition.value_type === "confidence" ? 1 : undefined)} step={definition.value_type === "confidence" ? 0.01 : definition.value_type === "integer" ? 1 : undefined} value={fieldStringValue(value)} readOnly={readOnly} placeholder={question.placeholder} onChange={(event) => onChange(isNumeric ? event.target.value === "" ? null : Number(event.target.value) : event.target.value || null)} className="h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73] read-only:bg-[#f4f6f5]" />;
}

export function PracticeAssessmentReview({ review }: { review: ReturnType<typeof getAssessmentPracticeReview> }) {
  const sections = [
    { label: "Required answers missing", items: review.missingRequired },
    { label: "Follow-ups still open", items: review.openConditionalDetails },
    { label: "Conflicting information", items: review.conflicts },
    { label: "Awaiting confirmation", items: review.awaitingConfirmation },
  ];

  return (
    <section aria-label="Practice assessment review" className="mb-7 border-y border-[#cfd8d4] py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Final check</div>
          <h4 className="mt-1 text-[17px] font-black">Review what still needs attention</h4>
        </div>
        <div className="text-[10px] font-bold text-[#52605a]">{review.sectionsReady.length} of {assessmentInterviewSections.length} sections ready</div>
      </div>
      <div className="mt-4 grid gap-x-7 gap-y-5 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="flex items-center justify-between gap-3 border-b border-[#e0e5e2] pb-2">
              <h5 className="text-[10px] font-black uppercase text-[#505a55]">{section.label}</h5>
              <span className="text-[10px] font-black tabular-nums text-[#0f7c68]">{section.items.length}</span>
            </div>
            {section.items.length > 0 ? (
              <ul className="mt-2 space-y-2 text-[11px] leading-5 text-[#59645f]">
                {section.items.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : <p className="mt-2 text-[11px] font-semibold text-[#0f6f5d]">Clear</p>}
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-[#e0e5e2] pt-4">
        <div className="text-[10px] font-black uppercase text-[#505a55]">Sections ready</div>
        <p className="mt-2 text-[11px] leading-5 text-[#59645f]">{review.sectionsReady.join(" · ") || "None yet"}</p>
      </div>
    </section>
  );
}

function AssessmentFieldWritingGuidePanel({ field }: { field: AssessmentToolFieldKey }) {
  const specification = getAssessmentFieldWritingSpec(field);
  if (!specification) return null;

  return (
    <details className="mt-2 border border-[#d9dfdb] bg-[#f8faf9]">
      <summary data-guide-target="assessment-answer-help" className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <span className="flex items-center gap-2 text-[10px] font-black text-[#315e50]"><Sparkles size={12} /> Answer format</span>
        <span className="text-[9px] font-semibold text-[#7b837e]">{specification.formatLabel} · {specification.lengthGuidance}</span>
      </summary>
      <div className="border-t border-[#d9dfdb] px-3 py-3">
        <AssessmentFieldWritingGuide specification={specification} />
      </div>
    </details>
  );
}

function AssessmentFieldWritingGuide({ specification }: { specification: NonNullable<ReturnType<typeof getAssessmentFieldWritingSpec>> }) {
  return (
    <>
      <div className="border-l-2 border-[#0f8b73] bg-white px-3 py-2.5">
        <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#315e50]">Use this order</div>
        <p className="mt-1.5 text-[10px] font-semibold leading-4 text-[#3f4a45]">{specification.formatTemplate}</p>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(260px,1.1fr)]">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Include</div>
          <ul className="mt-2 grid gap-1.5 text-[10px] leading-4 text-[#595959] sm:grid-cols-2 lg:grid-cols-1">
            {specification.requiredElements.map((item) => <li key={item} className="flex items-start gap-2"><Check size={11} className="mt-0.5 shrink-0 text-[#0f8b73]" />{item}</li>)}
          </ul>
        </div>
        <div className="border-l border-[#d9dfdb] pl-3">
          <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Example format</div>
          <p className="mt-2 text-[10px] leading-4 text-[#4f5652]">{specification.strongExample}</p>
        </div>
      </div>
      <p className="mt-3 border-l-2 border-[#d2a759] bg-[#fffaf0] px-2 py-1.5 text-[9px] leading-4 text-[#70480d]">{specification.guardrail}</p>
    </>
  );
}

function assessmentEvidenceLocation(provenance: AssessmentFieldProvenance) {
  if (provenance.evidence_url?.startsWith("workbook://")) return "";
  return provenance.source_page_no ? `, page ${provenance.source_page_no}` : "";
}

function assessmentEvidenceSource(provenance: AssessmentFieldProvenance) {
  if (provenance.evidence_url?.startsWith("workbook://") || /\.(xlsx?|csv|tsv)$/i.test(provenance.source_file ?? "")) {
    return "existing assessment data";
  }
  return provenance.source_file || "the uploaded packet";
}

function listFromLines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function fieldStringValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.join("\n");
  if (value === null) return "";
  return String(value);
}

function hasValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null;
}

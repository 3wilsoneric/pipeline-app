"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  History,
  LoaderCircle,
  Save,
  UploadCloud,
} from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { parseAssessmentFile } from "@/lib/assessment/assessment-file-parser";
import type {
  AssessmentListResponse,
  PipelineAssessmentRecord,
} from "@/lib/assessment/assessment-records";
import {
  assessmentToolFieldDefinitions,
  assessmentToolSections,
  createEmptyAssessmentToolData,
  getAssessmentToolCompleteness,
  getAssessmentToolCoverage,
  pickAssessmentToolData,
  type AssessmentToolData,
  type AssessmentToolFieldDefinition,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";

type AssessmentWorkspaceProps = {
  referralId?: number;
  onSummaryChange?: (summary: { captured: number; total: number; status: string; assessmentId?: string }) => void;
};

const sectionLabels: Record<AssessmentToolSection, string> = {
  identity: "Identity",
  prior_placement: "Placement",
  prior_history: "History",
  diagnosis_clinical: "Clinical",
  functional_adl: "ADLs",
  behavioral_risk: "Risk",
  legal_conservatorship: "Legal",
  medication: "Medication",
  substance_use: "Substance use",
  social_support: "Support",
  provenance_qc: "Review notes",
};

const extractionOwnedFields = new Set<AssessmentToolFieldKey>([
  "source_file",
  "match_confidence",
  "extraction_date",
]);

export default function AssessmentWorkspace({ referralId, onSummaryChange }: AssessmentWorkspaceProps) {
  const [assessments, setAssessments] = useState<PipelineAssessmentRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AssessmentToolData>(createEmptyAssessmentToolData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>("identity");
  const [isLoading, setIsLoading] = useState(Boolean(referralId));
  const [isBusy, setIsBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = assessments.find((assessment) => assessment.assessment_id === selectedId) ?? null;
  const coverage = useMemo(() => getAssessmentToolCoverage(draft), [draft]);
  const required = useMemo(() => getAssessmentToolCompleteness(draft), [draft]);
  const pendingFields = useMemo(() => getPendingFields(selected), [selected]);
  const sectionDefinitions = useMemo(
    () => assessmentToolFieldDefinitions.filter((definition) => definition.section === activeSection),
    [activeSection],
  );

  useEffect(() => {
    if (!referralId) {
      setAssessments([]);
      setSelectedId("");
      setDraft(createEmptyAssessmentToolData());
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    fetchPipelineJson<AssessmentListResponse>(`/api/referrals/${referralId}/assessments`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((payload) => {
        setAssessments(payload.assessments);
        setSelectedId((current) => current && payload.assessments.some((item) => item.assessment_id === current)
          ? current
          : payload.assessments[0]?.assessment_id ?? "");
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(messageFor(loadError, "Assessment history could not be loaded."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [referralId]);

  useEffect(() => {
    if (!selected) return;
    setDraft(pickAssessmentToolData(selected));
    setDirty(false);
  }, [selected]);

  useEffect(() => {
    onSummaryChange?.({
      captured: coverage.captured,
      total: coverage.total,
      status: selected?.status ?? "not_started",
      assessmentId: selected?.assessment_id,
    });
  }, [coverage.captured, coverage.total, onSummaryChange, selected?.assessment_id, selected?.status]);

  const startAssessment = async () => {
    if (!referralId) return;
    setIsBusy(true);
    setError("");
    setMessage("Starting assessment...");
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/referrals/${referralId}/assessments`,
        {
          method: "POST",
          body: JSON.stringify({ data: {}, client_mutation_id: mutationId("assessment-create") }),
        },
      );
      upsertAssessment(payload.assessment, true);
      setMessage("Assessment draft created");
      setActiveSection("identity");
    } catch (createError) {
      setError(messageFor(createError, "The assessment could not be started."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const saveAssessment = async (nextStatus = selected?.status ?? "draft", acceptPending = false) => {
    if (!selected) return;
    setIsBusy(true);
    setError("");
    setMessage(nextStatus === "complete" ? "Checking assessment..." : "Saving assessment...");
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(selected.assessment_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            if_match: selected.version,
            patch: {
              data: editableAssessmentData(draft),
              status: nextStatus,
              ...(acceptPending ? { accept_pending: true } : {}),
            },
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      setMessage(
        nextStatus === "complete"
          ? "Assessment completed"
          : acceptPending
            ? "Imported values confirmed"
            : "Assessment saved",
      );
    } catch (saveError) {
      setError(messageFor(saveError, "The assessment could not be saved."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file || !referralId) return;
    setIsBusy(true);
    setError("");
    setMessage("Reading assessment file...");
    try {
      const parsed = await parseAssessmentFile(file);
      setMessage(`Mapping ${parsed.fields.length} extracted values...`);
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/referrals/${referralId}/assessments/import`,
        {
          method: "POST",
          body: JSON.stringify({
            assessment_id: selected?.assessment_id,
            if_match: selected?.version,
            fields: parsed.fields,
            context: {
              source_file: file.name,
              extraction_date: new Date().toISOString(),
              match_confidence: parsed.matchConfidence,
            },
            client_mutation_id: mutationId("assessment-import"),
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      setMessage("Extracted values are ready for review");
    } catch (importError) {
      setError(messageFor(importError, "The assessment file could not be imported."));
      setMessage("");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsBusy(false);
    }
  };

  const upsertAssessment = (assessment: PipelineAssessmentRecord, select = false) => {
    setAssessments((current) => [assessment, ...current.filter((item) => item.assessment_id !== assessment.assessment_id)]);
    if (select) setSelectedId(assessment.assessment_id);
    setDraft(pickAssessmentToolData(assessment));
    setDirty(false);
  };

  const updateField = (key: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => {
    setDraft((current) => setAssessmentValue(current, key, value));
    setDirty(true);
    setMessage("Unsaved changes");
    setError("");
  };

  if (!referralId) {
    return (
      <AssessmentEmpty
        title="Save the referral before starting the assessment"
        detail="The assessment needs a referral ID so its history, files, and edits stay attached to one intake episode."
      />
    );
  }

  if (isLoading) {
    return <div className="flex min-h-56 items-center justify-center gap-2 text-[12px] text-[#737373]"><LoaderCircle className="animate-spin" size={16} /> Loading assessment history...</div>;
  }

  if (!selected) {
    return (
      <AssessmentEmpty
        title="No assessment started"
        detail="Start a draft, enter answers directly, or import a CSV assessment. Repeated assessments remain separate history records."
        action={<button type="button" onClick={startAssessment} disabled={isBusy} className="h-11 bg-[#111111] px-5 text-[12px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-50">Start assessment</button>}
        error={error}
      />
    );
  }

  return (
    <section aria-label="Assessment workspace" className="border border-[#d6ddd9] bg-white">
      <div className="grid grid-cols-3 gap-px bg-[#d9dfdb] lg:grid-cols-[minmax(0,1fr)_190px_190px_190px]">
        <div className="col-span-3 bg-white px-5 py-4 lg:col-span-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-black">Assessment</h2>
            <StatusLabel status={selected.status} />
            {dirty ? <span className="text-[11px] font-semibold text-[#a66b17]">Unsaved</span> : null}
          </div>
          <div className="mt-1 text-[11px] text-[#737373]">
            {formatDate(selected.assessment_date)} · version {selected.version}
          </div>
        </div>
        <AssessmentMetric label="Captured" value={`${coverage.captured} / ${coverage.total}`} detail={`${coverage.percent}% of assessment fields`} />
        <AssessmentMetric label="Required identity" value={`${required.required_ready} / ${required.required_total}`} detail={required.missing_fields.length ? `${required.missing_fields.length} still needed` : "Ready"} />
        <AssessmentMetric label="Needs review" value={String(pendingFields.length)} detail={selected.unmapped_fields.length ? `${selected.unmapped_fields.length} banked values` : "No banked values"} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[#d9dfdb] px-4 py-3">
        <History size={15} className="text-[#0f8b73]" />
        <label htmlFor="assessment-history" className="sr-only">Assessment history</label>
        <select
          id="assessment-history"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="h-9 min-w-[210px] border border-[#c9ceca] bg-white px-3 text-[12px] font-semibold outline-none focus:border-[#0f8b73]"
        >
          {assessments.map((assessment, index) => (
            <option key={assessment.assessment_id} value={assessment.assessment_id}>
              {formatDate(assessment.assessment_date)} · {assessment.status.replace("_", " ")}{index === 0 ? " · latest" : ""}
            </option>
          ))}
        </select>
        <button type="button" onClick={startAssessment} disabled={isBusy} className="h-9 border border-[#c9ceca] px-3 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-50">New assessment</button>
        <div className="min-w-0 flex-1" />
        <span aria-live="polite" className={`text-[11px] ${error ? "text-[#a63d2f]" : "text-[#737373]"}`}>{error || message}</span>
        <button type="button" onClick={() => saveAssessment(selected.status)} disabled={isBusy || !dirty} className="flex h-9 items-center gap-2 border border-[#111111] px-3 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:cursor-not-allowed disabled:opacity-35"><Save size={14} /> Save</button>
        {selected.status === "complete" ? (
          <button type="button" onClick={() => window.confirm("Reopen this completed assessment?") && saveAssessment("draft")} disabled={isBusy} className="h-9 bg-[#fff3dc] px-3 text-[11px] font-black text-[#8a5a10] disabled:opacity-50">Reopen</button>
        ) : (
          <button type="button" onClick={() => window.confirm("Mark this assessment complete?") && saveAssessment("complete")} disabled={isBusy} className="h-9 bg-[#111111] px-3 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-50">Complete</button>
        )}
      </div>

      <AssessmentImport
        busy={isBusy}
        pendingFields={pendingFields}
        assessment={selected}
        inputRef={fileInputRef}
        onFile={importFile}
        onConfirm={() => saveAssessment("draft", true)}
        onOpenField={(field) => {
          const definition = assessmentToolFieldDefinitions.find((candidate) => candidate.key === field);
          if (definition) setActiveSection(definition.section);
        }}
      />

      <div className="border-t border-[#d9dfdb] px-4 py-3">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11" role="tablist" aria-label="Assessment sections">
          {assessmentToolSections.map((section) => {
            const definitions = assessmentToolFieldDefinitions.filter((definition) => definition.section === section);
            const filled = definitions.filter((definition) => hasValue(draft[definition.key])).length;
            const active = activeSection === section;
            return (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSection(section)}
                className={`min-h-10 border px-2 py-2 text-center text-[11px] font-black leading-4 transition-colors ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-transparent text-[#686868] hover:bg-[#f4f7f5] hover:text-[#0f8b73]"}`}
              >
                {sectionLabels[section]} <span className="ml-1 font-semibold opacity-70">{filled}/{definitions.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[#d9dfdb] px-5 py-5">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-black">{sectionLabels[activeSection]}</h3>
            <p className="mt-1 text-[11px] text-[#737373]">Missing values remain visible. Changes save to this assessment version.</p>
          </div>
          <span className="text-[11px] font-semibold text-[#737373]">{sectionDefinitions.filter((definition) => hasValue(draft[definition.key])).length} of {sectionDefinitions.length} captured</span>
        </div>
        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
          {sectionDefinitions.map((definition) => (
            <AssessmentField
              key={definition.key}
              definition={definition}
              value={draft[definition.key]}
              pending={pendingFields.includes(definition.key)}
              onChange={(value) => updateField(definition.key, value)}
            />
          ))}
        </div>
      </div>

      {selected.unmapped_fields.length > 0 ? (
        <details className="border-t border-[#d9dfdb] px-5 py-4">
          <summary className="cursor-pointer text-[12px] font-black text-[#9a6115]">{selected.unmapped_fields.length} banked values need mapping</summary>
          <div className="mt-3 divide-y divide-[#e1e4e2] border-y border-[#e1e4e2]">
            {selected.unmapped_fields.map((field, index) => (
              <div key={`${field.source_field_key}-${index}`} className="grid gap-1 py-3 text-[11px] sm:grid-cols-[220px_90px_minmax(0,1fr)]">
                <span className="font-black text-[#333333]">{field.source_field_key}</span>
                <span className="text-[#8a5a10]">{field.reason ?? "unmapped"}</span>
                <span className="break-words text-[#595959]">{field.value || "No value"}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function AssessmentImport({
  busy,
  pendingFields,
  assessment,
  inputRef,
  onFile,
  onConfirm,
  onOpenField,
}: {
  busy: boolean;
  pendingFields: AssessmentToolFieldKey[];
  assessment: PipelineAssessmentRecord;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File | undefined) => void;
  onConfirm: () => void;
  onOpenField: (field: AssessmentToolFieldKey) => void;
}) {
  return (
    <div className="border-t border-[#d9dfdb] bg-[#fbfdfc] px-4 py-4">
      <div className="grid items-start gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onFile(event.dataTransfer.files[0]);
          }}
          disabled={busy}
          className="flex min-h-24 items-center gap-4 border border-dashed border-[#8cb9aa] bg-white px-4 text-left hover:border-[#0f8b73] disabled:opacity-50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-[#e7f3ee] text-[#0f8b73]"><UploadCloud size={19} /></span>
          <span>
            <span className="block text-[12px] font-black">Drop assessment file</span>
            <span className="mt-1 block text-[10px] leading-4 text-[#737373]">CSV or JSON locally. XLSX routes to Azure when connected.</span>
          </span>
        </button>
        <input ref={inputRef} type="file" accept=".csv,.tsv,.json,.xlsx,.xls" className="hidden" aria-label="Upload assessment file" onChange={(event) => onFile(event.target.files?.[0])} />

        <div aria-label="Imported assessment values" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-black"><FileSpreadsheet size={15} className="text-[#0f8b73]" /> Imported values</div>
              <div className="mt-1 text-[10px] text-[#737373]">{assessment.source_file || "No assessment file imported"}</div>
            </div>
            {pendingFields.length > 0 ? <button type="button" onClick={onConfirm} disabled={busy} className="flex h-9 items-center gap-2 bg-[#0f8b73] px-3 text-[11px] font-black text-white hover:bg-[#0b6d5b] disabled:opacity-50"><Check size={14} /> Confirm {pendingFields.length} values</button> : null}
          </div>
          {pendingFields.length > 0 ? (
            <div className="mt-3 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {pendingFields.map((field) => {
                const definition = assessmentToolFieldDefinitions.find((candidate) => candidate.key === field);
                return (
                  <button key={field} type="button" onClick={() => onOpenField(field)} className="flex min-w-0 items-center justify-between gap-2 border-b border-[#d9dfdb] px-2 py-2 text-left hover:bg-white">
                    <span className="truncate text-[11px] font-semibold">{definition?.label ?? field}</span>
                    <ChevronRight size={13} className="shrink-0 text-[#0f8b73]" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-[#737373]"><CheckCircle2 size={14} className="text-[#0f8b73]" /> No imported values are waiting for review.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssessmentField({
  definition,
  value,
  pending,
  onChange,
}: {
  definition: AssessmentToolFieldDefinition;
  value: AssessmentToolData[AssessmentToolFieldKey];
  pending: boolean;
  onChange: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const id = `assessment-${definition.key}`;
  const readOnly = extractionOwnedFields.has(definition.key);
  const stringValue = Array.isArray(value) ? value.join("\n") : value === null ? "" : String(value);
  const multiline = definition.value_type === "string_list" || [
    "assessment_notes",
    "behavioral_history",
    "prior_placements",
    "adl_needs",
    "triggers",
    "housing_history",
    "discharge_planning_goals",
  ].includes(definition.key);

  return (
    <div className={multiline ? "md:col-span-2" : ""}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[10px] font-black uppercase text-[#555555]">{definition.label}{definition.required_for_completion ? " *" : ""}</label>
        {pending ? <span className="bg-[#fff3dc] px-2 py-0.5 text-[9px] font-black uppercase text-[#9a6115]">Review</span> : hasValue(value) ? <Check size={12} className="text-[#0f8b73]" /> : <span className="text-[9px] font-semibold uppercase text-[#999999]">Missing</span>}
      </div>
      {multiline ? (
        <textarea
          id={id}
          value={stringValue}
          readOnly={readOnly}
          rows={definition.value_type === "string_list" ? 3 : 4}
          onChange={(event) => onChange(definition.value_type === "string_list" ? listFromLines(event.target.value) : event.target.value || null)}
          placeholder={definition.value_type === "string_list" ? "One item per line" : "Enter assessment detail"}
          className="w-full resize-y border border-[#c9ceca] bg-white px-3 py-2 text-[12px] leading-5 outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73] read-only:bg-[#f4f6f5]"
        />
      ) : (
        <input
          id={id}
          type={definition.value_type === "date" ? "date" : definition.value_type === "integer" || definition.value_type === "confidence" ? "number" : "text"}
          min={definition.value_type === "integer" || definition.value_type === "confidence" ? 0 : undefined}
          max={definition.value_type === "confidence" ? 1 : undefined}
          step={definition.value_type === "confidence" ? 0.01 : definition.value_type === "integer" ? 1 : undefined}
          value={stringValue}
          readOnly={readOnly}
          onChange={(event) => onChange(
            definition.value_type === "integer" || definition.value_type === "confidence"
              ? event.target.value === "" ? null : Number(event.target.value)
              : event.target.value || null,
          )}
          className="h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73] read-only:bg-[#f4f6f5]"
        />
      )}
    </div>
  );
}

function AssessmentEmpty({ title, detail, action, error }: { title: string; detail: string; action?: React.ReactNode; error?: string }) {
  return (
    <section className="flex min-h-64 items-center justify-center border border-[#d6ddd9] bg-white px-6 py-12 text-center">
      <div className="max-w-lg">
        <FileSpreadsheet size={25} className="mx-auto text-[#0f8b73]" />
        <h2 className="mt-4 text-[17px] font-black">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-[#737373]">{detail}</p>
        {action ? <div className="mt-5">{action}</div> : null}
        {error ? <div role="alert" className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[#a63d2f]"><AlertTriangle size={13} /> {error}</div> : null}
      </div>
    </section>
  );
}

function AssessmentMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="bg-white px-4 py-4"><div className="text-[9px] font-black uppercase text-[#737373]">{label}</div><div className="mt-1 text-[18px] font-black">{value}</div><div className="mt-1 truncate text-[10px] text-[#737373]">{detail}</div></div>;
}

function StatusLabel({ status }: { status: PipelineAssessmentRecord["status"] }) {
  const style = status === "complete" ? "bg-[#e7f3ee] text-[#0f6f5d]" : status === "needs_review" ? "bg-[#fff3dc] text-[#8a5a10]" : "bg-[#eef1f6] text-[#4e6177]";
  return <span className={`px-2 py-1 text-[9px] font-black uppercase ${style}`}>{status.replace("_", " ")}</span>;
}

function getPendingFields(assessment: PipelineAssessmentRecord | null) {
  if (!assessment) return [];
  return assessmentToolFieldDefinitions
    .filter((definition) => assessment.field_provenance[definition.key]?.at(-1)?.review_status === "pending")
    .map((definition) => definition.key);
}

function editableAssessmentData(data: AssessmentToolData) {
  return Object.fromEntries(
    assessmentToolFieldDefinitions
      .filter((definition) => !extractionOwnedFields.has(definition.key))
      .map((definition) => [definition.key, data[definition.key]]),
  );
}

function setAssessmentValue(
  data: AssessmentToolData,
  key: AssessmentToolFieldKey,
  value: AssessmentToolData[AssessmentToolFieldKey],
) {
  const next = pickAssessmentToolData(data);
  if (key === "secondary_diagnoses" || key === "medications_at_intake" || key === "substances") {
    if (Array.isArray(value)) next[key] = value;
  } else if (key === "prior_hospitalizations_count" || key === "match_confidence") {
    if (typeof value === "number" || value === null) next[key] = value;
  } else if (typeof value === "string" || value === null) {
    next[key] = value;
  }
  return next;
}

function listFromLines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function hasValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null;
}

function mutationId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value: string | null) {
  if (!value) return "Date not entered";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

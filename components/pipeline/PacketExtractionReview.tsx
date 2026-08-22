"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSearch,
  Pencil,
  X,
} from "lucide-react";

import type { ExtractedField } from "@/lib/extraction/contracts";

type PacketExtractionReviewProps = {
  fields: ExtractedField[];
  fileName: string;
  developmentOnly?: boolean;
  busyFieldKey?: string;
  bulkBusy?: boolean;
  completionBusy?: boolean;
  completionBlockers?: string[];
  onAccept: (field: ExtractedField) => Promise<void>;
  onAcceptAll: (fields: ExtractedField[]) => Promise<void>;
  onEdit: (field: ExtractedField, value: string) => Promise<void>;
  onContinue: () => Promise<void>;
};

const knownLabels: Record<string, string> = {
  "demographics.first_name": "First name",
  "demographics.last_name": "Last name",
  "demographics.date_of_birth": "Date of birth",
  "referral.first_name": "First name",
  "referral.last_name": "Last name",
  "referral.full_name": "Client name",
  "referral.date_of_birth": "Date of birth",
  "referral.age": "Age",
  "referral.gender": "Gender",
  "referral.source": "Referral source",
  "referral.referring_provider": "Referring provider",
  "referral.referring_facility": "Referring facility",
  "referral.source_record_number": "Source record number",
  "referral.source_admission_date": "Source admission date",
  "referral.payer": "Payer",
  "referral.preferred_admission_date": "Preferred admission date",
  "referral.emergency_contact": "Responsible person",
  "referral.primary_diagnosis": "Primary diagnosis",
  "referral.allergies": "Allergies",
  "referral.legal_status": "Legal status",
  "referral.packet_summary": "Packet summary",
  "referral.notes": "Referral notes",
  "assessment.presenting_needs": "Presenting needs",
  "assessment.community_preference": "Community preference",
  "assessment.guardian_contact": "Guardian contact",
  "packet_completeness.med_list_received": "Medication list received",
};

export default function PacketExtractionReview({
  fields,
  fileName,
  developmentOnly = false,
  busyFieldKey,
  bulkBusy = false,
  completionBusy = false,
  completionBlockers = [],
  onAccept,
  onAcceptAll,
  onEdit,
  onContinue,
}: PacketExtractionReviewProps) {
  const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const pending = fields.filter((field) => field.review_status === "pending").length;
  const conflicts = fields.filter((field) => field.is_conflict && field.review_status === "pending").length;
  const reviewed = fields.filter((field) => field.review_status === "accepted" || field.review_status === "edited").length;
  const reviewPercent = fields.length === 0 ? 0 : Math.round((reviewed / fields.length) * 100);
  const safePendingFields = fields.filter((field) => (
    field.review_status === "pending"
    && !field.is_conflict
    && field.confidence >= 0.9
    && Boolean(finalFieldValue(field))
  ));
  const reviewComplete = pending === 0 && conflicts === 0;

  return (
    <section aria-label="Extraction review" className="mb-3 border-y border-[#cfd8d3] bg-white">
      <div className={`flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 ${expanded ? "border-b border-[#dbe2de]" : ""}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#eff8f4] text-[#0f8b73]">
            <FileSearch size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[12px] font-black uppercase tracking-[0.1em] text-[#111111]">
                Extraction review
              </h3>
              {developmentOnly ? (
                <span className="border border-[#c9973b] bg-[#fff5df] px-2 py-0.5 text-[9px] font-black uppercase text-[#8a5b0d]">
                  Development data
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[#595959]">
              {fields.length} values stripped from {fileName}. Confirm them or correct anything the packet got wrong.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.06em]">
          <span className="text-[#8a5b0d]">{pending} to review</span>
          {conflicts > 0 ? <span className="text-[#a04436]">{conflicts} conflicts</span> : null}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="flex h-8 items-center gap-1.5 px-2 text-[10px] font-black text-[#0c705f] hover:bg-[#eff8f4]"
          >
            {expanded ? "Hide fields" : "Review fields"}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {expanded ? (
        <>
      <div className="grid gap-px border-b border-[#dbe2de] bg-[#dbe2de] sm:grid-cols-3" aria-label="Packet ingestion progress">
        <IngestionStep number="1" label="Upload" value="Original saved" complete />
        <IngestionStep number="2" label="Extract" value={`${fields.length} values found`} complete />
        <IngestionStep number="3" label="Human review" value={`${reviewed} of ${fields.length} confirmed`} complete={pending === 0 && conflicts === 0} />
      </div>
      <div className="h-1.5 bg-[#e7ece9]" aria-hidden="true">
        <div className="h-full bg-[#0f8b73] transition-[width]" style={{ width: `${reviewPercent}%` }} />
      </div>

      {confirmingBulk ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dbe2de] bg-[#fffaf0] px-4 py-3">
          <div>
            <div className="text-[11px] font-black text-[#111111]">Confirm {safePendingFields.length} high-confidence values?</div>
            <div className="mt-0.5 text-[10px] text-[#6d5b37]">Conflicted, missing, and lower-confidence values stay in review. Confirmed values can still be corrected.</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setConfirmingBulk(false)} disabled={bulkBusy} className="h-8 px-3 text-[10px] font-black text-[#595959] disabled:opacity-50">Cancel</button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={async () => {
                try {
                  await onAcceptAll(safePendingFields);
                  setConfirmingBulk(false);
                } catch {
                  // The parent keeps the recovery message and latest field versions visible.
                }
              }}
              className="h-8 bg-[#111111] px-3 text-[10px] font-black uppercase text-white hover:bg-[#0f8b73] disabled:bg-[#b9b9b9]"
            >
              {bulkBusy ? "Confirming..." : "Confirm values"}
            </button>
          </div>
        </div>
      ) : safePendingFields.length > 1 ? (
        <div className="flex justify-end border-b border-[#dbe2de] bg-white px-4 py-2">
          <button type="button" onClick={() => setConfirmingBulk(true)} disabled={bulkBusy || Boolean(busyFieldKey)} className="h-8 border border-[#0f8b73] px-3 text-[10px] font-black uppercase text-[#0f8b73] hover:bg-[#eff8f4] disabled:opacity-50">
            Confirm {safePendingFields.length} high-confidence values
          </button>
        </div>
      ) : null}

      {reviewComplete ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 ${completionBlockers.length === 0 ? "border-[#b8dacf] bg-[#eff8f4]" : "border-[#e1c998] bg-[#fffaf0]"}`}>
          <div>
            <div className="text-[11px] font-black text-[#111111]">Extraction review complete</div>
            <div className="mt-0.5 text-[10px] text-[#595959]">
              {completionBlockers.length === 0 ? "The reviewed packet can move into assessment." : completionBlockers.join(" ")}
            </div>
          </div>
          <button type="button" onClick={() => void onContinue().catch(() => undefined)} disabled={completionBusy || completionBlockers.length > 0} className="h-9 bg-[#0f8b73] px-4 text-[10px] font-black uppercase text-white hover:bg-[#0a6a58] disabled:bg-[#c4cac7]">
            {completionBusy ? "Advancing..." : "Continue to assessment"}
          </button>
        </div>
      ) : null}

      <div className="divide-y divide-[#e2e7e4]">
        {fields.map((field) => {
          const value = finalFieldValue(field);
          const editing = editingFieldKey === field.field_key;
          const busy = bulkBusy || busyFieldKey === field.field_key;
          const confirmed = field.review_status === "accepted" || field.review_status === "edited";
          const confidence = Math.round(field.confidence * 100);

          return (
            <div key={field.field_key} className="grid gap-2 px-4 py-3 md:grid-cols-[190px_minmax(0,1fr)_auto] md:items-center">
              <div>
                <div className="text-[11px] font-black text-[#111111]">{fieldLabel(field.field_key)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-[#737373]">
                  <span>{confidence}% confidence</span>
                  {field.source_page_no ? <span>Page {field.source_page_no}</span> : null}
                  {field.is_conflict ? (
                    <span className="inline-flex items-center gap-1 font-black text-[#a04436]">
                      <AlertTriangle size={11} /> Conflict
                    </span>
                  ) : null}
                </div>
              </div>

              {editing ? (
                <input
                  autoFocus
                  aria-label={`Correct ${fieldLabel(field.field_key)}`}
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  className="h-9 w-full scroll-mt-[150px] border border-[#0f8b73] bg-white px-3 text-[12px] font-semibold text-[#111111] outline-none"
                />
              ) : (
                <div className={`min-w-0 text-[12px] font-semibold ${value ? "text-[#303638]" : "text-[#9a6a18]"}`}>
                  <span className="block whitespace-pre-wrap break-words">{value || "No value found"}</span>
                  <span className={`mt-0.5 block text-[9px] font-black uppercase tracking-[0.06em] ${confirmed ? "text-[#0f8b73]" : "text-[#8a5b0d]"}`}>
                    {reviewLabel(field.review_status)}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      title="Cancel correction"
                      aria-label={`Cancel correction for ${fieldLabel(field.field_key)}`}
                      onClick={() => {
                        setEditingFieldKey(null);
                        setEditValue("");
                      }}
                      disabled={busy}
                      className="flex h-8 w-8 items-center justify-center border border-[#cfd3d0] bg-white text-[#595959] hover:border-[#111111] hover:text-[#111111] disabled:opacity-50"
                    >
                      <X size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await onEdit(field, editValue.trim());
                          setEditingFieldKey(null);
                          setEditValue("");
                        } catch {
                          // The parent keeps the recovery message visible and the correction open.
                        }
                      }}
                      disabled={busy || !editValue.trim()}
                      className="flex h-8 scroll-mt-[150px] items-center gap-1.5 border border-[#111111] bg-[#111111] px-3 text-[10px] font-black uppercase text-white hover:border-[#0f8b73] hover:bg-[#0f8b73] disabled:border-[#cfd3d0] disabled:bg-[#cfd3d0]"
                    >
                      <Check size={13} /> {busy ? "Saving" : "Save correction"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      title={`Edit ${fieldLabel(field.field_key)}`}
                      aria-label={`Edit extracted ${fieldLabel(field.field_key)}`}
                      onClick={() => {
                        setEditingFieldKey(field.field_key);
                        setEditValue(value);
                      }}
                      disabled={busy}
                      className="flex h-8 w-8 items-center justify-center border border-[#cfd3d0] bg-white text-[#595959] hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-50"
                    >
                      <Pencil size={13} />
                    </button>
                    {!confirmed && value ? (
                    <button
                      type="button"
                      onClick={() => void onAccept(field).catch(() => undefined)}
                        disabled={busy}
                        className="flex h-8 items-center gap-1.5 border border-[#0f8b73] bg-white px-3 text-[10px] font-black uppercase text-[#0f8b73] hover:bg-[#e3f2ec] disabled:opacity-50"
                      >
                        <CheckCircle2 size={13} /> {busy ? "Saving" : "Confirm"}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
        </>
      ) : null}
    </section>
  );
}

function IngestionStep({
  number,
  label,
  value,
  complete,
}: {
  number: string;
  label: string;
  value: string;
  complete: boolean;
}) {
  return (
    <div className="flex items-center gap-3 bg-white px-4 py-3">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${complete ? "bg-[#0f8b73] text-white" : "border border-[#c99b3e] bg-[#fff8e8] text-[#8a5b0d]"}`}>
        {complete ? <Check size={12} /> : number}
      </span>
      <span className="min-w-0">
        <span className="block text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] font-semibold text-[#111111]">{value}</span>
      </span>
    </div>
  );
}

function finalFieldValue(field: ExtractedField) {
  return (field.final_value ?? field.proposed_value ?? "").trim();
}

function fieldLabel(fieldKey: string) {
  const known = knownLabels[fieldKey];
  if (known) return known;

  const tail = fieldKey.split(".").pop() ?? fieldKey;
  return tail
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reviewLabel(status: ExtractedField["review_status"]) {
  if (status === "accepted") return "Confirmed";
  if (status === "edited") return "Corrected";
  if (status === "rejected") return "Not used";
  return "Needs review";
}

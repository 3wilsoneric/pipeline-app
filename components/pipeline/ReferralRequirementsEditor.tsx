"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, ChevronDown, RefreshCw, Save } from "lucide-react";

import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import type {
  AdmissionRequirement,
  Referral,
  RequirementStatus,
} from "@/lib/pipeline/referral-types";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";

const statuses: Array<{ value: RequirementStatus; label: string }> = [
  { value: "needed", label: "Needed" },
  { value: "requested", label: "Requested" },
  { value: "received", label: "Received" },
  { value: "reviewed", label: "Reviewed" },
  { value: "waived", label: "Waived" },
  { value: "expired", label: "Expired" },
];

type Draft = {
  status: RequirementStatus;
  ownerId: string;
  owner: string;
  dueAt: string;
  nextStep: string;
  blocker: boolean;
  evidenceDocumentName: string;
  waiverReason: string;
  handoffReason: string;
};

export default function ReferralRequirementsEditor({
  referral,
  onReferralUpdated,
}: {
  referral: Referral | null;
  onReferralUpdated: (referral: Referral) => void | Promise<void>;
}) {
  const [items, setItems] = useState<AdmissionRequirement[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(Boolean(referral?.id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  useEffect(() => {
    fetchPipelineJson<{ members: WorkspaceMember[] }>("/api/members", { cache: "no-store" })
      .then((payload) => setMembers(payload.members))
      .catch(() => setError("The owner list could not be loaded."));
  }, []);

  const load = useCallback(async () => {
    if (!referral?.id) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await fetchPipelineJson<{ work_items?: AdmissionRequirement[] }>(
        `/api/referrals/${referral.id}/work-items`,
        { cache: "no-store" },
      );
      setItems(Array.isArray(payload.work_items) ? payload.work_items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Requirements could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [referral?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (item: AdmissionRequirement) => {
    if (editingId === item.id) {
      setEditingId(undefined);
      setDraft(undefined);
      return;
    }
    setEditingId(item.id);
    setDraft(toDraft(item));
    setMessage("");
    setError("");
  };

  const save = async (item: AdmissionRequirement) => {
    if (!referral || !draft) return;
    if (!draft.ownerId || isUnassignedOwner(draft.owner) || !draft.dueAt || !draft.nextStep.trim()) {
      setError("Add an owner, due date, and next action before saving.");
      return;
    }
    if (draft.ownerId !== (item.ownerId ?? "") && !isUnassignedOwner(item.owner) && draft.handoffReason.trim().length < 3) {
      setError("Add a brief handoff reason when changing the owner.");
      return;
    }
    if (draft.status === "waived" && !draft.waiverReason.trim()) {
      setError("Record why this requirement is being waived.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await fetchPipelineJson<{
        work_item: AdmissionRequirement;
        referral: Referral;
      }>(`/api/referrals/${referral.id}/work-items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          if_match: item.version ?? 1,
          patch: {
            status: draft.status,
            owner: draft.owner.trim(),
            dueAt: `${draft.dueAt}T17:00:00.000Z`,
            nextStep: draft.nextStep.trim(),
            blocker: draft.blocker,
            evidenceDocumentName: draft.evidenceDocumentName.trim(),
            waiverReason: draft.status === "waived" ? draft.waiverReason.trim() : "",
          },
          owner_principal_id: draft.ownerId,
          ...(draft.handoffReason.trim() ? { handoff_reason: draft.handoffReason.trim() } : {}),
        }),
      });
      setItems((current) => current.map((entry) => entry.id === item.id ? payload.work_item : entry));
      await onReferralUpdated(payload.referral);
      setEditingId(undefined);
      setDraft(undefined);
      setMessage(`${item.label} updated.`);
    } catch (saveError) {
      if (saveError instanceof PipelineApiError && saveError.status === 409) {
        await load();
        setError("Someone else changed this requirement. The latest value is shown; review it before saving again.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "The requirement could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  };

  const completed = items.filter((item) => item.status === "reviewed" || item.status === "waived").length;

  return (
    <section aria-label="Follow-up requirements" className="mt-5 border-t border-[#d9d9d9] pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-3">
        <div>
          <h3 className="text-[12px] font-black uppercase tracking-[0.1em] text-[#111111]">Follow-up requirements</h3>
          <p className="mt-1 text-[11px] text-[#737373]">Owner, due date, evidence, and next action stay with the client record.</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-black text-[#0f8b73]">
          <span>{completed}/{items.length} cleared</span>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh requirements"
            title="Refresh requirements"
            className="flex h-8 w-8 items-center justify-center border border-[#c9ceca] hover:border-[#0f8b73]"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div aria-live="polite" className="min-h-5 text-[11px]">
        {error ? <span className="font-semibold text-[#a63d2f]">{error}</span> : <span className="text-[#0f8b73]">{message}</span>}
      </div>

      {loading && items.length === 0 ? (
        <div className="border-y border-[#e5e5e5] px-4 py-8 text-center text-[12px] text-[#737373]">Loading requirements...</div>
      ) : items.length === 0 ? (
        <div className="border-y border-[#e5e5e5] px-4 py-8 text-center text-[12px] text-[#737373]">
          Save the referral to create its follow-up requirements.
        </div>
      ) : (
        <div className="divide-y divide-[#e5e5e5] border-y border-[#d9d9d9]">
          {items.map((item) => {
            const editing = editingId === item.id && draft;
            const cleared = item.status === "reviewed" || item.status === "waived";
            return (
              <div key={item.id}>
                <button
                  type="button"
                  onClick={() => openEditor(item)}
                  aria-expanded={Boolean(editing)}
                  className="grid w-full grid-cols-[20px_minmax(0,1fr)_auto_20px] items-center gap-3 px-3 py-3 text-left hover:bg-[#f7faf9] sm:px-4"
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${cleared ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#b98b1c] text-[#b98b1c]"}`}>
                    {cleared ? <Check size={12} /> : <AlertCircle size={12} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-black text-[#111111]">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-[#737373]">
                      {item.owner || "Unassigned"} · {formatDueDate(item.dueAt)} · {item.evidenceDocumentName || "No evidence attached"}
                    </span>
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">{statusLabel(item.status)}</span>
                  <ChevronDown size={14} className={`transition-transform ${editing ? "rotate-180" : ""}`} />
                </button>

                {editing ? (
                  <div className="grid gap-3 bg-[#f8faf9] px-4 py-4 md:grid-cols-[150px_170px_minmax(180px,1fr)_160px] md:items-end">
                    <label className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">
                      Status
                      <select
                        value={draft.status}
                        onChange={(event) => setDraft({ ...draft, status: event.target.value as RequirementStatus })}
                        className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2 text-[12px] normal-case tracking-[0] text-[#111111] outline-none focus:border-[#0f8b73]"
                      >
                        {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                      </select>
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">
                      Owner
                      <select
                        value={draft.ownerId || (isUnassignedOwner(draft.owner) ? "" : "__unlinked")}
                        onChange={(event) => {
                          const member = members.find((candidate) => candidate.principal_id === event.target.value);
                          setDraft({ ...draft, ownerId: member?.principal_id ?? "", owner: member?.display_name ?? "" });
                        }}
                        className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2 text-[12px] normal-case tracking-[0] outline-none focus:border-[#0f8b73]"
                      >
                        <option value="">Choose owner</option>
                        {!draft.ownerId && !isUnassignedOwner(draft.owner) ? <option value="__unlinked" disabled>{draft.owner} (choose member)</option> : null}
                        {members.map((member) => (
                          <option key={member.principal_id} value={member.principal_id}>
                            {member.display_name}{member.identity_status === "provisional" ? " · Microsoft access pending" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">
                      Next action
                      <input
                        value={draft.nextStep}
                        onChange={(event) => setDraft({ ...draft, nextStep: event.target.value })}
                        className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2 text-[12px] normal-case tracking-[0] outline-none focus:border-[#0f8b73]"
                      />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">
                      Due
                      <input
                        type="date"
                        value={draft.dueAt}
                        onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}
                        className="mt-1 h-9 border border-[#c9ceca] bg-white px-2 text-[12px] normal-case tracking-[0] outline-none focus:border-[#0f8b73]"
                      />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959] md:col-span-2">
                      Evidence
                      <input
                        value={draft.evidenceDocumentName}
                        onChange={(event) => setDraft({ ...draft, evidenceDocumentName: event.target.value })}
                        placeholder="Document name or evidence reference"
                        className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2 text-[12px] normal-case tracking-[0] outline-none placeholder:text-[#9a9a9a] focus:border-[#0f8b73]"
                      />
                    </label>
                    {draft.status === "waived" ? (
                      <label className="md:col-span-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">
                        Waiver reason
                        <input
                          value={draft.waiverReason}
                          onChange={(event) => setDraft({ ...draft, waiverReason: event.target.value })}
                          className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2 text-[12px] normal-case tracking-[0] outline-none focus:border-[#0f8b73]"
                        />
                      </label>
                    ) : null}
                    {draft.ownerId !== (item.ownerId ?? "") && !isUnassignedOwner(item.owner) ? (
                      <label className="md:col-span-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">
                        Handoff reason
                        <input
                          value={draft.handoffReason}
                          onChange={(event) => setDraft({ ...draft, handoffReason: event.target.value })}
                          placeholder="Why is ownership changing?"
                          className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2 text-[12px] normal-case tracking-[0] outline-none focus:border-[#0f8b73]"
                        />
                      </label>
                    ) : null}
                    <label className="flex h-9 items-center gap-2 text-[11px] font-semibold text-[#595959]">
                      <input
                        type="checkbox"
                        checked={draft.blocker}
                        onChange={(event) => setDraft({ ...draft, blocker: event.target.checked })}
                      />
                      Blocks next gate
                    </label>
                    <button
                      type="button"
                      onClick={() => void save(item)}
                      disabled={saving}
                      className="flex h-9 items-center justify-center gap-2 bg-[#111111] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73] disabled:bg-[#b3b3b3]"
                    >
                      <Save size={13} />
                      {saving ? "Saving" : "Save"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function toDraft(item: AdmissionRequirement): Draft {
  return {
    status: item.status,
    ownerId: item.ownerId ?? "",
    owner: isUnassignedOwner(item.owner) ? "" : item.owner,
    dueAt: item.dueAt ? item.dueAt.slice(0, 10) : "",
    nextStep: item.nextStep,
    blocker: item.blocker,
    evidenceDocumentName: item.evidenceDocumentName ?? "",
    waiverReason: item.waiverReason ?? "",
    handoffReason: "",
  };
}

function statusLabel(status: RequirementStatus) {
  return statuses.find((entry) => entry.value === status)?.label ?? status;
}

function formatDueDate(value: string) {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid due date" : `Due ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

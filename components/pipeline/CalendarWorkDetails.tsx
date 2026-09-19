"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { contactDisplayName, referralContactRoleLabel, type ReferralContactRecord } from "@/lib/pipeline/contact-types";
import type { AdmissionRequirement, ReferralFile } from "@/lib/pipeline/referral-types";
import { toPipelinePath } from "@/lib/pipeline/base-path";

const FilePreview = dynamic(() => import("./ReferralFilePreviewDialog"), { ssr: false });
const closedRequirements = new Set(["received", "reviewed", "waived", "not_applicable"]);

export default function CalendarWorkDetails({ referralId, onOpenChart, onDirtyChange }: { referralId: number; onOpenChart: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const dirtyItems = useRef(new Set<string>());
  const [contacts, setContacts] = useState<ReferralContactRecord[] | null>(null);
  const [files, setFiles] = useState<ReferralFile[] | null>(null);
  const [requirements, setRequirements] = useState<AdmissionRequirement[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<ReferralFile | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal, cache: "no-store" as const };
    const report = (part: string) => (error: unknown) => {
      if (!controller.signal.aborted) setErrors((current) => ({ ...current, [part]: error instanceof Error ? error.message : "Could not load." }));
    };
    const clear = (part: string) => setErrors((current) => ({ ...current, [part]: "" }));
    void fetchPipelineJson<{ contacts: ReferralContactRecord[] }>(`/api/referrals/${referralId}/contacts`, options).then((value) => {
      if (!controller.signal.aborted) { setContacts(value.contacts); clear("Contacts"); }
    }).catch(report("Contacts"));
    void fetchPipelineJson<{ files: ReferralFile[] }>(`/api/files?referral_id=${referralId}&limit=6`, options).then((value) => {
      if (!controller.signal.aborted) { setFiles(value.files); clear("Documents"); }
    }).catch(report("Documents"));
    void fetchPipelineJson<{ work_items: AdmissionRequirement[] }>(`/api/referrals/${referralId}/work-items`, options).then((value) => {
      if (!controller.signal.aborted) { setRequirements(value.work_items); clear("Follow-ups"); }
    }).catch(report("Follow-ups"));
    return () => controller.abort();
  }, [referralId, retry]);

  return <div className="space-y-7 border-t border-[#e3e8e5] px-5 py-5 text-[14px] text-[#354139]">
    <section aria-label="Contacts">
      <h3 className="mb-3 font-bold text-[#25392e]">Contacts</h3>
      {errors.Contacts ? <LoadError message={errors.Contacts} onRetry={() => setRetry(retry + 1)} /> : contacts === null ? <p className="text-[#6e7972]">Loading contacts…</p> : contacts.length === 0 ? <p className="text-[#6e7972]">No saved contacts. Contact details can be added in the chart.</p> : <div className="space-y-3">{contacts.map((link) => <div key={link.id} className="rounded-lg border border-[#dfe6e1] p-3">
        <div className="font-semibold">{contactDisplayName(link.contact)}</div>
        <p className="mt-1 text-[12px] text-[#6a776e]">{[referralContactRoleLabel(link.role), link.relationship, link.contact.organization].filter(Boolean).join(" · ")}</p>
        {link.contact.phone ? <p className="mt-2 select-text">{link.contact.phone}</p> : null}
        {link.contact.email ? <p className="break-all select-text">{link.contact.email}</p> : null}
        {link.contact.bestContactTime ? <p className="mt-1 text-[12px]">Best time: {link.contact.bestContactTime}</p> : null}
        {link.notes ? <p className="mt-2 whitespace-pre-wrap text-[13px]">{link.notes}</p> : null}
      </div>)}</div>}
    </section>
    <section aria-label="Recent documents">
      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-bold text-[#25392e]">Recent documents</h3><button type="button" onClick={onOpenChart} className="min-h-10 text-[13px] font-bold text-[#14745c]">View chart</button></div>
      {errors.Documents ? <LoadError message={errors.Documents} onRetry={() => setRetry(retry + 1)} /> : files === null ? <p className="text-[#6e7972]">Loading documents…</p> : files.length === 0 ? <p className="text-[#6e7972]">No uploaded documents.</p> : <div className="grid grid-cols-2 gap-3">{files.map((file) => <button key={file.id} type="button" onClick={() => setPreview(file)} aria-label={`Preview ${file.name}`} className="overflow-hidden rounded-lg border border-[#dce4df] text-left hover:border-[#659a7c] focus-visible:outline-2 focus-visible:outline-[#14745c]">
        <div className="relative flex h-24 items-center justify-center overflow-hidden border-b border-[#e4e9e6] bg-[#f5f7f5]">{file.thumbnailUrl ? <Image src={toPipelinePath(file.thumbnailUrl)} alt="" fill unoptimized sizes="260px" className="object-cover object-top" /> : <FileText size={25} className="text-[#779085]" />}</div>
        <div className="p-3"><span className="block break-words text-[13px] font-semibold">{file.name}</span><span className="mt-1 block text-[12px] text-[#6b756e]">{file.category}</span></div>
      </button>)}</div>}
    </section>
    <section aria-label="Workspace follow-ups">
      <h3 className="mb-3 font-bold text-[#25392e]">Workspace follow-ups</h3>
      {errors["Follow-ups"] ? <LoadError message={errors["Follow-ups"]} onRetry={() => setRetry(retry + 1)} /> : requirements === null ? <p className="text-[#6e7972]">Loading follow-ups…</p> : <>
        <p className="mb-3 text-[12px] leading-5 text-[#6b756e]">Set the next step and date on an existing request. This does not mark the requested information as received.</p>
        {requirements.filter((item) => !closedRequirements.has(item.status)).map((item) => <FollowUpEditor key={`${item.id}:${item.version}`} referralId={referralId} item={item} onDirtyChange={(dirty) => {
          if (dirty) dirtyItems.current.add(item.id); else dirtyItems.current.delete(item.id);
          onDirtyChange(dirtyItems.current.size > 0);
        }} onSaved={(saved) => setRequirements((current) => current?.map((value) => value.id === saved.id ? saved : value) ?? null)} />)}
        {!requirements.some((item) => !closedRequirements.has(item.status)) ? <p className="text-[#6e7972]">No open requests.</p> : null}
      </>}
    </section>
    {preview ? <FilePreview file={preview} onClose={() => setPreview(null)} /> : null}
  </div>;
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="text-[13px] text-[#855020]">{message}<button type="button" onClick={onRetry} className="ml-2 min-h-10 font-bold underline">Retry</button></div>;
}

function FollowUpEditor({ referralId, item, onSaved, onDirtyChange }: { referralId: number; item: AdmissionRequirement; onSaved: (item: AdmissionRequirement) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [date, setDate] = useState(item.dueAt?.slice(0, 10) ?? "");
  const [step, setStep] = useState(item.nextStep ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = date !== (item.dueAt?.slice(0, 10) ?? "") || step !== (item.nextStep ?? "");
  useEffect(() => {
    onDirtyChange(dirty || busy);
    return () => onDirtyChange(false);
  }, [dirty, busy, onDirtyChange]);
  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true); setError("");
    try {
      const result = await fetchPipelineJson<{ work_item: AdmissionRequirement }>(`/api/referrals/${referralId}/work-items/${item.id}`, {
        method: "PATCH", body: JSON.stringify({ if_match: item.version ?? 1, client_mutation_id: `calendar-follow-up:${crypto.randomUUID()}`, patch: { dueAt: date, nextStep: step } }),
      });
      onSaved(result.work_item);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Follow-up could not be saved. Your changes are still here."); }
    finally { setBusy(false); }
  };
  return <details className="border-b border-[#e2e7e3] py-2">
    <summary className="cursor-pointer py-2 font-semibold">{item.label}<span className="ml-2 text-[12px] font-normal text-[#6c776e]">{item.status === "requested" ? "Waiting for information" : "Open request"}</span></summary>
    <div className="space-y-3 pb-3 pt-1">
      <p className="text-[12px] text-[#69776d]">Responsible: {item.owner || "Unassigned"}{item.requestedFrom ? ` · Requested from ${item.requestedFrom}` : ""}</p>
      <label className="block">Next step<textarea aria-label={`Next step for ${item.label}`} value={step} maxLength={500} onChange={(event) => setStep(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-[#bdccc2] p-2 text-base" /></label>
      <label className="block">Follow-up date<input aria-label={`Follow-up date for ${item.label}`} type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-[#bdccc2] px-2 text-base" /></label>
      {error ? <p role="alert" className="text-[13px] text-[#973c30]">{error}</p> : null}
      <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="min-h-11 rounded-md bg-[#146e57] px-4 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save follow-up"}</button>
    </div>
  </details>;
}

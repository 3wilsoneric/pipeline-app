"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { calendarToday } from "@/lib/pipeline/calendar-date";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { pipelineCommunities } from "@/lib/pipeline/community-config";
import type { HistoricalAdmissionSuggestion } from "@/lib/pipeline/historical-admission";
import type { Referral } from "@/lib/pipeline/referral-types";

type Lookup = { suggestion: HistoricalAdmissionSuggestion | null; available: boolean };
const inputClass = "min-h-11 w-full rounded-input border border-control-border bg-paper px-3 text-value text-ink focus-visible:outline-2 focus-visible:outline-focus";
const buttonClass = "min-h-11 rounded-input border border-control-border px-3 py-2 text-label font-semibold focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50";

export default function HistoricalAdmissionPanel({ referral, readOnly, onSaved }: {
  referral: Referral; readOnly: boolean; onSaved: (referral: Referral) => void;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(referral.admissionDate ?? "");
  const [community, setCommunity] = useState(referral.community === "Unassigned" ? "" : referral.community);
  const [version, setVersion] = useState(referral.version);
  const [confirmed, setConfirmed] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Referral | null>(null);
  const [message, setMessage] = useState("");
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const saving = useRef(false);
  const path = `/api/referrals/${referral.id}/historical-admission`;

  useEffect(() => {
    if (!open || readOnly) return;
    const controller = new AbortController();
    fetchPipelineJson<Lookup>(path, { signal: controller.signal, cache: "no-store" })
      .then((value) => { if (!controller.signal.aborted) setLookup(value); }).catch(() => { if (!controller.signal.aborted) setLookup({ suggestion: null, available: false }); });
    return () => controller.abort();
  }, [open, path, readOnly]);

  async function save() {
    if (saving.current || readOnly || !confirmed || conflict) return;
    const key = JSON.stringify({ date, community, version });
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    saving.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const saved = await fetchPipelineJson<{ referral: Referral }>(path, { method: "POST", body: JSON.stringify({
        admissionDate: date, community, confirmed, if_match: version, client_mutation_id: attempt.current.id,
      }) });
      onSaved(saved.referral); setOpen(false); setConfirmed(false); attempt.current = null;
      setDate(saved.referral.admissionDate ?? ""); setCommunity(saved.referral.community); setVersion(saved.referral.version);
      setMessage("Prior admission recorded. No new intake was created.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Admission was not confirmed. Your entered date is still here; try again.");
      // Compare, never silently rebase and overwrite another operator's change.
      if (failure && typeof failure === "object" && "status" in failure && failure.status === 409) {
        try { const latest = await fetchPipelineJson<{ referral: Referral }>(`/api/referrals/${referral.id}`, { cache: "no-store" }); setConflict(latest.referral); }
        catch { /* Keep the input and the original version: a retry cannot overwrite newer work. */ }
      }
    } finally { saving.current = false; setBusy(false); }
  }

  return <section aria-label="Prior admission" className="mb-4 rounded-paper border border-card-border bg-paper p-4 text-ink">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-section font-semibold">Prior admission</h2>
        {referral.admissionDate ? <p className="text-value">Admitted · {formatProfileDate(referral.admissionDate)} · {referral.community}</p> : null}</div>
      {!readOnly && !open ? <button type="button" className={buttonClass} onClick={() => { setConfirmed(false); setOpen(true); setMessage(""); }}>
        {referral.admissionDate ? "Correct prior admission" : "Record prior admission"}</button> : null}
    </div>
    {open ? <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p className="text-label text-ink-muted">Record an admission that already happened. This does not start intake, complete an assessment, send a packet, or change the current census.</p>
      {lookup?.suggestion ? <div className="text-label">
        <p>{lookup.suggestion.identityMatched ? "Name and date of birth match" : "Possible client match"}: {lookup.suggestion.name}. Check this is the same person and admission.</p>
        <p>Date of birth in Alamo: {lookup.suggestion.dob ? formatProfileDate(lookup.suggestion.dob) : "Not recorded"}. Your original chart is not changed by this lookup.</p>
        {(lookup.suggestion.admissions ?? []).map((stay) => <div key={`${stay.admissionDate}:${stay.community}`} className="mt-2 flex flex-wrap items-center gap-2">
          <span>{stay.community} · {formatProfileDate(stay.admissionDate)}</span>
          <button type="button" disabled={busy} aria-label={`Use ${stay.community} admission on ${formatProfileDate(stay.admissionDate)}`} className={buttonClass} onClick={() => { setDate(stay.admissionDate); setCommunity(stay.community); setConfirmed(false); }}>Use this admission</button>
        </div>)}
        {!lookup.suggestion.admissions?.length ? <p>No admission date and community recorded together. Enter the prior admission below.</p> : null}
      </div> : <p className="text-meta text-ink-muted">{lookup ? "No verified client match. You can enter and confirm the prior admission below." : "Checking client records; you can enter the admission while they load."}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-label">Admission date<input className={inputClass} type="date" required max={calendarToday()} value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setConfirmed(false); }} /></label>
        <div className="text-label"><label htmlFor={`${fieldId}-community`}>Admission community</label><select id={`${fieldId}-community`} className={inputClass} required value={community} disabled={busy} onChange={(event) => { setCommunity(event.target.value as Referral["community"]); setConfirmed(false); }}>
          <option value="">Choose community</option>{pipelineCommunities.filter((item) => item !== "Unassigned").map((item) => <option key={item}>{item}</option>)}
        </select></div>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-label"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />I confirm this client was admitted to this community on this date.</label>
      {conflict ? <div role="alert" className="text-label">Another session recorded {formatProfileDate(conflict.admissionDate ?? "") ?? "no admission date"} · {conflict.community}. Your entry is still above.
        <button type="button" className={`${buttonClass} ml-2`} onClick={() => { onSaved(conflict); setVersion(conflict.version); setConflict(null); setConfirmed(false); setError(""); }}>Reviewed latest record</button></div> : null}
      {error ? <p role="alert" className="text-label text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || !confirmed || Boolean(conflict)} className={buttonClass}>{busy ? "Recording…" : "Confirm prior admission"}</button>
        <button type="button" className={buttonClass} onClick={() => setOpen(false)}>Close</button></div>
    </form> : null}
    {!open && error ? <p role="alert" className="mt-2 text-label text-danger">{error}</p> : null}
    {message ? <p role="status" className="mt-2 text-label">{message}</p> : null}
  </section>;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, UserRoundCheck } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ClinicalResident, ClinicalResidentResponse } from "@/lib/clinical/clinical-contracts";
import type { PipelineResidentLink, ResidentLinkListResponse } from "@/lib/pipeline/resident-link-records";

type ReconciliationResponse =
  | {
      status: "candidate_created";
      link: PipelineResidentLink;
      confidence: number;
      method: "exact_name_dob" | "compatible_name_dob";
      data_as_of: string;
    }
  | {
      status: "no_match" | "stale_source";
      data_as_of: string | null;
    };

export default function ReferralClientActivationPanel({
  referralId,
  canReconcile,
  canReview,
  onOpenProfile,
}: {
  referralId: number;
  canReconcile: boolean;
  canReview: boolean;
  onOpenProfile: (canonicalClientId: string) => void;
}) {
  const [link, setLink] = useState<PipelineResidentLink | null>(null);
  const [resident, setResident] = useState<ClinicalResident | null>(null);
  const [candidateCount, setCandidateCount] = useState(0);
  const [identityConflict, setIdentityConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");

  const loadIdentity = useCallback(async (signal?: AbortSignal) => {
    const result = await fetchPipelineJson<ResidentLinkListResponse>(
      `/api/resident-links?referral_id=${referralId}&limit=100`,
      { cache: "no-store", signal },
    );
    const confirmed = result.links.filter((candidate) => candidate.status === "confirmed");
    const candidates = result.links.filter((candidate) => candidate.status === "candidate");
    const current = confirmed[0] ?? candidates[0] ?? null;

    setIdentityConflict(confirmed.length > 1);
    setCandidateCount(candidates.length);
    setLink(current);
    setResident(null);
    setError(confirmed.length > 1
      ? "More than one confirmed client identity is attached to this referral. Stop and resolve the identity records before using a client profile."
      : "");

    if (current && confirmed.length <= 1) {
      try {
        const clinical = await fetchPipelineJson<ClinicalResidentResponse>(
          `/api/clinical/residents/${encodeURIComponent(current.resident_key)}`,
          { cache: "no-store", signal },
        );
        setResident(clinical.resident);
      } catch (loadError) {
        if (!signal?.aborted) {
          setError(loadError instanceof Error
            ? loadError.message
            : "The governed resident record is temporarily unavailable.");
        }
      }
    }
    setLoading(false);
  }, [referralId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadIdentity(controller.signal).catch((loadError) => {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : "Client identity status could not be loaded.");
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [loadIdentity]);

  async function reconcile() {
    setBusy("reconcile");
    setError("");
    setMessage("");
    try {
      const result = await fetchPipelineJson<ReconciliationResponse>(
        `/api/referrals/${referralId}/census-reconciliation`,
        { method: "POST", body: "{}" },
      );
      if (result.status === "no_match") {
        setMessage("No unique name-and-date-of-birth match is in the current Alamo roster. Nothing was linked.");
      } else if (result.status === "stale_source") {
        setMessage("The Alamo roster is not fresh enough to match safely. Nothing was linked; check again after it refreshes.");
      } else {
        setMessage("Possible client found. Verify the governed identity before confirming the connection.");
      }
      await loadIdentity();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The Alamo roster could not be checked.");
    } finally {
      setBusy("");
    }
  }

  async function review(action: "confirm" | "reject") {
    if (!isCandidateLink(link) || !reviewConfirmationAccepted(action, resident)) return;

    setBusy(action);
    setError("");
    setMessage("");
    try {
      await fetchPipelineJson(`/api/resident-links/${encodeURIComponent(link.link_id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          if_match: link.version,
          ...(action === "reject" ? { review_note: rejectionNote.trim() } : {}),
        }),
      });
      setRejectionNote("");
      setMessage(action === "confirm"
        ? "Client profile connected."
        : "Possible match rejected; no records were joined.");
      await loadIdentity();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The identity review could not be saved.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-label="Admitted client profile" className="border border-[#cfd8d3] bg-white">
      <div className="flex items-start gap-3 border-b border-[#e0e5e2] px-4 py-3">
        <UserRoundCheck size={17} className="mt-0.5 shrink-0 text-[#0f8b73]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[12px] font-black text-[#202522]">Admitted client profile</h3>
          <p className="mt-0.5 text-[10px] leading-4 text-[#68716c]">Connect the completed referral only after the person appears in the governed Alamo roster.</p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-[#68716c]" role="status">
            <LoaderCircle size={14} className="animate-spin" /> Checking client identity...
          </div>
        ) : identityConflict ? null : link?.status === "confirmed" ? (
          <ConfirmedIdentity resident={resident} onOpenProfile={onOpenProfile} />
        ) : link?.status === "candidate" ? (
          <CandidateIdentity
            link={link}
            resident={resident}
            candidateCount={candidateCount}
            canReview={canReview}
            busy={busy}
            rejectionNote={rejectionNote}
            onRejectionNoteChange={setRejectionNote}
            onReview={review}
          />
        ) : (
          <div>
            <p className="text-[11px] leading-5 text-[#4f5c57]">No reviewed Alamo identity is connected. A roster check can create a review candidate, but it never joins records automatically.</p>
            {canReconcile ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void reconcile()} className="mt-3 inline-flex h-9 items-center gap-2 border border-[#0f8b73] bg-white px-3 text-[10px] font-black text-[#0f6f5e] hover:bg-[#eff8f5] disabled:opacity-50">
                {busy === "reconcile" ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Check Alamo roster
              </button>
            ) : <p className="mt-2 text-[10px] font-bold text-[#737373]">An assigned operator or supervisor must run the roster check.</p>}
          </div>
        )}

        {message ? <div role="status" className="border-l-2 border-[#0f8b73] bg-[#effaf5] px-3 py-2 text-[10px] font-semibold leading-4 text-[#174f43]">{message}</div> : null}
        {error ? <div role="alert" className="border-l-2 border-[#a63d2f] bg-[#fff5f2] px-3 py-2 text-[10px] font-semibold leading-4 text-[#8b3328]">{error}</div> : null}
      </div>
    </section>
  );
}

function isCandidateLink(link: PipelineResidentLink | null): link is PipelineResidentLink {
  return link?.status === "candidate";
}

function reviewConfirmationAccepted(action: "confirm" | "reject", resident: ClinicalResident | null) {
  if (action === "reject") return true;
  if (!resident) return false;
  return window.confirm(
    `Connect this referral to ${resident.display_name} at ${resident.community_name}? Confirm only after verifying they are the same person.`,
  );
}

function ConfirmedIdentity({
  resident,
  onOpenProfile,
}: {
  resident: ClinicalResident | null;
  onOpenProfile: (canonicalClientId: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-black text-[#0f6f5e]"><CheckCircle2 size={15} /> Client identity confirmed</div>
      {resident ? <IdentityFacts resident={resident} /> : null}
      {resident?.canonical_client_id ? (
        <button type="button" onClick={() => onOpenProfile(resident.canonical_client_id!)} className="mt-3 h-9 bg-[#111111] px-4 text-[10px] font-black text-white hover:bg-[#0f8b73]">Open client profile</button>
      ) : <p className="mt-2 text-[10px] text-[#737373]">The connection is preserved, but the governed client profile is not available right now.</p>}
    </div>
  );
}

function CandidateIdentity({
  link,
  resident,
  candidateCount,
  canReview,
  busy,
  rejectionNote,
  onRejectionNoteChange,
  onReview,
}: {
  link: PipelineResidentLink;
  resident: ClinicalResident | null;
  candidateCount: number;
  canReview: boolean;
  busy: string;
  rejectionNote: string;
  onRejectionNoteChange: (value: string) => void;
  onReview: (action: "confirm" | "reject") => Promise<void>;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-black text-[#8a5a10]"><CircleAlert size={15} /> Review required</div>
      {resident ? <IdentityFacts resident={resident} /> : <p className="mt-2 text-[10px] text-[#8b3328]">Governed identity evidence is unavailable, so this candidate cannot be confirmed.</p>}
      {candidateCount > 1 ? <p className="mt-2 text-[10px] font-bold text-[#8a5a10]">{candidateCount} possible matches exist. Review one at a time; confirming one blocks the others.</p> : null}
      <p className="mt-2 text-[9px] text-[#737373]">Candidate created by {link.created_by.name}. No records are joined yet.</p>
      {canReview ? (
        <div className="mt-3">
          <label className="block">
            <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Rejection reason</span>
            <textarea value={rejectionNote} onChange={(event) => onRejectionNoteChange(event.target.value)} placeholder="Required only when rejecting" rows={2} className="mt-1 w-full resize-y border border-[#c9ceca] px-3 py-2 text-[10px] outline-none focus:border-[#0f8b73]" />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy) || !resident} onClick={() => void onReview("confirm")} className="h-9 bg-[#0f8b73] px-3 text-[10px] font-black text-white disabled:opacity-40">{busy === "confirm" ? "Confirming..." : "Confirm identity"}</button>
            <button type="button" disabled={Boolean(busy) || !rejectionNote.trim()} onClick={() => void onReview("reject")} className="h-9 border border-[#a63d2f] px-3 text-[10px] font-black text-[#a63d2f] disabled:opacity-40">{busy === "reject" ? "Rejecting..." : "Reject match"}</button>
          </div>
        </div>
      ) : <p className="mt-2 text-[10px] font-bold text-[#737373]">A reviewer or supervisor must confirm or reject this candidate.</p>}
    </div>
  );
}

function IdentityFacts({ resident }: { resident: ClinicalResident }) {
  return (
    <dl className="mt-3 grid gap-2 border-y border-[#e0e5e2] py-3 text-[10px] sm:grid-cols-2">
      <div><dt className="font-black uppercase tracking-[0.06em] text-[#737373]">Governed name</dt><dd className="mt-0.5 font-bold text-[#202522]">{resident.display_name}</dd></div>
      <div><dt className="font-black uppercase tracking-[0.06em] text-[#737373]">Date of birth</dt><dd className="mt-0.5 font-bold text-[#202522]">{resident.date_of_birth || "Not available"}</dd></div>
      <div><dt className="font-black uppercase tracking-[0.06em] text-[#737373]">Community</dt><dd className="mt-0.5 font-bold text-[#202522]">{resident.community_name}</dd></div>
      <div><dt className="font-black uppercase tracking-[0.06em] text-[#737373]">Resident number</dt><dd className="mt-0.5 font-bold text-[#202522]">{resident.resident_number || resident.resident_id}</dd></div>
    </dl>
  );
}

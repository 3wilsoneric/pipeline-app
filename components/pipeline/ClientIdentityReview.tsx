"use client";

import { useRef, useState, type ReactNode } from "react";

import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { identityDatesConflict } from "@/lib/pipeline/master-record-matching";
import type { PipelineResidentLink } from "@/lib/pipeline/resident-link-records";
import { createMutationId } from "@/lib/pipeline/referral-packet-upload";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { UnifiedClientProfileResponse } from "@/lib/pipeline/unified-profile-contracts";

type IdentityControlProps = {
  profile: UnifiedClientProfileResponse;
  onConnectionChanged: () => void;
};

export function IdentityReviewControls({
  profile,
  residentDisplayName,
  formatDate,
  onConnectionChanged,
}: IdentityControlProps & {
  residentDisplayName: string;
  formatDate: (value: string | null) => string;
}) {
  const { connection } = profile.pipeline;
  const canReview = profile.pipeline.permissions?.can_review_identity ?? false;
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewEvidence, setReviewEvidence] = useState<Referral | null>(null);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  async function openReview(link: PipelineResidentLink) {
    if (reviewing === link.link_id) {
      setReviewing(null);
      setReviewEvidence(null);
      setRejectionNote("");
      return;
    }
    if (!link.referral_id) {
      setError("This identity candidate is missing its Pipeline referral and cannot be reviewed.");
      return;
    }
    setReviewing(link.link_id);
    setReviewEvidence(null);
    setRejectionNote("");
    setIsLoadingEvidence(true);
    setError("");
    try {
      const payload = await fetchPipelineJson<{ referral?: Referral }>(
        `/api/referrals/${link.referral_id}`,
        { cache: "no-store" },
      );
      if (!payload.referral) throw new Error("The referral evidence is unavailable.");
      setReviewEvidence(payload.referral);
    } catch (loadError) {
      setReviewing(null);
      setError(loadError instanceof Error ? loadError.message : "The referral evidence could not be loaded.");
    } finally {
      setIsLoadingEvidence(false);
    }
  }

  async function reviewCandidate(link: PipelineResidentLink, action: "confirm" | "reject") {
    setIsBusy(true);
    setError("");
    try {
      await fetchPipelineJson(`/api/resident-links/${encodeURIComponent(link.link_id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          if_match: link.version,
          ...(action === "reject" ? { review_note: rejectionNote.trim() } : {}),
        }),
      });
      setReviewing(null);
      setReviewEvidence(null);
      setRejectionNote("");
      onConnectionChanged();
    } catch (mutationError) {
      if (mutationError instanceof PipelineApiError && mutationError.status === 409) {
        setReviewing(null);
        setReviewEvidence(null);
        onConnectionChanged();
      }
      setError(mutationError instanceof Error ? mutationError.message : "The identity review could not be saved.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div>
      {connection.candidates.length > 0 ? (
        <div className="space-y-3">
          {connection.candidates.map((link) => (
            <div key={link.link_id} className="border-t border-[#d9d9d9] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-black">Possible referral match</div>
                  <div className="mt-1 text-[10px] text-[#737373]">Suggested by {link.created_by.name}</div>
                </div>
                {canReview ? (
                  <div className="flex gap-2">
                    <button type="button" disabled={isLoadingEvidence || isBusy} onClick={() => void openReview(link)} className="h-9 border border-[#b07b21] px-3 text-[10px] font-black text-[#8a5a10] disabled:opacity-40">Review</button>
                  </div>
                ) : <span className="text-[10px] font-black uppercase text-[#8a5a10]">Awaiting reviewer</span>}
              </div>
              {reviewing === link.link_id ? (
                <div className="mt-3 bg-[#fafafa] p-3">
                  {isLoadingEvidence ? (
                    <p className="text-[11px] text-[#595959]" role="status">Loading identity evidence…</p>
                  ) : reviewEvidence ? (
                    <IdentityEvidenceComparison
                      profile={profile}
                      referral={reviewEvidence}
                      link={link}
                      residentDisplayName={residentDisplayName}
                      formatDate={formatDate}
                    >
                      <textarea
                        value={rejectionNote}
                        onChange={(event) => setRejectionNote(event.target.value)}
                        placeholder="Reason required only for rejection"
                        aria-label="Identity rejection reason"
                        className="mt-3 min-h-20 w-full resize-y border border-[#bdbdbd] bg-white p-2 text-[11px] outline-none focus:border-[#0f8b73]"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" disabled={isBusy || !canConfirmIdentity(reviewEvidence, profile)} onClick={() => reviewCandidate(link, "confirm")} className="h-9 bg-[#0f8b73] px-3 text-[10px] font-black text-white disabled:opacity-40">Confirm connection</button>
                        <button type="button" disabled={isBusy || !rejectionNote.trim()} onClick={() => reviewCandidate(link, "reject")} className="h-9 border border-[#a63d2f] px-3 text-[10px] font-black text-[#a63d2f] disabled:opacity-40">Reject match</button>
                        <button type="button" onClick={() => { setReviewing(null); setReviewEvidence(null); }} className="h-9 px-3 text-[10px] font-black text-[#595959]">Cancel</button>
                      </div>
                    </IdentityEvidenceComparison>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <EmptyIdentityMessage>The possible match is no longer available. Refresh this profile.</EmptyIdentityMessage>}
      {error ? <div className="mt-3 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-3 py-2 text-[11px] text-[#59332d]" role="alert">{error}</div> : null}
    </div>
  );
}

function IdentityEvidenceComparison({
  profile,
  referral,
  link,
  residentDisplayName,
  formatDate,
  children,
}: {
  profile: UnifiedClientProfileResponse;
  referral: Referral;
  link: PipelineResidentLink;
  residentDisplayName: string;
  formatDate: (value: string | null) => string;
  children: ReactNode;
}) {
  const resident = profile.resident;
  const dobStatus = !referral.dob || !resident?.date_of_birth
    ? "Missing date evidence"
    : identityDatesConflict(referral.dob, resident.date_of_birth)
      ? "Date of birth conflict"
      : "Date of birth matches";
  const matchMethod = link.match_method === "resident_number_exact"
    ? "Resident number"
    : link.match_method === "imported" ? "Imported candidate" : "Manual review";

  return (
    <div aria-label="Identity evidence comparison">
      <p className="text-[11px] text-[#4f5c57]">Compare the referral with the governed resident record. The server checks the same evidence again when you confirm.</p>
      <div className="mt-3 grid gap-px bg-[#d9d9d9] sm:grid-cols-2">
        <IdentityEvidenceRecord label="Referral record" name={referral.name} dateOfBirth={referral.dob} community={referral.community} identifier={`Workspace #${referral.id}`} formatDate={formatDate} />
        <IdentityEvidenceRecord label="Governed resident record" name={resident?.display_name ?? residentDisplayName} dateOfBirth={resident?.date_of_birth ?? null} community={resident?.community_name ?? "Not reported"} identifier={resident?.resident_number ?? resident?.resident_id ?? "Not reported"} formatDate={formatDate} />
      </div>
      <div className={`mt-2 text-[10px] font-black ${dobStatus.includes("conflict") ? "text-[#a63d2f]" : "text-[#386353]"}`} role="status">
        {dobStatus} · {matchMethod}{link.match_confidence === null ? "" : ` · ${Math.round(link.match_confidence * 100)}% confidence`}
      </div>
      {children}
    </div>
  );
}

function IdentityEvidenceRecord({
  label,
  name,
  dateOfBirth,
  community,
  identifier,
  formatDate,
}: {
  label: string;
  name: string;
  dateOfBirth: string | null;
  community: string;
  identifier: string;
  formatDate: (value: string | null) => string;
}) {
  return (
    <dl className="bg-white p-3 text-[10px]">
      <dt className="font-black uppercase tracking-[0.08em] text-[#737373]">{label}</dt>
      <dd className="mt-2 text-[12px] font-black text-[#202522]">{name}</dd>
      <dt className="mt-2 text-[#737373]">Date of birth</dt>
      <dd className="font-bold text-[#202522]">{formatDate(dateOfBirth)}</dd>
      <dt className="mt-2 text-[#737373]">Community</dt>
      <dd className="font-bold text-[#202522]">{community}</dd>
      <dt className="mt-2 text-[#737373]">Identifier</dt>
      <dd className="font-bold text-[#202522]">{identifier}</dd>
    </dl>
  );
}

function canConfirmIdentity(referral: Referral, profile: UnifiedClientProfileResponse) {
  return Boolean(profile.resident)
    && !identityDatesConflict(referral.dob, profile.resident?.date_of_birth);
}

export function IdentitySuggestionControls({ profile, onConnectionChanged }: IdentityControlProps) {
  const resident = profile.resident;
  const canCreate = profile.pipeline.permissions?.can_create_identity_candidate ?? false;
  const [busyReferralId, setBusyReferralId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const mutationIds = useRef(new Map<number, string>());

  async function createCandidate(suggestion: UnifiedClientProfileResponse["pipeline"]["connection"]["suggestions"][number]) {
    if (!resident || !window.confirm(
      `Create an identity review candidate between ${suggestion.client_name} and ${resident.display_name}? This will not join records until someone confirms the match.`,
    )) return;

    const mutationId = mutationIds.current.get(suggestion.referral_id) ?? createMutationId();
    mutationIds.current.set(suggestion.referral_id, mutationId);
    setBusyReferralId(suggestion.referral_id);
    setError("");
    try {
      await fetchPipelineJson("/api/resident-links", {
        method: "POST",
        body: JSON.stringify({
          client_mutation_id: mutationId,
          pipeline_client_id: suggestion.pipeline_client_id,
          display_name: suggestion.client_name,
          date_of_birth: resident.date_of_birth,
          referral_id: suggestion.referral_id,
          resident_key: resident.resident_key,
          resident_number: resident.resident_number ?? resident.resident_id,
          community_id: resident.community_id,
          match_method: suggestion.match_method === "resident_number_exact" ? "resident_number_exact" : "manual",
          match_confidence: suggestion.confidence,
        }),
      });
      mutationIds.current.delete(suggestion.referral_id);
      onConnectionChanged();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The identity review candidate could not be created.");
    } finally {
      setBusyReferralId(null);
    }
  }

  if (!resident) {
    return <EmptyIdentityMessage>The current governed resident record is unavailable, so no identity candidate can be created.</EmptyIdentityMessage>;
  }

  return (
    <div>
      <p className="text-[11px] leading-5 text-[#4f5c57]">These are possible referral matches only. Review the evidence, create a candidate, then confirm or reject it in a separate step.</p>
      <div className="mt-3 divide-y divide-[#d9d9d9] border-y border-[#d9d9d9]">
        {profile.pipeline.connection.suggestions.map((suggestion) => (
          <div key={suggestion.referral_id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="text-[12px] font-black text-[#202522]">{suggestion.client_name}</div>
              <div className="mt-1 text-[10px] text-[#737373]">{suggestion.community} · workspace #{suggestion.referral_id}</div>
              <ul className="mt-2 space-y-1 text-[10px] text-[#4f5c57]">
                {suggestion.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
              </ul>
            </div>
            {canCreate ? (
              <button type="button" disabled={busyReferralId !== null} onClick={() => void createCandidate(suggestion)} className="h-9 border border-[#0f8b73] bg-white px-3 text-[10px] font-black text-[#0f6f5e] hover:bg-[#eff8f5] disabled:opacity-40">
                {busyReferralId === suggestion.referral_id ? "Creating..." : "Create review candidate"}
              </button>
            ) : <span className="text-[10px] font-black uppercase text-[#8a5a10]">Reviewer action required</span>}
          </div>
        ))}
      </div>
      {error ? <div className="mt-3 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-3 py-2 text-[11px] text-[#59332d]" role="alert">{error}</div> : null}
    </div>
  );
}

function EmptyIdentityMessage({ children }: { children: ReactNode }) {
  return <div className="border-l-2 border-[#d9d9d9] bg-[#f8f8f8] px-4 py-3 text-[12px] text-[#595959]">{children}</div>;
}

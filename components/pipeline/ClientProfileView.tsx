"use client";

/* eslint-disable @next/next/no-img-element -- Private no-store thumbnails require the signed-in browser request. */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, CircleAlert, ExternalLink, FileText, ImageOff, Link2, LoaderCircle, Search, X } from "lucide-react";

import type {
  ClinicalClientRecord,
  ClinicalClientDocumentSearchResponse,
  ClinicalClientFact,
  ClinicalClientFactEvidenceResponse,
  ClinicalClientSourceDocument,
} from "@/lib/clinical/clinical-contracts";
import {
  hasReadableClinicalValue,
  humanizeClinicalField,
} from "@/lib/clinical/clinical-value-presentation";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { ClientHistoryProjection } from "@/lib/pipeline/client-history-contracts";
import {
  buildClientEpisodeSummaries,
  buildClientProfileSections,
  type ClientEpisodeSummary,
  type ClientProfileFact,
  type ClientProfileSection,
} from "@/lib/pipeline/client-profile-presentation";
import {
  buildClientMedicalChart,
  removePromotedClientProfileFacts,
} from "@/lib/pipeline/client-medical-chart";
import {
  formatClientIdentityDetail,
  formatClientIdentityTitle,
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import type { PipelineResidentLink } from "@/lib/pipeline/resident-link-records";
import type {
  UnifiedClientProfileResponse,
  UnifiedProfileLinkSuggestion,
} from "@/lib/pipeline/unified-profile-contracts";
import ClientAssessmentSummary from "@/components/pipeline/ClientAssessmentSummary";
import ClientMedicalChart from "@/components/pipeline/ClientMedicalChart";

export default function ClientProfileView({
  residentKey,
  onBack,
}: {
  residentKey: string;
  onBack: () => void;
}) {
  return <ClientProfileLoader key={residentKey} residentKey={residentKey} onBack={onBack} />;
}

function ClientProfileLoader({ residentKey, onBack }: { residentKey: string; onBack: () => void }) {
  const [profile, setProfile] = useState<UnifiedClientProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchPipelineJson<UnifiedClientProfileResponse>(
      `/api/profiles/${encodeURIComponent(residentKey)}`,
      { cache: "no-store", signal: controller.signal },
      { cacheTtlMs: 15_000 },
    )
      .then((payload) => {
        const identity = profileIdentity(payload);
        recordRecentDestination({
          id: `profile:${payload.client.canonical_client_id}`,
          kind: "profile",
          screen: "profile",
          title: identity.title.slice(0, 200),
          detail: payload.client.current_resident
            ? `${identity.community} · Current resident`
            : `${identity.community} · Prior resident`,
          clientId: payload.client.canonical_client_id,
        });
        setProfile(payload);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(profileLoadMessage(loadError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [residentKey, reloadKey]);

  if (isLoading) {
    return <ProfileShell><ProfileSkeleton onBack={onBack} /></ProfileShell>;
  }

  if (error || !profile) {
    return (
      <ProfileShell>
        <div className="border-l-2 border-[#a63d2f] bg-[#fff7f5] px-4 py-3 text-[13px] text-[#59332d]" role="alert">
          <div className="font-black">This client profile could not be loaded.</div>
          <div className="mt-1">{error || "The admitted-client profile is unavailable."}</div>
        </div>
        <div className="mt-3 flex items-center gap-5">
          <button
            type="button"
            className="h-8 text-[12px] font-black text-[#a63d2f] hover:text-[#7d2d23]"
            onClick={() => {
              setError("");
              setIsLoading(true);
              setReloadKey((value) => value + 1);
            }}
          >
            Retry
          </button>
          <BackButton onClick={onBack} />
        </div>
      </ProfileShell>
    );
  }

  return (
    <ResidentProfile
      profile={profile}
      onBack={onBack}
      onConnectionChanged={() => setReloadKey((value) => value + 1)}
    />
  );
}

function profileLoadMessage(error: unknown) {
  if (error instanceof PipelineApiError && error.status >= 500) {
    return "Referral information is temporarily unavailable. Retry, or return to clients; the current census is unchanged.";
  }
  return error instanceof Error ? error.message : "The admitted-client profile is unavailable.";
}

function ResidentProfile({
  profile,
  onBack,
  onConnectionChanged,
}: {
  profile: UnifiedClientProfileResponse;
  onBack: () => void;
  onConnectionChanged: () => void;
}) {
  const client = profile.client;
  const resident = profile.resident;
  const pipelineOnly = profile.profile_origin === "pipeline";
  const history = profile.history ?? UNAVAILABLE_CLIENT_HISTORY;
  const completeness = useMemo(() => getCompleteness(profile), [profile]);
  const identity = profileIdentity(profile);
  const chart = useMemo(() => {
    const record: ClinicalClientRecord = {
      ...client.enrichment,
      display_name: identity.title,
      resident_name: identity.title,
      gender: identity.gender,
      episode_count: client.episode_count,
      ...(resident ? {
        date_of_birth: resident.date_of_birth,
        admit_date: resident.admit_date,
        latest_admit_date: resident.admit_date,
        resident_number: resident.resident_number,
        age: resident.age,
        primary_diagnosis: resident.primary_diagnosis,
        physician: resident.physician,
        payor: resident.payor,
      } : {}),
    };
    const sections = buildClientProfileSections(record);
    return {
      sections,
      detailSections: removePromotedClientProfileFacts(sections),
      episodes: buildClientEpisodeSummaries(client.resident_episode_history),
    };
  }, [client, identity.gender, identity.title, resident]);
  const medicalChart = buildClientMedicalChart(
    {
      name: identity.title,
      gender: identity.gender,
      community: identity.community || "Not documented",
    },
    resident,
    chart.sections,
    profile.pipeline.assessments,
    clientRecordStatus(client.current_resident, pipelineOnly, profile.pipeline.summary.referral_count),
  );
  const hasPipelineHistory = ["confirmed", "pipeline_only"].includes(profile.pipeline.connection.status);

  return (
    <main aria-label={`Client profile for ${identity.title}`} className="h-full min-h-0 overflow-y-auto overscroll-y-contain bg-white text-[#111111] [scrollbar-gutter:stable]">
      <div data-testid="profile-workspace" className="mx-auto w-full max-w-[1480px] px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-[calc(4rem+env(safe-area-inset-bottom))] lg:px-8">
        <BackButton onClick={onBack} />

        {profile.freshness.status === "stale" || profile.freshness.warning ? (
          <div className="mt-4 border-l-2 border-[#b07b21] bg-[#fffaf0] px-4 py-3 text-[12px] text-[#5d4925]" role="status">
            {profile.freshness.warning || "This resident profile is older than its target freshness window."}
          </div>
        ) : null}

        <div className="mt-3">
          <ClientMedicalChart
            chart={medicalChart}
            dataAsOf={profile.data_as_of}
            sourceLabel={pipelineOnly ? "Pipeline record" : client.current_resident ? "Current census" : "Longitudinal record"}
          />
        </div>

        <div className="mt-5 min-w-0 space-y-5">
          {hasPipelineHistory || profile.pipeline.assessments.length > 0 ? (
            <ProfileSection title="Assessments">
              <ClientAssessmentSummary
                assessments={profile.pipeline.assessments}
                connection={profile.pipeline.connection}
              />
            </ProfileSection>
          ) : null}

          <ProfileSection title="Client information" detail="Additional clinical and support detail">
            <CuratedClientRecord sections={chart.detailSections} />
          </ProfileSection>

          {!pipelineOnly ? (
            <ProfileSection title="Stay history">
              <GovernedEpisodeHistory episodes={chart.episodes} />
            </ProfileSection>
          ) : null}

          {client.resident_episode_history.length === 0 && history.status === "available" ? (
            <ProfileSection title="Placement trajectory" detail="Exact resident-number history; newest episode first">
              <ClientHistorySummary history={history} />
            </ProfileSection>
          ) : null}

          <ProfileSection title="Referral history" detail={pipelineWorkDetail(profile.pipeline.connection.status)}>
            <PipelineWorkSummary profile={profile} onConnectionChanged={onConnectionChanged} />
          </ProfileSection>

          {client.facts.length > 0 ? (
            <ProfileSection title="Source-backed information" detail="Extracted packet facts">
              <ClientFactReview
                canonicalClientId={client.canonical_client_id}
                facts={client.facts}
                documents={client.source_documents}
              />
            </ProfileSection>
          ) : null}

          {client.source_documents.length > 0 ? (
            <ProfileSection title="Source documents" detail={`${client.source_documents.length} available`}>
              <ClientDocumentSearch
                canonicalClientId={client.canonical_client_id}
                documents={client.source_documents}
              />
              <ClinicalSourceDocumentGallery
                canonicalClientId={client.canonical_client_id}
                documents={client.source_documents}
              />
            </ProfileSection>
          ) : null}

          {profile.pipeline.documents.length > 0 || ["confirmed", "pipeline_only"].includes(profile.pipeline.connection.status) ? (
            <ProfileSection title="Referral documents" detail={`${profile.pipeline.documents.length} available`}>
              <ClientDocumentGallery documents={profile.pipeline.documents} />
            </ProfileSection>
          ) : null}

          {!pipelineOnly ? (
            <ProfileSection title="Record quality" detail={`${completeness.complete} of ${completeness.total} tracked fields`}>
              <RecordQualitySummary completeness={completeness} historyDataAsOf={history.data_as_of} />
            </ProfileSection>
          ) : null}
        </div>
      </div>
    </main>
  );
}

const UNAVAILABLE_CLIENT_HISTORY: ClientHistoryProjection = {
  status: "unavailable",
  source: null,
  data_as_of: null,
  imported_at: null,
  warning: "Placement history is temporarily unavailable. The current governed resident profile is still shown.",
  episode_count: 0,
  current_episode_count: 0,
  discharged_episode_count: 0,
  first_admit_date: null,
  latest_admit_date: null,
  quality_flags: [],
  episodes: [],
};

function CuratedClientRecord({ sections }: { sections: ClientProfileSection[] }) {
  if (sections.length === 0) {
    return <EmptyChartMessage>No additional client information is available in the current clinical record.</EmptyChartMessage>;
  }

  return (
    <div className="border-y border-[#d9dfdc]">
      {sections.map((section) => (
        <section key={section.key} className="grid border-b border-[#d9dfdc] last:border-b-0 lg:grid-cols-[220px_minmax(0,1fr)]">
          <h3 className="bg-[#f2f6f4] px-4 py-4 text-[11px] font-black uppercase tracking-[0.08em] text-[#244b41] lg:px-5">
            {section.label}
          </h3>
          <FactGrid facts={section.facts} className="px-4 py-4 lg:px-6" />
        </section>
      ))}
    </div>
  );
}

function GovernedEpisodeHistory({ episodes }: { episodes: ClientEpisodeSummary[] }) {
  if (episodes.length === 0) {
    return <EmptyChartMessage>No stay history is available for this client.</EmptyChartMessage>;
  }

  return (
    <div className="space-y-3" aria-label="Referral episodes">
      {episodes.map((episode, index) => episode.facts.length > 0 ? (
          <details key={episode.key} open={index === 0} className="border-b border-[#d9d9d9]">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 py-3">
              {episode.community ? <span className="text-[13px] font-black text-[#111111]">{episode.community}</span> : null}
              {episode.period ? <span className="text-[11px] text-[#737373]">{episode.period}</span> : null}
            </summary>
            <FactGrid facts={episode.facts} className="pb-5" />
          </details>
        ) : (
          <div key={episode.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9d9d9] py-3">
            {episode.community ? <span className="text-[13px] font-black text-[#111111]">{episode.community}</span> : null}
            {episode.period ? <span className="text-[11px] text-[#737373]">{episode.period}</span> : null}
          </div>
        ))}
    </div>
  );
}

function ClientHistorySummary({ history }: { history: UnifiedClientProfileResponse["history"] }) {
  if (history.status !== "available") {
    const alert = history.status === "identity_conflict";
    return (
      <div
        className={`border-l-2 px-4 py-3 text-[12px] leading-5 ${
          alert
            ? "border-[#a63d2f] bg-[#fff7f5] text-[#59332d]"
            : "border-[#d9d9d9] bg-[#f8f8f8] text-[#595959]"
        }`}
        role={alert ? "alert" : "status"}
      >
        {history.warning}
      </div>
    );
  }

  return (
    <div>
      <div className="border-l-2 border-[#b07b21] bg-[#fffaf0] px-4 py-3 text-[11px] leading-5 text-[#5d4925]" role="status">
        {history.warning}
      </div>
      <div className="mt-4 text-[12px] leading-6 text-[#4f5753]" aria-label="Placement history summary">
        {formatCount(history.episode_count, "placement episode")} recorded from {formatDate(history.first_admit_date)} through {formatDate(history.latest_admit_date)}.
        <span className="ml-1 text-[#737b77]">History data through {formatDate(history.data_as_of)}.</span>
      </div>
      {history.quality_flags.length > 0 ? (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-[#8a5a10]">
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          <span>Source rows overlap for this resident. Both versions remain visible for review.</span>
        </div>
      ) : null}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-y border-[#d9d9d9] text-[9px] font-black uppercase tracking-[0.1em] text-[#737373]">
              <th className="px-2 py-3">Admission</th>
              <th className="px-2 py-3">Community</th>
              <th className="px-2 py-3">Outcome</th>
              <th className="px-2 py-3">Prior setting</th>
              <th className="px-2 py-3">Clinical context</th>
            </tr>
          </thead>
          <tbody>
            {history.episodes.map((episode, index) => (
              <tr key={`${episode.admit_date}-${episode.community}-${index}`} className="border-b border-[#e5e5e5] align-top text-[11px] text-[#404040]">
                <td className="px-2 py-3.5">
                  <div className="font-black text-[#111111]">{formatDate(episode.admit_date)}</div>
                  <div className="mt-1 text-[#737373]">{episode.episode_days} days</div>
                </td>
                <td className="px-2 py-3.5">
                  <div className="font-semibold text-[#111111]">{episode.community}</div>
                  <div className="mt-1 text-[#737373]">{episode.county || "County not reported"}</div>
                </td>
                <td className="px-2 py-3.5">
                  <div className={`font-black ${episode.resident_status === "Current" ? "text-[#0f8b73]" : "text-[#595959]"}`}>
                    {episode.resident_status}
                  </div>
                  <div className="mt-1 max-w-[180px] text-[#737373]">
                    {episode.discharge_date ? formatDate(episode.discharge_date) : episode.discharge_reason || "No discharge recorded"}
                  </div>
                  {episode.quality_flags.length > 0 ? (
                    <div className="mt-2 text-[9px] font-black uppercase text-[#8a5a10]">Source conflict</div>
                  ) : null}
                </td>
                <td className="px-2 py-3.5">
                  <div className="max-w-[200px] font-semibold text-[#111111]">
                    {episode.prior_setting_bucket || "Not classified"}
                  </div>
                  <div className="mt-1 max-w-[200px] text-[#737373]">
                    {episode.facility_canonical || episode.referring_facility || "Referring facility not reported"}
                  </div>
                </td>
                <td className="px-2 py-3.5">
                  <div className="max-w-[260px] font-semibold text-[#111111]">
                    {episode.primary_diagnosis || "Primary diagnosis not reported"}
                  </div>
                  {episode.secondary_diagnoses.length > 0 ? (
                    <div className="mt-1 max-w-[260px] text-[#737373]">{episode.secondary_diagnoses.join(" · ")}</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PipelineWorkSummary({
  profile,
  onConnectionChanged,
}: {
  profile: UnifiedClientProfileResponse;
  onConnectionChanged: () => void;
}) {
  const { connection, summary } = profile.pipeline;
  const confirmed = connection.status === "confirmed" || connection.status === "pipeline_only";
  const needsReview = connection.status === "candidate" || connection.status === "unavailable";

  return (
    <div>
      {connection.status === "unlinked" ? (
        <div className="text-[12px] leading-5 text-[#595959]" role="status">
          No referral history has been connected to this client. This is normal for clients admitted before Pipeline was used.
        </div>
      ) : needsReview ? (
        <div className="border-l-2 border-[#d7bd84] bg-[#fffaf0] px-4 py-3 text-[12px] leading-5 text-[#5d4925]" role="status">
          <div className="font-black">{connectionLabel(connection.status)}</div>
          <div className="mt-1">{connectionMessage(connection.status)}</div>
        </div>
      ) : null}

      {confirmed ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_270px]">
          <div className="min-w-0">
            <div role="region" className="border-t border-[#d9dfdc]" aria-label={`${formatCount(summary.referral_count, "referral")} in referral history`}>
              {profile.pipeline.referrals.map((referral) => (
                <article
                  key={referral.id}
                  className="grid gap-4 border-b border-[#e5e9e7] px-1 py-4 last:border-b-0 sm:grid-cols-[130px_minmax(0,1fr)_180px]"
                >
                  <ProfileDatum label="Received" value={formatDate(referral.date)} />
                  {referral.source?.trim() ? (
                    <ProfileDatum
                      label="Referral source"
                      value={referral.source}
                      detail={resolveClientCommunity(referral.community) ?? undefined}
                    />
                  ) : null}
                  <ProfileDatum label="Assigned to" value={referral.owner || "Unassigned"} />
                </article>
              ))}
              {profile.pipeline.referrals.length === 0 ? (
                <div className="px-1 py-4 text-[12px] text-[#737b77]">No referral records are available.</div>
              ) : null}
            </div>
          </div>
          <aside className="border-t border-[#d9dfdc] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <ProfileDatum
              label="Assessment"
              value={formatWorkflowStatus(summary.latest_assessment_status) || "Not started"}
              detail={formatCount(summary.assessment_count, "assessment")}
            />
            <div className="mt-5 text-[9px] font-black uppercase tracking-[0.08em] text-[#69726e]">Needs attention</div>
            {summary.actions_needed.length > 0 ? (
              <ul className="mt-2 space-y-2.5">
                {summary.actions_needed.map((action) => (
                  <li key={action} className="flex items-start gap-2 text-[11px] leading-5 text-[#404743]">
                    <CircleAlert size={14} className="mt-0.5 shrink-0 text-[#b07b21]" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-[#0f8b73]">
                <Check size={14} /> No open Pipeline actions
              </div>
            )}
            <div className="mt-5 border-t border-[#e2e6e4] pt-3 text-[10px] text-[#737b77]">
              {formatCount(summary.document_count, "document")} attached
            </div>
          </aside>
        </div>
      ) : connection.status === "unavailable" ? null : profile.resident ? (
        <IdentityLinkControls profile={profile} onConnectionChanged={onConnectionChanged} />
      ) : (
        <div className="mt-4 text-[12px] text-[#737373]">
          Clients outside the current census remain searchable. A referral can be connected after the client appears on the current census.
        </div>
      )}
    </div>
  );
}

function ClientDocumentGallery({ documents }: { documents: ReferralFile[] }) {
  if (documents.length === 0) {
    return (
      <div className="border-l-2 border-[#d9d9d9] bg-[#f8f8f8] px-4 py-3 text-[12px] leading-5 text-[#595959]">
        No files are attached to this client workspace.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {documents.map((document) => (
        <article key={document.id} className="min-w-0 overflow-hidden border border-[#d9d9d9] bg-white">
          <DocumentThumbnail document={document} />
          <div className="p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">{document.category}</span>
              <span className="text-[9px] font-black uppercase text-[#737373]">{formatWorkflowStatus(document.status)}</span>
            </div>
            <div className="mt-2 break-words text-[12px] font-black leading-5 text-[#111111]">{document.name}</div>
            <div className="mt-2 text-[10px] leading-4 text-[#737373]">
              {document.referralId ? `Referral #${document.referralId}` : "Client file"}{document.community ? ` · ${document.community}` : ""}
              {document.pageCount ? ` · ${document.pageCount} page${document.pageCount === 1 ? "" : "s"}` : ""}
            </div>
            <div className="mt-1 text-[10px] text-[#737373]">Uploaded {formatDate(document.uploadedAt)}</div>
            {document.previewUrl || document.downloadUrl ? (
              <a
                href={document.previewUrl ?? document.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black text-[#0f8b73] hover:text-[#0a6a58]"
              >
                {document.previewUrl ? "Open file" : "Download file"} <ExternalLink size={12} />
              </a>
            ) : (
              <div className="mt-3 text-[10px] font-semibold text-[#8a6118]">Preview is still processing</div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function ClientFactReview({
  canonicalClientId,
  facts,
  documents,
}: {
  canonicalClientId: string;
  facts: ClinicalClientFact[];
  documents: ClinicalClientSourceDocument[];
}) {
  const [selectedFact, setSelectedFact] = useState<ClinicalClientFact | null>(null);

  return (
    <>
      <div className="divide-y divide-[#e5e5e5] border-y border-[#d9d9d9]">
        {facts.map((fact) => (
          <div key={fact.field_name} className="grid gap-2 py-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-start sm:gap-5">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#737373]">
                {humanizeClinicalField(fact.field_name)}
              </div>
              <div className={`mt-1 text-[9px] font-black uppercase ${factStatusClass(fact.completion_status)}`}>
                {factStatusLabel(fact.completion_status)}
              </div>
            </div>
            <div className="min-w-0 whitespace-pre-wrap text-[12px] leading-5 text-[#222222]">{formatClientFactValue(fact.value)}</div>
            {fact.evidence_count > 0 ? (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 text-[10px] font-black text-[#0f8b73] hover:text-[#0a6a58] focus:outline-none focus:ring-2 focus:ring-[#0f8b73]"
                onClick={() => setSelectedFact(fact)}
              >
                {fact.evidence_count} source{fact.evidence_count === 1 ? "" : "s"}
              </button>
            ) : (
              <span className="text-[10px] text-[#8a8a8a]">No source citation</span>
            )}
          </div>
        ))}
      </div>
      {selectedFact ? (
        <ClientFactEvidenceDialog
          canonicalClientId={canonicalClientId}
          fact={selectedFact}
          documents={documents}
          onClose={() => setSelectedFact(null)}
        />
      ) : null}
    </>
  );
}

function ClientFactEvidenceDialog({
  canonicalClientId,
  fact,
  documents,
  onClose,
}: {
  canonicalClientId: string;
  fact: ClinicalClientFact;
  documents: ClinicalClientSourceDocument[];
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<ClinicalClientFactEvidenceResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.document_id, document])),
    [documents],
  );

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    fetchPipelineJson<ClinicalClientFactEvidenceResponse>(
      factEvidencePath(canonicalClientId, fact.field_name),
      { cache: "no-store", signal: controller.signal },
    )
      .then(setPayload)
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Sources could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [canonicalClientId, fact.field_name]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const loadMore = async () => {
    if (!payload?.next_cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setError("");
    try {
      const next = await fetchPipelineJson<ClinicalClientFactEvidenceResponse>(
        `${factEvidencePath(canonicalClientId, fact.field_name)}&cursor=${encodeURIComponent(payload.next_cursor)}`,
        { cache: "no-store" },
      );
      setPayload({ ...next, evidence: [...payload.evidence, ...next.evidence] });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "More sources could not be loaded.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-fact-evidence-title"
        className="max-h-[86vh] w-full max-w-3xl overflow-hidden border border-[#cfcfcf] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-5 border-b border-[#d9d9d9] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Source evidence</div>
            <h3 id="client-fact-evidence-title" className="mt-1 text-[18px] font-black text-[#111111]">
              {humanizeClinicalField(fact.field_name)}
            </h3>
            <p className="mt-1 text-[11px] leading-5 text-[#595959]">{formatClientFactValue(fact.value)}</p>
          </div>
          <button type="button" aria-label="Close source evidence" className="shrink-0 p-2 text-[#595959] hover:text-[#111111]" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="max-h-[calc(86vh-92px)] overflow-y-auto px-5 py-4">
          {isLoading ? <LoadingLine label="Loading source pages" /> : null}
          {error ? <InlineError>{error}</InlineError> : null}
          {!isLoading && payload?.evidence.length === 0 ? (
            <EmptyChartMessage>No page-level source evidence is available for this fact.</EmptyChartMessage>
          ) : null}
          <div className="divide-y divide-[#e5e5e5]">
            {payload?.evidence.map((item, index) => {
              const document = documentById.get(item.document_id);
              const previewPath = document?.preview_available
                ? sourceDocumentPagePath(canonicalClientId, item.document_id, item.page_number)
                : null;
              return (
                <article key={`${item.document_id}:${item.page_number}:${index}`} className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-black text-[#111111]">{item.document_name} · Page {item.page_number}</div>
                    {previewPath ? (
                      <a href={previewPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-black text-[#0f8b73] hover:text-[#0a6a58]">
                        Open page <ExternalLink size={11} />
                      </a>
                    ) : null}
                  </div>
                  <blockquote className="mt-2 border-l-2 border-[#b8dacf] pl-3 text-[12px] leading-5 text-[#404040]">
                    {item.excerpt}
                  </blockquote>
                  <div className="mt-2 text-[9px] font-black uppercase text-[#737373]">
                    {factEvidenceStatusLabel(item.status)} · {Math.round(item.confidence * 100)}% confidence
                  </div>
                </article>
              );
            })}
          </div>
          {payload?.next_cursor ? (
            <button type="button" className="mt-4 text-[10px] font-black text-[#0f8b73] hover:text-[#0a6a58]" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading..." : "Show more sources"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ClientDocumentSearch({
  canonicalClientId,
  documents,
}: {
  canonicalClientId: string;
  documents: ClinicalClientSourceDocument[];
}) {
  const [query, setQuery] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [payload, setPayload] = useState<ClinicalClientDocumentSearchResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const previewableDocumentIds = useMemo(
    () => new Set(documents.filter((document) => document.preview_available).map((document) => document.document_id)),
    [documents],
  );

  const runSearch = async (cursor = "", append = false) => {
    const normalized = query.trim();
    if (normalized.length < 2 || isLoading) return;
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: normalized, limit: "20" });
      if (documentId) params.set("document_id", documentId);
      if (cursor) params.set("cursor", cursor);
      const next = await fetchPipelineJson<ClinicalClientDocumentSearchResponse>(
        `/api/clinical/clients/${encodeURIComponent(canonicalClientId)}/search?${params}`,
        { cache: "no-store" },
      );
      setPayload(append && payload ? { ...next, results: [...payload.results, ...next.results] } : next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Document search could not be completed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mb-5 border-b border-[#d9d9d9] pb-5">
      <form
        className="grid gap-2 md:grid-cols-[minmax(0,1fr)_260px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <label className="flex h-10 min-w-0 items-center gap-2 border border-[#cfcfcf] bg-white px-3 focus-within:border-[#0f8b73]">
          <Search size={15} className="shrink-0 text-[#0f8b73]" />
          <span className="sr-only">Search text inside this client&apos;s documents</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search text inside these documents"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[#111111] outline-none placeholder:text-[#8a8a8a]"
          />
        </label>
        <label className="sr-only" htmlFor="client-document-filter">Limit search to one document</label>
        <select
          id="client-document-filter"
          value={documentId}
          onChange={(event) => setDocumentId(event.target.value)}
          className="h-10 min-w-0 border border-[#cfcfcf] bg-white px-3 text-[11px] text-[#404040] outline-none focus:border-[#0f8b73]"
        >
          <option value="">All source documents</option>
          {documents.map((document) => <option key={document.document_id} value={document.document_id}>{document.display_name}</option>)}
        </select>
        <button
          type="submit"
          disabled={query.trim().length < 2 || isLoading}
          className="inline-flex h-10 items-center justify-center gap-2 bg-[#0f8b73] px-4 text-[10px] font-black uppercase text-white disabled:bg-[#cfcfcf]"
        >
          {isLoading ? <LoaderCircle size={14} className="animate-spin" /> : <Search size={14} />}
          Search
        </button>
      </form>
      {error ? <div className="mt-3"><InlineError>{error}</InlineError></div> : null}
      {payload ? (
        <div className="mt-4">
          <div className="text-[10px] font-black uppercase text-[#737373]">
            {payload.total} page{payload.total === 1 ? "" : "s"} matched
          </div>
          {payload.results.length === 0 ? (
            <div className="mt-3 text-[12px] text-[#595959]">No matching text was found in this client&apos;s indexed pages.</div>
          ) : (
            <div className="mt-2 divide-y divide-[#e5e5e5]">
              {payload.results.map((result) => {
                const content = (
                  <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-black text-[#111111]">
                    <span>{result.document_name} · Page {result.page_number}</span>
                    {previewableDocumentIds.has(result.document_id) ? (
                      <ExternalLink size={11} className="text-[#0f8b73]" />
                    ) : (
                      <span className="text-[9px] uppercase text-[#737373]">Preview unavailable</span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-[#595959]">{result.snippet}</p>
                  </>
                );
                return previewableDocumentIds.has(result.document_id) ? (
                  <a
                    key={`${result.document_id}:${result.page_number}`}
                    href={sourceDocumentPagePath(canonicalClientId, result.document_id, result.page_number)}
                    target="_blank"
                    rel="noreferrer"
                    className="block py-3 hover:bg-[#f7faf8]"
                  >
                    {content}
                  </a>
                ) : (
                  <div key={`${result.document_id}:${result.page_number}`} className="py-3">
                    {content}
                  </div>
                );
              })}
            </div>
          )}
          {payload.next_cursor ? (
            <button type="button" className="mt-3 text-[10px] font-black text-[#0f8b73]" disabled={isLoading} onClick={() => void runSearch(payload.next_cursor ?? "", true)}>
              {isLoading ? "Loading..." : "Show more matches"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function factEvidencePath(canonicalClientId: string, fieldName: string) {
  return `/api/clinical/clients/${encodeURIComponent(canonicalClientId)}/facts/${encodeURIComponent(fieldName)}/evidence?limit=20`;
}

function sourceDocumentPagePath(canonicalClientId: string, documentId: string, pageNumber: number) {
  return `/api/profiles/${encodeURIComponent(canonicalClientId)}/source-documents/${encodeURIComponent(documentId)}/preview#page=${pageNumber}`;
}

function factStatusLabel(status: ClinicalClientFact["completion_status"]) {
  if (status === "verified") return "Verified";
  if (status === "needs_review") return "Review needed";
  if (status === "not_documented") return "Not documented";
  return "No source documents";
}

function factStatusClass(status: ClinicalClientFact["completion_status"]) {
  if (status === "verified") return "text-[#0f8b73]";
  if (status === "needs_review") return "text-[#a66412]";
  return "text-[#737373]";
}

function factEvidenceStatusLabel(status: "accepted" | "needs_review" | "candidate") {
  if (status === "accepted") return "Accepted source";
  if (status === "needs_review") return "Review needed";
  return "Candidate source";
}

function LoadingLine({ label }: { label: string }) {
  return <div className="flex items-center gap-2 py-4 text-[11px] text-[#595959]"><LoaderCircle size={14} className="animate-spin text-[#0f8b73]" /> {label}</div>;
}

function InlineError({ children }: { children: ReactNode }) {
  return <div className="border-l-2 border-[#a63d2f] bg-[#fff7f5] px-3 py-2 text-[11px] text-[#59332d]" role="alert">{children}</div>;
}

function ClinicalSourceDocumentGallery({
  canonicalClientId,
  documents,
}: {
  canonicalClientId: string;
  documents: ClinicalClientSourceDocument[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {documents.map((document) => {
        const basePath = `/api/profiles/${encodeURIComponent(canonicalClientId)}/source-documents/${encodeURIComponent(document.document_id)}`;
        const thumbnailUrl = document.thumbnail_available ? `${basePath}/thumbnail` : null;
        const previewUrl = document.preview_available ? `${basePath}/preview` : null;
        return (
          <article key={document.document_id} className="min-w-0 overflow-hidden border border-[#d9d9d9] bg-white">
            <ClinicalSourceThumbnail
              document={document}
              thumbnailUrl={thumbnailUrl}
              previewUrl={previewUrl}
            />
            <div className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Alamo source</span>
                <span className="text-[9px] font-black uppercase text-[#737373]">
                  {document.content_type.includes("pdf") ? "PDF" : "Image"}
                </span>
              </div>
              <div className="mt-2 break-words text-[12px] font-black leading-5 text-[#111111]">{document.display_name}</div>
              <div className="mt-2 text-[10px] leading-4 text-[#737373]">
                {document.page_count ? `${document.page_count} page${document.page_count === 1 ? "" : "s"}` : "Page count not reported"}
                {document.link_source ? ` · ${humanizeClinicalField(document.link_source)}` : ""}
              </div>
              {document.linked_at ? <div className="mt-1 text-[10px] text-[#737373]">Linked {formatDate(document.linked_at)}</div> : null}
              {previewUrl ? (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black text-[#0f8b73] hover:text-[#0a6a58]"
                >
                  Open file <ExternalLink size={12} />
                </a>
              ) : (
                <div className="mt-3 text-[10px] font-semibold text-[#737373]">Thumbnail only</div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ClinicalSourceThumbnail({
  document,
  thumbnailUrl,
  previewUrl,
}: {
  document: ClinicalClientSourceDocument;
  thumbnailUrl: string | null;
  previewUrl: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const content = thumbnailUrl && !failed ? (
    <img
      src={thumbnailUrl}
      alt={`First-page thumbnail for ${document.display_name}`}
      loading="lazy"
      className="h-full w-full object-cover object-top"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#f2f5f3] text-[#737373]">
      {failed ? <ImageOff size={24} strokeWidth={1.5} /> : <FileText size={28} strokeWidth={1.5} />}
      <span className="text-[9px] font-black uppercase tracking-[0.1em]">
        {failed ? "Thumbnail unavailable" : "No thumbnail published"}
      </span>
    </div>
  );

  return previewUrl ? (
    <a
      href={previewUrl}
      target="_blank"
      rel="noreferrer"
      className="block h-40 border-b border-[#d9d9d9] bg-[#f2f5f3] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0f8b73]"
      aria-label={`Open ${document.display_name}`}
    >
      {content}
    </a>
  ) : (
    <div className="h-40 border-b border-[#d9d9d9] bg-[#f2f5f3]">{content}</div>
  );
}

function DocumentThumbnail({ document }: { document: ReferralFile }) {
  const [failed, setFailed] = useState(false);
  const available = Boolean(document.thumbnailUrl) && !failed;
  const content = available ? (
    <img
      src={document.thumbnailUrl}
      alt={`First-page thumbnail for ${document.name}`}
      loading="lazy"
      className="h-full w-full object-cover object-top"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#f2f5f3] text-[#737373]">
      {failed ? <ImageOff size={24} strokeWidth={1.5} /> : <FileText size={28} strokeWidth={1.5} />}
      <span className="text-[9px] font-black uppercase tracking-[0.1em]">
        {failed ? "Thumbnail unavailable" : document.previewStatus === "ready" ? "File preview" : "Processing"}
      </span>
    </div>
  );

  const openUrl = document.previewUrl ?? document.downloadUrl;
  return openUrl ? (
    <a
      href={openUrl}
      target="_blank"
      rel="noreferrer"
      className="block h-40 border-b border-[#d9d9d9] bg-[#f2f5f3] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0f8b73]"
      aria-label={`Open ${document.name}`}
    >
      {content}
    </a>
  ) : (
    <div className="h-40 border-b border-[#d9d9d9] bg-[#f2f5f3]">{content}</div>
  );
}

function IdentityLinkControls({
  profile,
  onConnectionChanged,
}: {
  profile: UnifiedClientProfileResponse;
  onConnectionChanged: () => void;
}) {
  const currentResident = profile.resident;
  const { connection } = profile.pipeline;
  const canCreate = profile.pipeline.permissions?.can_create_identity_candidate ?? false;
  const canReview = profile.pipeline.permissions?.can_review_identity ?? false;
  const suggestions = connection.suggestions ?? [];
  const [isChoosing, setIsChoosing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Referral[]>([]);
  const [selected, setSelected] = useState<IdentityReferralChoice | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isChoosing) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "25" });
      if (query.trim()) params.set("q", query.trim());
      fetchPipelineJson<{ referrals: Referral[] }>(`/api/referrals?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((payload) => setResults(payload.referrals))
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            setError(loadError instanceof Error ? loadError.message : "Referrals could not be loaded.");
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isChoosing, query]);

  if (!currentResident) return null;

  async function createCandidate() {
    const resident = currentResident;
    if (!selected || !resident) return;
    setIsBusy(true);
    setError("");
    try {
      await fetchPipelineJson("/api/resident-links", {
        method: "POST",
        body: JSON.stringify({
          pipeline_client_id: selected.clientId,
          display_name: selected.name,
          referral_id: selected.id,
          resident_key: resident.resident_key,
          resident_number: resident.resident_number
            ?? profile.client.resident_numbers.find((value) => value === resident.resident_id)
            ?? resident.resident_id,
          community_id: resident.community_id,
          match_method: selected.matchMethod === "resident_number_exact" ? "resident_number_exact" : "manual",
          match_confidence: selected.confidence,
          client_mutation_id: crypto.randomUUID(),
        }),
      });
      onConnectionChanged();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The identity candidate could not be created.");
    } finally {
      setIsBusy(false);
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
      setRejectionNote("");
      onConnectionChanged();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The identity review could not be saved.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mt-4">
      {connection.status === "unlinked" ? (
        canCreate ? (
          <>
            <button
              type="button"
              onClick={() => {
                setIsChoosing((value) => !value);
                setSelected(null);
                setError("");
              }}
              className="inline-flex h-10 items-center gap-2 border border-[#0f8b73] px-3 text-[11px] font-black text-[#0f8b73] hover:bg-[#effaf5]"
            >
              {isChoosing ? <X size={14} /> : <Link2 size={14} />}
              {isChoosing ? "Cancel" : "Connect a referral"}
            </button>
            {isChoosing ? (
              <div className="mt-4 border-t border-[#d9d9d9] pt-4">
                {suggestions.length > 0 ? (
                  <div className="mb-4">
                    <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Suggested matches</div>
                    <p className="mt-1 text-[10px] leading-4 text-[#737373]">Suggestions are evidence-based, but a person must still submit and confirm the connection.</p>
                    <div className="mt-2 border-y border-[#d9d9d9]">
                      {suggestions.map((suggestion) => {
                        const choice = suggestionChoice(suggestion);
                        const active = selected?.id === choice.id;
                        return (
                          <button
                            key={suggestion.referral_id}
                            type="button"
                            onClick={() => setSelected(choice)}
                            className={`flex w-full items-center justify-between gap-4 border-b border-[#eeeeee] px-3 py-3 text-left last:border-b-0 ${active ? "bg-[#effaf5]" : "hover:bg-[#f8f8f8]"}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[12px] font-black text-[#111111]">{formatClientIdentityTitle({ name: suggestion.client_name, gender: suggestion.gender, community: suggestion.community })}</span>
                              {formatClientIdentityDetail(resolveClientGender(suggestion.gender), resolveClientCommunity(suggestion.community)) ? (
                                <span className="mt-1 block truncate text-[10px] text-[#737373]">{formatClientIdentityDetail(resolveClientGender(suggestion.gender), resolveClientCommunity(suggestion.community))}</span>
                              ) : null}
                              <span className="mt-1 block truncate text-[10px] font-semibold text-[#356759]">{suggestion.reasons.join(" · ")}</span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[10px] font-black text-[#0f8b73]">{Math.round(suggestion.confidence * 100)}%</span>
                              {active ? <Check size={15} className="ml-auto mt-1 text-[#0f8b73]" /> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <label className="flex h-10 items-center gap-2 border border-[#bdbdbd] px-3 focus-within:border-[#0f8b73]">
                  <Search size={14} className="shrink-0 text-[#737373]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find the exact referral"
                    className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
                  />
                </label>
                <div className="mt-2 max-h-56 overflow-y-auto border-y border-[#e5e5e5]">
                  {results.length > 0 ? results.map((referral) => {
                    const choice = referralChoice(referral);
                    const active = selected?.id === choice.id;
                    return (
                    <button
                      key={referral.id}
                      type="button"
                      onClick={() => setSelected(choice)}
                      className={`flex w-full items-center justify-between gap-4 border-b border-[#eeeeee] px-3 py-3 text-left last:border-b-0 ${active ? "bg-[#effaf5]" : "hover:bg-[#f8f8f8]"}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-black text-[#111111]">{formatClientIdentityTitle(referral)}</span>
                        {formatClientIdentityDetail(resolveClientGender(referral.gender), resolveClientCommunity(referral.community)) ? (
                          <span className="mt-1 block truncate text-[10px] text-[#737373]">{formatClientIdentityDetail(resolveClientGender(referral.gender), resolveClientCommunity(referral.community))}</span>
                        ) : null}
                      </span>
                      {active ? <Check size={15} className="shrink-0 text-[#0f8b73]" /> : null}
                    </button>
                    );
                  }) : (
                    <div className="px-3 py-5 text-center text-[11px] text-[#737373]">
                      {query.trim().length < 2 ? "Type at least two characters to search all referrals." : "No matching referrals."}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!selected || isBusy}
                  onClick={createCandidate}
                  className="mt-3 h-10 bg-[#111111] px-4 text-[11px] font-black text-white disabled:bg-[#d9d9d9]"
                >
                  {isBusy ? "Saving..." : "Send match for review"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="text-[12px] text-[#737373]">Ask an assessor to select the matching Pipeline referral.</div>
        )
      ) : (
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
                    <button type="button" onClick={() => setReviewing(reviewing === link.link_id ? null : link.link_id)} className="h-9 border border-[#b07b21] px-3 text-[10px] font-black text-[#8a5a10]">Review</button>
                  </div>
                ) : <span className="text-[10px] font-black uppercase text-[#8a5a10]">Awaiting reviewer</span>}
              </div>
              {reviewing === link.link_id ? (
                <div className="mt-3 bg-[#fafafa] p-3">
                  <p className="text-[11px] text-[#595959]">Confirm only after verifying this resident and referral are the same person.</p>
                  <textarea
                    value={rejectionNote}
                    onChange={(event) => setRejectionNote(event.target.value)}
                    placeholder="Reason required only for rejection"
                    className="mt-3 min-h-20 w-full resize-y border border-[#bdbdbd] bg-white p-2 text-[11px] outline-none focus:border-[#0f8b73]"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={isBusy} onClick={() => reviewCandidate(link, "confirm")} className="h-9 bg-[#0f8b73] px-3 text-[10px] font-black text-white disabled:opacity-50">Confirm connection</button>
                    <button type="button" disabled={isBusy || !rejectionNote.trim()} onClick={() => reviewCandidate(link, "reject")} className="h-9 border border-[#a63d2f] px-3 text-[10px] font-black text-[#a63d2f] disabled:opacity-40">Reject match</button>
                    <button type="button" onClick={() => setReviewing(null)} className="h-9 px-3 text-[10px] font-black text-[#595959]">Cancel</button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {error ? <div className="mt-3 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-3 py-2 text-[11px] text-[#59332d]" role="alert">{error}</div> : null}
    </div>
  );
}

type IdentityReferralChoice = {
  id: number;
  clientId: string;
  name: string;
  gender: string | null;
  community: Referral["community"];
  stage: Referral["stage"];
  matchMethod: UnifiedProfileLinkSuggestion["match_method"] | "manual";
  confidence: number | null;
};

function suggestionChoice(suggestion: UnifiedProfileLinkSuggestion): IdentityReferralChoice {
  return {
    id: suggestion.referral_id,
    clientId: suggestion.pipeline_client_id,
    name: suggestion.client_name,
    gender: suggestion.gender,
    community: suggestion.community,
    stage: suggestion.stage,
    matchMethod: suggestion.match_method,
    confidence: suggestion.confidence,
  };
}

function referralChoice(referral: Referral): IdentityReferralChoice {
  return {
    id: referral.id,
    clientId: referral.clientId ?? "",
    name: referral.name,
    gender: referral.gender?.trim() || null,
    community: referral.community,
    stage: referral.stage,
    matchMethod: "manual",
    confidence: null,
  };
}

function ProfileDatum({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#69726e]">{label}</div>
      <div className="mt-1 break-words text-[12px] font-semibold leading-5 text-[#222825]">{value}</div>
      {detail ? <div className="mt-0.5 break-words text-[10px] leading-4 text-[#737b77]">{detail}</div> : null}
    </div>
  );
}

function formatCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function connectionLabel(status: UnifiedClientProfileResponse["pipeline"]["connection"]["status"]) {
  if (status === "pipeline_only") return "Pipeline workspace";
  if (status === "confirmed") return "Referral history available";
  if (status === "candidate") return "Referral match to review";
  if (status === "unavailable") return "Referral history unavailable";
  return "No referral history";
}

function clientRecordStatus(currentResident: boolean, pipelineOnly: boolean, referralCount: number) {
  if (currentResident) return "Current resident";
  if (!pipelineOnly) return "Prior resident";
  return referralCount > 0 ? "Referral record" : "Client file record";
}

function pipelineWorkDetail(status: UnifiedClientProfileResponse["pipeline"]["connection"]["status"]) {
  if (status === "candidate") return "Possible match awaiting review";
  if (status === "unavailable") return "Temporarily unavailable";
  return undefined;
}

function connectionMessage(status: UnifiedClientProfileResponse["pipeline"]["connection"]["status"]) {
  if (status === "confirmed") return "This client's Pipeline referrals, assessments, and files are shown below.";
  if (status === "pipeline_only") return "This workspace contains referral records and files captured in Pipeline.";
  if (status === "candidate") return "A possible referral match needs review before its records are shown here.";
  return "Referral information cannot be loaded right now. The client record above is still available.";
}

function formatWorkflowStatus(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatClientFactValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Not documented";

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const items = parsed
          .map((item) => typeof item === "string" || typeof item === "number" ? String(item).trim() : "")
          .filter(Boolean);
        return items.length > 0 ? items.join("; ") : "Not documented";
      }
      if (parsed && typeof parsed === "object") {
        const items = Object.values(parsed)
          .map((item) => typeof item === "string" || typeof item === "number" ? String(item).trim() : "")
          .filter(Boolean);
        return items.length > 0 ? items.join("; ") : "Not documented";
      }
    } catch {
      // Keep non-JSON narrative text exactly as extracted.
    }
  }

  return trimmed;
}

function getCompleteness(profile: UnifiedClientProfileResponse) {
  const total = profile.client_database.fields.length;
  const complete = profile.client_database.fields.filter((field) =>
    hasReadableClinicalValue(profile.client.enrichment[field], field),
  ).length;
  return {
    complete,
    total,
    percent: total === 0 ? 0 : Math.round((complete / total) * 100),
  };
}

function ProfileShell({ children }: { children: React.ReactNode }) {
  return <main className="h-full overflow-y-auto bg-white text-[#111111]"><div className="mx-auto w-full max-w-[1480px] px-4 py-4 sm:px-6 lg:px-8">{children}</div></main>;
}

function ProfileSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div aria-label="Loading admitted-client profile" aria-busy="true">
      <BackButton onClick={onBack} />
      <div className="mt-4 animate-pulse border-b border-[#d9d9d9] px-2 pb-5 pt-2 md:px-3">
        <div className="min-w-0 flex-1">
          <div className="h-8 w-full max-w-[360px] bg-[#e8ebe9]" />
          <div className="mt-3 h-3 w-full max-w-[220px] bg-[#f0f2f1]" />
        </div>
      </div>
      <div className="mt-4 animate-pulse space-y-4">
        <div className="min-h-[230px] border-b border-[#d9dfdc] bg-[#fafbfa]" />
        <div className="min-h-[190px] border-b border-[#d9dfdc] bg-[#fafbfa]" />
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex h-8 items-center gap-2 text-[12px] font-black text-[#0f8b73] hover:text-[#0a6a58]"><ArrowLeft size={15} /> Back to profiles</button>;
}

function ProfileSection({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#cfd7d2] bg-white px-5 py-5 md:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#d9dfdc] pb-3">
        <h2 className="text-[15px] font-black tracking-[-0.01em]">{title}</h2>
        {detail ? <span className="text-[11px] text-[#737373]">{detail}</span> : null}
      </div>
      <div className="pt-5">{children}</div>
    </section>
  );
}

function profileIdentity(profile: UnifiedClientProfileResponse) {
  const client = profile.client;
  const enrichment = client.enrichment;
  const gender = resolveClientGender(
    client.gender,
    enrichment.gender_values_json,
    enrichment.gender_identity,
    enrichment.gender,
    enrichment.sex,
    client.resident_profile?.gender_values_json,
    client.resident_profile?.gender_identity,
    client.resident_profile?.gender,
    client.resident_profile?.sex,
    ...client.resident_profiles.flatMap((record) => [
      record.gender_values_json,
      record.gender_identity,
      record.gender,
      record.sex,
    ]),
  );
  const community = resolveClientCommunity(
    client.current_community
      || profile.resident?.community_name
      || client.community_names[0],
  );
  return {
    gender,
    community,
    title: formatClientIdentityTitle({
      name: client.display_name,
      gender,
      community,
    }),
  };
}

function FactGrid({ facts, className = "" }: { facts: ClientProfileFact[]; className?: string }) {
  return (
    <div className={`grid gap-x-7 gap-y-5 sm:grid-cols-2 2xl:grid-cols-3 ${className}`}>
      {facts.map((item) => <DataPoint key={item.label} label={item.label} value={item.value} />)}
    </div>
  );
}

function EmptyChartMessage({ children }: { children: React.ReactNode }) {
  return <div className="border-l-2 border-[#d9d9d9] bg-[#f8f8f8] px-4 py-3 text-[12px] text-[#595959]">{children}</div>;
}

function DataPoint({ label, value }: { label: string; value: string | number | null }) {
  const display = typeof value === "number" ? String(value) : value?.trim() || "Not reported";
  const present = display !== "Not reported";
  return <div><div className="text-[10px] font-black uppercase tracking-[0.09em] text-[#68706c]">{label}</div><div className={`mt-1.5 break-words text-[14px] font-semibold leading-5 ${present ? "text-[#111111]" : "text-[#9a6a18]"}`}>{display}</div></div>;
}

function RecordQualitySummary({
  completeness,
  historyDataAsOf,
}: {
  completeness: ReturnType<typeof getCompleteness>;
  historyDataAsOf: string | null;
}) {
  const missing = completeness.total - completeness.complete;
  return (
    <div className="grid items-center gap-5 md:grid-cols-[140px_minmax(0,1fr)_minmax(220px,auto)]">
      <div>
        <div className="text-[24px] font-black text-[#111111]">{completeness.percent}%</div>
        <div className="mt-1 text-[10px] text-[#737373]">Fields available</div>
      </div>
      <div>
        <div className="h-2 bg-[#e8eeeb]"><div className="h-full bg-[#0f8b73]" style={{ width: `${completeness.percent}%` }} /></div>
        <div className="mt-2 text-[10px] text-[#737373]">{missing > 0 ? `${missing} tracked fields are not available.` : "All tracked profile fields are available."}</div>
      </div>
      <div className="text-[10px] leading-5 text-[#737b77] md:text-right">
        {historyDataAsOf ? `Stay history updated through ${formatDate(historyDataAsOf)}` : "Profile quality reflects the latest available record."}
      </div>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Not reported";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

"use client";

/* eslint-disable @next/next/no-img-element -- Private no-store thumbnails require the signed-in browser request. */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleAlert, ExternalLink, FileText, ImageOff, Link2, Search, UserRound, X } from "lucide-react";

import type {
  ClinicalClientRecord,
  ClinicalClientSourceDocument,
  ClinicalResident,
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
  formatProfileDate,
  type ClientEpisodeSummary,
  type ClientProfileFact,
  type ClientProfileSection,
} from "@/lib/pipeline/client-profile-presentation";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import type { PipelineResidentLink } from "@/lib/pipeline/resident-link-records";
import type {
  UnifiedClientProfileResponse,
  UnifiedProfileLinkSuggestion,
} from "@/lib/pipeline/unified-profile-contracts";
import ClientAssessmentSummary from "@/components/pipeline/ClientAssessmentSummary";

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
    )
      .then((payload) => {
        recordRecentDestination({
          id: `profile:${payload.client.canonical_client_id}`,
          kind: "profile",
          screen: "profile",
          title: payload.client.display_name,
          detail: payload.client.current_resident
            ? `${payload.client.current_community || "Current community"} · Current resident`
            : "Historical client",
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
  const chart = useMemo(() => {
    const record: ClinicalClientRecord = {
      ...client.enrichment,
      display_name: client.display_name,
      resident_name: client.display_name,
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
    return {
      sections: buildClientProfileSections(record),
      episodes: buildClientEpisodeSummaries(client.resident_episode_history),
    };
  }, [client, resident]);
  const currentFacts = useMemo(() => currentResidentFacts(resident), [resident]);
  const hasPipelineHistory = ["confirmed", "pipeline_only"].includes(profile.pipeline.connection.status);

  return (
    <main aria-label={`Client profile for ${client.display_name}`} className="h-full overflow-y-auto bg-white text-[#111111]">
      <div data-testid="profile-workspace" className="mx-auto w-full max-w-[1480px] px-4 py-4 sm:px-6 lg:px-8">
        <BackButton onClick={onBack} />

        {profile.freshness.status === "stale" || profile.freshness.warning ? (
          <div className="mt-4 border-l-2 border-[#b07b21] bg-[#fffaf0] px-4 py-3 text-[12px] text-[#5d4925]" role="status">
            {profile.freshness.warning || "This resident profile is older than its target freshness window."}
          </div>
        ) : null}

        <header className="mt-4 border-b border-[#d9d9d9] px-2 pb-5 pt-2 md:px-3">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-[#b8dacf] bg-[#effaf5] text-[18px] font-black text-[#0f8b73]">
              {getInitials(client.display_name)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[30px] font-black md:text-[38px]">{client.display_name}</h1>
                {profile.pipeline.connection.status !== "unlinked" ? (
                  <span className={connectionBadgeClass(profile.pipeline.connection.status)}>
                    {connectionLabel(profile.pipeline.connection.status)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[13px] text-[#595959]">
                {pipelineOnly
                  ? `${client.current_community || client.community_names.join(" · ") || "Community not reported"} · ${profile.pipeline.summary.referral_count > 0 ? "Referral client" : "Historical file workspace"}`
                  : client.current_resident
                  ? `${client.current_community || resident?.community_name || "Current resident"}${client.unit ? ` · Unit ${client.unit}` : ""}`
                  : `${client.community_names.join(" · ") || "Community not reported"} · Historical client`}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-4 grid gap-px border-b border-[#d9d9d9] bg-[#d9d9d9] md:grid-cols-4" aria-label="Profile summary">
          <Metric label="Profile data" value={pipelineOnly ? "Pipeline" : `${completeness.percent}%`} detail={pipelineOnly ? profile.pipeline.summary.referral_count > 0 ? "Referral workspace" : "Historical files" : `${completeness.complete} of ${completeness.total} fields available`} />
          <Metric label={pipelineOnly ? "Referrals" : "Current stay"} value={pipelineOnly ? String(profile.pipeline.summary.referral_count) : resident?.length_of_stay_days === null || resident?.length_of_stay_days === undefined ? "Not reported" : `${resident.length_of_stay_days.toLocaleString()} days`} detail={pipelineOnly ? `${profile.pipeline.summary.active_referral_count} active` : resident?.admit_date ? `Admitted ${formatDate(resident.admit_date)}` : "Admission date not reported"} />
          {hasPipelineHistory ? (
            <>
              <Metric label="Open items" value={String(profile.pipeline.summary.open_requirement_count)} detail={`${profile.pipeline.summary.blocker_count} blocking`} />
              <Metric label="Assessments" value={String(profile.pipeline.summary.assessment_count)} detail={formatWorkflowStatus(profile.pipeline.summary.latest_assessment_status) || "None recorded"} />
            </>
          ) : (
            <>
              <Metric label="Referral history" value="None" detail="No Pipeline referral on file" />
              <Metric label="Source documents" value={String(client.source_documents.length)} detail="Available client records" />
            </>
          )}
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,0.65fr)]">
          <div className="min-w-0 space-y-5">
            {currentFacts.length > 0 ? (
              <ProfileSection title="Current resident" detail="Current census">
                <FactGrid facts={currentFacts} />
              </ProfileSection>
            ) : null}

            <ProfileSection title="Client information" detail={pipelineOnly ? "Captured in Pipeline" : "Latest available information"}>
              <CuratedClientRecord sections={chart.sections} />
            </ProfileSection>

            {client.source_documents.length > 0 ? (
              <ProfileSection title="Source documents" detail={`${client.source_documents.length} available`}>
                <ClinicalSourceDocumentGallery
                  canonicalClientId={client.canonical_client_id}
                  documents={client.source_documents}
                />
              </ProfileSection>
            ) : null}

            {!pipelineOnly ? (
              <ProfileSection title="Stay history">
                <GovernedEpisodeHistory episodes={chart.episodes} />
              </ProfileSection>
            ) : null}

            <ProfileSection title="Referral history" detail={pipelineWorkDetail(profile.pipeline.connection.status)}>
              <PipelineWorkSummary profile={profile} onConnectionChanged={onConnectionChanged} />
            </ProfileSection>

            {profile.pipeline.documents.length > 0 || ["confirmed", "pipeline_only"].includes(profile.pipeline.connection.status) ? (
              <ProfileSection title="Referral documents" detail={`${profile.pipeline.documents.length} available`}>
                <ClientDocumentGallery documents={profile.pipeline.documents} />
              </ProfileSection>
            ) : null}

            {hasPipelineHistory || profile.pipeline.assessments.length > 0 ? (
              <ProfileSection title="Assessments" detail="Latest first">
                <ClientAssessmentSummary
                  assessments={profile.pipeline.assessments}
                  connection={profile.pipeline.connection}
                />
              </ProfileSection>
            ) : null}

            {client.resident_episode_history.length === 0 && history.status === "available" ? (
              <ProfileSection title="Placement trajectory" detail="Legacy exact resident-number history; newest episode first">
                <ClientHistorySummary history={history} />
              </ProfileSection>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-5">
            {!pipelineOnly ? <ProfileSection title="Data completeness" detail={`${completeness.complete} of ${completeness.total}`}>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[30px] font-black text-[#111111]">{completeness.percent}%</div>
                  <div className="mt-1 text-[11px] text-[#737373]">Profile fields available</div>
                </div>
                <div className="text-right text-[10px] font-black uppercase text-[#737373]">
                  {completeness.total - completeness.complete} missing
                </div>
              </div>
              <div className="mt-4 h-2 bg-[#e8eeeb]"><div className="h-full bg-[#0f8b73]" style={{ width: `${completeness.percent}%` }} /></div>
              <div className="mt-5 space-y-3">
                {completeness.total - completeness.complete > 0 ? (
                  <div className="flex items-start gap-2 text-[12px] text-[#6d5428]">
                    <CircleAlert size={15} className="mt-0.5 shrink-0 text-[#b07b21]" />
                    <span>{completeness.total - completeness.complete} tracked fields are not available in the current record.</span>
                  </div>
                ) : null}
                {completeness.complete === completeness.total ? (
                  <div className="flex items-start gap-2 text-[12px] text-[#356759]">
                    <Check size={15} className="mt-0.5 shrink-0 text-[#0f8b73]" />
                    <span>All tracked profile fields are available.</span>
                  </div>
                ) : null}
              </div>
            </ProfileSection> : null}

            <ProfileSection title="Record status">
              <div className="flex gap-3">
                <FileText size={17} className="mt-0.5 shrink-0 text-[#0f8b73]" />
                <div className="space-y-3 text-[12px] text-[#595959]">
                  <div><span className="font-black text-[#111111]">{pipelineOnly ? "Pipeline" : "Alamo Platform"}</span><br />{pipelineOnly ? profile.pipeline.summary.referral_count > 0 ? "Referral history" : "Historical client files" : "Current clinical profile"}</div>
                  <div>Updated through {formatDate(profile.data_as_of)}</div>
                  {history.data_as_of ? (
                    <div className="border-t border-[#d9d9d9] pt-3">
                      Stay history updated through {formatDate(history.data_as_of)}
                    </div>
                  ) : null}
                </div>
              </div>
            </ProfileSection>
          </aside>
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
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
      {sections.map((section) => (
        <section key={section.key}>
          <h3 className="border-b border-[#d9d9d9] pb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">
            {section.label}
          </h3>
          <FactGrid facts={section.facts} className="mt-4" />
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
    <div className="space-y-3">
      {episodes.map((episode, index) => episode.facts.length > 0 ? (
          <details key={episode.key} open={index === 0} className="border-b border-[#d9d9d9]">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 py-3">
              <span className="text-[13px] font-black text-[#111111]">{episode.community}</span>
              <span className="text-[11px] text-[#737373]">{episode.period}</span>
            </summary>
            <FactGrid facts={episode.facts} className="pb-5" />
          </details>
        ) : (
          <div key={episode.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9d9d9] py-3">
            <span className="text-[13px] font-black text-[#111111]">{episode.community}</span>
            <span className="text-[11px] text-[#737373]">{episode.period}</span>
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
      <div className="mt-4 grid gap-px bg-[#d9dfdb] sm:grid-cols-2 lg:grid-cols-4" aria-label="Placement history summary">
        <HistoryMetric label="Episodes" value={history.episode_count} detail={`${history.discharged_episode_count} completed`} />
        <HistoryMetric label="First admission" value={formatDate(history.first_admit_date)} detail="Earliest recorded episode" />
        <HistoryMetric label="Latest admission" value={formatDate(history.latest_admit_date)} detail="Newest recorded episode" />
        <HistoryMetric label="Data through" value={formatDate(history.data_as_of)} detail="One-time master extract" />
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

function HistoryMetric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">{label}</div>
      <div className="mt-1 truncate text-[15px] font-black text-[#111111]">{value}</div>
      <div className="mt-1 truncate text-[10px] text-[#737373]">{detail}</div>
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
  const noticeClass = confirmed
    ? "border-[#b8dacf] bg-[#effaf5] text-[#315b51]"
    : connection.status === "candidate"
      ? "border-[#e2ca9f] bg-[#fffaf0] text-[#5d4925]"
      : connection.status === "unavailable"
        ? "border-[#d7bd84] bg-[#fffaf0] text-[#5d4925]"
        : "border-[#d9d9d9] bg-[#f8f8f8] text-[#595959]";

  return (
    <div>
      {connection.status === "unlinked" ? (
        <div className="text-[12px] leading-5 text-[#595959]" role="status">
          No referral history has been connected to this client. This is normal for clients admitted before Pipeline was used.
        </div>
      ) : (
        <div className={`border-l-2 px-4 py-3 text-[12px] leading-5 ${noticeClass}`} role="status">
          <div className="font-black">{connectionLabel(connection.status)}</div>
          <div className="mt-1">{connectionMessage(connection.status)}</div>
        </div>
      )}

      {confirmed ? (
        <>
          <div className="mt-4 grid gap-px bg-[#d9dfdb] sm:grid-cols-2 lg:grid-cols-4" aria-label="Referral history summary">
            <SummaryCell label="Referrals" value={summary.referral_count} detail={`${summary.active_referral_count} active`} />
            <SummaryCell label="Assessments" value={summary.assessment_count} detail={formatWorkflowStatus(summary.latest_assessment_status) || "None yet"} />
            <SummaryCell label="Open items" value={summary.open_requirement_count} detail={`${summary.blocker_count} blocking`} />
            <SummaryCell label="Documents" value={summary.document_count} detail="Linked to referrals" />
          </div>
          <div className="mt-5">
            <div className="text-[10px] font-black uppercase text-[#737373]">Next actions</div>
            {summary.actions_needed.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {summary.actions_needed.map((action) => (
                  <li key={action} className="flex items-start gap-2 text-[12px] text-[#404040]">
                    <CircleAlert size={14} className="mt-0.5 shrink-0 text-[#b07b21]" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-[#0f8b73]">
                <Check size={14} /> No open Pipeline actions
              </div>
            )}
          </div>
        </>
      ) : connection.status === "unavailable" ? null : profile.resident ? (
        <IdentityLinkControls profile={profile} onConnectionChanged={onConnectionChanged} />
      ) : (
        <div className="mt-4 text-[12px] text-[#737373]">
          Historical clients remain searchable, but a referral can only be connected while the client appears on the current census.
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
                              <span className="block truncate text-[12px] font-black text-[#111111]">{suggestion.client_name}</span>
                              <span className="mt-1 block truncate text-[10px] text-[#737373]">{suggestion.community} · {suggestion.stage}</span>
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
                        <span className="block truncate text-[12px] font-black text-[#111111]">{referral.name}</span>
                        <span className="mt-1 block truncate text-[10px] text-[#737373]">{referral.community} · {referral.stage}</span>
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
    community: referral.community,
    stage: referral.stage,
    matchMethod: "manual",
    confidence: null,
  };
}

function SummaryCell({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[9px] font-black uppercase text-[#737373]">{label}</div>
      <div className="mt-1 text-[18px] font-black">{value}</div>
      <div className="mt-1 truncate text-[10px] capitalize text-[#737373]">{detail}</div>
    </div>
  );
}

function connectionLabel(status: UnifiedClientProfileResponse["pipeline"]["connection"]["status"]) {
  if (status === "pipeline_only") return "Pipeline workspace";
  if (status === "confirmed") return "Referral history available";
  if (status === "candidate") return "Referral match to review";
  if (status === "unavailable") return "Referral history unavailable";
  return "No referral history";
}

function pipelineWorkDetail(status: UnifiedClientProfileResponse["pipeline"]["connection"]["status"]) {
  if (status === "confirmed" || status === "pipeline_only") return "Referral, assessment, and follow-up";
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

function connectionBadgeClass(status: UnifiedClientProfileResponse["pipeline"]["connection"]["status"]) {
  const common = "border px-2 py-1 text-[10px] font-black uppercase";
  if (status === "confirmed" || status === "pipeline_only") return `${common} border-[#b8dacf] bg-[#effaf5] text-[#0f8b73]`;
  if (status === "candidate") return `${common} border-[#e2ca9f] bg-[#fffaf0] text-[#8a5a10]`;
  if (status === "unavailable") return `${common} border-[#d7bd84] bg-[#fffaf0] text-[#8a6118]`;
  return `${common} border-[#d9d9d9] bg-[#f8f8f8] text-[#737373]`;
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
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 shrink-0 rounded-full bg-[#e7efeb]" />
          <div className="min-w-0 flex-1">
            <div className="h-8 w-full max-w-[360px] rounded bg-[#e8ebe9]" />
            <div className="mt-3 h-3 w-full max-w-[220px] rounded bg-[#f0f2f1]" />
          </div>
        </div>
      </div>
      <div className="mt-4 grid animate-pulse gap-px border-b border-[#d9d9d9] bg-[#d9d9d9] md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="min-h-[96px] bg-white px-5 py-4">
            <div className="h-2.5 w-24 rounded bg-[#edf0ee]" />
            <div className="mt-3 h-6 w-24 rounded bg-[#e7eae8]" />
            <div className="mt-2 h-2.5 w-32 rounded bg-[#f3f4f3]" />
          </div>
        ))}
      </div>
      <div className="mt-5 grid animate-pulse gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,0.65fr)]">
        <div className="min-h-[360px] border-b border-[#d9d9d9] bg-[#fafbfa]" />
        <div className="min-h-[360px] border-b border-[#d9d9d9] bg-[#fafbfa]" />
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex h-8 items-center gap-2 text-[12px] font-black text-[#0f8b73] hover:text-[#0a6a58]"><ArrowLeft size={15} /> Back to profiles</button>;
}

function ProfileSection({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[#d9d9d9] bg-white px-5 py-5 md:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#d9d9d9] pb-3">
        <h2 className="text-[16px] font-black">{title}</h2>
        {detail ? <span className="text-[11px] text-[#737373]">{detail}</span> : null}
      </div>
      <div className="pt-5">{children}</div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="bg-white px-5 py-4"><div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#737373]">{label}</div><div className="mt-2 truncate text-[20px] font-black">{value}</div><div className="mt-1 truncate text-[11px] text-[#737373]">{detail}</div></div>;
}

function currentResidentFacts(resident: ClinicalResident | null): ClientProfileFact[] {
  if (!resident) return [];
  return [
    fact("Full name", resident.display_name),
    fact("Resident number", resident.resident_number),
    fact("Date of birth", formatProfileDate(resident.date_of_birth)),
    fact("Age", resident.age),
    fact("Community", resident.community_name),
    fact("Unit", resident.unit),
    fact("Admission date", formatProfileDate(resident.admit_date)),
    fact("Care level", resident.care_level),
    fact("Payor", resident.payor),
    fact("Primary diagnosis", resident.primary_diagnosis),
    fact("Physician", resident.physician),
    fact("Diet", resident.diet),
  ].filter((value): value is ClientProfileFact => Boolean(value));
}

function fact(label: string, value: string | number | null | undefined): ClientProfileFact | null {
  const display = typeof value === "number" ? String(value) : value?.trim();
  return display ? { label, value: display } : null;
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
  return <div><div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#737373]">{label}</div><div className={`mt-1 break-words text-[13px] font-semibold ${present ? "text-[#111111]" : "text-[#9a6a18]"}`}>{display}</div></div>;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return <UserRound size={18} />;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
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

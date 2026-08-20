"use client";

/* eslint-disable @next/next/no-img-element -- Private no-store thumbnails require the signed-in browser request. */

import { useEffect, useState } from "react";
import { ArrowLeft, Check, CircleAlert, ExternalLink, FileText, ImageOff, Link2, Search, UserRound, X } from "lucide-react";

import type {
  ClinicalClientRecord,
  ClinicalClientSourceDocument,
  ClinicalJsonValue,
} from "@/lib/clinical/clinical-contracts";
import {
  hasReadableClinicalValue,
  humanizeClinicalField,
  presentClinicalValue,
} from "@/lib/clinical/clinical-value-presentation";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { ClientHistoryProjection } from "@/lib/pipeline/client-history-contracts";
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
    return "Pipeline work data is temporarily unavailable. Retry, or return to Clients; the admitted-client roster is unchanged.";
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
  const history = profile.history ?? UNAVAILABLE_CLIENT_HISTORY;

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
                <span className={connectionBadgeClass(profile.pipeline.connection.status)}>
                  {connectionLabel(profile.pipeline.connection.status)}
                </span>
              </div>
              <p className="mt-2 text-[13px] text-[#595959]">
                {client.current_resident
                  ? `${client.current_community || resident?.community_name || "Current resident"}${client.unit ? ` · Unit ${client.unit}` : ""}`
                  : `${client.community_names.join(" · ") || "Community not reported"} · Historical client`}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-4 grid gap-px border-b border-[#d9d9d9] bg-[#d9d9d9] md:grid-cols-4" aria-label="Profile summary">
          <Metric label="Resident number" value={client.resident_numbers[0] || "Not reported"} detail={client.resident_numbers.length > 1 ? `${client.resident_numbers.length} recorded identifiers` : "Governed identifier"} />
          <Metric label="Community" value={client.current_community || client.community_names.at(-1) || "Not reported"} detail={client.unit ? `Unit ${client.unit}` : client.current_resident ? "Current resident" : "Historical client"} />
          <Metric label="Admitted" value={formatDate(client.admit_date)} detail={client.care_level || "Care level not reported"} />
          <Metric label="Recorded stays" value={String(client.episode_count)} detail={client.current_resident ? "Includes current stay" : "Historical record"} />
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,0.65fr)]">
          <div className="min-w-0 space-y-5">
            {resident ? (
              <ProfileSection title="Current client record" detail="Governed Alamo snapshot">
                <div className="grid gap-8 lg:grid-cols-2">
                  <RecordGroup title="Identity and residence">
                    <DataPoint label="Full name" value={resident.display_name} />
                    <DataPoint label="Resident number" value={resident.resident_number ?? resident.resident_id} />
                    <DataPoint label="Date of birth" value={formatDate(resident.date_of_birth)} />
                    <DataPoint label="Community" value={resident.community_name} />
                    <DataPoint label="Unit" value={resident.unit} />
                    <DataPoint label="Admission date" value={formatDate(resident.admit_date)} />
                  </RecordGroup>
                  <RecordGroup title="Clinical snapshot">
                    <DataPoint label="Care level" value={resident.care_level} />
                    <DataPoint label="Payor" value={resident.payor} />
                    <DataPoint label="Primary diagnosis" value={resident.primary_diagnosis} />
                    <DataPoint label="Physician" value={resident.physician} />
                    <DataPoint label="Diet" value={resident.diet} />
                  </RecordGroup>
                </div>
              </ProfileSection>
            ) : null}

            <ProfileSection title="Key client context" detail="Most relevant verified history and clinical details">
              <KeyClientContext client={client} />
            </ProfileSection>

            {client.source_documents.length > 0 ? (
              <ProfileSection title="Governed source files" detail={`${client.source_documents.length} attached to canonical client ID`}>
                <ClinicalSourceDocumentGallery
                  canonicalClientId={client.canonical_client_id}
                  documents={client.source_documents}
                />
              </ProfileSection>
            ) : null}

            <ProfileSection title="Resident episode history" detail="Joined by canonical client identifier">
              <GovernedEpisodeHistory episodes={client.resident_episode_history} />
            </ProfileSection>

            <ProfileSection title="Pipeline work" detail="Available only through a reviewed identity link">
              <PipelineWorkSummary profile={profile} onConnectionChanged={onConnectionChanged} />
            </ProfileSection>

            {profile.pipeline.connection.status === "confirmed" ? (
              <ProfileSection title="Client files" detail={`${profile.pipeline.documents.length} linked through reviewed identity`}>
                <ClientDocumentGallery documents={profile.pipeline.documents} />
              </ProfileSection>
            ) : null}

            <ProfileSection title="Assessments" detail="Separate dated records; latest shown first">
              <ClientAssessmentSummary
                assessments={profile.pipeline.assessments}
                connection={profile.pipeline.connection}
              />
            </ProfileSection>

            {client.resident_episode_history.length === 0 && history.status === "available" ? (
              <ProfileSection title="Placement trajectory" detail="Legacy exact resident-number history; newest episode first">
                <ClientHistorySummary history={history} />
              </ProfileSection>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-5">
            <ProfileSection title="Record status">
              <dl className="space-y-4 text-[12px]">
                <StatusPoint label="Client status" value={client.current_resident ? "Current resident" : "Historical client"} />
                <StatusPoint label="Clinical data through" value={formatDate(profile.data_as_of)} />
                <StatusPoint label="Profile baseline" value={formatDate(profile.client_database.baseline_date)} />
                <StatusPoint label="Attached source files" value={String(client.source_documents.length)} />
                {history.data_as_of ? <StatusPoint label="Placement history through" value={formatDate(history.data_as_of)} /> : null}
              </dl>
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

type CuratedClinicalField = { label: string; keys: string[] };

const CURATED_CLIENT_CONTEXT: Array<{ name: string; fields: CuratedClinicalField[] }> = [
  {
    name: "Placement and coverage",
    fields: [
      { label: "Prior setting", keys: ["prior_setting_enriched_json", "prior_setting_bucket", "structured_prior_setting_buckets_json", "previous_living_status_values_json"] },
      { label: "Referring facility", keys: ["referring_facilities_enriched_json", "referring_facility"] },
      { label: "County", keys: ["county_enriched_json", "county"] },
      { label: "Payor", keys: ["payer_values_enriched_json", "payer_values_json"] },
      { label: "Discharge destination", keys: ["discharge_destination_values_json"] },
    ],
  },
  {
    name: "Clinical and safety",
    fields: [
      { label: "Primary diagnosis", keys: ["primary_diagnosis"] },
      { label: "Other diagnoses", keys: ["diagnoses_enriched_json", "structured_diagnoses_json", "secondary_diagnoses"] },
      { label: "Active allergies", keys: ["active_allergies_json"] },
      { label: "Active medications", keys: ["active_medication_count"] },
      { label: "Psychotropic medications", keys: ["active_psychotropic_medication_count"] },
      { label: "Substance use", keys: ["substance_use_enriched_json", "substance_use", "substances"] },
      { label: "Conservatorship", keys: ["conservatorship_enriched_json", "conservatorship", "conservatorship_type"] },
      { label: "Code status", keys: ["code_status_values_json"] },
    ],
  },
  {
    name: "Personal and care contacts",
    fields: [
      { label: "Date of birth", keys: ["date_of_birth"] },
      { label: "Primary language", keys: ["primary_language_values_json"] },
      { label: "Primary physician", keys: ["primary_physician_values_json"] },
      { label: "Advance directive", keys: ["advance_directive_values_json"] },
      { label: "Emergency contacts", keys: ["emergency_contact_count"] },
      { label: "Legal contacts", keys: ["legal_contact_count"] },
    ],
  },
];

function KeyClientContext({ client }: { client: UnifiedClientProfileResponse["client"] }) {
  const groups = CURATED_CLIENT_CONTEXT.flatMap((group) => {
    const fields = group.fields.flatMap((field) => {
      const selected = selectClinicalField(client.enrichment, field);
      return selected ? [{ ...field, ...selected }] : [];
    });
    return fields.length > 0 ? [{ name: group.name, fields }] : [];
  });

  if (groups.length === 0) {
    return <div className="text-[12px] text-[#737373]">No additional verified client context is available yet.</div>;
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.name}>
          <h3 className="border-b border-[#d9d9d9] pb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">{group.name}</h3>
          <div className="mt-4 grid gap-x-7 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
            {group.fields.map((field) => (
              <ClinicalDataPoint key={field.label} label={field.label} fieldKey={field.key} value={field.value} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GovernedEpisodeHistory({ episodes }: { episodes: ClinicalClientRecord[] }) {
  if (episodes.length === 0) {
    return (
      <div className="border-l-2 border-[#d9d9d9] bg-[#f8f8f8] px-4 py-3 text-[12px] text-[#595959]">
        No governed resident episodes are linked to this canonical client identifier.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {episodes.map((episode, index) => {
        const title = firstClinicalText(episode, ["facility_name", "community_name", "community"]) || `Episode ${index + 1}`;
        const admitDate = firstClinicalText(episode, ["admit_date", "admission_date"]);
        const dischargeDate = firstClinicalText(episode, ["discharge_date"]);
        return (
          <details key={`${title}-${admitDate}-${index}`} open={index === 0} className="border-b border-[#d9d9d9]">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 py-3">
              <span className="text-[13px] font-black text-[#111111]">{title}</span>
              <span className="text-[11px] text-[#737373]">
                {admitDate ? formatLooseDate(admitDate) : "Admission not reported"}
                {dischargeDate ? ` to ${formatLooseDate(dischargeDate)}` : ""}
              </span>
            </summary>
            <div className="grid gap-x-7 gap-y-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
              {EPISODE_CONTEXT_FIELDS.flatMap((field) => {
                const selected = selectClinicalField(episode, field);
                return selected ? [
                  <ClinicalDataPoint key={field.label} label={field.label} fieldKey={selected.key} value={selected.value} />,
                ] : [];
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

const EPISODE_CONTEXT_FIELDS: CuratedClinicalField[] = [
  { label: "Status", keys: ["resident_status", "status"] },
  { label: "Prior setting", keys: ["prior_setting_bucket", "prior_setting"] },
  { label: "Referring facility", keys: ["referring_facility", "facility_canonical"] },
  { label: "Primary diagnosis", keys: ["primary_diagnosis"] },
  { label: "Conservatorship", keys: ["conservatorship"] },
  { label: "Discharge reason", keys: ["discharge_reason"] },
];

function selectClinicalField(record: ClinicalClientRecord, field: CuratedClinicalField) {
  for (const key of field.keys) {
    const value = record[key];
    if (hasReadableClinicalValue(value, key)) return { key, value };
  }
  return null;
}

function firstClinicalText(record: ClinicalClientRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function formatLooseDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value;
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
  const confirmed = connection.status === "confirmed";
  const noticeClass = confirmed
    ? "border-[#b8dacf] bg-[#effaf5] text-[#315b51]"
    : connection.status === "candidate"
      ? "border-[#e2ca9f] bg-[#fffaf0] text-[#5d4925]"
      : connection.status === "unavailable"
        ? "border-[#d7bd84] bg-[#fffaf0] text-[#5d4925]"
        : "border-[#d9d9d9] bg-[#f8f8f8] text-[#595959]";

  return (
    <div>
      <div className={`border-l-2 px-4 py-3 text-[12px] leading-5 ${noticeClass}`} role="status">
        <div className="font-black">{connectionLabel(connection.status)}</div>
        <div className="mt-1">{connection.message}</div>
      </div>

      {confirmed ? (
        <>
          <div className="mt-4 grid gap-px bg-[#d9dfdb] sm:grid-cols-2 lg:grid-cols-4" aria-label="Pipeline work summary">
            <SummaryCell label="Referrals" value={summary.referral_count} detail={`${summary.active_referral_count} active`} />
            <SummaryCell label="Assessments" value={summary.assessment_count} detail={summary.latest_assessment_status?.replaceAll("_", " ") || "None yet"} />
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
          Historical clients remain searchable and retain assessment history, but a new current-resident identity link cannot be created without a governed current roster record.
        </div>
      )}
    </div>
  );
}

function ClientDocumentGallery({ documents }: { documents: ReferralFile[] }) {
  if (documents.length === 0) {
    return (
      <div className="border-l-2 border-[#d9d9d9] bg-[#f8f8f8] px-4 py-3 text-[12px] leading-5 text-[#595959]">
        No Pipeline files are attached to this canonical client through a reviewed referral link.
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
              <span className="text-[9px] font-black uppercase text-[#737373]">{document.status}</span>
            </div>
            <div className="mt-2 break-words text-[12px] font-black leading-5 text-[#111111]">{document.name}</div>
            <div className="mt-2 text-[10px] leading-4 text-[#737373]">
              Referral #{document.referralId} · {document.community}
              {document.pageCount ? ` · ${document.pageCount} page${document.pageCount === 1 ? "" : "s"}` : ""}
            </div>
            <div className="mt-1 text-[10px] text-[#737373]">Uploaded {formatDate(document.uploadedAt)}</div>
            {document.previewUrl ? (
              <a
                href={document.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black text-[#0f8b73] hover:text-[#0a6a58]"
              >
                Open file <ExternalLink size={12} />
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

  return document.previewUrl ? (
    <a
      href={document.previewUrl}
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
              {isChoosing ? "Cancel" : "Choose matching referral"}
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
                              <span className="mt-1 block truncate text-[10px] text-[#737373]">#{suggestion.referral_id} · {suggestion.community} · {suggestion.stage}</span>
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
                        <span className="mt-1 block truncate text-[10px] text-[#737373]">#{referral.id} · {referral.community} · {referral.stage}</span>
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
                  <div className="text-[12px] font-black">Referral #{link.referral_id ?? "not recorded"}</div>
                  <div className="mt-1 text-[10px] text-[#737373]">Proposed by {link.created_by.name} · version {link.version}</div>
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
  if (status === "confirmed") return "Pipeline linked";
  if (status === "candidate") return "Identity review needed";
  if (status === "unavailable") return "Pipeline work unavailable";
  return "Pipeline not linked";
}

function connectionBadgeClass(status: UnifiedClientProfileResponse["pipeline"]["connection"]["status"]) {
  const common = "border px-2 py-1 text-[10px] font-black uppercase";
  if (status === "confirmed") return `${common} border-[#b8dacf] bg-[#effaf5] text-[#0f8b73]`;
  if (status === "candidate") return `${common} border-[#e2ca9f] bg-[#fffaf0] text-[#8a5a10]`;
  if (status === "unavailable") return `${common} border-[#d7bd84] bg-[#fffaf0] text-[#8a6118]`;
  return `${common} border-[#d9d9d9] bg-[#f8f8f8] text-[#737373]`;
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

function RecordGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="border-b border-[#d9d9d9] pb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">{title}</h3>
      <div className="mt-4 grid gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">{children}</div>
    </section>
  );
}

function DataPoint({ label, value }: { label: string; value: string | number | null }) {
  const display = typeof value === "number" ? String(value) : value?.trim() || "Not reported";
  const present = display !== "Not reported";
  return <div><div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#737373]">{label}</div><div className={`mt-1 break-words text-[13px] font-semibold ${present ? "text-[#111111]" : "text-[#9a6a18]"}`}>{display}</div></div>;
}

function ClinicalDataPoint({
  label,
  fieldKey,
  value,
}: {
  label: string;
  fieldKey: string;
  value: ClinicalJsonValue | undefined;
}) {
  const presentation = presentClinicalValue(value, fieldKey);

  return (
    <div className="min-w-0">
      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#737373]">{label}</div>
      {presentation.kind === "missing" ? (
        <div className="mt-1 text-[13px] font-semibold text-[#9a6a18]">{presentation.text}</div>
      ) : presentation.kind === "list" ? (
        <ul className="mt-2 space-y-1.5">
          {presentation.items.map((item, index) => (
            <li key={`${index}-${item}`} className="flex items-start gap-2 text-[13px] font-semibold leading-5 text-[#111111]">
              <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-[#0f8b73]" aria-hidden="true" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      ) : presentation.kind === "record" ? (
        <dl className="mt-2 space-y-2 border-l border-[#d9dfdb] pl-3">
          {presentation.entries.map((entry) => (
            <div key={`${entry.label}-${entry.value}`}>
              <dt className="text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">{entry.label}</dt>
              <dd className="mt-0.5 break-words text-[12px] font-semibold leading-5 text-[#111111]">{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="mt-1 break-words text-[13px] font-semibold leading-5 text-[#111111]">{presentation.text}</div>
      )}
    </div>
  );
}

function StatusPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[#e5e5e5] pb-3 last:border-b-0 last:pb-0">
      <dt className="text-[9px] font-black uppercase tracking-[0.1em] text-[#737373]">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-[#111111]">{value}</dd>
    </div>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return <UserRound size={18} />;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function formatDate(value: string | null) {
  if (!value) return "Not reported";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

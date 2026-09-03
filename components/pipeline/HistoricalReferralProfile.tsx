"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Archive, FileSearch, Paperclip } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { HistoricalProfileResponse } from "@/lib/pipeline/historical-profile-contracts";
import type { Referral } from "@/lib/pipeline/referral-types";
import { getWorkspaceCounty } from "@/lib/pipeline/workspace-presentation";
import { formatClientIdentityTitle, resolveClientCommunity, resolveClientGender } from "@/lib/pipeline/client-identity-presentation.mjs";

export default function HistoricalReferralProfile({ referral }: { referral: Referral }) {
  const [profile, setProfile] = useState<HistoricalProfileResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchPipelineJson<HistoricalProfileResponse>(`/api/referrals/${referral.id}/historical-profile`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(setProfile).catch((reason) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Historical profile could not be loaded.");
      }
    });
    return () => controller.abort();
  }, [referral.id]);

  const county = firstValue(profileFact(profile, "county"), getWorkspaceCounty(referral));
  const dob = firstValue(profileFact(profile, "dob"), referral.dob);
  const gender = resolveClientGender(profileFact(profile, "gender"), referral.gender) ?? "";

  return (
    <div className="space-y-5">
      <HistoricalProfileHeader referral={referral} county={county} dob={dob} gender={gender} />
      <HistoricalProfileStatus profile={profile} error={error} />
      {profile ? <HistoricalProfileContent profile={profile} /> : null}
    </div>
  );
}

const prominentFactKeys = new Set(["name", "gender", "county", "dob"]);

function HistoricalProfileHeader({ referral, county, dob, gender }: { referral: Referral; county: string; dob: string; gender: string }) {
  const identityTitle = formatClientIdentityTitle({ name: referral.name, gender, community: referral.community });
  const facts = [
    { label: "Community", value: resolveClientCommunity(referral.community) ?? "" },
    { label: "Gender", value: gender },
    { label: "County", value: county },
    { label: "Date of birth", value: dob },
    { label: "Source period", value: sourcePeriod(referral) },
  ].filter((fact) => fact.value);
  return (
    <section className="border border-[#cfd7d4] bg-[#f7faf9] px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[760px]">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em] text-[#0c705f]">
            <Archive size={14} aria-hidden="true" /> Historical profile
          </div>
          <h2 className="mt-2 text-[18px] font-black tracking-[-0.02em] text-[#111111]">{identityTitle}</h2>
          <p className="mt-1 text-[11px] leading-5 text-[#59635f]">
            Read-only facts and notes reconstructed from imported source material. This is not a completed assessment and does not enter assessment reporting.
          </p>
        </div>
        {facts.length > 0 ? <div className="grid min-w-[260px] grid-cols-2 border-l border-t border-[#d7ddd9] bg-white">{facts.map((fact) => <ProfileFact key={fact.label} {...fact} />)}</div> : null}
      </div>
    </section>
  );
}

function HistoricalProfileStatus({ profile, error }: { profile: HistoricalProfileResponse | null; error: string }) {
  if (error) {
    return <section role="alert" className="border-l-2 border-[#a9473d] bg-[#fff5f3] px-4 py-3 text-[11px] font-semibold text-[#7c3229]">{error}</section>;
  }
  if (!profile) {
    return <section role="status" className="border border-[#d7ddd9] px-4 py-8 text-center text-[11px] font-semibold text-[#737373]">Organizing linked source material...</section>;
  }
  return null;
}

function HistoricalProfileContent({ profile }: { profile: HistoricalProfileResponse }) {
  const facts = profile.facts.filter((fact) => !prominentFactKeys.has(fact.key));
  return (
    <>
      <HistoricalEmptyMessage message={profile.message} />
      <HistoricalFacts facts={facts} />
      <HistoricalDocuments documents={profile.documents} />
      <HistoricalAssessmentEvidence sections={profile.sections} />
      <HistoricalUnmappedEvidence evidence={profile.unmappedEvidence} />
      <HistoricalSourceDetails sections={profile.sourceSections} />
      <p className="border-t border-[#d7ddd9] pt-3 text-[9px] leading-4 text-[#68716d]">
        This is a read-only reconstruction of the linked source record. Historical facts and notes must be verified before reuse in a current assessment.
      </p>
    </>
  );
}

function HistoricalEmptyMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <section className="flex items-start gap-3 border border-[#d7ddd9] bg-white px-4 py-3">
      <FileSearch size={17} className="mt-0.5 shrink-0 text-[#68716d]" aria-hidden="true" />
      <div>
        <p className="text-[11px] font-bold text-[#303633]">{message}</p>
        <p className="mt-0.5 text-[10px] leading-4 text-[#737373]">This workspace will update when source material is linked.</p>
      </div>
    </section>
  );
}

function HistoricalFacts({ facts }: { facts: HistoricalProfileResponse["facts"] }) {
  if (!facts.length) return null;
  return (
    <section aria-labelledby="historical-facts">
      <SectionHeading id="historical-facts" title="Profile facts" detail="Values captured in the original workspace" count={facts.length} />
      <div className="grid border-l border-t border-[#d7ddd9] bg-white sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.factId} className="min-w-0 border-b border-r border-[#d7ddd9] px-4 py-3">
            <div className="text-[9px] font-black uppercase tracking-[0.07em] text-[#68716d]">{fact.label}</div>
            <div className="mt-1 whitespace-pre-wrap text-[12px] font-semibold leading-5 text-[#202522]">{fact.value}</div>
            <div className="mt-2 truncate text-[9px] text-[#8a918d]" title={sourceDescription(fact.source)}>{sourceDescription(fact.source)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoricalDocuments({ documents }: { documents: HistoricalProfileResponse["documents"] }) {
  if (!documents.length) return null;
  return (
    <section aria-labelledby="historical-documents">
      <SectionHeading id="historical-documents" title="Source documents" detail="Every file linked to this imported workspace" count={documents.length} />
      <div className="divide-y divide-[#e1e5e2] border border-[#d7ddd9] bg-white">
        {documents.map((document) => (
          <article key={document.documentId} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_180px_130px] sm:items-center">
            <div className="flex min-w-0 items-start gap-2.5">
              <Paperclip size={14} className="mt-0.5 shrink-0 text-[#0c705f]" aria-hidden="true" />
              <div className="min-w-0">
                <p className="break-words text-[11px] font-bold text-[#202522]">{document.name}</p>
                <p className="mt-0.5 text-[9px] text-[#737b77]">{document.category}</p>
              </div>
            </div>
            <p className="text-[9px] text-[#737b77]">{formatDocumentExtent(document)}</p>
            <p className="text-[9px] text-[#737b77]">Added {formatDate(document.uploadedAt)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function HistoricalAssessmentEvidence({ sections }: { sections: HistoricalProfileResponse["sections"] }) {
  return sections.map((section) => (
    <section key={section.section} aria-labelledby={`historical-${section.section}`}>
      <SectionHeading
        id={`historical-${section.section}`}
        title={section.label}
        detail="Imported evidence organized against future assessment fields"
        count={section.evidenceCount}
      />
      <div className="divide-y divide-[#e1e5e2] border border-[#d7ddd9] bg-white">
        {section.fields.map((field) => (
          <details key={field.targetField} className="group" open={section.fields.length <= 3}>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3 hover:bg-[#f7faf9]">
              <span>
                <span className="block text-[12px] font-black text-[#202522]">{field.label}</span>
                <span className="mt-1 block max-w-[880px] text-[10px] leading-4 text-[#737b77]">{field.purpose}</span>
              </span>
              <span className="shrink-0 text-[10px] font-black text-[#0c705f]">{field.evidence.length}</span>
            </summary>
            <div className="border-t border-[#edf0ee] bg-[#fbfcfb] px-4 py-3">
              <div className="space-y-3">
                {field.evidence.map((evidence) => (
                  <article key={evidence.evidenceId} className="border-l-2 border-[#8cbdb1] bg-white px-3 py-3">
                    <p className="whitespace-pre-wrap text-[11px] leading-5 text-[#252b28]">{evidence.text}</p>
                    <EvidenceSource evidence={evidence} />
                  </article>
                ))}
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  ));
}

function EvidenceSource({ evidence }: { evidence: HistoricalProfileResponse["sections"][number]["fields"][number]["evidence"][number] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#747c78]">
      <span className="font-black text-[#53615c]">{evidence.confidence === "high" ? "Stronger field match" : "Possible field match"}</span>
      <span>{evidence.source.sourceCanvasName}</span>
      {evidence.source.sourceProjectName ? <span>{evidence.source.sourceProjectName}</span> : null}
      {evidence.source.capturedAt ? <span>Captured {formatDate(evidence.source.capturedAt)}</span> : null}
    </div>
  );
}

function HistoricalUnmappedEvidence({ evidence }: { evidence: HistoricalProfileResponse["unmappedEvidence"] }) {
  if (!evidence.length) return null;
  return (
    <details className="border border-[#d8cda4] bg-[#fffdf4]">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#8a6e12]" aria-hidden="true" />
        <span>
          <span className="block text-[12px] font-black text-[#4c421d]">Source notes needing structure</span>
          <span className="mt-1 block text-[10px] leading-4 text-[#74683c]">Preserved statements that need human review before they are assigned to an assessment field.</span>
        </span>
      </summary>
      <div className="divide-y divide-[#e8dfbd] border-t border-[#e1d5aa] px-4">
        {evidence.map((item) => (
          <article key={item.evidenceId} className="py-3">
            <p className="whitespace-pre-wrap text-[11px] leading-5 text-[#34322a]">{item.text}</p>
            <p className="mt-1 text-[9px] text-[#7c7351]">{item.source.sourceCanvasName}</p>
          </article>
        ))}
      </div>
    </details>
  );
}

function HistoricalSourceDetails({ sections }: { sections: HistoricalProfileResponse["sourceSections"] }) {
  if (!sections.length) return null;
  const count = sections.reduce((total, section) => total + section.blocks.length, 0);
  return (
    <section aria-labelledby="historical-source-details">
      <SectionHeading id="historical-source-details" title="Other source details" detail="Captured workspace content that is not duplicated above" count={count} />
      <div className="space-y-3">
        {sections.map((section) => (
          <details key={section.sectionId} className="border border-[#d7ddd9] bg-white" open={sections.length <= 3}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 hover:bg-[#f7faf9]">
              <span className="min-w-0">
                <span className="block text-[11px] font-black text-[#202522]">{section.label}</span>
                <span className="mt-0.5 block truncate text-[9px] text-[#818884]" title={sourceDescription(section.source)}>{sourceDescription(section.source)}</span>
              </span>
              <span className="shrink-0 text-[9px] font-black text-[#0c705f]">{section.blocks.length}</span>
            </summary>
            <div className="divide-y divide-[#edf0ee] border-t border-[#edf0ee] bg-[#fbfcfb]">
              {section.blocks.map((block) => <p key={block.blockId} className="whitespace-pre-wrap px-4 py-2.5 text-[11px] leading-5 text-[#303633]">{block.text}</p>)}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({ id, title, detail, count }: { id: string; title: string; detail: string; count: number }) {
  return (
    <div className="flex items-end justify-between gap-4 border-t-2 border-[#111111] pb-2 pt-3">
      <div>
        <h2 id={id} className="text-[14px] font-black text-[#111111]">{title}</h2>
        <p className="mt-0.5 text-[10px] text-[#737373]">{detail}</p>
      </div>
      <span className="shrink-0 text-[10px] font-black text-[#0c705f]">{count}</span>
    </div>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-b border-r border-[#d7ddd9] px-3 py-2.5"><div className="text-[8px] font-black uppercase tracking-[0.08em] text-[#7b827f]">{label}</div><div className="mt-1 truncate text-[10px] font-bold text-[#303633]" title={value}>{value}</div></div>;
}

function sourcePeriod(referral: Referral) {
  const source = referral.sourceProjectName?.trim() || referral.sourceWorkspaceName?.trim();
  return source || formatDate(referral.createdAt);
}

function profileFact(profile: HistoricalProfileResponse | null, key: HistoricalProfileResponse["facts"][number]["key"]) {
  return profile?.facts.find((fact) => fact.key === key)?.value ?? "";
}

function sourceDescription(source: HistoricalProfileResponse["sources"][number]) {
  return [source.sourceCanvasName, source.sourceProjectName].filter(Boolean).join(" · ");
}

function firstValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function formatDocumentExtent(document: HistoricalProfileResponse["documents"][number]) {
  if (!document.pageCount) return formatBytes(document.sizeBytes);
  return `${document.pageCount} page${document.pageCount === 1 ? "" : "s"}`;
}

function formatBytes(value: number | null) {
  if (value === null) return "Size not recorded";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

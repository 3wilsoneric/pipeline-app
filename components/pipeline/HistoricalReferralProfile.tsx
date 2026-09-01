"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Archive, FileSearch } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { HistoricalProfileResponse } from "@/lib/pipeline/historical-profile-contracts";
import type { Referral } from "@/lib/pipeline/referral-types";
import { getWorkspaceCounty } from "@/lib/pipeline/workspace-presentation";

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

  return (
    <div className="space-y-5">
      <section className="border border-[#cfd7d4] bg-[#f7faf9] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[760px]">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em] text-[#0c705f]">
              <Archive size={14} aria-hidden="true" /> Historical profile
            </div>
            <h2 className="mt-2 text-[18px] font-black tracking-[-0.02em] text-[#111111]">{referral.name}</h2>
            <p className="mt-1 text-[11px] leading-5 text-[#59635f]">
              Read-only facts and notes reconstructed from imported source material. This is not a completed assessment and does not enter assessment reporting.
            </p>
          </div>
          <div className="grid min-w-[260px] grid-cols-2 border-l border-t border-[#d7ddd9] bg-white">
            <ProfileFact label="Community" value={referral.community || "Not recorded"} />
            <ProfileFact label="County" value={getWorkspaceCounty(referral)} />
            <ProfileFact label="Date of birth" value={referral.dob || "Not recorded"} />
            <ProfileFact label="Source period" value={sourcePeriod(referral)} />
          </div>
        </div>
      </section>

      {error ? (
        <section role="alert" className="border-l-2 border-[#a9473d] bg-[#fff5f3] px-4 py-3 text-[11px] font-semibold text-[#7c3229]">
          {error}
        </section>
      ) : null}

      {!profile && !error ? (
        <section role="status" className="border border-[#d7ddd9] px-4 py-8 text-center text-[11px] font-semibold text-[#737373]">
          Organizing linked source notes into the historical profile...
        </section>
      ) : null}

      {profile ? (
        <>
          {profile.message ? (
            <section className="flex items-start gap-3 border border-[#d7ddd9] bg-white px-4 py-3">
              <FileSearch size={17} className="mt-0.5 shrink-0 text-[#68716d]" aria-hidden="true" />
              <div>
                <p className="text-[11px] font-bold text-[#303633]">No assessment notes were captured for this record.</p>
                <p className="mt-0.5 text-[10px] leading-4 text-[#737373]">Use Source files to review the original material.</p>
              </div>
            </section>
          ) : null}

          {profile.sections.map((section) => (
            <section key={section.section} aria-labelledby={`historical-${section.section}`}>
              <div className="flex items-end justify-between gap-4 border-t-2 border-[#111111] pb-2 pt-3">
                <div>
                  <h2 id={`historical-${section.section}`} className="text-[14px] font-black text-[#111111]">{section.label}</h2>
                  <p className="mt-0.5 text-[10px] text-[#737373]">Imported evidence organized against future assessment fields</p>
                </div>
                <span className="text-[10px] font-black text-[#0c705f]">{section.evidenceCount} statement{section.evidenceCount === 1 ? "" : "s"}</span>
              </div>
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
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#747c78]">
                              <span className="font-black text-[#53615c]">{evidence.confidence === "high" ? "Stronger field match" : "Possible field match"}</span>
                              <span>{evidence.source.sourceCanvasName}</span>
                              {evidence.source.sourceProjectName ? <span>{evidence.source.sourceProjectName}</span> : null}
                              {evidence.source.capturedAt ? <span>Captured {formatDate(evidence.source.capturedAt)}</span> : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}

          {profile.unmappedEvidence.length ? (
            <details className="border border-[#d8cda4] bg-[#fffdf4]">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#8a6e12]" aria-hidden="true" />
                <span>
                  <span className="block text-[12px] font-black text-[#4c421d]">Source notes needing structure</span>
                  <span className="mt-1 block text-[10px] leading-4 text-[#74683c]">
                    These statements were preserved but did not meet the deterministic threshold for a questionnaire field. They require human review rather than a forced match.
                  </span>
                </span>
              </summary>
              <div className="divide-y divide-[#e8dfbd] border-t border-[#e1d5aa] px-4">
                {profile.unmappedEvidence.map((evidence) => (
                  <article key={evidence.evidenceId} className="py-3">
                    <p className="whitespace-pre-wrap text-[11px] leading-5 text-[#34322a]">{evidence.text}</p>
                    <p className="mt-1 text-[9px] text-[#7c7351]">{evidence.source.sourceCanvasName}</p>
                  </article>
                ))}
              </div>
            </details>
          ) : null}

          <p className="border-t border-[#d7ddd9] pt-3 text-[9px] leading-4 text-[#68716d]">
            Any historical notes must be verified before reuse in a current assessment.
          </p>
        </>
      ) : null}
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

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

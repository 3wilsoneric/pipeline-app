"use client";

import { ArrowRight } from "lucide-react";

import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import {
  formatClientIdentityTitle,
  formatReferralIdentityContext,
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { prefetchPipelineWorkspace } from "@/lib/pipeline/client-navigation";
import { getWorkspaceAdmissionOutcome, getWorkspaceCounty, getWorkspaceWorkflowLabel, isClientChartWorkspace, isEarlierWorkspaceMonth, isRecordedWorkspaceCommunity, workspaceFileCount } from "@/lib/pipeline/workspace-presentation";
import { workspaceMonthKey } from "@/lib/pipeline/workspace-month.mjs";
import styles from "./WorkspaceDirectory.module.css";
import { ClientNoteLine } from "@/components/pipeline/ClientNotes";
import { useLatestNote, useLatestNotes } from "@/components/pipeline/useLatestNotes";

export default function ReferralWorklist({
  referrals,
  onOpenPacket,
  progressByReferral = {},
  selectedMonth,
}: {
  referrals: Referral[];
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  progressByReferral?: Record<number, ReferralProgress>;
  selectedMonth?: string;
}) {
  // Ask once for every listed referral's latest note; each row reads its own.
  useLatestNotes(referrals.map((referral) => referral.id));
  const rows = referrals.map((referral) => {
    const progress = progressByReferral[referral.id] ?? getReferralProgress(referral);
    return {
      referral,
      progress,
      identityTitle: formatClientIdentityTitle(referral),
      county: getWorkspaceCounty(referral),
      carriedOver: Boolean(selectedMonth && workspaceMonthKey(referral) < selectedMonth),
    };
  });

  return (
    <div role="region" aria-label="Referral worklist" className={styles.worklist}>
      <div className={`${styles.rows} lg:hidden`}>
        {rows.map(({ referral, progress, identityTitle, county, carriedOver }) => (
          <CompactReferralRow
            key={referral.id}
            referral={referral}
            progress={progress}
            identityTitle={identityTitle}
            county={county}
            carriedOver={carriedOver}
            onOpen={() => onOpenPacket(referral)}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <div className="min-w-0">
        <div className={styles.tableHead}>
          <span>Client</span>
          <span>Status</span>
          <span>Owner</span>
          <span>Date</span>
          <span className="sr-only">Open</span>
        </div>
        <div className={styles.rows}>
          {rows.map(({ referral, progress, identityTitle, county, carriedOver }) => (
            <button
              key={referral.id}
              type="button"
              data-guide-target="workspace-results"
              data-earlier-workspace={isEarlierWorkspaceMonth(workspaceMonthKey(referral))}
              onClick={() => onOpenPacket(referral)}
              onPointerEnter={() => prefetchPipelineWorkspace(referral)}
              onFocus={() => prefetchPipelineWorkspace(referral)}
              aria-label={`Open ${identityTitle} referral workspace`}
              className={`${styles.row} ${styles.tableRow}`}
            >
              <span className="flex min-w-0 items-start gap-3">
                <span className="min-w-0 pt-0.5">
                  <span data-workspace-name className="block truncate text-[13px] font-bold text-[#111111]" title={identityTitle}>{identityTitle}</span>
                  {carriedOver ? <span className="mt-1 block text-meta font-semibold text-ink-muted">Carried over</span> : null}
                  {workspaceIdentityDetail(referral, county) ? (
                    <span title={workspaceIdentityContext(referral)} className={styles.identityDetail}>{workspaceIdentityDetail(referral, county)}</span>
                  ) : null}
                  <span className={styles.noteLine}><WorkspaceNoteLine referralId={referral.id} /></span>
                  {!isClientChartWorkspace(referral) && referral.priority !== "standard" ? (
                    <span className="mt-1 block text-[9px] font-semibold text-[#8c392f]">{referral.priority} priority</span>
                  ) : null}
                </span>
              </span>

              <span className="min-w-0">
                <WorkspaceStatus referral={referral} progress={progress} />
              </span>

              <span className={styles.owner}>{normalizeOwnerName(referral.owner)}</span>
              <span className={styles.date}>{workspaceDateLabel(referral)}</span>
              <ArrowRight data-workspace-open size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

function CompactReferralRow({
  referral,
  progress,
  identityTitle,
  county,
  carriedOver,
  onOpen,
}: {
  referral: Referral;
  progress: ReferralProgress;
  identityTitle: string;
  county: string;
  carriedOver: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-guide-target="workspace-results"
      data-earlier-workspace={isEarlierWorkspaceMonth(workspaceMonthKey(referral))}
      onClick={onOpen}
      onPointerEnter={() => prefetchPipelineWorkspace(referral)}
      onFocus={() => prefetchPipelineWorkspace(referral)}
      aria-label={`Open ${identityTitle} referral workspace`}
      className={`${styles.row} ${styles.compactRow}`}
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-3">
          <span className="min-w-0 pt-0.5">
            <span data-workspace-name className="block truncate text-[13px] font-bold text-[#111111]" title={identityTitle}>{identityTitle}</span>
            {carriedOver ? <span className="mt-1 block text-meta font-semibold text-ink-muted">Carried over</span> : null}
            {workspaceIdentityDetail(referral, county) ? (
              <span title={workspaceIdentityContext(referral)} className={styles.identityDetail}>{workspaceIdentityDetail(referral, county)}</span>
            ) : null}
            <span className={styles.noteLine}><WorkspaceNoteLine referralId={referral.id} /></span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <ArrowRight data-workspace-open size={15} className="text-[#0f8b73]" />
        </span>
      </span>

      <span className="mt-3 block">
        <WorkspaceStatus referral={referral} progress={progress} />
      </span>

      <span className="mt-3 flex items-center justify-between gap-3 text-meta">
        <span className={styles.owner}>{normalizeOwnerName(referral.owner)}</span>
        <span className={styles.date}>{workspaceDateLabel(referral)}</span>
      </span>
    </button>
  );
}

function WorkspaceStatus({ referral, progress }: { referral: Referral; progress: ReferralProgress }) {
  const openDocuments = progress.state.open_document_count;
  const fileCount = isClientChartWorkspace(referral) ? workspaceFileCount(referral) : null;
  const detail = fileCount !== null
    ? `${fileCount} ${fileCount === 1 ? "file" : "files"}`
    : openDocuments > 0 ? `${openDocuments} ${openDocuments === 1 ? "document" : "documents"} needed` : null;
  const outcome = getWorkspaceAdmissionOutcome(referral);
  return <span data-workspace-status data-state={outcome.evidence === "assumed" ? "unconfirmed" : outcome.status} data-phase={progress.phase} className={styles.status}>
    <strong>{getWorkspaceWorkflowLabel(referral)}</strong>
    {detail ? <span className="mt-1 block text-meta text-ink-muted">{detail}</span> : null}
  </span>;
}

function workspaceDateLabel(referral: Referral) {
  if (isClientChartWorkspace(referral)) return referral.workspaceMonth ?? "—";
  return ageLabel(referral.updatedAt ?? referral.createdAt);
}

function workspaceIdentityDetail(referral: Referral, county = "") {
  return [
    isRecordedWorkspaceCommunity(referral.community) ? resolveClientCommunity(referral.community) : null,
    county || null,
  ].filter(Boolean).join(" · ");
}

function workspaceIdentityContext(referral: Referral) {
  return [resolveClientGender(referral.gender), formatReferralIdentityContext({ name: referral.name, referralId: referral.id, received: formatProfileDate(referral.date), source: referral.source })].filter(Boolean).join(" · ");
}

function ageLabel(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown";
  const hours = Math.max(0, Math.floor((Date.now() - time) / 36e5));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function WorkspaceNoteLine({ referralId }: { referralId: number }) {
  return <ClientNoteLine note={useLatestNote(referralId)} compact />;
}

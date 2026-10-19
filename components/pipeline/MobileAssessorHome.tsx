"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, ClipboardList, Search, UserPlus } from "lucide-react";

import ContinueWorkPanel from "@/components/pipeline/ContinueWorkPanel";
import { SinceLastVisitAssignments } from "@/components/pipeline/WorkspaceActivityFeed";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { ReferralWorklistItem } from "@/lib/pipeline/operations-types";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { AssessmentEntryAction, PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";

const inProgressStates = new Set(["in_progress", "waiting_for_information", "ready_to_sign"]);
type OpenPacket = (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation, action?: AssessmentEntryAction) => void;

export default function MobileAssessorHome({ briefing, onOpenPacket, onBrowseHome, onResumeDraft, onAcknowledgeAssignments, onSearch }: {
  briefing: HomeBriefingSnapshot;
  onOpenPacket: OpenPacket;
  onBrowseHome: () => void;
  onResumeDraft: (draftKey: `new-${string}`, intakeField?: PipelineWorkspaceLocation["intakeField"]) => void;
  onAcknowledgeAssignments: (ids: string[], through?: string) => Promise<void>;
  onSearch: () => void;
}) {
  const [showAllClients, setShowAllClients] = useState(false);
  const [showAssignments, setShowAssignments] = useState(false);
  const mine = briefing.workflow.board_items ?? briefing.workflow.active_items;
  const inProgress = mine.filter((item) => inProgressStates.has(item.assessment_state));
  const scheduled = mine.filter((item) => item.assessment_state === "scheduled");
  const toSchedule = mine.filter((item) => item.flow_state === "ready_to_schedule" && !inProgressStates.has(item.assessment_state) && item.assessment_state !== "scheduled");
  const other = mine.filter((item) => !inProgress.includes(item) && !scheduled.includes(item) && !toSchedule.includes(item));
  const appointments = new Map(briefing.upcoming.filter((event) => event.kind === "assessment").map((event) => [event.referralId, event]));
  const drafts = briefing.continuity.resume_items.filter((item) => item.draft_key);
  const count = inProgress.length + scheduled.length + toSchedule.length;
  const openAssessment = (item: ReferralWorklistItem, action: AssessmentEntryAction = "resume") =>
    onOpenPacket(selection(item), { view: "assessment" }, action);

  return (
    <div data-testid="mobile-assessor-home" className="pb-5 lg:hidden">
      <header className="flex items-center justify-between gap-3 border-b border-sheet-border pb-3 pt-2">
        <div>
          <p className="text-[11px] font-semibold text-ink-muted">Assigned to you</p>
          <h1 className="mt-0.5 text-[25px] font-bold tracking-[-0.04em] text-ink">My assessments</h1>
          <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-ink-muted">{count} to work on</p>
        </div>
        <button type="button" onClick={onSearch} aria-label="Search clients and files" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-control-border bg-paper text-link focus-visible:outline-2 focus-visible:outline-focus">
          <Search size={19} aria-hidden="true" />
        </button>
      </header>

      {briefing.unavailable_sections.includes("workflow") ? (
        <p role="status" className="mt-3 border-l-2 border-warning bg-warning-soft px-3 py-2.5 text-[12px] text-warning">
          Your client list could not refresh. Try again shortly.
        </p>
      ) : null}

      {briefing.continuity.new_assignments.length > 0 ? (
        <div className="mt-3">
          <button type="button" onClick={() => setShowAssignments((current) => !current)} aria-expanded={showAssignments} className="flex min-h-11 w-full items-center gap-2.5 rounded-sheet bg-primary-soft px-3 text-left text-[13px] font-semibold text-link focus-visible:outline-2 focus-visible:outline-focus">
            <UserPlus size={17} aria-hidden="true" />
            <span className="flex-1">{briefing.continuity.new_assignments.length} new assignment{briefing.continuity.new_assignments.length === 1 ? "" : "s"}</span>
            <span className="text-[12px]">{showAssignments ? "Hide" : "Review"}</span>
          </button>
          {showAssignments ? (
            <div className="mt-2">
              <SinceLastVisitAssignments items={briefing.continuity.new_assignments} unavailable={false} onOpenPacket={onOpenPacket} onAcknowledge={onAcknowledgeAssignments} />
            </div>
          ) : null}
        </div>
      ) : null}

      {inProgress.length > 0 ? (
        <section aria-label="Assessments in progress" className="mt-4">
          <SectionLabel>In progress</SectionLabel>
          <div className="space-y-2">
            {inProgress.map((item) => <InProgressCard key={item.referral_id} item={item} onOpen={() => openAssessment(item)} />)}
          </div>
        </section>
      ) : null}

      {scheduled.length > 0 ? (
        <section aria-label="Scheduled assessments" className="mt-5">
          <SectionLabel>Coming up</SectionLabel>
          <div className="divide-y divide-paper-rule border-y border-sheet-border">
            {scheduled.map((item) => (
              <AssessmentRow key={item.referral_id} item={item} detail={scheduleLabel(appointments.get(item.referral_id)?.startsAt, appointments.get(item.referral_id)?.date)} onOpen={() => openAssessment(item)} />
            ))}
          </div>
        </section>
      ) : null}

      {toSchedule.length > 0 ? (
        <section aria-label="Assessments to schedule" className="mt-5">
          <SectionLabel>To schedule</SectionLabel>
          <div className="divide-y divide-paper-rule border-y border-sheet-border">
            {toSchedule.map((item) => <AssessmentRow key={item.referral_id} item={item} detail={`${item.community} · Set assessment date`} onOpen={() => openAssessment(item, "schedule")} />)}
          </div>
        </section>
      ) : null}

      {count === 0 && !briefing.unavailable_sections.includes("workflow") ? (
        <div className="mt-4 flex items-start gap-3 rounded-sheet border border-sheet-border bg-paper px-4 py-4">
          <ClipboardList size={19} className="mt-0.5 shrink-0 text-link" aria-hidden="true" />
          <p className="text-[13px] leading-5 text-ink-muted">No assessments in progress or scheduled. Your other assigned clients are below.</p>
        </div>
      ) : null}

      {other.length > 0 ? (
        <section aria-label="Other assigned clients" className="mt-6">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Other assigned clients</h2>
            <span className="text-[12px] tabular-nums text-ink-muted">{other.length}</span>
          </div>
          <div className="divide-y divide-paper-rule border-y border-sheet-border">
            {(showAllClients ? other : other.slice(0, 4)).map((item) => (
              <button key={item.referral_id} type="button" onClick={() => onOpenPacket(selection(item), item.location)} className="flex min-h-[68px] w-full items-center justify-between gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-focus">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-ink">{clientName(item)}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{item.community} · {item.next_action}</span>
                </span>
                <ArrowRight size={17} className="shrink-0 text-link" aria-hidden="true" />
              </button>
            ))}
          </div>
          {other.length > 4 ? (
            <button type="button" onClick={() => setShowAllClients((current) => !current)} aria-expanded={showAllClients} className="mt-2 min-h-11 w-full text-left text-[13px] font-semibold text-link">
              {showAllClients ? "Show fewer" : `Show all ${other.length} clients`}
            </button>
          ) : null}
        </section>
      ) : null}

      {drafts.length > 0 ? <div className="mt-4"><ContinueWorkPanel items={drafts} unavailable={briefing.continuity.unavailable} onOpenPacket={onOpenPacket} onResumeDraft={onResumeDraft} /></div> : null}
      <button type="button" onClick={onBrowseHome} className="mt-5 flex min-h-11 w-full items-center justify-between border-t border-sheet-border pt-3 text-[13px] font-semibold text-link">
        View full Home <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted">{children}</h2>;
}

function InProgressCard({ item, onOpen }: { item: ReferralWorklistItem; onOpen: () => void }) {
  const readyToSign = item.assessment_state === "ready_to_sign";
  const status = readyToSign ? "Ready to sign" : item.assessment_state === "waiting_for_information" ? "Waiting for information" : "Interview in progress";
  return (
    <button type="button" onClick={onOpen} className="group w-full rounded-sheet border border-stage-green-border bg-paper px-4 py-3.5 text-left shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      <span className="block text-[11px] font-semibold text-link">{status}</span>
      <span className="mt-1 block truncate text-[18px] font-semibold tracking-[-0.025em] text-ink">{clientName(item)}</span>
      <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{item.community}</span>
      <span className="mt-3 flex items-center justify-between border-t border-paper-rule pt-2.5 text-[13px] font-semibold text-link">
        {readyToSign ? "Review assessment" : "Continue assessment"}
        <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </button>
  );
}

function AssessmentRow({ item, detail, onOpen }: { item: ReferralWorklistItem; detail: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[68px] w-full items-center gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-focus">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sheet bg-primary-soft text-link"><CalendarDays size={18} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">{clientName(item)}</span>
        <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{detail}</span>
      </span>
      <ArrowRight size={17} className="shrink-0 text-link" aria-hidden="true" />
    </button>
  );
}

function selection(item: ReferralWorklistItem) {
  return { id: item.referral_id, name: item.client_name, community: item.community as Referral["community"] };
}

function clientName(item: ReferralWorklistItem) {
  return formatClientIdentityTitle({ name: item.client_name, community: item.community });
}

function scheduleLabel(startsAt?: string, date?: string) {
  if (!startsAt && !date) return "Scheduled · Open assessment";
  const value = new Date(startsAt ?? `${date}T12:00:00`);
  if (!Number.isFinite(value.getTime())) return "Scheduled · Open assessment";
  return startsAt
    ? value.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : value.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

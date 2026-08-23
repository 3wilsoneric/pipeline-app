"use client";

import { ArrowRight, CircleAlert, RefreshCw } from "lucide-react";

import type { Referral } from "@/lib/pipeline/referral-types";
import type {
  ReferralWorklistBucket,
  ReferralWorklistItem,
  ReferralWorklistSnapshot,
} from "@/lib/pipeline/operations-types";
import {
  filterReferralWorklistItems,
  referralWorklistBuckets,
  referralWorklistCategoryLabel,
} from "@/lib/pipeline/referral-worklist-filter";

export default function ReferralActionWorklist({
  snapshot,
  selectedBucket,
  searchTerm,
  loading,
  error,
  onSelectBucket,
  onOpenPacket,
  onRetry,
}: {
  snapshot: ReferralWorklistSnapshot | null;
  selectedBucket: ReferralWorklistBucket;
  searchTerm: string;
  loading: boolean;
  error: string;
  onSelectBucket: (bucket: ReferralWorklistBucket) => void;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onRetry: () => void;
}) {
  const items = filterReferralWorklistItems(snapshot?.items ?? [], selectedBucket, searchTerm);

  return (
    <section aria-label="Referral action worklist" className="min-w-0 bg-white">
      <nav aria-label="Action categories" className="overflow-x-auto border-b border-[#d9d9d9]">
        <div className="grid min-w-[920px] grid-cols-8">
          {referralWorklistBuckets.map((bucket) => {
            const active = selectedBucket === bucket.value;
            const count = snapshot?.counts[bucket.value] ?? 0;
            return (
              <button
                key={bucket.value}
                type="button"
                aria-label={bucket.label}
                aria-pressed={active}
                onClick={() => onSelectBucket(bucket.value)}
                className={`flex h-12 min-w-0 items-center justify-center gap-1 border-b-2 px-1 text-[10px] font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] ${
                  active
                    ? "border-[#0f8b73] bg-[#f0f8f5] text-[#0c705f]"
                    : "border-transparent text-[#595959] hover:border-[#b8dacf] hover:text-[#111111]"
                }`}
              >
                <span className="text-center leading-3">{bucket.label}</span>
                <span aria-hidden="true" className={`min-w-4 shrink-0 px-1 py-0.5 text-center text-[9px] ${active ? "bg-white text-[#0c705f]" : "bg-[#f2f3f2] text-[#737373]"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {error ? (
        <div className="m-3 flex items-center justify-between gap-3 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-4 py-3 text-[12px] font-semibold text-[#59332d]" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="flex h-8 items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#a63d2f]">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : loading ? (
        <div className="px-5 py-16 text-center text-[13px] font-semibold text-[#737373]">Loading current work</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <div className="text-[15px] font-black text-[#111111]">
            {searchTerm.trim() ? "No work matches this search" : emptyLabel(selectedBucket)}
          </div>
          <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[#737373]">
            {searchTerm.trim()
              ? "Try a client, owner, community, stage, or next action."
              : "This view is derived from current referral, assessment, decision, document, and requirement data."}
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-[#e2e2e2] xl:hidden">
            {items.map((item) => (
              <CompactWorklistRow key={item.referral_id} item={item} onOpenPacket={onOpenPacket} />
            ))}
          </div>
          <div className="hidden overflow-x-auto xl:block">
            <div className="min-w-[1120px]">
            <div className="grid grid-cols-[minmax(190px,1fr)_minmax(240px,1.25fr)_minmax(190px,1fr)_125px_105px_110px_100px_36px] items-center border-b border-[#d9d9d9] bg-[#fafafa] px-4 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-[#737373]">
              <span>Client</span>
              <span>Next action</span>
              <span>Blockers / missing</span>
              <span>Owner</span>
              <span>Due</span>
              <span>Last activity</span>
              <span>Complete</span>
              <span className="sr-only">Open</span>
            </div>
            <div className="divide-y divide-[#e2e2e2]">
              {items.map((item) => (
                <WorklistRow key={item.referral_id} item={item} onOpenPacket={onOpenPacket} />
              ))}
            </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function CompactWorklistRow({
  item,
  onOpenPacket,
}: {
  item: ReferralWorklistItem;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenPacket({ id: item.referral_id, name: item.client_name, community: item.community })}
      aria-label={`Open ${item.client_name} referral workspace`}
      className="block w-full px-3 py-4 text-left transition-colors hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] sm:px-4"
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-black text-[#111111]">{item.client_name}</span>
          <span className="mt-1 block truncate text-[10px] text-[#737373]">{item.community}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={categoryClass(item.primary_category)}>{referralWorklistCategoryLabel(item.primary_category)}</span>
          <ArrowRight size={15} className="text-[#0f8b73]" />
        </span>
      </span>

      <span className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(180px,0.75fr)] sm:items-end">
        <span className="min-w-0">
          <span className="flex items-start gap-2 text-[11px] font-black text-[#111111]">
            {item.urgency !== "normal" ? <CircleAlert size={13} className={`mt-0.5 shrink-0 ${urgencyText(item.urgency)}`} /> : null}
            <span className="line-clamp-2">{item.next_action}</span>
          </span>
          <span className={`mt-1 block line-clamp-2 text-[9px] font-semibold ${item.blockers.length > 0 ? "text-[#a4473c]" : "text-[#737373]"}`}>
            {needsSummary(item)}
          </span>
        </span>

        <span>
          <span className="flex items-center justify-between gap-3 text-[10px]">
            <span className="font-black text-[#111111]">Complete</span>
            <span className="text-[#737373]">{item.completion_pct}%</span>
          </span>
          <span className="mt-1.5 block h-1.5 bg-[#e5e9e6]">
            <span className="block h-full bg-[#0f8b73]" style={{ width: `${item.completion_pct}%` }} />
          </span>
        </span>
      </span>

      <span className="mt-3 grid grid-cols-3 gap-3 border-t border-[#ececec] pt-2.5 text-[9px] text-[#737373]">
        <span className="min-w-0">
          <span className="block uppercase tracking-[0.06em]">Owner</span>
          <span className={`mt-1 block truncate text-[10px] font-semibold ${item.owner === "Unassigned" ? "text-[#a4473c]" : "text-[#404040]"}`}>{item.owner}</span>
        </span>
        <span>
          <span className="block uppercase tracking-[0.06em]">Due</span>
          <span className="mt-1 block text-[10px] font-semibold text-[#404040]">{dueOrAge(item)}</span>
        </span>
        <span>
          <span className="block uppercase tracking-[0.06em]">Activity</span>
          <span className="mt-1 block text-[10px] font-semibold text-[#404040]">{lastActivity(item.last_activity_at, item.age_hours)}</span>
        </span>
      </span>
    </button>
  );
}

function WorklistRow({
  item,
  onOpenPacket,
}: {
  item: ReferralWorklistItem;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenPacket({ id: item.referral_id, name: item.client_name, community: item.community })}
      aria-label={`Open ${item.client_name} referral workspace`}
      className="grid w-full grid-cols-[minmax(190px,1fr)_minmax(240px,1.25fr)_minmax(190px,1fr)_125px_105px_110px_100px_36px] items-center px-4 py-3 text-left hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73]"
    >
      <span className="min-w-0 pr-4">
        <span className="block truncate text-[12px] font-black text-[#111111]">{item.client_name}</span>
        <span className="mt-1 block truncate text-[10px] text-[#737373]">{item.community}</span>
      </span>

      <span className="min-w-0 pr-4">
        <span className="flex items-start gap-2 text-[11px] font-black text-[#111111]">
          {item.urgency !== "normal" ? <CircleAlert size={13} className={`mt-0.5 shrink-0 ${urgencyText(item.urgency)}`} /> : null}
          <span className="truncate">{item.next_action}</span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <span className={categoryClass(item.primary_category)}>{referralWorklistCategoryLabel(item.primary_category)}</span>
          {item.categories.length > 1 ? <span className="truncate text-[9px] text-[#737373]">+{item.categories.length - 1} need{item.categories.length === 2 ? "" : "s"}</span> : null}
        </span>
      </span>

      <span className="min-w-0 pr-4">
        <span className={`block truncate text-[10px] font-semibold ${item.blockers.length > 0 ? "text-[#a4473c]" : "text-[#595959]"}`}>
          {needsSummary(item)}
        </span>
        {item.blockers.length > 0 && item.missing_data.length > item.blockers.length ? (
          <span className="mt-1 block truncate text-[9px] text-[#737373]">
            {item.missing_data.length} incomplete items total
          </span>
        ) : null}
      </span>
      <span className={`truncate text-[10px] font-semibold ${item.owner === "Unassigned" ? "text-[#a4473c]" : "text-[#404040]"}`}>{item.owner}</span>
      <span className="text-[10px] text-[#595959]">{dueOrAge(item)}</span>
      <span className="text-[10px] text-[#595959]">{lastActivity(item.last_activity_at, item.age_hours)}</span>
      <span className="pr-4">
        <span className="flex items-center justify-between text-[10px]">
          <span className="font-black text-[#111111]">{item.completion_pct}%</span>
        </span>
        <span className="mt-1.5 block h-1.5 bg-[#e5e9e6]">
          <span className="block h-full bg-[#0f8b73]" style={{ width: `${item.completion_pct}%` }} />
        </span>
      </span>
      <span className="flex h-8 w-8 items-center justify-center text-[#0f8b73]"><ArrowRight size={15} /></span>
    </button>
  );
}

function emptyLabel(bucket: ReferralWorklistBucket) {
  if (bucket === "all_actionable") return "Nothing needs action";
  if (bucket === "unassigned") return "Every referral has an owner";
  if (bucket === "packet_review") return "No packets are waiting for review";
  if (bucket === "assessment_due") return "No assessments need completion";
  if (bucket === "decision_needed") return "No referrals need a decision";
  if (bucket === "missing_documents") return "No required documents are missing";
  return "No referrals are blocked";
}

function needsSummary(item: ReferralWorklistItem) {
  const needs = item.blockers.length > 0 ? item.blockers : item.missing_data;
  if (needs.length === 0) return "No recorded gap";
  const first = needs[0];
  return needs.length === 1 ? first : `${first} +${needs.length - 1}`;
}

function dueOrAge(item: ReferralWorklistItem) {
  if (!item.due_at) return "No due date";
  const due = new Date(item.due_at);
  if (Number.isNaN(due.getTime())) return ageLabel(item.age_hours);
  const overdue = due.getTime() < Date.now();
  return `${overdue ? "Overdue" : "Due"} ${due.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function lastActivity(value: string, fallbackHours: number) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return ageLabel(fallbackHours);
  const hours = Math.max(0, (Date.now() - timestamp.getTime()) / 36e5);
  return ageLabel(hours);
}

function ageLabel(hours: number) {
  if (hours < 1) return "Updated now";
  if (hours < 24) return `${Math.floor(hours)}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

function categoryClass(bucket: Exclude<ReferralWorklistBucket, "all_actionable">) {
  const shared = "inline-flex max-w-[145px] truncate border px-2 py-1 text-[9px] font-black uppercase";
  if (bucket === "blocked") return `${shared} border-[#d8aaa4] bg-[#fff3f1] text-[#8c392f]`;
  if (bucket === "unassigned") return `${shared} border-[#e0bc78] bg-[#fff9e8] text-[#745315]`;
  if (bucket === "decision_needed") return `${shared} border-[#c8b5df] bg-[#f6f0ff] text-[#60417d]`;
  if (bucket === "assessment_due") return `${shared} border-[#d8c58c] bg-[#fff9e8] text-[#745315]`;
  if (bucket === "missing_documents") return `${shared} border-[#b8c8da] bg-[#f2f6fb] text-[#415b78]`;
  return `${shared} border-[#8fc7b7] bg-[#effaf5] text-[#0f705d]`;
}

function urgencyText(urgency: ReferralWorklistItem["urgency"]) {
  return urgency === "overdue" || urgency === "blocked" ? "text-[#a4473c]" : "text-[#b07b21]";
}

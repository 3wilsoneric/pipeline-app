"use client";

import { ArrowRight, RotateCcw } from "lucide-react";

import type { HomeResumeItem } from "@/lib/pipeline/home-briefing-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { Referral } from "@/lib/pipeline/referral-types";

export default function ContinueWorkPanel({
  items,
  onOpenPacket,
  onResumeDraft,
}: {
  items: HomeResumeItem[];
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
  onResumeDraft: (draftKey: `new-${string}`, intakeField?: PipelineWorkspaceLocation["intakeField"]) => void;
}) {
  if (items.length === 0) return null;
  const [primary, ...secondary] = items;
  return (
    <section aria-label="Continue working" className="mt-3 border-y border-[#cfd8d4] bg-[#f7fbf9]">
      <button
        type="button"
        onClick={() => openResumeItem(primary, onOpenPacket, onResumeDraft)}
        className="group grid min-h-[72px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 text-left hover:bg-[#eef7f3] sm:px-4"
      >
        <RotateCcw size={17} className="text-[#0f8b73]" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#47766a]">Continue working</span>
          <span className="mt-1 block truncate text-[15px] font-black text-[#17211d]">{primary.client_name}</span>
          <span className="mt-0.5 block truncate text-[11px] font-semibold text-[#68716c]">{resumeMeta(primary)}</span>
        </span>
        <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.05em] text-[#0c705f]">
          Resume <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
      {secondary.length > 0 ? (
        <div className="grid border-t border-[#dbe4e0] sm:grid-cols-2">
          {secondary.slice(0, 2).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openResumeItem(item, onOpenPacket, onResumeDraft)}
              className="flex min-h-12 items-center justify-between gap-3 border-t border-[#e1e7e4] px-4 text-left first:border-t-0 hover:bg-white sm:border-l sm:border-t-0 sm:first:border-l-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-black text-[#25302b]">{item.client_name}</span>
                <span className="block truncate text-[9px] font-semibold text-[#737c77]">{resumeMeta(item)}</span>
              </span>
              <ArrowRight size={13} className="shrink-0 text-[#0f8b73]" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function openResumeItem(
  item: HomeResumeItem,
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void,
  onResumeDraft: (draftKey: `new-${string}`, intakeField?: PipelineWorkspaceLocation["intakeField"]) => void,
) {
  if (item.draft_key) {
    onResumeDraft(item.draft_key, item.location.intakeField);
    return;
  }
  if (!item.referral_id) return;
  onOpenPacket({
    id: item.referral_id,
    name: item.client_name,
    community: item.community as Referral["community"],
  }, item.location);
}

function resumeMeta(item: HomeResumeItem) {
  const progress = item.completed_fields !== undefined && item.total_fields
    ? ` · ${item.completed_fields}/${item.total_fields} fields`
    : "";
  return `${item.detail}${item.community ? ` · ${item.community}` : ""}${progress}`;
}

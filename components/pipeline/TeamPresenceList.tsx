"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";

type PresenceMember = WorkspaceMember & {
  presence_state: "editing" | "online" | "offline";
  editing_sections: string[];
};

type MemberResponse = {
  members: PresenceMember[];
  current_principal_id: string;
  authenticated_principal_id?: string;
};

export default function TeamPresenceList({ compact = false }: { compact?: boolean }) {
  const [payload, setPayload] = useState<MemberResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      fetchPipelineJson<MemberResponse>("/api/members?presence=1", { cache: "no-store" })
        .then((next) => {
          if (cancelled) return;
          setPayload(next);
          setUnavailable(false);
        })
        .catch(() => {
          if (!cancelled) setUnavailable(true);
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const activeMembers = useMemo(() => (payload?.members ?? [])
    .filter((member) => member.presence_state !== "offline")
    .sort((left, right) => presenceRank(left) - presenceRank(right)
      || Number(right.principal_id === activePrincipalId(payload)) - Number(left.principal_id === activePrincipalId(payload))
      || displayName(left).localeCompare(displayName(right))), [payload]);
  const visibleMembers = compact ? activeMembers.slice(0, 5) : activeMembers;

  return (
    <section aria-label="Team presence" className={compact ? "border-t border-[#e5e5e5] px-4 py-3" : "border border-[#d9dfdb] bg-white p-5"}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={compact ? "text-[10px] font-black uppercase tracking-[0.12em] text-[#595959]" : "text-[15px] font-black text-[#111111]"}>
          Active now
        </h2>
        <span className="text-[10px] font-bold text-[#737373]">{activeMembers.length}</span>
      </div>
      {visibleMembers.length > 0 ? (
        <div className={compact ? "mt-2 space-y-1" : "mt-4 divide-y divide-[#edf0ee]"}>
          {visibleMembers.map((member) => (
            <div key={member.principal_id} className={`flex items-center gap-3 ${compact ? "py-1" : "py-3 first:pt-0 last:pb-0"}`}>
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e7f3ee] text-[10px] font-black text-[#0f6f5d]">
                {initials(displayName(member))}
                <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#20a464]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-black text-[#222222]">
                  {displayName(member)}{member.principal_id === activePrincipalId(payload) ? " (you)" : ""}
                </span>
                <span className="mt-0.5 block truncate text-[9px] font-semibold text-[#5e746c]">
                  {presenceLabel(member)}
                </span>
              </span>
            </div>
          ))}
          {compact && activeMembers.length > visibleMembers.length ? (
            <div className="pt-1 text-[9px] font-bold text-[#737373]">+{activeMembers.length - visibleMembers.length} more active</div>
          ) : null}
        </div>
      ) : (
        <p className={`text-[#737373] ${compact ? "mt-2 text-[9px]" : "mt-3 text-[11px]"}`}>
          {unavailable ? "Presence is temporarily unavailable." : "No teammates are active right now."}
        </p>
      )}
    </section>
  );
}

function displayName(member: PresenceMember) {
  return member.profile.preferred_name || member.display_name;
}

function activePrincipalId(payload: MemberResponse | null) {
  return payload?.authenticated_principal_id ?? payload?.current_principal_id;
}

function presenceRank(member: PresenceMember) {
  return member.presence_state === "editing" ? 0 : 1;
}

function presenceLabel(member: PresenceMember) {
  if (member.presence_state !== "editing") return member.profile.status_message || "Online";
  const labels = [...new Set(member.editing_sections.map(editingSectionLabel))];
  if (labels.length === 0) return "Editing a workspace";
  if (labels.length === 1) return `Editing ${labels[0]}`;
  return `Editing ${labels.length} workspace areas`;
}

function editingSectionLabel(section: string) {
  if (section.startsWith("assessment:")) return "an assessment";
  if (section === "documents") return "documents";
  if (section === "decision") return "a decision";
  if (section === "workflow") return "workflow";
  if (section === "identity") return "client details";
  return section;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "?"}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}

"use client";

import { CalendarDays, FolderOpen, Plus, Search, UsersRound } from "lucide-react";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";

export type PipelineNavTarget = "referrals" | "calendar" | "profiles" | "packet" | null;

export default function PipelineActionNav({
  active = null,
  searchOpen = false,
  onOpenSearch,
  onNavigate,
}: {
  active?: PipelineNavTarget;
  searchOpen?: boolean;
  onOpenSearch: () => void;
  onNavigate: (target: Exclude<PipelineNavTarget, null>) => void;
}) {
  const navSize = "h-11 w-11 px-0 max-[359px]:h-9 max-[359px]:w-9 xl:h-[54px] xl:w-[168px] xl:px-3.5";
  const navItem =
    "group flex shrink-0 items-center justify-center gap-2.5 overflow-hidden rounded-lg border-2 outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";
  const labelClass = "hidden xl:inline";
  const inactiveSearch =
    "border-transparent bg-transparent text-[#8a5a10] hover:border-[#c4832c] hover:bg-[#fff3dc] hover:shadow-[0_4px_14px_rgba(196,131,44,0.14)]";
  const inactiveReferrals =
    "border-transparent bg-transparent hover:border-[#0f8b73] hover:bg-[#e7f3ee] hover:shadow-[0_4px_14px_rgba(15,139,115,0.14)]";
  const inactiveProfiles =
    "border-transparent bg-transparent hover:border-[#4b68ad] hover:bg-[#eef1ff] hover:shadow-[0_4px_14px_rgba(75,104,173,0.14)]";
  const inactivePacket =
    "border-transparent bg-transparent text-[#a9473d] hover:border-[#c85b4d] hover:bg-[#fff0ed] hover:shadow-[0_4px_14px_rgba(200,91,77,0.14)]";

  return (
    <nav
      aria-label="Primary navigation"
      className="flex flex-nowrap items-center gap-1.5 max-[359px]:gap-1 xl:gap-3"
    >
      <button
        type="button"
        aria-label={searchOpen ? "Close search" : "Open search"}
        aria-pressed={searchOpen}
        data-active={searchOpen ? "true" : undefined}
        title={searchOpen ? "Close search" : "Search"}
        onClick={() => {
          if (searchOpen) {
            onOpenSearch();
          } else {
            onOpenSearch();
          }
        }}
        className={`${navItem} ${navSize} ${
          searchOpen
            ? "border-[#c4832c] bg-[#fff3dc] text-[#8a5a10] shadow-[0_4px_14px_rgba(196,131,44,0.14)]"
            : inactiveSearch
        }`}
      >
        <Search size={20} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[12px] font-black uppercase tracking-[0.08em]`}>
          Search
        </span>
      </button>
      <button
        type="button"
        aria-label="Open referrals"
        aria-current={active === "referrals" ? "page" : undefined}
        data-active={active === "referrals" ? "true" : undefined}
        title="Workspaces"
        onClick={() => {
          recordRecentDestination({
            id: "page:referrals",
            kind: "page",
            screen: "referrals",
            title: "Workspaces",
            detail: "Client referral records",
          });
          onNavigate("referrals");
        }}
        className={`${navItem} ${navSize} text-[#0c705f] ${
          active === "referrals"
            ? "border-[#0f8b73] bg-[#e7f3ee] shadow-[0_4px_14px_rgba(15,139,115,0.14)]"
            : inactiveReferrals
        }`}
      >
        <FolderOpen size={20} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[12px] font-black uppercase tracking-[0.08em]`}>
          Workspaces
        </span>
      </button>
      <button
        type="button"
        aria-label="Open calendar"
        aria-current={active === "calendar" ? "page" : undefined}
        data-active={active === "calendar" ? "true" : undefined}
        title="Calendar"
        onClick={() => onNavigate("calendar")}
        className={`${navItem} ${navSize} text-[#176b78] ${
          active === "calendar"
            ? "border-[#27889a] bg-[#e9f7f9] shadow-[0_4px_14px_rgba(39,136,154,0.14)]"
            : "border-transparent bg-transparent hover:border-[#27889a] hover:bg-[#e9f7f9] hover:shadow-[0_4px_14px_rgba(39,136,154,0.14)]"
        }`}
      >
        <CalendarDays size={20} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[12px] font-black uppercase tracking-[0.08em]`}>Calendar</span>
      </button>
      <button
        type="button"
        aria-pressed={active === "profiles"}
        data-active={active === "profiles" ? "true" : undefined}
        onClick={() => {
          recordRecentDestination({
            id: "page:profiles",
            kind: "page",
            screen: "profiles",
            title: "Client profiles",
            detail: "Profile directory",
          });
          onNavigate("profiles");
        }}
        aria-label="Open client profiles"
        title="Client profiles"
        className={`${navItem} ${navSize} text-[#4b68ad] ${
          active === "profiles"
            ? "border-[#4b68ad] bg-[#eef1ff] shadow-[0_4px_14px_rgba(75,104,173,0.14)]"
            : inactiveProfiles
        }`}
      >
        <UsersRound size={20} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[12px] font-black uppercase tracking-[0.08em]`}>
          Clients
        </span>
      </button>
      <button
        type="button"
        aria-label="Create new referral"
        aria-current={active === "packet" ? "page" : undefined}
        data-active={active === "packet" ? "true" : undefined}
        title="New referral"
        onClick={() => {
          recordRecentDestination({
            id: "page:new-packet",
            kind: "page",
            screen: "packet",
            title: "New referral",
            detail: "Create a workspace",
          });
          onNavigate("packet");
        }}
        className={`${navItem} ${navSize} ${
          active === "packet"
            ? "border-[#c85b4d] bg-[#fff0ed] text-[#a9473d] shadow-[0_4px_14px_rgba(200,91,77,0.14)]"
            : inactivePacket
        }`}
      >
        <Plus size={21} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[12px] font-black uppercase tracking-[0.08em]`}>
          New referral
        </span>
      </button>
    </nav>
  );
}

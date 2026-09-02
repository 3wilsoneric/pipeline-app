"use client";

import { BarChart3, CalendarDays, FolderOpen, Plus, Search, UsersRound } from "lucide-react";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";

export type PipelineNavTarget = "referrals" | "calendar" | "profiles" | "operations" | "packet" | null;

export default function PipelineActionNav({
  active = null,
  searchOpen = false,
  showSearch = true,
  onOpenSearch,
  onNavigate,
}: {
  active?: PipelineNavTarget;
  searchOpen?: boolean;
  showSearch?: boolean;
  onOpenSearch: () => void;
  onNavigate: (target: Exclude<PipelineNavTarget, null>) => void;
}) {
  const utilitySize = "h-11 w-11 px-0 max-sm:h-9 max-sm:w-9 xl:h-[50px] xl:w-[50px]";
  const destinationSize = "h-11 w-11 px-0 max-sm:h-9 max-sm:w-9 md:w-[128px] md:px-3 xl:h-[50px] xl:w-[144px]";
  const navItem =
    "group flex shrink-0 items-center justify-center gap-2.5 overflow-hidden rounded-lg border-2 outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";
  const labelClass = "hidden md:inline";
  const inactiveSearch =
    "border-transparent bg-transparent text-[#8a5a10] hover:border-[#c4832c] hover:bg-[#fff3dc] hover:shadow-[0_4px_14px_rgba(196,131,44,0.14)]";
  const inactiveReferrals =
    "border-transparent bg-transparent hover:border-[#0f8b73] hover:bg-[#e7f3ee] hover:shadow-[0_4px_14px_rgba(15,139,115,0.14)]";
  const inactiveProfiles =
    "border-transparent bg-transparent hover:border-[#4b68ad] hover:bg-[#eef1ff] hover:shadow-[0_4px_14px_rgba(75,104,173,0.14)]";
  const inactivePacket =
    "border-transparent bg-transparent text-[#a9473d] hover:border-[#c85b4d] hover:bg-[#fff0ed] hover:shadow-[0_4px_14px_rgba(200,91,77,0.14)]";

  return (
    <div className="flex flex-nowrap items-center gap-1.5 max-sm:gap-1 xl:gap-2.5">
      <SearchNavigationButton
        visible={showSearch}
        searchOpen={searchOpen}
        onOpenSearch={onOpenSearch}
        className={`${navItem} ${utilitySize}`}
        inactiveClassName={inactiveSearch}
      />
      <nav aria-label="Primary navigation" className="flex flex-nowrap items-center gap-1.5 max-sm:gap-1 xl:gap-2.5">
        <button
          type="button"
          aria-label="Open referrals"
          data-guide-target="primary-workspaces"
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
          className={`${navItem} ${destinationSize} text-[#0c705f] ${
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
          data-guide-target="primary-calendar"
          aria-current={active === "calendar" ? "page" : undefined}
          data-active={active === "calendar" ? "true" : undefined}
          title="Calendar"
          onClick={() => onNavigate("calendar")}
          className={`${navItem} ${destinationSize} text-[#176b78] ${
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
          data-guide-target="primary-clients"
          title="Client profiles"
          className={`${navItem} ${destinationSize} text-[#4b68ad] ${
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
          aria-label="Open reports"
          data-guide-target="primary-reports"
          aria-current={active === "operations" ? "page" : undefined}
          data-active={active === "operations" ? "true" : undefined}
          title="Reports"
          onClick={() => {
            recordRecentDestination({
              id: "page:operations",
              kind: "page",
              screen: "operations",
              title: "Reports",
              detail: "Referral and assessment reports",
            });
            onNavigate("operations");
          }}
          className={`${navItem} ${destinationSize} text-[#59652d] ${
            active === "operations"
              ? "border-[#7d8b3f] bg-[#f4f6e8] shadow-[0_4px_14px_rgba(125,139,63,0.14)]"
              : "border-transparent bg-transparent hover:border-[#7d8b3f] hover:bg-[#f4f6e8] hover:shadow-[0_4px_14px_rgba(125,139,63,0.14)]"
          }`}
        >
          <BarChart3 size={20} className="shrink-0" />
          <span className={`${labelClass} whitespace-nowrap text-[12px] font-black uppercase tracking-[0.08em]`}>Reports</span>
        </button>
      </nav>
      <button
        type="button"
        aria-label="Create new referral"
        data-guide-target="primary-new-referral"
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
        className={`${navItem} ${utilitySize} ${
          active === "packet"
            ? "border-[#c85b4d] bg-[#fff0ed] text-[#a9473d] shadow-[0_4px_14px_rgba(200,91,77,0.14)]"
            : inactivePacket
        }`}
      >
        <Plus size={21} className="shrink-0" />
      </button>
    </div>
  );
}

function SearchNavigationButton({
  visible,
  searchOpen,
  onOpenSearch,
  className,
  inactiveClassName,
}: {
  visible: boolean;
  searchOpen: boolean;
  onOpenSearch: () => void;
  className: string;
  inactiveClassName: string;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      aria-label={searchOpen ? "Close search" : "Open search"}
      aria-pressed={searchOpen}
      data-active={searchOpen ? "true" : undefined}
      title={searchOpen ? "Close search" : "Search"}
      onClick={onOpenSearch}
      className={`${className} ${searchOpen ? "border-[#c4832c] bg-[#fff3dc] text-[#8a5a10] shadow-[0_4px_14px_rgba(196,131,44,0.14)]" : inactiveClassName}`}
    >
      <Search size={20} className="shrink-0" />
    </button>
  );
}

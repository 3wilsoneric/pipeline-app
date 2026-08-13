"use client";

import Link from "next/link";
import { FolderOpen, Plus, Search, UsersRound } from "lucide-react";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";

export type PipelineNavTarget = "referrals" | "profiles" | "packet" | null;

export default function PipelineActionNav({
  active = null,
  searchOpen = false,
  size = "default",
  onOpenProfiles,
  onOpenSearch,
  onNavigate,
}: {
  active?: PipelineNavTarget;
  searchOpen?: boolean;
  size?: "default" | "welcome";
  onOpenProfiles: () => void;
  onOpenSearch: () => void;
  onNavigate?: () => void;
}) {
  const handleNavigation = () => {
    onNavigate?.();
  };
  const welcome = size === "welcome";
  const navSize = welcome
    ? "h-14 min-w-[148px] px-3 sm:h-[68px] sm:w-[198px] sm:px-3.5"
    : "h-11 w-11 px-0 sm:h-[54px] sm:w-[168px] sm:px-3.5";
  const navItem =
    "group flex shrink-0 items-center justify-center gap-2.5 overflow-hidden rounded-lg border-2 outline-none transition-[background-color,border-color,box-shadow,color] duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";
  const labelClass = welcome ? "inline" : "hidden sm:inline";
  const inactiveSearch =
    "border-transparent bg-transparent shadow-none hover:border-[#c4832c] hover:bg-[#fff3dc] hover:shadow-[0_4px_14px_rgba(196,131,44,0.14)]";
  const inactiveReferrals =
    "border-transparent bg-transparent shadow-none hover:border-[#0f8b73] hover:bg-[#e7f3ee] hover:shadow-[0_4px_14px_rgba(15,139,115,0.14)]";
  const inactiveProfiles =
    "border-transparent bg-transparent shadow-none hover:border-[#4b68ad] hover:bg-[#eef1ff] hover:shadow-[0_4px_14px_rgba(75,104,173,0.14)]";
  const inactivePacket =
    "border-transparent bg-transparent shadow-none hover:border-[#c85b4d] hover:bg-[#fff0ed] hover:shadow-[0_4px_14px_rgba(200,91,77,0.14)]";

  return (
    <nav
      aria-label="Primary navigation"
      className={welcome ? "grid grid-cols-2 gap-2 sm:flex sm:flex-nowrap sm:items-center sm:gap-3" : "flex flex-nowrap items-center gap-1 sm:gap-3"}
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
            handleNavigation();
            onOpenSearch();
          }
        }}
        className={`${navItem} ${navSize} text-[#8a5a10] ${
          searchOpen
            ? "border-[#c4832c] bg-[#fff3dc] shadow-[0_4px_14px_rgba(196,131,44,0.14)]"
            : inactiveSearch
        }`}
      >
        <Search size={20} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[10px] font-black uppercase tracking-[0.1em] sm:text-[12px]`}>
          Search
        </span>
      </button>
      <Link
        href="/?view=referrals"
        aria-label="Open referrals"
        aria-current={active === "referrals" ? "page" : undefined}
        data-active={active === "referrals" ? "true" : undefined}
        title="Referrals"
        onPointerEnter={preloadReferrals}
        onFocus={preloadReferrals}
        onClick={() => {
          handleNavigation();
          recordRecentDestination({
            id: "page:referrals",
            kind: "page",
            screen: "referrals",
            title: "Referrals",
            detail: "Referral packets",
          });
        }}
        className={`${navItem} ${navSize} text-[#0c705f] ${
          active === "referrals"
            ? "border-[#0f8b73] bg-[#e7f3ee] shadow-[0_4px_14px_rgba(15,139,115,0.14)]"
            : inactiveReferrals
        }`}
      >
        <FolderOpen size={20} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[10px] font-black uppercase tracking-[0.1em] sm:text-[12px]`}>
          Referrals
        </span>
      </Link>
      <button
        type="button"
        aria-pressed={active === "profiles"}
        data-active={active === "profiles" ? "true" : undefined}
        onClick={() => {
          handleNavigation();
          recordRecentDestination({
            id: "page:profiles",
            kind: "page",
            screen: "profiles",
            title: "Client profiles",
            detail: "Profile directory",
          });
          onOpenProfiles();
        }}
        aria-label="Open client profiles"
        title="Client profiles"
        onPointerEnter={preloadProfiles}
        onFocus={preloadProfiles}
        className={`${navItem} ${navSize} text-[#4b68ad] ${
          active === "profiles"
            ? "border-[#4b68ad] bg-[#eef1ff] shadow-[0_4px_14px_rgba(75,104,173,0.14)]"
            : inactiveProfiles
        }`}
      >
        <UsersRound size={20} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[10px] font-black uppercase tracking-[0.1em] sm:text-[12px]`}>
          Profiles
        </span>
      </button>
      <Link
        href="/?view=referrals&screen=packet"
        aria-label="Create new packet"
        aria-current={active === "packet" ? "page" : undefined}
        data-active={active === "packet" ? "true" : undefined}
        title="New packet"
        onPointerEnter={preloadPacketCanvas}
        onFocus={preloadPacketCanvas}
        onClick={() => {
          handleNavigation();
          recordRecentDestination({
            id: "page:new-packet",
            kind: "page",
            screen: "packet",
            title: "New referral packet",
            detail: "Create a packet",
          });
        }}
        className={`${navItem} ${navSize} text-[#a9473d] ${
          active === "packet"
            ? "border-[#c85b4d] bg-[#fff0ed] shadow-[0_4px_14px_rgba(200,91,77,0.14)]"
            : inactivePacket
        }`}
      >
        <Plus size={21} className="shrink-0" />
        <span className={`${labelClass} whitespace-nowrap text-[10px] font-black uppercase tracking-[0.1em] sm:text-[12px]`}>
          New packet
        </span>
      </Link>
    </nav>
  );
}

function preloadReferrals() {
  void import("@/components/pipeline/ReferralHome").catch(() => undefined);
}

function preloadProfiles() {
  void import("@/components/pipeline/ClientProfileDirectory").catch(() => undefined);
}

function preloadPacketCanvas() {
  void import("@/components/pipeline/ReferralPacketCanvas").catch(() => undefined);
}

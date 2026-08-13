"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Activity, ArrowRight, LogOut, UserRound } from "lucide-react";

import PipelineActionNav, { type PipelineNavTarget } from "@/components/pipeline/PipelineActionNav";
import UserAvatar from "@/components/pipeline/UserAvatar";
import { fetchCurrentPipelineUser, type PipelineCurrentUser } from "@/lib/auth/authenticated-fetch";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { getAccountDisplayName } from "@/lib/auth/entra-client";
import { usePipelineAuth } from "@/components/auth/PipelineAuthProvider";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";

export default function PipelineHeader() {
  const [user, setUser] = useState<PipelineCurrentUser | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const auth = usePipelineAuth();
  const { searchOpen, setSearchOpen, homeMode, setHomeMode } = usePipelineShell();
  const [manualRouteSearch, setManualRouteSearch] = useState<string | null>(null);
  // Search is a temporary mode. While it is open, it owns the expanded slot
  // so the page we came from collapses immediately instead of competing with it.
  const effectiveSearchParams = manualRouteSearch === null ? searchParams : new URLSearchParams(manualRouteSearch);
  const activeNav = searchOpen ? null : getActiveNavTarget(effectiveSearchParams, pathname);

  useEffect(() => {
    setManualRouteSearch(searchParams.toString());
  }, [searchParams]);

  useEffect(() => {
    const syncFromLocation = () => setManualRouteSearch(window.location.search);
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchCurrentPipelineUser()
      .then((payload) => {
        if (!cancelled) setUser(payload?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsProfileMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isProfileMenuOpen]);

  const signedInName = user?.name || (auth.account ? getAccountDisplayName(auth.account) : "Eric Wilson");
  const signedInInitials = getInitials(signedInName);
  const operationsActive = effectiveSearchParams.get("screen") === "operations";

  // The nav remains visible on work surfaces even when every item is compact.
  // Home is the only screen that omits the header home tile.
  const isHomeRoute = !effectiveSearchParams.get("view") && !effectiveSearchParams.get("screen");
  const showHomeTile = !isHomeRoute || homeMode === "workspace" || searchOpen;
  const showHeaderNav = showHomeTile || searchOpen;

  return (
    <header className="relative flex h-[82px] shrink-0 items-center overflow-visible bg-white px-3 sm:px-5 md:px-8">
      {showHomeTile ? (
        <div className="relative z-10 flex shrink-0 items-center">
          <Link
            href="/"
            onClick={(event) => {
              event.preventDefault();
              setSearchOpen(false);
              setHomeMode("workspace");
              window.history.pushState({}, "", "/");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            aria-label="Pipeline"
            title="Home"
            className="flex h-10 items-center whitespace-nowrap px-1 text-[14px] font-black tracking-[0.1em] text-[#0c705f] outline-none transition-colors hover:text-[#095a4c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:text-[17px] sm:tracking-[0.12em]"
          >
            PIPELINE
          </Link>
          <span aria-hidden="true" className="ml-2 h-7 w-px bg-[#d9d9d9] sm:ml-4" />
        </div>
      ) : null}

      {showHeaderNav ? (
        <div className={`pipeline-nav-dock-enter min-w-0 flex-1 overflow-x-auto ${showHomeTile ? "ml-2 sm:ml-6" : "ml-0"}`}>
          <div className="pointer-events-auto w-max">
            <PipelineActionNav
              active={activeNav}
              searchOpen={searchOpen}
              onOpenProfiles={() => {
                setSearchOpen(false);
                window.history.pushState({}, "", "/?screen=profiles");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              onOpenSearch={() => setSearchOpen((current) => !current)}
              onNavigate={() => setSearchOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="relative z-10 ml-auto flex items-center">
        <div ref={profileMenuRef} className="relative">
          <button
            type="button"
            aria-label={`Open profile menu for ${signedInName}`}
            aria-expanded={isProfileMenuOpen}
            aria-haspopup="dialog"
            title={user ? `${user.name} · ${user.email}` : signedInName}
            data-profile-scope="signed-in-user"
            onClick={() => setIsProfileMenuOpen((open) => !open)}
            className="flex h-10 max-w-[190px] shrink-0 items-center gap-2 rounded-md border border-transparent px-2 text-[#595959] outline-none transition-colors hover:bg-[#f7faf9] hover:text-[#111111] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 aria-expanded:border-[#b8dacf] aria-expanded:bg-[#effaf5]"
          >
            <UserRound size={18} strokeWidth={1.8} className="shrink-0 text-[#0f8b73]" />
            <span className="hidden truncate text-[12px] font-black uppercase tracking-[0.1em] xl:inline">{signedInName}</span>
          </button>

          {isProfileMenuOpen ? (
            <div
              role="dialog"
              aria-label="Profile menu"
              className="absolute right-0 top-[calc(100%+10px)] z-50 w-[320px] overflow-hidden rounded-md border border-[#d9d9d9] bg-white shadow-[0_16px_36px_rgba(17,17,17,0.14)]"
            >
              <div className="flex items-center gap-3 px-4 py-4">
                <UserAvatar size="md" initials={signedInInitials} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-black text-[#111111]">{signedInName}</div>
                  <div className="truncate text-[11px] text-[#737373]">{user?.email ?? "Signed in to Pipeline"}</div>
                </div>
              </div>
              <div className="border-t border-[#e5e5e5] px-3 py-3">
                <Link
                  href="/?screen=operations"
                  aria-current={operationsActive ? "page" : undefined}
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    recordRecentDestination({
                      id: "page:operations",
                      kind: "page",
                      screen: "operations",
                      title: "Operations",
                      detail: "Queue, ownership, and data gaps",
                    });
                  }}
                  className={`group flex items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
                    operationsActive
                      ? "border-[#0f8b73] bg-[#e7f3ee]"
                      : "border-[#b8dacf] bg-[#f4faf7] hover:border-[#0f8b73] hover:bg-[#e7f3ee]"
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#b8dacf] bg-white text-[#0f8b73]">
                    <Activity size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-black text-[#111111]">Operations</span>
                    <span className="mt-0.5 block text-[11px] text-[#595959]">Queue, ownership, and data gaps</span>
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-[#0f8b73] transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
              {auth.required ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    void auth.signOut();
                  }}
                  className="flex w-full items-center gap-2 border-t border-[#e5e5e5] px-4 py-3 text-left text-[#737373] hover:bg-[#fff8ed] hover:text-[#9b6418]"
                >
                  <LogOut size={15} />
                  <span className="text-[12px] font-black">Sign out</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function getActiveNavTarget(searchParams: URLSearchParams, pathname: string): PipelineNavTarget {
  if (searchParams.get("screen") === "packet") return "packet";
  if (pathname === "/referrals") return "referrals";
  if (searchParams.get("screen") === "referrals" || searchParams.get("view") === "referrals") return "referrals";
  if (searchParams.get("screen") === "profiles" || searchParams.get("screen") === "profile") return "profiles";
  return null;
}

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials || "EW";
}

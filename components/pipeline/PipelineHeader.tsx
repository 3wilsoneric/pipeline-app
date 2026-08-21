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
import { pushPipelineHistory, usePipelineLocationSearch } from "@/lib/pipeline/client-navigation";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";

export default function PipelineHeader() {
  const [user, setUser] = useState<PipelineCurrentUser | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSearchParams = new URLSearchParams(usePipelineLocationSearch(searchParams.toString()));
  const auth = usePipelineAuth();
  const { searchOpen, setSearchOpen, setHomeMode } = usePipelineShell();
  const activeNav = searchOpen ? null : getActiveNavTarget(activeSearchParams, pathname);

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
  const operationsActive = activeSearchParams.get("screen") === "operations";

  const navigateTo = (target: "home" | Exclude<PipelineNavTarget, null> | "operations") => {
    setSearchOpen(false);
    setHomeMode("workspace");
    const destination = target === "referrals"
      ? "/?view=referrals"
      : target === "profiles"
        ? "/?screen=profiles"
        : target === "packet"
          ? "/?view=referrals&screen=packet"
          : target === "operations"
            ? "/?screen=operations"
            : "/";
    pushPipelineHistory(destination);
  };

  return (
    <header className="relative flex h-[82px] shrink-0 items-center overflow-visible bg-white px-4 sm:px-6 lg:px-8">
      <div className="relative z-10 flex shrink-0 items-center">
        <div
          role="img"
          aria-label="Alamo Platform"
          data-platform-brand="alamo"
          className="flex h-12 cursor-default items-center gap-2 whitespace-nowrap text-[17px] font-semibold text-[#595959]"
        >
          <span className="hidden sm:inline"><span className="font-black text-[#08745f]">Alamo</span><span className="ml-1">Health</span></span>
        </div>
        <span aria-hidden="true" className="mx-4 hidden h-8 w-px bg-[#d9d9d9] sm:block" />
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            navigateTo("home");
          }}
          aria-label="Pipeline home"
          title="Pipeline home"
          data-pipeline-home="true"
          data-platform-page-active="pipeline"
          className="flex h-12 items-center whitespace-nowrap px-1 text-[16px] font-black text-[#111111] outline-none hover:text-[#0f8b73] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]"
        >
          Pipeline
        </button>
      </div>

      <div className="pipeline-nav-dock-enter ml-3 min-w-0 flex-1 overflow-x-auto overflow-y-hidden py-3 sm:ml-6">
        <div className="pointer-events-auto w-max">
          <PipelineActionNav
            active={activeNav}
            searchOpen={searchOpen}
            onOpenSearch={() => setSearchOpen((current) => !current)}
            onNavigate={navigateTo}
          />
        </div>
      </div>

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
            className="flex h-12 max-w-[190px] shrink-0 items-center gap-2 rounded-md border border-transparent px-3 text-[#595959] outline-none transition-colors hover:bg-[#f7faf9] hover:text-[#111111] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 aria-expanded:border-[#b8dacf] aria-expanded:bg-[#effaf5]"
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
                  onClick={(event) => {
                    event.preventDefault();
                    setIsProfileMenuOpen(false);
                    recordRecentDestination({
                      id: "page:operations",
                      kind: "page",
                      screen: "operations",
                      title: "Pipeline operations",
                      detail: "Queue, ownership, and record gaps",
                    });
                    navigateTo("operations");
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
                    <span className="block text-[13px] font-black text-[#111111]">Pipeline operations</span>
                    <span className="mt-0.5 block text-[11px] text-[#595959]">Queue, ownership, and record gaps</span>
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

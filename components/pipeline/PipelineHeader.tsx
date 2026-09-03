"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CircleHelp, GraduationCap, LogOut, Trash2, UserRound } from "lucide-react";

import PipelineActionNav, { type PipelineNavTarget } from "@/components/pipeline/PipelineActionNav";
import PipelineLogoMark from "@/components/pipeline/PipelineLogoMark";
import { fetchCurrentPipelineUser, type PipelineCurrentUser } from "@/lib/auth/authenticated-fetch";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { getAccountDisplayName } from "@/lib/auth/entra-client";
import { usePipelineAuth } from "@/components/auth/PipelineAuthProvider";
import { pushPipelineHistory, usePipelineLocationSearch } from "@/lib/pipeline/client-navigation";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { dispatchOperatorGuide } from "@/lib/training/operator-guided-tour-state";

export default function PipelineHeader() {
  const [user, setUser] = useState<PipelineCurrentUser | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const pathname = normalizePathname(usePathname());
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSearchParams = new URLSearchParams(usePipelineLocationSearch(searchParamsText(searchParams)));
  const auth = usePipelineAuth();
  const { homeMode, searchOpen, setSearchOpen, setHomeMode } = usePipelineShell();
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
  const trashActive = activeSearchParams.get("screen") === "trash";
  const isWelcomeSurface = homeMode === "welcome"
    && pathname === "/"
    && activeNav === null
    && !searchOpen;
  const hideGlobalGuide = pathname === "/note-lab" || pathname.startsWith("/note-lab/");

  const navigateTo = (target: "home" | Exclude<PipelineNavTarget, null> | "operations" | "trash") => {
    setSearchOpen(false);
    setHomeMode("workspace");
    const destination = target === "referrals"
      ? "/?view=referrals"
      : target === "calendar"
        ? "/?screen=calendar"
      : target === "profiles"
        ? "/?screen=profiles"
        : target === "packet"
          ? `/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}`
          : target === "operations"
            ? "/?screen=operations"
            : target === "trash"
              ? "/?screen=trash"
            : "/";
    navigatePipelineDestination(pathname, destination, router);
  };

  return (
    <header className="relative flex h-[68px] shrink-0 items-center overflow-visible bg-white px-3 max-[359px]:px-1 sm:h-[74px] sm:px-5 lg:px-6 xl:h-[82px] xl:px-8">
      <div className="relative z-10 flex shrink-0 items-center">
        <div
          role={isWelcomeSurface ? "img" : undefined}
          aria-label={isWelcomeSurface ? "Alamo Platform" : undefined}
          aria-hidden={!isWelcomeSurface}
          data-platform-brand="alamo"
          className={`flex h-12 cursor-default items-center gap-2 overflow-hidden whitespace-nowrap text-[17px] font-semibold text-[#595959] transition-[max-width,opacity] duration-300 ease-out motion-reduce:transition-none ${
            isWelcomeSurface ? "max-w-[128px] opacity-100" : "pointer-events-none max-w-0 opacity-0"
          }`}
        >
          <span className="hidden sm:inline"><span className="font-black text-[#08745f]">Alamo</span><span className="ml-1">Health</span></span>
        </div>
        <span
          aria-hidden="true"
          className={`hidden h-8 bg-[#d9d9d9] transition-[width,margin,opacity] duration-300 ease-out motion-reduce:transition-none sm:block ${
            isWelcomeSurface ? "mx-4 w-px opacity-100" : "mx-0 w-0 opacity-0"
          }`}
        />
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            navigateTo("home");
          }}
          aria-label="Pipeline home"
          title="Pipeline home"
          data-pipeline-home="true"
          data-guide-target="pipeline-home"
          data-platform-page-active="pipeline"
          className="flex h-12 w-[72px] items-center justify-center outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] max-sm:h-9 max-sm:w-9 min-[360px]:max-sm:w-10"
        >
          <PipelineLogoMark size={32} />
        </button>
      </div>

      <div data-testid="primary-navigation-dock" className="pipeline-nav-dock-enter ml-2 min-w-0 flex-1 overflow-x-auto overflow-y-hidden py-2 max-sm:ml-0.5 sm:ml-4 lg:ml-5 xl:ml-6 xl:py-3">
        <div className="pointer-events-auto w-max">
          <PipelineActionNav
            active={activeNav}
            searchOpen={searchOpen}
            showSearch={pathname === "/"}
            onOpenSearch={() => setSearchOpen((current) => !current)}
            onNavigate={navigateTo}
          />
        </div>
      </div>

      <div className="relative z-10 ml-auto flex items-center">
        {!hideGlobalGuide ? (
          <button
            type="button"
            aria-label="Open guided tutorials"
            title="Guided tutorials"
            data-guide-target="guided-help"
            onClick={() => dispatchOperatorGuide({ type: "open-library" })}
            className="mr-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-[#0f8b73] outline-none hover:bg-[#eff8f5] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 min-[360px]:flex sm:h-12 sm:w-10"
          >
            <CircleHelp size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
        <div ref={profileMenuRef} className="relative">
          <button
            type="button"
            aria-label={`Open profile menu for ${signedInName}`}
            aria-expanded={isProfileMenuOpen}
            aria-haspopup="dialog"
            title={user ? `${user.name} · ${user.email}` : signedInName}
            data-profile-scope="signed-in-user"
            data-guide-target="profile-menu"
            onClick={() => setIsProfileMenuOpen((open) => !open)}
            className="flex h-12 max-w-[190px] shrink-0 items-center gap-2 rounded-md border border-transparent px-3 text-[#595959] outline-none transition-colors hover:bg-[#f7faf9] hover:text-[#111111] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 aria-expanded:border-[#b8dacf] aria-expanded:bg-[#effaf5] max-sm:h-9 max-sm:w-9 max-sm:justify-center max-sm:px-0"
          >
            <UserRound size={18} strokeWidth={1.8} className="shrink-0 text-[#0f8b73]" />
            <span className="hidden truncate text-[12px] font-black uppercase tracking-[0.1em] xl:inline">{signedInName}</span>
          </button>

          {isProfileMenuOpen ? (
            <div
              role="dialog"
              aria-label="Profile menu"
              data-profile-menu="true"
              className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(304px,calc(100vw-2rem))] overflow-hidden rounded-sm border border-[#cfcfcf] border-t-[3px] border-t-[#0f8b73] bg-white shadow-[0_10px_24px_rgba(17,17,17,0.12)]"
            >
              <div className="flex min-h-[78px] items-center gap-3 px-4 py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[#b8dacf] bg-[#f4faf7] text-[#0f8b73]">
                  <UserRound size={20} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-black text-[#111111]">{signedInName}</div>
                  <div className="mt-1 truncate text-[11px] text-[#737373]">{user?.email ?? "Signed in to Pipeline"}</div>
                </div>
              </div>
              <ProfileLearningLink active={pathname === "/training"} onSelect={() => setIsProfileMenuOpen(false)} />
              {user?.roles.some((role) => ["admin", "assessment_coordinator", "reviewer"].includes(role)) ? (
                <button
                  type="button"
                  aria-current={trashActive ? "page" : undefined}
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    navigateTo("trash");
                  }}
                  className={`grid min-h-[52px] w-full grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-3 border-b border-l-[3px] border-b-[#e5e5e5] px-4 py-2.5 text-left outline-none transition-colors ${trashActive ? "border-l-[#a9473d] bg-[#fff3f1]" : "border-l-transparent hover:border-l-[#a9473d] hover:bg-[#fff3f1]"}`}
                >
                  <Trash2 size={17} strokeWidth={1.8} className="text-[#a9473d]" aria-hidden="true" />
                  <span><span className="block text-[11px] font-black text-[#111111]">Trash</span><span className="mt-0.5 block text-[9px] text-[#737373]">Restore deleted workspaces</span></span>
                  <ArrowRight size={14} className="text-[#a9473d]" aria-hidden="true" />
                </button>
              ) : null}
              {auth.required ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    void auth.signOut();
                  }}
                  className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-[#737373] outline-none transition-colors hover:bg-[#fff8ed] hover:text-[#8a5a10] focus-visible:bg-[#fff8ed] focus-visible:text-[#8a5a10]"
                >
                  <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span className="text-[11px] font-black">Sign out</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function normalizePathname(pathname: string | null) {
  return pathname || "/";
}

function searchParamsText(searchParams: { toString(): string } | null) {
  return searchParams ? searchParams.toString() : "";
}

function ProfileLearningLink({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  return <Link href="/training" aria-label="Learning Center Guided walkthroughs and common tasks" aria-current={active ? "page" : undefined} onClick={onSelect} className={`group grid min-h-[64px] grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-3 border-y border-[#e5e5e5] border-l-[3px] px-4 py-3 text-left outline-none transition-colors focus-visible:bg-[#edf7f3] ${active ? "border-l-[#0f8b73] bg-[#edf7f3]" : "border-l-transparent hover:border-l-[#0f8b73] hover:bg-[#f7faf9]"}`}><GraduationCap size={18} strokeWidth={1.8} className="text-[#0f8b73]" aria-hidden="true" /><span className="min-w-0"><span className="block text-[12px] font-black text-[#111111]">Learning Center</span><span className="mt-0.5 block text-[10px] leading-4 text-[#737373]">Walkthroughs and common tasks</span></span><ArrowRight size={15} className="text-[#0f8b73] transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></Link>;
}

function navigatePipelineDestination(
  pathname: string,
  destination: string,
  router: ReturnType<typeof useRouter>,
) {
  if (pathname === "/") pushPipelineHistory(destination);
  else router.push(toPipelinePath(destination), { scroll: false });
}

function getActiveNavTarget(searchParams: URLSearchParams, pathname: string): PipelineNavTarget {
  if (searchParams.get("screen") === "packet") {
    return searchParams.has("referralId") ? "referrals" : "packet";
  }
  if (searchParams.get("screen") === "calendar") return "calendar";
  if (pathname === "/referrals") return "referrals";
  if (searchParams.get("screen") === "referrals" || searchParams.get("view") === "referrals") return "referrals";
  if (searchParams.get("screen") === "profiles" || searchParams.get("screen") === "profile") return "profiles";
  if (searchParams.get("screen") === "operations") return "operations";
  return null;
}

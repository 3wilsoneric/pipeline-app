"use client";

import { canEditWorkspace } from "@/lib/pipeline/referral-ownership";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CircleHelp, FlaskConical, ListTodo, LogOut, MoreHorizontal, Settings, Trash2, UserRound, X } from "lucide-react";

import { ActiveAssessorSessionPill, AssessorSessionMenuAction } from "@/components/pipeline/AssessorSessionControl";
import PipelineActionNav, { type PipelineNavTarget } from "@/components/pipeline/PipelineActionNav";
import PipelineLogoMark from "@/components/pipeline/PipelineLogoMark";
import { fetchCurrentPipelineUser, type PipelineCurrentUser } from "@/lib/auth/authenticated-fetch";
import { pipelinePageHeaders } from "@/lib/auth/browser-session";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { getAccountDisplayName } from "@/lib/auth/entra-client";
import { usePipelineAuth } from "@/components/auth/PipelineAuthProvider";
import { pushPipelineHistory, usePipelineLocationSearch } from "@/lib/pipeline/client-navigation";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { canAccessOperationsReports } from "@/lib/pipeline/report-access";
import { dispatchOperatorGuide } from "@/lib/training/operator-guided-tour-state";
import DemoPersonaSwitch from "@/components/pipeline/DemoPersonaSwitch";
import DemoAssessmentLabButton from "@/components/pipeline/DemoAssessmentLabButton";
import sidebarStyles from "@/components/pipeline/PipelineMobileShell.module.css";
import PipelinePhoneNotifications from "@/components/pipeline/PipelinePhoneNotifications";
import { applyPipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";

export default function PipelineHeader({ onDestinationChange, phone = false }: { onDestinationChange: () => void; phone?: boolean }) {
  const phoneMenuRef = useRef<HTMLDialogElement>(null);
  const auth = usePipelineAuth();
  const [user, setUser] = useState<PipelineCurrentUser | null>(auth.initialUser);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const pathname = normalizePathname(usePathname());
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationSearch = usePipelineLocationSearch(searchParamsText(searchParams));
  const activeSearchParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const { searchOpen, setSearchOpen, setHomeMode, beforeNavigationRef } = usePipelineShell();
  const activeNav = searchOpen ? null : getActiveNavTarget(activeSearchParams, pathname);
  const canAccessReports = canAccessOperationsReports(user);
  useWorkspacePresenceHeartbeat(Boolean(user));
  useEffect(() => { phoneMenuRef.current?.close(); onDestinationChange(); }, [pathname, locationSearch, onDestinationChange]);

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

  const signedInName = user?.name || (auth.account ? getAccountDisplayName(auth.account) : process.env.NEXT_PUBLIC_PIPELINE_PERSONA_DEMO === "true" ? "Account" : "Eric Wilson");
  const profileAppearance = getProfileAppearance(user);
  const trashActive = activeSearchParams.get("screen") === "trash";
  const hideGlobalGuide = pathname === "/note-lab" || pathname.startsWith("/note-lab/");

  const runNavigation = useCallback(async (action: () => void) => {
    try {
      if (beforeNavigationRef.current) await beforeNavigationRef.current();
    } catch {
      // The active editor owns the save error and keeps the working copy open.
      return;
    }
    phoneMenuRef.current?.close();
    action();
  }, [beforeNavigationRef]);

  const navigateTo = (target: "home" | Exclude<PipelineNavTarget, null> | "operations" | "trash") => void runNavigation(() => {
    if (target === "operations" && !canAccessReports) return;
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
  });

  const focusHomeSearch = useCallback(() => void runNavigation(() => {
    setHomeMode("welcome");
    const onHome = pathname === "/" && activeSearchParams.size === 0;
    if (!onHome) navigatePipelineDestination(pathname, "/", router);
    setSearchOpen(true);
  }), [activeSearchParams, pathname, router, runNavigation, setHomeMode, setSearchOpen]);

  useEffect(() => {
    const focusSearchFromKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const shortcut = event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k");
      if (!shortcut) return;
      event.preventDefault();
      focusHomeSearch();
    };
    document.documentElement.dataset.pipelineKeyboardShortcutsReady = "true";
    window.addEventListener("keydown", focusSearchFromKeyboard);
    return () => {
      window.removeEventListener("keydown", focusSearchFromKeyboard);
      delete document.documentElement.dataset.pipelineKeyboardShortcutsReady;
    };
  }, [focusHomeSearch]);

  const navigationContent = <>
      <div className={sidebarStyles.brand}>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            navigateTo("home");
          }}
          aria-label="Pipeline home"
          title="Pipeline — Alamo Health Management"
          data-pipeline-home="true"
          data-guide-target="pipeline-home"
          data-platform-page-active="pipeline"
          className={`${sidebarStyles.home} min-w-11`}
        >
          <PipelineLogoMark size={32} />
          <span className={sidebarStyles.brandDivider} data-brand-divider aria-hidden="true" />
          <span className={sidebarStyles.brandAlamo}>
            <Image src={toPipelinePath("/brand/alamo-health-management.png")} alt="Alamo Health Management" width={774} height={206} loading="eager" unoptimized draggable={false} className={sidebarStyles.brandAlamoImage} />
          </span>
        </button>
      </div>
      <div id="pipeline-primary-navigation" data-testid="primary-navigation-dock" className={sidebarStyles.destinations}>
        <div>
          <PipelineActionNav
            active={activeNav}
            showReports={canAccessReports}
            onNavigate={navigateTo}
          />
        </div>
      </div>

      <div className={sidebarStyles.utilities}>
        <HeaderSessionControls user={user} hideGlobalGuide={hideGlobalGuide} />
        <div ref={profileMenuRef} className="relative">
          <button
            type="button"
            aria-label={`Open profile menu for ${signedInName}`}
            aria-expanded={isProfileMenuOpen}
            aria-haspopup="dialog"
            title={profileAppearance.title || signedInName}
            data-profile-scope="signed-in-user"
            data-guide-target="profile-menu"
            onClick={() => setIsProfileMenuOpen((open) => !open)}
            className={profileAppearance.buttonClass}
          >
            <UserRound size={18} strokeWidth={1.8} className="shrink-0 text-[#0f8b73]" />
            <span className="hidden truncate text-[12px] font-black uppercase tracking-[0.1em] xl:inline">{signedInName}</span>
            <span aria-hidden="true" title="Online" className={profilePresenceIndicatorClass(Boolean(user))} />
          </button>

          <div
            role="dialog"
            aria-label="Profile settings"
            data-profile-menu="true"
            hidden={!isProfileMenuOpen}
            className={`pipeline-popover-enter ${sidebarStyles.profileMenu} overflow-y-auto overscroll-contain rounded-md border border-[#cfd6d2] bg-white shadow-[0_12px_30px_rgba(17,17,17,0.14)]`}
          >
            <DemoProfileMenu user={user} signedInName={signedInName} onSelect={() => setIsProfileMenuOpen(false)} onTrash={() => { setIsProfileMenuOpen(false); navigateTo("trash"); }}>
            <div className="border-b border-[#e2e6e3] px-5 py-4">
              <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Profile settings</div>
              <div className="mt-2 truncate text-[15px] font-black text-[#111111]">{signedInName}</div>
              <div className="mt-0.5 truncate text-[11px] text-[#6b716d]">{profileAppearance.detail}</div>
            </div>
            <ProfileSettingsLink active={pathname === "/settings"} onSelect={() => setIsProfileMenuOpen(false)} />
            <AssessorSessionMenuAction user={user} closeProfileMenu={() => setIsProfileMenuOpen(false)} />
            {canEditWorkspace(user) ? (
              <button
                type="button"
                aria-current={trashActive ? "page" : undefined}
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  navigateTo("trash");
                }}
                className={`grid min-h-[52px] w-full grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-3 border-t border-l-[3px] border-t-[#e5e5e5] px-4 py-2.5 text-left outline-none transition-colors ${trashActive ? "border-l-[#a9473d] bg-[#fff3f1]" : "border-l-transparent hover:border-l-[#a9473d] hover:bg-[#fff3f1]"}`}
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
                  void runNavigation(() => { void auth.signOut(); });
                }}
                className="flex min-h-11 w-full items-center gap-3 border-t border-[#e5e5e5] px-4 py-2.5 text-left text-[#737373] outline-none transition-colors hover:bg-[#fff8ed] hover:text-[#8a5a10] focus-visible:bg-[#fff8ed] focus-visible:text-[#8a5a10]"
              >
                <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
                <span className="text-[11px] font-black">Sign out</span>
              </button>
            ) : null}
            </DemoProfileMenu>
          </div>
        </div>
      </div>
  </>;
  const pageLabel = headerPageLabel(pathname, activeSearchParams, activeNav);
  const hasBack = headerHasBack(pathname, activeSearchParams);
  const goBack = () => void runNavigation(() => {
    const previous = window.history.state?.pipelinePrevious;
    if (typeof previous === "string" && previous.startsWith("/") && !previous.startsWith("//")) window.history.back();
    else navigatePipelineDestination(pathname, activeNav === "profiles" ? "/?screen=profiles" : "/", router);
  });
  return <header data-pipeline-header="true" data-phone-header={phone || undefined} onClickCapture={(event) => {
    if (!beforeNavigationRef.current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.origin !== window.location.origin) return;
    event.preventDefault(); event.stopPropagation();
    void runNavigation(() => { setIsProfileMenuOpen(false); router.push(`${link.pathname}${link.search}${link.hash}`); });
  }} className={phone ? sidebarStyles.phoneHeader : sidebarStyles.sidebar}>
    {phone ? <>
      <div className={sidebarStyles.phoneBar}>
        {hasBack ? <button type="button" aria-label="Back to previous page" onClick={goBack}><ArrowLeft size={20} aria-hidden="true" /><span>Back</span></button> : <button type="button" aria-label="Pipeline home" onClick={() => navigateTo("home")}><ListTodo size={20} aria-hidden="true" /><span>My work</span></button>}
        <PipelinePhoneNotifications key={user?.id ?? "anonymous"} onOpenWorkspace={(id, location) => void runNavigation(() => {
          const params = new URLSearchParams({ view: "referrals", screen: "packet", referralId: String(id) });
          applyPipelineWorkspaceLocation(params, location ?? { view: "intake" });
          navigatePipelineDestination(pathname, `/?${params}`, router);
        })} />
        <button type="button" className={sidebarStyles.phonePageButton} aria-label={`Open page menu, current page ${pageLabel}`} aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus(); phoneMenuRef.current?.showModal(); }}><MoreHorizontal size={20} aria-hidden="true" /><span>More</span></button>
      </div>
      <dialog ref={phoneMenuRef} aria-label="Pipeline pages" className={sidebarStyles.phoneMenu} onClick={(event) => { if (event.target === event.currentTarget || event.target instanceof Element && event.target.closest('[data-guide-target="guided-help"]')) phoneMenuRef.current?.close(); }}>
        <div className={sidebarStyles.phoneMenuHeading}><span>More</span><button type="button" aria-label="Close page menu" onClick={() => phoneMenuRef.current?.close()}><X size={20} /></button></div>
        {navigationContent}
      </dialog>
    </> : navigationContent}
  </header>;
}

function HeaderSessionControls({ user, hideGlobalGuide }: { user: PipelineCurrentUser | null; hideGlobalGuide: boolean }) {
  return <>
    {user?.demoPersona ? <DemoAssessmentLabButton className="flex items-center text-[#08745f]" ><FlaskConical size={18} aria-hidden="true" /><span>Assessment lab</span></DemoAssessmentLabButton> : null}
    {user?.demoPersona ? <DemoPersonaSwitch persona={user.demoPersona} /> : <ActiveAssessorSessionPill user={user} />}
    {!hideGlobalGuide ? (
      <button
        type="button"
        aria-label="Open guided tutorials"
        title="Help · Learning Center"
        data-guide-target="guided-help"
        onClick={() => dispatchOperatorGuide({ type: "open-library" })}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#0f8b73] outline-none hover:bg-[#eff8f5] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2"
      >
        <CircleHelp size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>Help</span>
      </button>
    ) : null}
  </>;
}

function DemoProfileMenu({ user, signedInName, onSelect, onTrash, children }: {
  user: PipelineCurrentUser | null;
  signedInName: string;
  onSelect: () => void;
  onTrash: () => void;
  children: ReactNode;
}) {
  if (!user?.demoPersona) return children;
  return <>
    <div className="border-b border-[#e2e6e3] px-4 py-3">
      <div className="text-[15px] font-semibold text-[#222b27]">{signedInName}</div>
      <div className="mt-1 text-[12px] text-[#68736d]">{user.demoPersona === "supervisor" ? "Supervisor" : "Assessor"}</div>
    </div>
    <div className="p-1 text-[14px] text-[#28372f]">
      <DemoAssessmentLabButton className="block w-full rounded px-3 py-3 text-left hover:bg-[#f0f6f3] focus-visible:outline-[#0f8b73] sm:hidden" />
      <Link href="/settings" onClick={onSelect} className="block rounded px-3 py-3 hover:bg-[#f0f6f3] focus-visible:outline-[#0f8b73]">Profile</Link>
      <button type="button" onClick={onTrash} className="block w-full rounded px-3 py-3 text-left hover:bg-[#f0f6f3] focus-visible:outline-[#0f8b73]">Trash</button>
    </div>
  </>;
}

function normalizePathname(pathname: string | null) {
  return pathname || "/";
}

function searchParamsText(searchParams: { toString(): string } | null) {
  return searchParams ? searchParams.toString() : "";
}

function getProfileAppearance(user: PipelineCurrentUser | null) {
  const baseClass = "relative flex h-12 max-w-[190px] shrink-0 items-center gap-2 rounded-md border px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 max-sm:h-9 max-sm:w-9 max-sm:justify-center max-sm:px-0";
  if (user?.delegation) {
    return {
      buttonClass: `${baseClass} border-[#d6a354] bg-[#fff8ed] text-[#6f470b] hover:bg-[#ffefcf] focus-visible:ring-[#a66b12]`,
      detail: `God mode · Administrator: ${user.delegation.initiatedBy.name}`,
      title: `God mode: ${user.delegation.target.name} · Administrator ${user.delegation.initiatedBy.name}`,
    };
  }
  if (user?.assessorSessionRecoveryRequired) {
    return {
      buttonClass: `${baseClass} border-[#d6a354] bg-[#fff8ed] text-[#6f470b] hover:bg-[#ffefcf] focus-visible:ring-[#a66b12]`,
      detail: "God mode account context is invalid",
      title: "Exit the invalid God mode state",
    };
  }
  return {
    buttonClass: `${baseClass} border-transparent text-[#595959] hover:bg-[#f7faf9] hover:text-[#111111] focus-visible:ring-[#0f8b73] aria-expanded:border-[#b8dacf] aria-expanded:bg-[#effaf5]`,
    detail: user?.email ?? "Signed in to Pipeline",
    title: user ? `${user.name} · ${user.email}` : "",
  };
}

function useWorkspacePresenceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const heartbeat = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void fetch(toPipelinePath("/api/me/presence"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...pipelinePageHeaders() },
      }).catch(() => undefined);
    };
    const interval = window.setInterval(heartbeat, 30_000);
    window.addEventListener("focus", heartbeat);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", heartbeat);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, [enabled]);
}

function profilePresenceIndicatorClass(online: boolean) {
  const base = "absolute bottom-2 left-[27px] h-2.5 w-2.5 rounded-full border-2 border-white max-sm:bottom-0.5 max-sm:left-auto max-sm:right-0.5";
  return `${base} ${online ? "bg-[#20a464]" : "opacity-0"}`;
}

function ProfileSettingsLink({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  return <Link href="/settings" prefetch={true} aria-label="Profile settings Account and display preferences" aria-current={active ? "page" : undefined} onClick={onSelect} className={`group grid min-h-[60px] grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-3 border-l-[3px] px-4 py-3 text-left outline-none transition-colors focus-visible:bg-[#edf7f3] ${active ? "border-l-[#0f8b73] bg-[#edf7f3]" : "border-l-transparent hover:border-l-[#0f8b73] hover:bg-[#f7faf9]"}`}><Settings size={17} strokeWidth={1.8} className="text-[#0f8b73]" aria-hidden="true" /><span className="min-w-0"><span className="block text-[12px] font-black text-[#111111]">Profile settings</span><span className="mt-0.5 block text-[10px] leading-4 text-[#737373]">Account and display preferences</span></span><ArrowRight size={15} className="text-[#0f8b73] transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></Link>;
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

function headerPageLabel(pathname: string, activeSearchParams: URLSearchParams, activeNav: PipelineNavTarget) {
  return pathname === "/settings" ? "Settings" : activeSearchParams.get("screen") === "packet" ? "Workspace" : activeNav === "calendar" ? "Calendar" : activeNav === "profiles" ? "Clients" : activeNav === "operations" ? "Reports" : "Workspaces";
}

function headerHasBack(pathname: string, activeSearchParams: URLSearchParams) {
  return activeSearchParams.has("referralId") || activeSearchParams.has("residentKey") || activeSearchParams.has("profileKey") || activeSearchParams.get("screen") === "packet" || pathname !== "/";
}

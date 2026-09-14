"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import ClientProfileDirectory, { preloadCurrentClientDirectory } from "@/components/pipeline/ClientProfileDirectory";
import OperationsDashboard from "@/components/pipeline/OperationsDashboard";
import PipelineCalendar from "@/components/pipeline/PipelineCalendar";
import PipelineTrash from "@/components/pipeline/PipelineTrash";
import ReferralHome from "@/components/pipeline/ReferralHome";
import PipelineWelcome from "@/components/pipeline/PipelineWelcome";
import CurrentWorkOverlay from "@/components/pipeline/CurrentWorkOverlay";
import { usePipelineAuth } from "@/components/auth/PipelineAuthProvider";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchCurrentPipelineUser, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { buildReferralParams } from "@/components/pipeline/referral-home-directory-model";
import {
  recordRecentDestination,
} from "@/lib/pipeline/recent-destinations";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import {
  formatClientIdentityDetail,
  formatClientIdentityTitle,
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";
import { canAccessOperationsReports } from "@/lib/pipeline/report-access";
import type { TrainingAssessmentMode } from "@/lib/training/mock-assessment";
import { assessmentToolSections, type AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import {
  pushPipelineHistory,
  replacePipelineHistory,
  usePipelineLocationSearch,
} from "@/lib/pipeline/client-navigation";
import { loadPipelineWorkspaceResumeLocation, recordLastPipelineWorkspace } from "@/lib/pipeline/work-continuity-client";
import {
  applyPipelineWorkspaceLocation,
  pipelineWorkspaceLocationFromSearchParams,
  type PipelineWorkspaceLocation,
} from "@/lib/pipeline/work-continuity";

async function loadDeferredWorkSurfaces() {
  const [profile, referral] = await Promise.all([
    import("@/components/pipeline/ClientProfileView"),
    import("@/components/pipeline/ReferralPacketCanvas"),
  ]);
  return {
    ClientProfileView: profile.default,
    ReferralPacketCanvas: referral.default,
  };
}

type DeferredWorkSurfaces = Awaited<ReturnType<typeof loadDeferredWorkSurfaces>>;

type PipelineScreen = "home" | "referrals" | "packet" | "calendar" | "profiles" | "profile" | "operations" | "trash";
type ReferralSelection = { id: number; name?: string; gender?: string; community?: Referral["community"] };

// Preserve immediate navigation: first lazy mounting delayed Calendar/Reports
// ~830 ms in CI and Workspaces ~350 ms live. Heavy charts still warm at idle.

function useDeferredWorkSurfaces(screen: PipelineScreen) {
  const [surfaces, setSurfaces] = useState<DeferredWorkSurfaces | null>(null);
  useEffect(() => {
    if (surfaces) return;
    let cancelled = false;
    const load = () => void loadDeferredWorkSurfaces().then((loaded) => {
      if (!cancelled) setSurfaces(loaded);
    });
    // Deep links load immediately. Home's authenticated content/reads get the
    // first turn before the large work surfaces are prepared for navigation.
    const idle = screen === "home" && "requestIdleCallback" in window
      ? window.requestIdleCallback(load, { timeout: 750 })
      : undefined;
    const timer = idle === undefined ? window.setTimeout(load, 0) : undefined;
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, [screen, surfaces]);
  return surfaces;
}

function DeferredScreenLoading() {
  return (
    <main className="h-full bg-white px-6 py-5" aria-label="Loading workspace">
      <div role="status" aria-label="Loading workspace" aria-busy="true" className="flex h-10 w-full max-w-[640px] items-center gap-4 bg-[#f7f9f8] px-3">
        <div className="h-3 w-24 animate-pulse bg-[#dce4e0]" />
        <div className="h-3 flex-1 animate-pulse bg-[#e7ece9]" />
      </div>
      <div className="mt-6 h-px w-full bg-[#e5e5e5]" />
    </main>
  );
}

function referralWorkspaceKey(referral: ReferralSelection | undefined, created: { id: number; key: string } | null, draftKey: string | undefined) {
  if (!referral) return draftKey ?? "new";
  return created?.id === referral.id ? created.key : `referral-${referral.id}`;
}

function selectedWorkspaceReferral(route: ReferralSelection | undefined, details: ReferralSelection | undefined) {
  return route && details?.id === route.id ? details : route;
}

function workspaceDestinationParams(search: string, screen: PipelineScreen, referral: ReferralSelection | undefined, clientId: string | undefined, location: PipelineWorkspaceLocation) {
  const params = new URLSearchParams(search);
  clearDestinationParams(params);
  params.delete("view");
  params.delete("screen");
  if (screen === "referrals" || screen === "packet") params.set("view", "referrals");
  if (["packet", "profile", "profiles", "operations", "calendar", "trash"].includes(screen)) params.set("screen", screen);
  if (screen === "profile" && clientId) params.set("clientId", clientId);
  if (screen === "packet") {
    if (referral?.id) {
      params.set("referralId", String(referral.id));
      applyPipelineWorkspaceLocation(params, location);
    } else {
      params.set("draftId", crypto.randomUUID());
    }
  }
  return params;
}

function recordCompleteNavigation(screen: PipelineScreen, referral: ReferralSelection | undefined) {
  if (screen === "packet" && referral && (!referral.name || !referral.community)) return;
  recordNavigation(screen, referral);
}

function isCurrentWorkOpen(screen: PipelineScreen, params: URLSearchParams) {
  return (screen === "home" || screen === "packet") && params.get("work") === "current";
}

function PacketAssignedWorkOverlay({ screen, open, isDemoWorkspace, ...props }: ComponentProps<typeof CurrentWorkOverlay> & {
  screen: PipelineScreen;
  open: boolean;
  isDemoWorkspace: boolean;
}) {
  if (screen !== "packet" || !open || isDemoWorkspace) return null;
  return <CurrentWorkOverlay {...props} />;
}

export default function PipelineOverviewRoute({ initialBriefing }: { initialBriefing?: HomeBriefingSnapshot | null }) {
  const { initialUser } = usePipelineAuth();
  const { searchTerm, setSearchTerm, setSearchOpen } = usePipelineShell();
  const searchParams = useSearchParams();
  const locationSearch = usePipelineLocationSearch(searchParamsText(searchParams));
  const activeSearchParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const screen = getScreenFromParams(activeSearchParams);
  const currentWorkOpen = isCurrentWorkOpen(screen, activeSearchParams);
  const editHome = screen === "home" && activeSearchParams.get("editHome") === "1";
  const selectedClientId = screen === "profile" ? activeSearchParams.get("clientId") ?? undefined : undefined;
  const routeReferral = screen === "packet" ? getReferralFromParams(activeSearchParams) : undefined;
  const newReferralDraftKey = screen === "packet" && !routeReferral
    ? getNewReferralDraftKey(activeSearchParams)
    : undefined;
  const [referralDetails, setReferralDetails] = useState<ReferralSelection | undefined>(() => routeReferral);
  const [createdWorkspace, setCreatedWorkspace] = useState<{ id: number; key: string } | null>(null);
  const [reportAccess, setReportAccess] = useState<boolean | null>(() => initialUser ? canAccessOperationsReports(initialUser.roles) : null);
  const [viewerId, setViewerId] = useState(() => initialUser?.id ?? initialBriefing?.viewer.id);
  const [entryBriefing, setEntryBriefing] = useState(initialBriefing ?? null);
  // Header links and browser history also leave Home without calling navigate.
  // The server seed is only for entry, never for a later return to Home.
  useEffect(() => {
    const discardEntry = () => setEntryBriefing(null);
    window.addEventListener("pipeline:navigation", discardEntry);
    window.addEventListener("popstate", discardEntry);
    return () => {
      window.removeEventListener("pipeline:navigation", discardEntry);
      window.removeEventListener("popstate", discardEntry);
    };
  }, [setEntryBriefing]);
  const deferredWorkSurfaces = useDeferredWorkSurfaces(screen);
  const selectedReferral = selectedWorkspaceReferral(routeReferral, referralDetails);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const warmDirectories = () => {
      void fetchPipelineJson(`/api/referrals/directory?${buildReferralParams({ kind: "all" }, "")}`, {}, { cacheTtlMs: 30_000 }).catch(() => undefined);
      void preloadCurrentClientDirectory(controller.signal).catch(() => undefined);
    };
    // Reuse the request-validated effective user, not a local/MSAL guess.
    // Each GET still validates its live session; role/session refresh remains.
    if (initialUser) warmDirectories();
    fetchCurrentPipelineUser()
      .then(({ user }) => {
        if (cancelled) return;
        setViewerId(user.id);
        setReportAccess(canAccessOperationsReports(user.roles));
        // Warm the first workspace page and complete current census after authentication.
        // GET-only reads use the same cache as navigation; no charts or files
        // are downloaded in bulk and no background user session is created.
        if (!initialUser) warmDirectories();
      })
      .catch(() => {
        if (!cancelled) setReportAccess(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [initialUser]);

  useEffect(() => {
    if (screen !== "operations" || reportAccess !== false) return;
    const params = new URLSearchParams(activeSearchParams.toString());
    params.delete("screen");
    replacePipelineHistory(params.size ? `/?${params.toString()}` : "/");
  }, [activeSearchParams, reportAccess, screen]);

  const navigationRequestRef = useRef(0);
  const navigate = async (
    nextScreen: PipelineScreen,
    referral?: ReferralSelection,
    clientId?: string,
    location?: PipelineWorkspaceLocation,
    resume = true,
  ) => {
    if (nextScreen === "operations" && reportAccess !== true) return;
    const requestId = ++navigationRequestRef.current;
    const sourceLocation = `${window.location.pathname}${window.location.search}`;
    const savedLocation = nextScreen === "packet" && referral?.id && resume
      ? await loadPipelineWorkspaceResumeLocation(referral.id).catch(() => undefined)
      : undefined;
    if (requestId !== navigationRequestRef.current || sourceLocation !== `${window.location.pathname}${window.location.search}`) return;
    const workspaceLocation = defaultWorkspaceLocation(savedLocation ?? location);
    setEntryBriefing(null);
    setSearchOpen(false);
    const params = workspaceDestinationParams(activeSearchParams.toString(), nextScreen, referral, clientId, workspaceLocation);
    pushPipelineHistory(params.size ? `/?${params.toString()}` : "/");
    recordNavigatedWorkspace(nextScreen, referral, workspaceLocation);
    recordCompleteNavigation(nextScreen, referral);
    setReferralDetails(referral);
  };

  const resumeReferralDraft = (draftKey: `new-${string}`, intakeField?: PipelineWorkspaceLocation["intakeField"]) => {
    setSearchOpen(false);
    const params = new URLSearchParams(activeSearchParams.toString());
    clearDestinationParams(params);
    params.set("view", "referrals");
    params.set("screen", "packet");
    params.set("draftId", draftKey.slice(4));
    applyPipelineWorkspaceLocation(params, { view: "intake", ...(intakeField ? { intakeField } : {}) });
    pushPipelineHistory(`/?${params.toString()}`);
    setReferralDetails(undefined);
  };

  const openCurrentWork = () => {
    setSearchOpen(false);
    const params = new URLSearchParams(activeSearchParams.toString());
    params.set("work", "current");
    pushPipelineHistory(`/?${params.toString()}`);
  };

  const closeCurrentWork = () => {
    const params = new URLSearchParams(activeSearchParams.toString());
    params.delete("work");
    replacePipelineHistory(params.size ? `/?${params.toString()}` : "/");
  };

  const finishEditingHome = () => {
    const params = new URLSearchParams(activeSearchParams.toString());
    params.delete("editHome");
    replacePipelineHistory(params.size ? `/?${params.toString()}` : "/");
  };

  if (screen === "home") {
    return (
      <PipelineWelcome
        viewerId={viewerId}
        initialBriefing={entryBriefing}
        canAccessReports={reportAccess === true}
        onOpenPacket={(referral, location) => navigate("packet", referral, undefined, location)}
        onOpenProfile={(clientId) => navigate("profile", undefined, clientId)}
        onOpenSearchDestination={(destination: PipelineSiteScreen) => navigate(destination)}
        onViewAllSearchResults={(query) => {
          setSearchTerm(query);
          navigate("referrals");
        }}
        onResumeDraft={resumeReferralDraft}
        currentWorkOpen={currentWorkOpen}
        onOpenCurrentWork={openCurrentWork}
        onCloseCurrentWork={closeCurrentWork}
        editHome={editHome}
        onFinishEditingHome={finishEditingHome}
      />
    );
  }

  const trainingAssessmentMode = getTrainingAssessmentMode(activeSearchParams);
  const trainingIntakeMode = activeSearchParams.get("trainingIntake") === "1";
  const isDemoWorkspace = [activeSearchParams.get("demo") === "1", Boolean(trainingAssessmentMode), trainingIntakeMode].some(Boolean);
  let page: ReactNode;
  if (screen === "packet") {
    const workspaceKey = referralWorkspaceKey(selectedReferral, createdWorkspace, newReferralDraftKey);
    const stillViewingWorkspace = () => {
      const current = new URLSearchParams(window.location.search);
      if (getScreenFromParams(current) !== "packet") return false;
      const currentId = getReferralFromParams(current)?.id;
      return selectedReferral ? currentId === selectedReferral.id : !currentId && getNewReferralDraftKey(current) === newReferralDraftKey;
    };
    const packetProps: ComponentProps<DeferredWorkSurfaces["ReferralPacketCanvas"]> = {
      referral: selectedReferral,
      newDraftKey: newReferralDraftKey,
      initialWorkspaceLocation: pipelineWorkspaceLocationFromSearchParams(activeSearchParams),
      trainingAssessmentMode,
      trainingAssessmentSection: getTrainingAssessmentSection(activeSearchParams),
      trainingIntakeMode,
      onWorkspaceLocationChange: (location) => {
        if (!stillViewingWorkspace()) return;
        const params = new URLSearchParams(window.location.search);
        applyPipelineWorkspaceLocation(params, location);
        replacePipelineHistory(`/?${params.toString()}`);
        const referralId = selectedReferral?.id;
        // Rehearsals use synthetic workspaces and must never become the operator's
        // durable resume destination.
        if (referralId && !isDemoWorkspace) {
          recordLastPipelineWorkspace({ referralId, location, visitedAt: new Date().toISOString() });
        }
      },
      onReferralSaved: (savedReferral) => {
        if (!stillViewingWorkspace()) return;
        // Preserve selected files through creation, but isolate a different client.
        if (!selectedReferral) setCreatedWorkspace({ id: savedReferral.id, key: workspaceKey });
        setReferralDetails(savedReferral);
        const params = new URLSearchParams(activeSearchParams.toString());
        params.set("view", "referrals");
        params.set("screen", "packet");
        params.set("referralId", String(savedReferral.id));
        params.delete("draftId");
        const location = pipelineWorkspaceLocationFromSearchParams(new URLSearchParams(window.location.search));
        applyPipelineWorkspaceLocation(params, location);
        replacePipelineHistory(`/?${params.toString()}`);
        if (!isDemoWorkspace) {
          recordLastPipelineWorkspace({ referralId: savedReferral.id, location, visitedAt: new Date().toISOString() });
        }
      },
      onReferralDeleted: () => navigate("referrals"),
      onOpenProfile: (clientId) => navigate("profile", undefined, clientId),
      onOpenAssignedWork: isDemoWorkspace ? undefined : openCurrentWork,
    };
    page = deferredWorkSurfaces ? <deferredWorkSurfaces.ReferralPacketCanvas key={workspaceKey} {...packetProps} /> : <DeferredScreenLoading />;
  } else if (screen === "profile" && selectedClientId) {
    const profileProps: ComponentProps<DeferredWorkSurfaces["ClientProfileView"]> = {
      residentKey: selectedClientId,
      onBack: () => navigate("profiles"),
      onOpenWorkspace: (referral) => navigate("packet", referral),
    };
    page = deferredWorkSurfaces ? <deferredWorkSurfaces.ClientProfileView {...profileProps} /> : <DeferredScreenLoading />;
  } else if (screen === "operations") {
    page = reportAccess === true ? (
      <OperationsDashboard
        onOpenPacket={(referral) => navigate("packet", referral)}
        onOpenProfile={(clientId) => navigate("profile", undefined, clientId)}
        onOpenProfiles={() => navigate("profiles")}
      />
    ) : null;
  } else if (screen === "calendar") {
    page = <PipelineCalendar onOpenPacket={(referral, location) => void navigate("packet", referral, undefined, location, false)} />;
  } else if (screen === "trash") {
    page = <PipelineTrash />;
  } else if (screen === "profiles") {
    page = <ClientProfileDirectory onOpenProfile={(clientId) => navigate("profile", undefined, clientId)} />;
  } else {
    page = (
      <ReferralHome
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        onOpenPacket={(referral) => navigate("packet", referral)}
        onOpenProfile={(clientId) => navigate("profile", undefined, clientId)}
        onResumeDraft={resumeReferralDraft}
        canViewTeam={Boolean(reportAccess)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="pipeline-route-enter h-full min-h-0 flex-1 overflow-hidden">
        {page}
      </div>
      <PacketAssignedWorkOverlay
        key={viewerId}
        screen={screen}
        open={currentWorkOpen}
        isDemoWorkspace={isDemoWorkspace}
        selectedReferralId={selectedReferral?.id}
        onClose={closeCurrentWork}
        onOpenPacket={(referral, location) => {
          if (referral.id === selectedReferral?.id) closeCurrentWork();
          else void navigate("packet", referral, undefined, location);
        }}
      />
    </div>
  );
}

function searchParamsText(searchParams: { toString(): string } | null) {
  return searchParams ? searchParams.toString() : "";
}

function clearDestinationParams(params: URLSearchParams) {
  for (const key of [
    "work",
    "demo",
    "trainingAssessment",
    "trainingIntake",
    "assessmentSection",
    "editHome",
    "workspaceStage",
    "workspaceView",
    "workspaceField",
    "referralId",
    "draftId",
    "clientId",
  ]) params.delete(key);
}

function defaultWorkspaceLocation(location: PipelineWorkspaceLocation | undefined): PipelineWorkspaceLocation {
  return location ?? { view: "intake" };
}

function recordNavigatedWorkspace(
  screen: PipelineScreen,
  referral: ReferralSelection | undefined,
  location: PipelineWorkspaceLocation,
) {
  if (screen !== "packet" || !referral?.id) return;
  recordLastPipelineWorkspace({
    referralId: referral.id,
    location,
    visitedAt: new Date().toISOString(),
  });
}

function getTrainingAssessmentMode(params: URLSearchParams): TrainingAssessmentMode | undefined {
  const mode = params.get("trainingAssessment");
  return mode === "schedule" || mode === "interview" || mode === "guided" ? mode : undefined;
}

function getTrainingAssessmentSection(params: URLSearchParams): AssessmentToolSection | undefined {
  const mode = getTrainingAssessmentMode(params);
  if (mode !== "interview" && mode !== "guided") return undefined;
  const section = params.get("assessmentSection");
  return assessmentToolSections.find((candidate) => candidate === section);
}

function getScreenFromParams(params: URLSearchParams): PipelineScreen {
  if (params.get("screen") === "packet") return "packet";
  if (params.get("screen") === "operations") return "operations";
  if (params.get("screen") === "calendar") return "calendar";
  if (params.get("screen") === "trash") return "trash";
  if (params.get("screen") === "profile" && params.get("clientId")) return "profile";
  if (params.get("screen") === "profiles") return "profiles";
  if (params.get("view") === "referrals") return "referrals";
  return "home";
}

function getReferralFromParams(params: URLSearchParams): ReferralSelection | undefined {
  const raw = params.get("referralId");
  if (!raw || !/^\d{1,15}$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? { id } : undefined;
}

function getNewReferralDraftKey(params: URLSearchParams): `new-${string}` | undefined {
  const draftId = params.get("draftId");
  return draftId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)
    ? `new-${draftId}`
    : undefined;
}

function recordNavigation(
  nextScreen: PipelineScreen,
  referral?: ReferralSelection,
) {
  if (nextScreen === "home") return;
  if (nextScreen === "referrals") {
    recordRecentDestination({
      id: "page:referrals",
      kind: "page",
      screen: "referrals",
      title: "Workspaces",
      detail: "Client referral records",
    });
    return;
  }
  if (nextScreen === "profiles") {
    recordRecentDestination({
      id: "page:profiles",
      kind: "page",
      screen: "profiles",
      title: "Client profiles",
      detail: "Profile directory",
    });
    return;
  }
  if (nextScreen === "operations") {
    recordRecentDestination({
      id: "page:operations",
      kind: "page",
      screen: "operations",
      title: "Operations",
      detail: "Today's work",
    });
    return;
  }
  if (nextScreen === "packet" && referral?.name && referral.community) {
    const identityTitle = formatClientIdentityTitle(referral);
    recordRecentDestination({
      id: `referral:${referral.id}`,
      kind: "referral",
      screen: "packet",
      title: identityTitle.slice(0, 200),
      detail: formatClientIdentityDetail(resolveClientGender(referral.gender), resolveClientCommunity(referral.community), "Referral workspace"),
      referralId: referral.id,
      community: referral.community,
    });
    return;
  }
  if (nextScreen === "packet") {
    recordRecentDestination({
      id: "page:new-packet",
      kind: "page",
      screen: "packet",
      title: "New referral",
      detail: "Create a workspace",
    });
  }
}

"use client";

import { useEffect, useMemo, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import ClientProfileDirectory from "@/components/pipeline/ClientProfileDirectory";
import OperationsDashboard from "@/components/pipeline/OperationsDashboard";
import PipelineCalendar from "@/components/pipeline/PipelineCalendar";
import PipelineTrash from "@/components/pipeline/PipelineTrash";
import PipelineWelcome from "@/components/pipeline/PipelineWelcome";
import ReferralHome from "@/components/pipeline/ReferralHome";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchCurrentPipelineUser } from "@/lib/auth/authenticated-fetch";
import {
  recordRecentDestination,
} from "@/lib/pipeline/recent-destinations";
import type { Referral } from "@/lib/pipeline/referral-types";
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
import { recordLastPipelineWorkspace } from "@/lib/pipeline/work-continuity-client";
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

function useDeferredWorkSurfaces() {
  const [surfaces, setSurfaces] = useState<DeferredWorkSurfaces | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Keep the first paint lean, then warm the two largest work surfaces so the
    // first operator navigation can render them synchronously.
    void loadDeferredWorkSurfaces().then((loaded) => {
      if (!cancelled) setSurfaces(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
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

function renderDeferredWorkSurface<Props extends object>(
  Surface: ComponentType<Props> | undefined,
  props: Props,
) {
  if (!Surface) return <DeferredScreenLoading />;
  return <Surface {...props} />;
}

export default function PipelineOverviewRoute() {
  const { searchTerm, setSearchTerm, setSearchOpen } = usePipelineShell();
  const searchParams = useSearchParams();
  const locationSearch = usePipelineLocationSearch(searchParamsText(searchParams));
  const activeSearchParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const screen = getScreenFromParams(activeSearchParams);
  const currentWorkOpen = screen === "home" && activeSearchParams.get("work") === "current";
  const editHome = screen === "home" && activeSearchParams.get("editHome") === "1";
  const selectedClientId = screen === "profile" ? activeSearchParams.get("clientId") ?? undefined : undefined;
  const routeReferral = screen === "packet" ? getReferralFromParams(activeSearchParams) : undefined;
  const newReferralDraftKey = screen === "packet" && !routeReferral
    ? getNewReferralDraftKey(activeSearchParams)
    : undefined;
  const [referralDetails, setReferralDetails] = useState<ReferralSelection | undefined>(() => routeReferral);
  const [reportAccess, setReportAccess] = useState<boolean | null>(null);
  const deferredWorkSurfaces = useDeferredWorkSurfaces();
  const selectedReferral = routeReferral && referralDetails?.id === routeReferral.id
    ? referralDetails
    : routeReferral;

  useEffect(() => {
    let cancelled = false;
    fetchCurrentPipelineUser()
      .then(({ user }) => {
        if (!cancelled) setReportAccess(canAccessOperationsReports(user.roles));
      })
      .catch(() => {
        if (!cancelled) setReportAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (screen !== "operations" || reportAccess !== false) return;
    const params = new URLSearchParams(activeSearchParams.toString());
    params.delete("screen");
    replacePipelineHistory(params.size ? `/?${params.toString()}` : "/");
  }, [activeSearchParams, reportAccess, screen]);

  const navigate = (
    nextScreen: PipelineScreen,
    referral?: ReferralSelection,
    clientId?: string,
    location?: PipelineWorkspaceLocation,
  ) => {
    if (nextScreen === "operations" && reportAccess !== true) return;
    const workspaceLocation = defaultWorkspaceLocation(location);
    setSearchOpen(false);
    const params = new URLSearchParams(activeSearchParams.toString());
    clearDestinationParams(params);
    if (nextScreen === "referrals") {
      params.set("view", "referrals");
      params.delete("screen");
    } else if (nextScreen === "packet") {
      params.set("view", "referrals");
      params.set("screen", "packet");
    } else if (["profile", "profiles", "operations", "calendar", "trash"].includes(nextScreen)) {
      params.delete("view");
      params.set("screen", nextScreen);
    } else {
      params.delete("view");
      params.delete("screen");
    }
    if (nextScreen === "profile" && clientId) {
      params.set("clientId", clientId);
    } else {
      params.delete("clientId");
    }
    if (nextScreen === "packet" && referral?.id) {
      params.set("referralId", String(referral.id));
      applyPipelineWorkspaceLocation(params, workspaceLocation);
    } else {
      params.delete("referralId");
    }
    if (nextScreen === "packet" && !referral?.id) {
      params.set("draftId", crypto.randomUUID());
    } else {
      params.delete("draftId");
    }
    pushPipelineHistory(params.size ? `/?${params.toString()}` : "/");
    recordNavigatedWorkspace(nextScreen, referral, workspaceLocation);
    if (!(nextScreen === "packet" && referral && (!referral.name || !referral.community))) {
      recordNavigation(nextScreen, referral);
    }
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

  let page: ReactNode;
  if (screen === "packet") {
    const trainingAssessmentMode = getTrainingAssessmentMode(activeSearchParams);
    const isDemoWorkspace = activeSearchParams.get("demo") === "1" || Boolean(trainingAssessmentMode);
    const packetProps: ComponentProps<DeferredWorkSurfaces["ReferralPacketCanvas"]> = {
      referral: selectedReferral,
      newDraftKey: newReferralDraftKey,
      initialWorkspaceLocation: pipelineWorkspaceLocationFromSearchParams(activeSearchParams),
      trainingAssessmentMode,
      trainingAssessmentSection: getTrainingAssessmentSection(activeSearchParams),
      onWorkspaceLocationChange: (location) => {
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
    };
    page = renderDeferredWorkSurface(deferredWorkSurfaces?.ReferralPacketCanvas, packetProps);
  } else if (screen === "profile" && selectedClientId) {
    const profileProps: ComponentProps<DeferredWorkSurfaces["ClientProfileView"]> = {
      residentKey: selectedClientId,
      onBack: () => navigate("profiles"),
      onOpenWorkspace: (referral) => navigate("packet", referral),
    };
    page = renderDeferredWorkSurface(deferredWorkSurfaces?.ClientProfileView, profileProps);
  } else if (screen === "operations") {
    page = reportAccess === true ? (
      <OperationsDashboard
        onOpenPacket={(referral) => navigate("packet", referral)}
        onOpenProfile={(clientId) => navigate("profile", undefined, clientId)}
        onOpenProfiles={() => navigate("profiles")}
      />
    ) : null;
  } else if (screen === "calendar") {
    page = <PipelineCalendar onOpenPacket={(referral, location) => navigate("packet", referral, undefined, location)} />;
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
    </div>
  );
}

function searchParamsText(searchParams: { toString(): string } | null) {
  return searchParams ? searchParams.toString() : "";
}

function clearDestinationParams(params: URLSearchParams) {
  for (const key of [
    "work",
    "trainingAssessment",
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
  return mode === "schedule" || mode === "interview" ? mode : undefined;
}

function getTrainingAssessmentSection(params: URLSearchParams): AssessmentToolSection | undefined {
  if (getTrainingAssessmentMode(params) !== "interview") return undefined;
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

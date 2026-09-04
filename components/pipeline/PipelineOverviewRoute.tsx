"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import ClientProfileDirectory from "@/components/pipeline/ClientProfileDirectory";
import ClientProfileView from "@/components/pipeline/ClientProfileView";
import OperationsDashboard from "@/components/pipeline/OperationsDashboard";
import PipelineCalendar from "@/components/pipeline/PipelineCalendar";
import PipelineTrash from "@/components/pipeline/PipelineTrash";
import PipelineSearchPanel from "@/components/pipeline/PipelineSearchPanel";
import PipelineWelcome from "@/components/pipeline/PipelineWelcome";
import ReferralHome from "@/components/pipeline/ReferralHome";
import ReferralPacketCanvas from "@/components/pipeline/ReferralPacketCanvas";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchCurrentPipelineUser } from "@/lib/auth/authenticated-fetch";
import {
  recordRecentDestination,
  touchRecentDestination,
  type PipelineRecentDestination,
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
import {
  pushPipelineHistory,
  replacePipelineHistory,
  usePipelineLocationSearch,
} from "@/lib/pipeline/client-navigation";

type PipelineScreen = "home" | "referrals" | "packet" | "calendar" | "profiles" | "profile" | "operations" | "trash";
type ReferralSelection = { id: number; name?: string; gender?: string; community?: Referral["community"] };

export default function PipelineOverviewRoute() {
  const { searchTerm, setSearchTerm, searchOpen, setSearchOpen } = usePipelineShell();
  const searchParams = useSearchParams();
  const locationSearch = usePipelineLocationSearch(searchParamsText(searchParams));
  const activeSearchParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const screen = getScreenFromParams(activeSearchParams);
  const currentWorkOpen = screen === "home" && activeSearchParams.get("work") === "current";
  const selectedClientId = screen === "profile" ? activeSearchParams.get("clientId") ?? undefined : undefined;
  const routeReferral = screen === "packet" ? getReferralFromParams(activeSearchParams) : undefined;
  const newReferralDraftKey = screen === "packet" && !routeReferral
    ? getNewReferralDraftKey(activeSearchParams)
    : undefined;
  const [referralDetails, setReferralDetails] = useState<ReferralSelection | undefined>(() => routeReferral);
  const [reportAccess, setReportAccess] = useState<boolean | null>(null);
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
  ) => {
    if (nextScreen === "operations" && reportAccess !== true) return;
    setSearchOpen(false);
    const params = new URLSearchParams(activeSearchParams.toString());
    params.delete("work");
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
    } else {
      params.delete("referralId");
    }
    if (nextScreen === "packet" && !referral?.id) {
      params.set("draftId", crypto.randomUUID());
    } else {
      params.delete("draftId");
    }
    pushPipelineHistory(params.size ? `/?${params.toString()}` : "/");
    if (!(nextScreen === "packet" && referral && (!referral.name || !referral.community))) {
      recordNavigation(nextScreen, referral);
    }
    setReferralDetails(referral);
  };

  const openRecent = (destination: PipelineRecentDestination) => {
    touchRecentDestination(destination.id);
    if (destination.kind === "profile") {
      navigate("profile", undefined, destination.clientId);
      return;
    }
    if (destination.kind === "referral") {
      navigate("packet", {
        id: destination.referralId,
        community: destination.community as Referral["community"],
      });
      return;
    }
    navigate(destination.screen === "packet" ? "packet" : destination.screen);
  };

  const resumeReferralDraft = (draftKey: `new-${string}`) => {
    setSearchOpen(false);
    const params = new URLSearchParams(activeSearchParams.toString());
    params.set("view", "referrals");
    params.set("screen", "packet");
    params.set("draftId", draftKey.slice(4));
    params.delete("referralId");
    params.delete("clientId");
    params.delete("work");
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

  const globalSearchPanel = searchOpen ? (
    <PipelineSearchPanel
      autoFocus
      canAccessReports={reportAccess === true}
      onOpenPacket={(referral) => {
        setSearchOpen(false);
        navigate("packet", referral);
      }}
      onOpenProfile={(clientId) => {
        setSearchOpen(false);
        navigate("profile", undefined, clientId);
      }}
      onOpenDestination={(destination) => navigate(destination)}
    />
  ) : null;

  if (screen === "home") {
    return (
      <PipelineWelcome
        canAccessReports={reportAccess === true}
        onOpenPacket={(referral) => navigate("packet", referral)}
        onOpenRecent={openRecent}
        onOpenProfile={(clientId) => navigate("profile", undefined, clientId)}
        onOpenSearchDestination={(destination: PipelineSiteScreen) => navigate(destination)}
        onResumeDraft={resumeReferralDraft}
        currentWorkOpen={currentWorkOpen}
        onOpenCurrentWork={openCurrentWork}
        onCloseCurrentWork={closeCurrentWork}
      />
    );
  }

  let page: ReactNode;
  if (screen === "packet") {
    page = (
      <ReferralPacketCanvas
        referral={selectedReferral}
        newDraftKey={newReferralDraftKey}
        initialWorkspaceStage={getInitialWorkspaceStage(activeSearchParams)}
        onWorkspaceStageChange={(stage) => {
          const params = new URLSearchParams(activeSearchParams.toString());
          if (stage === "intake") params.delete("workspaceStage");
          else params.set("workspaceStage", stage);
          replacePipelineHistory(`/?${params.toString()}`);
        }}
        onReferralSaved={(savedReferral) => {
          setReferralDetails(savedReferral);
          const params = new URLSearchParams(activeSearchParams.toString());
          params.set("view", "referrals");
          params.set("screen", "packet");
          params.set("referralId", String(savedReferral.id));
          params.delete("draftId");
          replacePipelineHistory(`/?${params.toString()}`);
        }}
        onReferralDeleted={() => navigate("referrals")}
      />
    );
  } else if (screen === "profile" && selectedClientId) {
    page = (
      <ClientProfileView
        residentKey={selectedClientId}
        onBack={() => navigate("profiles")}
      />
    );
  } else if (screen === "operations") {
    page = reportAccess === true ? (
      <OperationsDashboard
        onOpenPacket={(referral) => navigate("packet", referral)}
      />
    ) : null;
  } else if (screen === "calendar") {
    page = <PipelineCalendar onOpenPacket={(referral) => navigate("packet", referral)} />;
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
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {searchOpen ? (
        <div className="pipeline-search-enter h-full min-h-0 flex-1 overflow-y-auto bg-white px-5 pb-8 pt-3 md:px-8">
          <div className="mx-auto w-full max-w-[1240px]">
            {globalSearchPanel}
          </div>
        </div>
      ) : (
        <div className="pipeline-route-enter h-full min-h-0 flex-1 overflow-hidden">
          {page}
        </div>
      )}
    </div>
  );
}

function searchParamsText(searchParams: { toString(): string } | null) {
  return searchParams ? searchParams.toString() : "";
}

function getInitialWorkspaceStage(params: URLSearchParams) {
  const stage = params.get("workspaceStage");
  if (stage === "assessment" || stage === "chart") return stage;
  return "intake";
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

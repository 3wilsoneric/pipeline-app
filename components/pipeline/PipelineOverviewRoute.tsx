"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import {
  recordRecentDestination,
  touchRecentDestination,
  type PipelineRecentDestination,
} from "@/lib/pipeline/recent-destinations";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";
import {
  pushPipelineHistory,
  replacePipelineHistory,
  usePipelineLocationSearch,
} from "@/lib/pipeline/client-navigation";

type PipelineScreen = "home" | "referrals" | "packet" | "calendar" | "profiles" | "profile" | "operations" | "trash";
type ReferralSelection = { id: number; name?: string; community?: Referral["community"] };

export default function PipelineOverviewRoute() {
  const { searchTerm, setSearchTerm, searchOpen, setSearchOpen, homeMode } = usePipelineShell();
  const searchParams = useSearchParams();
  const locationSearch = usePipelineLocationSearch(searchParams.toString());
  const activeSearchParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const screen = getScreenFromParams(activeSearchParams);
  const selectedClientId = screen === "profile" ? activeSearchParams.get("clientId") ?? undefined : undefined;
  const routeReferral = screen === "packet" ? getReferralFromParams(activeSearchParams) : undefined;
  const newReferralDraftKey = screen === "packet" && !routeReferral
    ? getNewReferralDraftKey(activeSearchParams)
    : undefined;
  const [referralDetails, setReferralDetails] = useState<ReferralSelection | undefined>(() => routeReferral);
  const selectedReferral = routeReferral && referralDetails?.id === routeReferral.id
    ? referralDetails
    : routeReferral;

  const navigate = (
    nextScreen: PipelineScreen,
    referral?: Pick<Referral, "id" | "name" | "community">,
    clientId?: string,
  ) => {
    setSearchOpen(false);
    const params = new URLSearchParams(activeSearchParams.toString());
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
    recordNavigation(nextScreen, referral);
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
        name: destination.title,
        community: destination.community as Referral["community"],
      });
      return;
    }
    navigate(destination.screen === "packet" ? "packet" : destination.screen);
  };

  const globalSearchPanel = searchOpen ? (
    <PipelineSearchPanel
      autoFocus
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
        initialMode={homeMode}
        onOpenPacket={(referral) => navigate("packet", referral)}
        onOpenRecent={openRecent}
        onOpenProfile={(clientId) => navigate("profile", undefined, clientId)}
        onOpenOperations={() => navigate("operations")}
        onOpenSearchDestination={(destination: PipelineSiteScreen) => navigate(destination)}
      />
    );
  }

  let page: ReactNode;
  if (screen === "packet") {
    page = (
      <ReferralPacketCanvas
        referral={selectedReferral}
        newDraftKey={newReferralDraftKey}
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
    page = (
      <OperationsDashboard
        onOpenPacket={(referral) => navigate("packet", referral)}
      />
    );
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
  referral?: Pick<Referral, "id" | "name" | "community">,
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
  if (nextScreen === "packet" && referral) {
    recordRecentDestination({
      id: `referral:${referral.id}`,
      kind: "referral",
      screen: "packet",
      title: referral.name,
      detail: `${referral.community} · Referral workspace`,
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

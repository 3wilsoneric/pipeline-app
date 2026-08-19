"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";

import PipelineSearchPanel from "@/components/pipeline/PipelineSearchPanel";
import PipelineWelcome from "@/components/pipeline/PipelineWelcome";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import {
  recordRecentDestination,
  touchRecentDestination,
  type PipelineRecentDestination,
} from "@/lib/pipeline/recent-destinations";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";

const ReferralHome = dynamic(() => import("@/components/pipeline/ReferralHome"), {
  loading: () => <WorkSurfaceFallback kind="referrals" />,
});
const ReferralPacketCanvas = dynamic(() => import("@/components/pipeline/ReferralPacketCanvas"), {
  loading: () => <WorkSurfaceFallback kind="packet" />,
});
const ClientProfileDirectory = dynamic(() => import("@/components/pipeline/ClientProfileDirectory"), {
  loading: () => <WorkSurfaceFallback kind="profiles" />,
});
const ClientProfileView = dynamic(() => import("@/components/pipeline/ClientProfileView"), {
  loading: () => <WorkSurfaceFallback kind="profile" />,
});
const OperationsDashboard = dynamic(() => import("@/components/pipeline/OperationsDashboard"), {
  loading: () => <WorkSurfaceFallback kind="operations" />,
});

type PipelineScreen = "home" | "referrals" | "packet" | "profiles" | "profile" | "operations";
type ReferralSelection = { id: number; name?: string; community?: Referral["community"] };

export default function PipelineOverviewRoute() {
  const { searchTerm, searchOpen, setSearchOpen, homeMode } = usePipelineShell();
  const router = useRouter();
  const searchParams = useSearchParams();
  const screen = getScreenFromParams(searchParams);
  const selectedClientId = screen === "profile" ? searchParams.get("clientId") ?? undefined : undefined;
  const routeReferral = screen === "packet" ? getReferralFromParams(searchParams) : undefined;
  const [referralDetails, setReferralDetails] = useState<ReferralSelection | undefined>(() => routeReferral);
  const selectedReferral = routeReferral && referralDetails?.id === routeReferral.id
    ? referralDetails
    : routeReferral;

  const navigate = (
    nextScreen: "home" | "referrals" | "packet" | "profile" | "profiles" | "operations",
    referral?: Pick<Referral, "id" | "name" | "community">,
    clientId?: string,
  ) => {
    setSearchOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    if (nextScreen === "referrals") {
      params.set("view", "referrals");
      params.delete("screen");
    } else if (nextScreen === "packet") {
      params.set("view", "referrals");
      params.set("screen", "packet");
    } else if (nextScreen === "profile" || nextScreen === "profiles" || nextScreen === "operations") {
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
    router.push(params.size ? `/?${params.toString()}` : "/");
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
        onReferralSaved={(savedReferral) => {
          setReferralDetails(savedReferral);
          const params = new URLSearchParams(searchParams.toString());
          params.set("view", "referrals");
          params.set("screen", "packet");
          params.set("referralId", String(savedReferral.id));
          router.replace(`/?${params.toString()}`);
        }}
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
  } else if (screen === "profiles") {
    page = <ClientProfileDirectory onOpenProfile={(clientId) => navigate("profile", undefined, clientId)} />;
  } else {
    page = (
      <ReferralHome
        searchTerm={searchTerm}
        onOpenPacket={(referral) => navigate("packet", referral)}
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

function WorkSurfaceFallback({
  kind,
}: {
  kind: "referrals" | "packet" | "profiles" | "profile" | "operations";
}) {
  if (kind === "packet") {
    return (
      <main aria-label="Loading referral packet" aria-busy="true" className="h-full overflow-hidden bg-white px-2 pt-3 sm:px-4 lg:px-6">
        <div className="mx-auto w-full max-w-[1480px] animate-pulse">
          <div className="flex min-h-[52px] items-center gap-2 border-y border-[#d9d9d9] py-1.5">
            <div className="h-10 w-36 rounded-md bg-[#e7efeb]" />
            <div className="h-10 w-52 rounded-md bg-[#f1f3f2]" />
            <div className="ml-auto h-10 w-32 bg-[#e8ebe9]" />
          </div>
          <div className="mt-3 h-[42px] border-y border-[#d9d9d9] bg-[#fafbfa]" />
          <div className="mt-5 h-4 w-32 rounded bg-[#e8ebe9]" />
          <div className="mt-4 h-20 border border-[#d9d9d9] bg-[#fafbfa]" />
          <div className="mt-5 grid gap-px bg-[#d9d9d9] sm:grid-cols-2">
            <div className="h-24 bg-[#fffde0]" />
            <div className="h-24 bg-[#fffde0]" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main aria-label={`Loading ${kind}`} aria-busy="true" className="h-full overflow-hidden bg-white px-5 pt-3 md:px-8">
      <div className="mx-auto w-full max-w-[1240px] animate-pulse">
        <div className="h-16 border-b border-[#d9d9d9]">
          <div className="h-5 w-48 rounded bg-[#e8ebe9]" />
        </div>
        <div className="mt-3 h-12 w-full border-y border-[#d9d9d9] bg-[#fafbfa]" />
        <div className="mt-4 grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
          <div className="h-72 bg-[#f7f8f7]" />
          <div className="h-72 border-y border-[#d9d9d9] bg-[#fafbfa]" />
        </div>
      </div>
    </main>
  );
}

function getScreenFromParams(params: URLSearchParams): PipelineScreen {
  if (params.get("screen") === "packet") return "packet";
  if (params.get("screen") === "operations") return "operations";
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

function recordNavigation(
  nextScreen: "home" | "referrals" | "packet" | "profile" | "profiles" | "operations",
  referral?: Pick<Referral, "id" | "name" | "community">,
) {
  if (nextScreen === "home") return;
  if (nextScreen === "referrals") {
    recordRecentDestination({
      id: "page:referrals",
      kind: "page",
      screen: "referrals",
      title: "Referrals",
      detail: "Referral packets",
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
      detail: `${referral.community} · Referral packet`,
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
      title: "New referral packet",
      detail: "Create a packet",
    });
  }
}

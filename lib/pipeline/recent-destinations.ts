import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  isPipelineRecentDestination,
  type PipelineRecentDestination,
  type RecentDestinationInput,
} from "@/lib/pipeline/user-workspace-state-types";
import { usesServerUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-client";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";

export type { PipelineRecentDestination } from "@/lib/pipeline/user-workspace-state-types";

const storageKey = "pipeline.recent-destinations.v1";
const changeEvent = "pipeline-recent-destinations";
const maxRecentDestinations = 5;
let serverRecents: PipelineRecentDestination[] = [];
let serverRecentsRequest: Promise<PipelineRecentDestination[]> | null = null;

export function loadRecentDestinations() {
  if (typeof window === "undefined") return [];
  if (usesServerUserWorkspaceState()) return serverRecents;

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPipelineRecentDestination).map(cleanRecentDestination).slice(0, maxRecentDestinations);
  } catch {
    return [];
  }
}

export async function refreshRecentDestinations() {
  if (typeof window === "undefined" || !usesServerUserWorkspaceState()) return loadRecentDestinations();
  if (!serverRecentsRequest) {
    serverRecentsRequest = fetchPipelineJson<{ recents?: unknown }>("/api/me/recents", { cache: "no-store" })
      .then((payload) => {
        serverRecents = Array.isArray(payload.recents)
          ? payload.recents.filter(isPipelineRecentDestination).map(cleanRecentDestination).slice(0, maxRecentDestinations)
          : [];
        dispatchChange();
        return serverRecents;
      })
      .finally(() => {
        serverRecentsRequest = null;
      });
  }
  return serverRecentsRequest;
}

export function recordRecentDestination(destination: RecentDestinationInput) {
  if (typeof window === "undefined") return;

  const next = cleanRecentDestination({
    ...destination,
    visitedAt: destination.visitedAt ?? new Date().toISOString(),
  } as PipelineRecentDestination);
  const previous = loadRecentDestinations();
  const updated = [next, ...previous.filter((item) => item.id !== next.id)].slice(0, maxRecentDestinations);

  if (usesServerUserWorkspaceState()) {
    serverRecents = updated;
    dispatchChange();
    void fetchPipelineJson<{ destination: PipelineRecentDestination }>("/api/me/recents", {
      method: "POST",
      body: JSON.stringify({ destination: next }),
    }).then(() => refreshRecentDestinations()).catch(() => undefined);
    return;
  }

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(updated));
    dispatchChange();
  } catch {
    // Recents are helpful navigation state, never a reason to block the destination.
  }
}

export function touchRecentDestination(id: string) {
  const current = loadRecentDestinations().find((item) => item.id === id);
  if (!current) return;
  recordRecentDestination(current);
}

export function subscribeToRecentDestinations(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(changeEvent, onChange);
  return () => window.removeEventListener(changeEvent, onChange);
}

function dispatchChange() {
  window.dispatchEvent(new Event(changeEvent));
}

function cleanRecentDestination(destination: PipelineRecentDestination): PipelineRecentDestination {
  if (destination.kind === "page") return destination;
  return {
    ...destination,
    title: formatClientIdentityTitle({
      name: destination.title,
      community: destination.kind === "referral" ? destination.community : undefined,
    }),
  };
}

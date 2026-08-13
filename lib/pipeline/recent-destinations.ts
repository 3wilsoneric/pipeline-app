import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { isPipelineDesktopEnabled } from "@/lib/desktop/desktop-config";
import {
  isPipelineRecentDestination,
  type PipelineRecentDestination,
  type RecentDestinationInput,
} from "@/lib/pipeline/user-workspace-state-types";

export type { PipelineRecentDestination } from "@/lib/pipeline/user-workspace-state-types";

const storageKey = "pipeline.recent-destinations.v1";
const changeEvent = "pipeline-recent-destinations";
const maxRecentDestinations = 5;
let desktopRecents: PipelineRecentDestination[] = [];
let desktopRecentsRequest: Promise<PipelineRecentDestination[]> | null = null;

export function loadRecentDestinations() {
  if (typeof window === "undefined") return [];
  if (isPipelineDesktopEnabled()) return desktopRecents;

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPipelineRecentDestination).slice(0, maxRecentDestinations);
  } catch {
    return [];
  }
}

export async function refreshRecentDestinations() {
  if (typeof window === "undefined" || !isPipelineDesktopEnabled()) return loadRecentDestinations();
  if (!desktopRecentsRequest) {
    desktopRecentsRequest = fetchPipelineJson<{ recents?: unknown }>("/api/me/recents", { cache: "no-store" })
      .then((payload) => {
        desktopRecents = Array.isArray(payload.recents)
          ? payload.recents.filter(isPipelineRecentDestination).slice(0, maxRecentDestinations)
          : [];
        dispatchChange();
        return desktopRecents;
      })
      .finally(() => {
        desktopRecentsRequest = null;
      });
  }
  return desktopRecentsRequest;
}

export function recordRecentDestination(destination: RecentDestinationInput) {
  if (typeof window === "undefined") return;

  const next: PipelineRecentDestination = {
    ...destination,
    visitedAt: destination.visitedAt ?? new Date().toISOString(),
  } as PipelineRecentDestination;
  const previous = loadRecentDestinations();
  const updated = [next, ...previous.filter((item) => item.id !== next.id)].slice(0, maxRecentDestinations);

  if (isPipelineDesktopEnabled()) {
    desktopRecents = updated;
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

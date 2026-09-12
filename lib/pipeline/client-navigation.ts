"use client";

import { useEffect, useState } from "react";

import { toPipelinePath } from "@/lib/pipeline/base-path";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";
import { isImportedWorkspace } from "@/lib/pipeline/workspace-presentation";

export const PIPELINE_NAVIGATION_EVENT = "pipeline:navigation";
export const workspaceCanvasCacheTtlMs = 3_000;
let workspaceWarmupTimer: ReturnType<typeof setTimeout> | undefined;
const warmingWorkspaces = new Set<number>();
const warmingProfiles = new Set<string>();

export function cancelPipelineWarmup() {
  clearTimeout(workspaceWarmupTimer);
}

export function prefetchPipelineProfile(profileKey: string) {
  cancelPipelineWarmup();
  workspaceWarmupTimer = setTimeout(() => {
    if (warmingProfiles.size > 0) return;
    warmingProfiles.add(profileKey);
    void fetchPipelineJson(`/api/profiles/${encodeURIComponent(profileKey)}`, {}, { cacheTtlMs: 60_000 })
      .catch(() => undefined).finally(() => warmingProfiles.delete(profileKey));
  }, 120);
}

export function prefetchPipelineWorkspace(referral: Referral) {
  clearTimeout(workspaceWarmupTimer);
  // Ignore drive-by pointer movement; at most two intentional workspace reads
  // run at once. Revisit this ceiling only with measured navigation misses.
  workspaceWarmupTimer = setTimeout(() => {
    if (warmingWorkspaces.has(referral.id) || warmingWorkspaces.size >= 2) return;
    warmingWorkspaces.add(referral.id);
    const reads = [fetchPipelineJson(`/api/referrals/${referral.id}/canvas`, {}, { cacheTtlMs: workspaceCanvasCacheTtlMs })];
    if (referral.clientId) {
      reads.push(fetchPipelineJson(`/api/profiles/${encodeURIComponent(`pipeline:${referral.clientId}`)}`, {}, { cacheTtlMs: 60_000 }));
    }
    if (isImportedWorkspace(referral)) {
      reads.push(fetchPipelineJson(`/api/referrals/${referral.id}/historical-profile`, {}, { cacheTtlMs: 60_000 }));
    }
    // Prefetch is optional: failures never replace the normal navigation error
    // handling. These are protected JSON reads, never document bytes or writes.
    void Promise.allSettled(reads).finally(() => warmingWorkspaces.delete(referral.id));
  }, 120);
}

export function pushPipelineHistory(path: string) {
  window.history.pushState(null, "", toPipelinePath(path));
  notifyPipelineNavigation();
}

export function replacePipelineHistory(path: string) {
  window.history.replaceState(null, "", toPipelinePath(path));
  notifyPipelineNavigation();
}

export function usePipelineLocationSearch(nextSearch: string) {
  const [locationSearch, setLocationSearch] = useState(nextSearch);

  useEffect(() => {
    const syncLocation = () => setLocationSearch(window.location.search.slice(1));
    window.addEventListener(PIPELINE_NAVIGATION_EVENT, syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener(PIPELINE_NAVIGATION_EVENT, syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, []);

  useEffect(() => {
    setLocationSearch(nextSearch);
  }, [nextSearch]);

  return locationSearch;
}

function notifyPipelineNavigation() {
  window.dispatchEvent(new Event(PIPELINE_NAVIGATION_EVENT));
}

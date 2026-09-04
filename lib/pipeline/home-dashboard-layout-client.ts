"use client";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  defaultPipelineHomeDashboardLayout,
  parsePipelineHomeDashboardLayout,
  type PipelineHomeDashboardLayout,
} from "@/lib/pipeline/home-dashboard-layout";
import { usesServerUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-client";

const layoutStoragePrefix = "pipeline:home-layout:v1:";

export function cachedHomeDashboardLayout(viewerId: string) {
  if (typeof window === "undefined") return null;
  try {
    return parsePipelineHomeDashboardLayout(JSON.parse(window.localStorage.getItem(layoutStorageKey(viewerId)) ?? "null"));
  } catch {
    return null;
  }
}

export async function loadHomeDashboardLayout(viewerId: string) {
  const cached = cachedHomeDashboardLayout(viewerId);
  if (!usesServerUserWorkspaceState()) return cached ?? defaultPipelineHomeDashboardLayout();
  try {
    const payload = await fetchPipelineJson<{ layout?: unknown }>("/api/me/home-layout", { cache: "no-store" });
    const layout = parsePipelineHomeDashboardLayout(payload.layout) ?? cached ?? defaultPipelineHomeDashboardLayout();
    cacheHomeDashboardLayout(viewerId, layout);
    return layout;
  } catch {
    return cached ?? defaultPipelineHomeDashboardLayout();
  }
}

export function saveHomeDashboardLayout(viewerId: string, layout: PipelineHomeDashboardLayout) {
  cacheHomeDashboardLayout(viewerId, layout);
  if (!usesServerUserWorkspaceState()) return Promise.resolve();
  return fetchPipelineJson<{ layout: PipelineHomeDashboardLayout }>("/api/me/home-layout", {
    method: "PUT",
    body: JSON.stringify({ layout }),
  }).then(() => undefined);
}

function cacheHomeDashboardLayout(viewerId: string, layout: PipelineHomeDashboardLayout) {
  try {
    window.localStorage.setItem(layoutStorageKey(viewerId), JSON.stringify(layout));
  } catch {
    // A durable server copy remains authoritative when browser storage is unavailable.
  }
}

function layoutStorageKey(viewerId: string) {
  return `${layoutStoragePrefix}${encodeURIComponent(viewerId)}`;
}

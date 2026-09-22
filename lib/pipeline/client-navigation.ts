"use client";

import { useEffect, useState, type RefObject } from "react";

import { toPipelinePath } from "@/lib/pipeline/base-path";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";
import { beginPipelineNavigation } from "@/lib/observability/browser-performance";

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
  if (!canPrefetchPipelineData()) return;
  workspaceWarmupTimer = setTimeout(() => {
    if (warmingProfiles.size > 0) return;
    warmingProfiles.add(profileKey);
    void fetchPipelineJson(`/api/profiles/${encodeURIComponent(profileKey)}`, {}, { cacheTtlMs: 60_000 })
      .catch(() => undefined).finally(() => warmingProfiles.delete(profileKey));
  }, 120);
}

export function prefetchPipelineWorkspace(referral: Referral | number) {
  clearTimeout(workspaceWarmupTimer);
  if (!canPrefetchPipelineData()) return;
  const id = typeof referral === "number" ? referral : referral.id;
  // Ignore drive-by pointer movement; at most two intentional workspace reads
  // run at once. Revisit this ceiling only with measured navigation misses.
  workspaceWarmupTimer = setTimeout(() => {
    if (warmingWorkspaces.has(id) || warmingWorkspaces.size >= 2) return;
    warmingWorkspaces.add(id);
    const reads = [fetchPipelineJson(`/api/referrals/${id}/canvas`, {}, { cacheTtlMs: workspaceCanvasCacheTtlMs })];
    if (typeof referral !== "number" && referral.clientId) {
      reads.push(fetchPipelineJson(`/api/profiles/${encodeURIComponent(`pipeline:${referral.clientId}`)}`, {}, { cacheTtlMs: 60_000 }));
    }
    // Prefetch is optional: failures never replace the normal navigation error
    // handling. These are protected JSON reads, never document bytes or writes.
    void Promise.allSettled(reads).finally(() => warmingWorkspaces.delete(id));
  }, 120);
}

function canPrefetchPipelineData() {
  const connection = typeof navigator === "undefined" ? undefined
    : (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType ?? "")
    && (typeof document === "undefined" || document.visibilityState !== "hidden");
}

export function pushPipelineHistory(path: string) {
  beginPipelineNavigation(path);
  const index = window.history.state?.pipelineIndex ?? 0;
  window.history.pushState({ pipelineIndex: index + 1, pipelinePrevious: `${window.location.pathname}${window.location.search}` }, "", toPipelinePath(path));
  notifyPipelineNavigation();
}

export function replacePipelineHistory(path: string) {
  beginPipelineNavigation(path);
  window.history.replaceState(window.history.state, "", toPipelinePath(path));
  notifyPipelineNavigation();
}

export function usePipelineHistoryGuard(beforeNavigationRef: RefObject<(() => Promise<void>) | null>) {
  useEffect(() => {
    const history = window.history;
    if (!Number.isInteger(history.state?.pipelineIndex)) history.replaceState({ ...history.state, pipelineIndex: 0 }, "");
    let currentIndex: number = history.state.pipelineIndex;
    let pending: { target: number; running: boolean; allowed?: boolean } | null = null;
    let approvedIndex: number | undefined;
    let disposed = false;
    const resume = () => {
      if (disposed || !pending || history.state?.pipelineIndex !== currentIndex) return;
      if (pending.allowed !== undefined) {
        const { allowed, target } = pending;
        pending = null;
        if (allowed) { approvedIndex = target; history.go(target - currentIndex); }
      } else if (!pending.running) {
        const operation = pending;
        operation.running = true;
        void Promise.resolve().then(() => beforeNavigationRef.current?.()).then(() => {
          operation.allowed = true; resume();
        }, () => {
          // The active editor owns the explanation and retains its working copy.
          operation.allowed = false; resume();
        });
      }
    };
    const pop = (event: PopStateEvent) => {
      const target: unknown = event.state?.pipelineIndex;
      // Cross-document exits use the editors' native beforeunload protection.
      if (typeof target !== "number" || !Number.isInteger(target)) return;
      if (target === approvedIndex) { approvedIndex = undefined; currentIndex = target; return; }
      if (!pending && (target === currentIndex || !beforeNavigationRef.current)) { currentIndex = target; return; }
      event.stopImmediatePropagation();
      if (target === currentIndex) { resume(); return; }
      if (pending) pending.target = target;
      else pending = { target, running: false };
      // Restore the current entry before saving or asking about unsaved edits.
      // Replay the requested traversal only after the same guard used by app links succeeds.
      history.go(currentIndex - target);
    };
    const sync = () => {
      if (!pending && Number.isInteger(history.state?.pipelineIndex)) currentIndex = history.state.pipelineIndex;
    };
    let restoreHistoryMethods = () => {};
    // Observe Next's history methods too: Settings uses router links, while
    // workspace tabs use the helpers above. Both must participate in one stack.
    queueMicrotask(() => {
      if (disposed) return;
      const pushState = history.pushState;
      const replaceState = history.replaceState;
      const push: History["pushState"] = (data, unused, url) => {
        pushState.call(history, { ...data, pipelineIndex: (history.state?.pipelineIndex ?? 0) + 1 }, unused, url);
        sync();
      };
      const replace: History["replaceState"] = (data, unused, url) => {
        replaceState.call(history, { ...data, pipelineIndex: history.state?.pipelineIndex ?? 0 }, unused, url);
        sync();
      };
      history.pushState = push;
      history.replaceState = replace;
      restoreHistoryMethods = () => {
        if (history.pushState === push) history.pushState = pushState;
        if (history.replaceState === replace) history.replaceState = replaceState;
      };
    });
    window.addEventListener("popstate", pop, true);
    window.addEventListener(PIPELINE_NAVIGATION_EVENT, sync);
    return () => {
      disposed = true;
      restoreHistoryMethods();
      window.removeEventListener("popstate", pop, true);
      window.removeEventListener(PIPELINE_NAVIGATION_EVENT, sync);
    };
  }, [beforeNavigationRef]);
}

/** Keep return context on the current history entry (tab-scoped, survives reload and
 * Back/Forward). Callers must never store free text, clinical content, or unscoped identity. */
export function rememberPipelineHistoryContext(key: string, value: unknown) {
  window.history.replaceState({ ...window.history.state, [key]: value }, "");
}

export function readPipelineHistoryContext(key: string): unknown {
  return window.history.state?.[key];
}

/** Go back only when this entry was pushed from a matching Pipeline screen; direct links fall back. */
export function returnToPreviousPipelineEntry(matches: (params: URLSearchParams) => boolean) {
  const previous = window.history.state?.pipelinePrevious;
  if (typeof previous !== "string" || !previous.startsWith("/") || previous.startsWith("//")) return false;
  if (!matches(new URL(previous, window.location.origin).searchParams)) return false;
  window.history.back();
  return true;
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

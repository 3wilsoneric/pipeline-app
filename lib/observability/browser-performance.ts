"use client";

import { getPipelineReadCacheCounts } from "@/lib/auth/authenticated-fetch";
import { fromPipelinePath, toPipelinePath } from "@/lib/pipeline/base-path";
import { type BrowserPerformanceSample, type BrowserPerformanceSurface } from "./browser-performance-contract";

let navigation: { surface: BrowserPerformanceSurface; startedAt: number } | null = null;
let documentBatches = 0;
let sampled: boolean | undefined;

function surfaceFor(path: string): BrowserPerformanceSurface {
  const url = new URL(path, window.location.origin);
  if (fromPipelinePath(url.pathname) !== "/") return "other";
  const params = url.searchParams;
  if (isPracticeSurface(params)) return "other";
  const screen = params.get("screen");
  if (screen === "profile" && params.get("clientId")) return "profile";
  if (screen && ["packet", "profiles", "calendar", "operations", "trash"].includes(screen)) return screen as BrowserPerformanceSurface;
  return params.get("view") === "referrals" ? "referrals" : "home";
}

function isPracticeSurface(params: URLSearchParams) {
  return params.get("demo") === "1" || params.has("trainingAssessment") || params.get("trainingIntake") === "1";
}

export function beginPipelineNavigation(path: string) {
  navigation = { surface: surfaceFor(path), startedAt: performance.now() };
}

export function observePipelineBrowserPerformance() {
  // At most five 20-sample batches per document, from a 20% session sample.
  // Analytics never holds a clinical request, retries or renews a session.
  if (process.env.NODE_ENV !== "production") return () => {};
  sampled ??= Math.random() < 0.2;
  if (!sampled || documentBatches >= 5) return () => {};
  let samples: BrowserPerformanceSample[] = [];
  let counts = getPipelineReadCacheCounts();
  let span = navigation ?? { surface: surfaceFor(window.location.href), startedAt: 0 };
  const initialSurface = surfaceFor(window.location.href);
  let awaiting = span.surface !== "other";
  let frame = 0;
  const observers: PerformanceObserver[] = [];
  const add = (sample: BrowserPerformanceSample) => {
    if (sample.surface === "other") return;
    // Leave capacity for readiness and interval cache counts on busy devices.
    const limit = sample.metric === "long_task" ? 12 : 20;
    if (samples.length < limit && documentBatches < 5 && Number.isFinite(sample.value)) samples.push({ ...sample, value: Math.min(60_000, Math.max(0, Math.round(sample.value))) });
  };
  const checkReady = () => {
    if (!awaiting || !document.querySelector(`[data-performance-ready="${span.surface}"]`)) return;
    awaiting = false;
    add({ metric: "surface_ready", surface: span.surface, value: performance.now() - span.startedAt, result: "ready" });
  };
  const scheduleCheck = () => {
    if (!awaiting || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; checkReady(); });
  };
  const changed = () => {
    span = navigation ?? { surface: surfaceFor(window.location.href), startedAt: performance.now() };
    navigation = null;
    awaiting = span.surface !== "other";
    scheduleCheck();
  };
  const mutation = new MutationObserver(scheduleCheck);
  mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-performance-ready"] });
  for (const [type, metric] of [["largest-contentful-paint", "lcp"], ["longtask", "long_task"]] as const) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) add({ metric, surface: metric === "lcp" ? initialSurface : span.surface, value: metric === "lcp" ? entry.startTime : entry.duration, result: "ready" });
      });
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch { /* Unsupported browser timing never affects the application. */ }
  }
  const flush = () => {
    if (documentBatches >= 5) return;
    const current = getPipelineReadCacheCounts();
    if (span.surface === "other") {
      samples = [];
      counts = current;
      return;
    }
    for (const kind of ["hit", "join", "miss"] as const) {
      if (current[kind] > counts[kind] && samples.length < 20) samples.push({ metric: `cache_${kind}`, surface: "other", value: Math.min(60_000, current[kind] - counts[kind]), result: "ready" });
    }
    counts = current;
    if (awaiting && performance.now() - span.startedAt >= 30_000) {
      awaiting = false;
      add({ metric: "surface_ready", surface: span.surface, value: performance.now() - span.startedAt, result: "timeout" });
    }
    if (!samples.length) return;
    const batch = samples;
    samples = [];
    documentBatches += 1;
    void fetch(toPipelinePath("/api/me/performance"), { method: "POST", credentials: "same-origin", cache: "no-store", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch) }).catch(() => undefined);
  };
  const timer = window.setInterval(flush, 60_000);
  window.addEventListener("pipeline:navigation", changed);
  window.addEventListener("popstate", changed);
  window.addEventListener("pagehide", flush);
  scheduleCheck();
  return () => {
    mutation.disconnect();
    observers.forEach((observer) => observer.disconnect());
    cancelAnimationFrame(frame);
    window.clearInterval(timer);
    window.removeEventListener("pipeline:navigation", changed);
    window.removeEventListener("popstate", changed);
    window.removeEventListener("pagehide", flush);
  };
}

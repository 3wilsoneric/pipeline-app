"use client";

import { useEffect } from "react";

import {
  PIPELINE_DESKTOP_CACHE_PREFIX,
  PIPELINE_SERVICE_WORKER_PATH,
  isPipelineDesktopEnabled,
} from "@/lib/desktop/desktop-config";

export default function DesktopRuntime() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (!isPipelineDesktopEnabled()) {
      void removePipelineDesktopRuntime();
      return;
    }

    if (!window.isSecureContext && window.location.hostname !== "localhost") return;

    let cancelled = false;
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register(PIPELINE_SERVICE_WORKER_PATH, {
          scope: "/",
          updateViaCache: "none",
        });
        if (!cancelled) {
          const ready = await navigator.serviceWorker.ready;
          ready.active?.postMessage({ type: "PIPELINE_PRUNE_DESKTOP_CACHES" });
          await registration.update();
        }
      } catch {
        // Installation support must never prevent the web application from loading.
      }
    };

    void register();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

async function removePipelineDesktopRuntime() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => (
          registration.active ?? registration.waiting ?? registration.installing
        )?.scriptURL.endsWith(PIPELINE_SERVICE_WORKER_PATH))
        .map(async (registration) => {
          registration.active?.postMessage({ type: "PIPELINE_DISABLE_DESKTOP_CACHE" });
          await registration.unregister();
        }),
    );

    if (!("caches" in window)) return;
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(PIPELINE_DESKTOP_CACHE_PREFIX))
        .map((name) => window.caches.delete(name)),
    );
  } catch {
    // Cleanup is best effort and intentionally invisible to ordinary web sessions.
  }
}

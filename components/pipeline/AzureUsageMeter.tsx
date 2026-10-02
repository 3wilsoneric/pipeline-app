"use client";

import { useEffect, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { AzureUsageSnapshot } from "@/lib/observability/azure-usage";

export default function AzureUsageMeter() {
  const [usage, setUsage] = useState<AzureUsageSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void fetchPipelineJson<AzureUsageSnapshot>("/api/operations/azure-usage", { cache: "no-store", signal: controller.signal })
        .then((snapshot) => { if (!controller.signal.aborted) { setUsage(snapshot); setUnavailable(false); } })
        .catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  return <section aria-label="Live database usage" className="min-w-0 rounded-paper border border-card-border bg-paper px-4 py-2.5">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h3 className="text-sm font-semibold leading-5">Database usage</h3>
      <p className="text-xs leading-4 text-ink-muted">{usage && !unavailable ? `Azure sample ${new Date(usage.sampledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · refreshes every minute` : unavailable ? "Usage temporarily unavailable" : "Loading usage…"}</p>
    </div>
    {usage && !unavailable ? <div className="mt-2 grid grid-cols-3 items-start gap-x-3 gap-y-1.5">
      <UsageValue label="CPU" value={usage.cpuPercent} />
      <UsageValue label="Memory" value={usage.memoryPercent} />
      <div className="min-w-0"><strong className="block text-base font-semibold leading-5 tabular-nums">{Math.round(usage.activeConnections)}</strong><span className="block text-xs leading-4 text-ink-muted">Active connections</span></div>
      <p className="col-span-3 text-xs text-ink-muted">Highest 1-minute CPU average in the past hour: {usage.cpuPeakHourPercent.toFixed(1)}%. Azure publishes these readings after collection.</p>
    </div> : null}
  </section>;
}

function UsageValue({ label, value }: { label: string; value: number }) {
  const percentage = Math.max(0, Math.min(100, value));
  return <div className="min-w-0">
    <strong className="block text-base font-semibold leading-5 tabular-nums">{value.toFixed(1)}%</strong>
    <label htmlFor={`azure-usage-${label.toLowerCase()}`} className="block text-xs leading-4 text-ink-muted">{label}</label>
    <meter id={`azure-usage-${label.toLowerCase()}`} min="0" max="100" value={percentage} aria-label={`Database ${label}`} className="mt-1 h-1 w-full" />
  </div>;
}

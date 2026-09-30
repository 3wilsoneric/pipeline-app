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

  return <section aria-label="Live database usage" className="rounded-lg border border-[#d7dfdb] bg-white px-4 py-3">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 className="text-sm font-semibold">Database usage</h3>
      <p className="text-xs text-[#53665d]">{usage && !unavailable ? `Azure sample ${new Date(usage.sampledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · refreshes every minute` : unavailable ? "Usage temporarily unavailable" : "Loading usage…"}</p>
    </div>
    {usage && !unavailable ? <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <UsageValue label="CPU" value={usage.cpuPercent} />
      <UsageValue label="Memory" value={usage.memoryPercent} />
      <div className="text-sm"><span className="text-[#53665d]">Active connections</span><strong className="mt-1 block text-lg leading-none">{Math.round(usage.activeConnections)}</strong></div>
      <p className="text-xs text-[#53665d] sm:col-span-3">Highest 1-minute CPU average in the past hour: {usage.cpuPeakHourPercent.toFixed(1)}%. Azure publishes these readings after collection.</p>
    </div> : null}
  </section>;
}

function UsageValue({ label, value }: { label: string; value: number }) {
  const percentage = Math.max(0, Math.min(100, value));
  return <div className="text-sm">
    <div className="flex items-baseline justify-between gap-2"><label htmlFor={`azure-usage-${label.toLowerCase()}`} className="text-[#53665d]">{label}</label><strong>{value.toFixed(1)}%</strong></div>
    <meter id={`azure-usage-${label.toLowerCase()}`} min="0" max="100" value={percentage} aria-label={`Database ${label}`} className="mt-1 h-2 w-full" />
  </div>;
}

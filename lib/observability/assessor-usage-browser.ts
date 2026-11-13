"use client";
import { pipelinePageHeaders } from "@/lib/auth/browser-session";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export function observeAssessorUsage() {
  let stopped = false, accountId = "", pending = false;
  const sessionId = crypto.randomUUID();
  const samples = new Map<string, number>();
  const acknowledged = new Map<string, number>();
  const controller = new AbortController();
  const practice = () => {
    const params = new URLSearchParams(location.search);
    return params.get("demo") === "1" || params.has("trainingAssessment") || params.has("trainingIntake");
  };
  if (practice()) return () => {};
  // Failure is deliberately silent and isolated from clinical saves and sign-in.
  void fetch(toPipelinePath("/api/me/usage"), { headers: pipelinePageHeaders(), cache: "no-store", signal: controller.signal })
    .then(async (response) => response.ok ? response.json() : null)
    .then((result) => { if (!stopped && result?.enabled) accountId = result.accountId; })
    .catch(() => {});

  function interact(event: Event) {
    if (!accountId || stopped || practice() || !event.isTrusted || document.visibilityState !== "visible" || !document.hasFocus()) return;
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    const control = event.type === "click" && event.target instanceof Element
      && event.target.closest('button,a[href],input:not([type="text"]):not([type="email"]):not([type="tel"]):not([type="password"]),select,[role="button"],[role="tab"],[role="checkbox"],[role="radio"]');
    // Native keyboard activations generate click too; do not count keydown again.
    samples.set(minute, Math.min(600, (samples.get(minute) ?? 0) + (control ? 1 : 0)));
  }
  async function flush() {
    if (!accountId || stopped || pending) return;
    for (const minute of samples.keys()) if (Date.parse(minute) < Date.now() - 4 * 60_000) { samples.delete(minute); acknowledged.delete(minute); }
    const batch = [...samples].filter(([minute, count]) => acknowledged.get(minute) !== count)
      .slice(-5).map(([minute, interactions]) => ({ minute, interactions }));
    if (!batch.length) return;
    pending = true;
    try {
      const response = await fetch(toPipelinePath("/api/me/usage"), {
        method: "POST", credentials: "same-origin", keepalive: true,
        headers: { ...pipelinePageHeaders(), "Content-Type": "application/json", "x-pipeline-usage-account": accountId },
        body: JSON.stringify({ sessionId, samples: batch }),
      });
      if ([401, 403, 409].includes(response.status)) { stopped = true; samples.clear(); }
      if (response.ok) for (const sample of batch) acknowledged.set(sample.minute, sample.interactions);
    } catch { /* At most four minutes of aggregate retry; no durable browser tracking store. */ }
    finally { pending = false; }
  }
  const events = ["click", "keydown", "input", "wheel", "touchstart"];
  events.forEach((event) => document.addEventListener(event, interact, { passive: true, capture: true }));
  const hide = () => { if (document.visibilityState === "hidden") void flush(); };
  const unload = () => { void flush(); };
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", unload);
  const timer = window.setInterval(() => { void flush(); }, 30_000);
  return () => {
    void flush();
    stopped = true;
    controller.abort();
    clearInterval(timer);
    events.forEach((event) => document.removeEventListener(event, interact, true));
    document.removeEventListener("visibilitychange", hide);
    window.removeEventListener("pagehide", unload);
  };
}

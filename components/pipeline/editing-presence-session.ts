"use client";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { EditingPresence, EditingPresenceSection } from "@/lib/pipeline/editing-presence";

type Lease = { id: string; retired: boolean; busy: boolean };

// Presence is advisory, not a save lock. Hidden tabs can run timers only once a
// minute, longer than the server's 45-second lease; retire instead of renewing
// expired markers forever. A fresh lease isolates each return from late cleanup.
export function startEditingPresenceSession({ referralId, section, onPresence }: {
  referralId: number;
  section: EditingPresenceSection;
  onPresence?: (presence: Array<EditingPresence & { is_me?: boolean }>) => void;
}) {
  const url = `/api/referrals/${referralId}/presence`;
  let lease: Lease | null = null;
  let interval: number | undefined;
  let disposed = false;
  let pageHidden = false;
  const isVisible = () => !disposed && !pageHidden && document.visibilityState === "visible" && navigator.onLine;
  const isCurrent = (candidate: Lease) => lease === candidate && !candidate.retired && isVisible();

  const release = (candidate: Lease) => {
    void fetchPipelineJson(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lease_id: candidate.id }),
      keepalive: true,
    }).catch(() => undefined);
  };

  const heartbeat = async (candidate: Lease) => {
    if (!isCurrent(candidate) || candidate.busy) return;
    candidate.busy = true;
    try {
      await fetchPipelineJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lease_id: candidate.id, section }),
      });
      if (!isCurrent(candidate) || !onPresence) return;
      const payload = await fetchPipelineJson<{ presence: Array<EditingPresence & { is_me?: boolean }> }>(url, { cache: "no-store" });
      if (isCurrent(candidate)) onPresence(payload.presence);
    } catch {
      // A missing presence update never blocks editing or changes save state.
    } finally {
      candidate.busy = false;
      // A POST already in flight can finish after the first DELETE. Clean up
      // that old lease again, never the fresh lease created when work resumed.
      if (candidate.retired) release(candidate);
    }
  };

  const retire = () => {
    window.clearInterval(interval);
    interval = undefined;
    if (!lease) return;
    const previous = lease;
    lease = null;
    previous.retired = true;
    release(previous);
  };
  const refresh = () => {
    if (!isVisible()) {
      retire();
      return;
    }
    if (!lease) {
      lease = { id: crypto.randomUUID(), retired: false, busy: false };
      const current = lease;
      interval = window.setInterval(() => { void heartbeat(current); }, 15_000);
    }
    void heartbeat(lease);
  };
  const hide = () => { pageHidden = true; retire(); };
  const show = () => { pageHidden = false; refresh(); };
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  window.addEventListener("focus", refresh);
  window.addEventListener("offline", refresh);
  window.addEventListener("online", refresh);
  refresh();

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("offline", refresh);
    window.removeEventListener("online", refresh);
    retire();
    // If the browser is killed/offline, best-effort release can fail. The
    // unchanged server TTL remains the fallback; no new durable queue is needed.
    // Revisit alert classification only if these one-off expirations, rather
    // than repeated hidden-tab renewals, still exceed the alert threshold.
  };
}

"use client";

import { useEffect, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { PacketFieldsResponse, PacketStatusResponse } from "@/lib/extraction/contracts";

// Extraction is optional: polling never owns the workspace save or navigation state.
export function usePacketExtraction(packetId: string | undefined) {
  const [result, setResult] = useState<{
    packetId: string;
    status: PacketStatusResponse["status"] | "unavailable";
    packet?: PacketFieldsResponse;
  }>();

  useEffect(() => {
    if (!packetId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(refresh, 5000);
        return;
      }
      try {
        const status = await fetchPipelineJson<PacketStatusResponse>(`/api/packets/${encodeURIComponent(packetId)}/status`, { cache: "no-store", signal: controller.signal });
        const finished = status.status === "ready_for_review" || status.status === "reviewed";
        const packet = finished
          ? await fetchPipelineJson<PacketFieldsResponse>(`/api/packets/${encodeURIComponent(packetId)}/fields`, { cache: "no-store", signal: controller.signal })
          : undefined;
        if (cancelled) return;
        setResult({ packetId, status: status.status, packet });
        if (finished || status.status === "failed" || status.status === "received") return;
      } catch {
        if (cancelled) return;
        setResult((previous) => ({ packetId, status: "unavailable", ...(previous?.packetId === packetId ? { packet: previous.packet } : {}) }));
      }
      timer = setTimeout(refresh, 5000);
    };
    void refresh();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [packetId]);

  return result?.packetId === packetId ? result : undefined;
}

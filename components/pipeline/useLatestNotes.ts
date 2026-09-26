"use client";

import { useEffect, useSyncExternalStore } from "react";

import { fetchPipelineJson, onPipelineSessionCleared, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import type { LatestNote } from "@/lib/pipeline/client-notes";

// The latest client note per referral, shared by the Home board and Workspaces, and updated at once when a
// note is saved on this device (docs/design/DECISIONS.md, "Notes").
let notes = new Map<number, LatestNote>();
let requestedKey = "";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => notes;
const empty = new Map<number, LatestNote>();
onPipelineSessionCleared(() => { notes = new Map(); requestedKey = ""; emit(); });

export function rememberLatestNote(referralId: number, body: string, updatedAt: string) {
  const text = body.split("\n").map((line) => line.trim()).find(Boolean);
  const next = new Map(notes);
  if (text) next.set(referralId, { referral_id: referralId, text: text.slice(0, 300), updated_at: updatedAt });
  else next.delete(referralId);
  notes = next;
  emit();
}

export function useLatestNotes(referralIds: readonly number[]) {
  const generation = usePipelineDataGeneration();
  const key = `${generation}:${[...referralIds].sort((left, right) => left - right).join(",")}`;
  useEffect(() => {
    if (!referralIds.length || requestedKey === key) return;
    requestedKey = key;
    void fetchPipelineJson<{ notes: LatestNote[] }>(`/api/client-notes/latest?referral_ids=${referralIds.slice(0, 300).join(",")}`, { cache: "no-store" }, { cacheTtlMs: 30_000 })
      .then((payload) => {
        const next = new Map(notes);
        for (const id of referralIds) next.delete(id);
        for (const note of payload.notes) next.set(note.referral_id, note);
        notes = next;
        emit();
      })
      // Notes are a convenience on the board; the board works without them.
      .catch(() => { if (requestedKey === key) requestedKey = ""; });
  }, [key, referralIds]);
  return useSyncExternalStore(subscribe, snapshot, () => empty);
}

// Reads the shared latest notes without asking for more (a parent list asks for its referrals).
const noReferrals: readonly number[] = [];
export function useLatestNote(referralId: number) {
  return useLatestNotes(noReferrals).get(referralId);
}

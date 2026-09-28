"use client";

import { useEffect, useSyncExternalStore } from "react";

import { fetchPipelineJson, onPipelineSessionCleared, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import type { LatestNote } from "@/lib/pipeline/client-notes";

// The latest client note per referral, shared by the Home board and Workspaces, and updated at once when a
// note is saved on this device (docs/design/DECISIONS.md, "Notes").
let notes = new Map<number, LatestNote>();
let revision = 0;
let session = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => notes;
const empty = new Map<number, LatestNote>();
onPipelineSessionCleared(() => { notes = new Map(); session += 1; revision += 1; emit(); });

export function rememberLatestNote(referralId: number, body: string, updatedAt: string) {
  const text = body.split("\n").map((line) => line.trim()).find(Boolean);
  const next = new Map(notes);
  if (text && (!next.has(referralId) || next.get(referralId)!.updated_at <= updatedAt)) {
    next.set(referralId, { referral_id: referralId, text: text.slice(0, 300), updated_at: updatedAt });
  }
  // Clearing one heading may reveal another. Reload the canonical summary;
  // don't erase a referral's summary based on just that one heading.
  revision += 1;
  notes = next;
  emit();
}

export function useLatestNotes(referralIds: readonly number[]) {
  const generation = usePipelineDataGeneration();
  const value = useSyncExternalStore(subscribe, snapshot, () => empty);
  const ids = [...new Set(referralIds)].sort((left, right) => left - right).slice(0, 300).join(",");
  const noteRevision = revision;
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    const startedSession = session;
    const requestedIds = ids.split(",").map(Number);
    void fetchPipelineJson<{ notes: LatestNote[] }>(`/api/client-notes/latest?referral_ids=${ids}`, { cache: "no-store", signal: controller.signal }, { cacheTtlMs: 30_000 })
      .then((payload) => {
        if (controller.signal.aborted || startedSession !== session || noteRevision !== revision) return;
        const next = new Map(notes);
        for (const id of requestedIds) next.delete(id);
        for (const note of payload.notes) next.set(note.referral_id, note);
        notes = next;
        emit();
      })
      // Notes are a convenience on the board; the board works without them.
      .catch(() => undefined);
    return () => controller.abort();
  }, [ids, generation, noteRevision]);
  return value;
}

// Reads the shared latest notes without asking for more (a parent list asks for its referrals).
const noReferrals: readonly number[] = [];
export function useLatestNote(referralId: number) {
  return useLatestNotes(noReferrals).get(referralId);
}

"use client";

import { useEffect, useSyncExternalStore } from "react";

import { fetchPipelineJson, onPipelineSessionCleared, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import { clientNotePreview, type LatestNote } from "@/lib/pipeline/client-notes";

// The latest client note per referral, shared by the Home board and Workspaces, and updated at once when a
// note is saved on this device (docs/design/DECISIONS.md, "Notes").
const empty = { notes: new Map<number, LatestNote>(), revision: 0, session: 0 };
let state = empty;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => state;
onPipelineSessionCleared(() => {
  state = { notes: new Map(), session: state.session + 1, revision: state.revision + 1 };
  emit();
});

export function rememberLatestNote(referralId: number, body: string, updatedAt: string) {
  const text = clientNotePreview(body);
  const next = new Map(state.notes);
  if (text && (!next.has(referralId) || next.get(referralId)!.updated_at <= updatedAt)) {
    next.set(referralId, { referral_id: referralId, text: text.slice(0, 300), updated_at: updatedAt });
  }
  // Clearing one heading may reveal another. Reload the canonical summary;
  // don't erase a referral's summary based on just that one heading.
  state = { ...state, notes: next, revision: state.revision + 1 };
  emit();
}

export function useLatestNotes(referralIds: readonly number[]) {
  const generation = usePipelineDataGeneration();
  const value = useSyncExternalStore(subscribe, snapshot, () => empty);
  const ids = [...new Set(referralIds)].sort((left, right) => left - right).slice(0, 300).join(",");
  // The revision and account boundary must be reactive snapshot values too.
  // Reading mutable module counters here lets React Compiler memoize them away.
  const noteRevision = value.revision;
  const noteSession = value.session;
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    const requestedIds = ids.split(",").map(Number);
    void fetchPipelineJson<{ notes: LatestNote[] }>(`/api/client-notes/latest?referral_ids=${ids}`, { cache: "no-store", signal: controller.signal }, { cacheTtlMs: 30_000 })
      .then((payload) => {
        if (controller.signal.aborted || noteSession !== snapshot().session || noteRevision !== snapshot().revision) return;
        const next = new Map(snapshot().notes);
        for (const id of requestedIds) next.delete(id);
        for (const note of payload.notes) next.set(note.referral_id, note);
        state = { ...state, notes: next };
        emit();
      })
      // Notes are a convenience on the board; the board works without them.
      .catch(() => undefined);
    return () => controller.abort();
  }, [ids, generation, noteRevision, noteSession]);
  return value.notes;
}

// Reads the shared latest notes without asking for more (a parent list asks for its referrals).
const noReferrals: readonly number[] = [];
export function useLatestNote(referralId: number) {
  return useLatestNotes(noReferrals).get(referralId);
}

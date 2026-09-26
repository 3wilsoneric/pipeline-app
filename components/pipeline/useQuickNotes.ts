"use client";

import { useEffect, useSyncExternalStore } from "react";

import { fetchPipelineJson, onPipelineSessionCleared, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import type { ReferralQuickNote } from "@/lib/pipeline/referral-quick-notes";

// One shared copy of the signed-in person's quick notes, so a note saved in a record shows on the
// board and the workspace list without a reload. Notes are private: the server returns only the caller's own.
let notes = new Map<number, ReferralQuickNote>();
let loadedKey = "";
let sessionVersion = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => notes;
const emptyNotes = new Map<number, ReferralQuickNote>();
const emptySnapshot = () => emptyNotes;
// Another person may sign in on this browser next: forget this person's notes with their session.
onPipelineSessionCleared(() => { notes = new Map(); loadedKey = ""; sessionVersion += 1; emit(); });
const sessionSnapshot = () => sessionVersion;
const emptySession = () => 0;

async function load(generation: number, session: number) {
  const key = `${session}:${generation}`;
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const payload = await fetchPipelineJson<{ notes: ReferralQuickNote[] }>("/api/me/quick-notes", { cache: "no-store" }, { cacheTtlMs: 60_000 });
    if (session !== sessionVersion) return;
    notes = new Map(payload.notes.map((note) => [note.referralId, note]));
    emit();
  } catch {
    // Notes are a convenience; the board and records work without them. Retry on the next data refresh.
    if (loadedKey === key) loadedKey = "";
  }
}

export function useQuickNotes() {
  const generation = usePipelineDataGeneration();
  const session = useSyncExternalStore(subscribe, sessionSnapshot, emptySession);
  useEffect(() => { void load(generation, session); }, [generation, session]);
  return useSyncExternalStore(subscribe, snapshot, emptySnapshot);
}

export function useQuickNote(referralId: number | undefined) {
  const all = useQuickNotes();
  return referralId ? all.get(referralId) : undefined;
}

// Saves (or, when empty, clears) the caller's note. Shows the new text at once and restores the
// previous note if the save fails, so the caller can keep the typed text and say it was not saved.
export async function saveQuickNote(referralId: number, text: string) {
  const previous = notes.get(referralId);
  const optimistic = new Map(notes);
  const trimmed = text.trim();
  if (trimmed) optimistic.set(referralId, { referralId, text: trimmed, updatedAt: new Date().toISOString(), version: previous?.version ?? 0 });
  else optimistic.delete(referralId);
  notes = optimistic;
  emit();
  try {
    const payload = await fetchPipelineJson<{ note: ReferralQuickNote | null }>(`/api/referrals/${referralId}/quick-note`, { method: "PUT", body: JSON.stringify({ text: trimmed }) });
    const next = new Map(notes);
    if (payload.note) next.set(referralId, payload.note); else next.delete(referralId);
    notes = next;
    emit();
  } catch (error) {
    const restored = new Map(notes);
    if (previous) restored.set(referralId, previous); else restored.delete(referralId);
    notes = restored;
    emit();
    throw error;
  }
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { NotebookBlock } from "@/lib/assessment/assessment-notebook";

// Interview notebook state (docs/design/DECISIONS.md, "Interview notebook"). Each heading saves on its own:
// shortly after typing pauses and when it is left, one request at a time per heading, retried by itself
// when the connection drops. Nothing here ever blocks the page; a heading edited elsewhere is surfaced as
// a choice instead of being overwritten.

export type NotebookStatus = "loading" | "saved" | "saving" | "waiting" | "failed";
type Entry = { body: string; version: number; saved: string };
type Conflict = { theirs: NotebookBlock };

const saveDelayMs = 700;
const retryDelaysMs = [2_000, 5_000, 10_000, 20_000, 30_000];

export function useInterviewNotebook(assessmentId: string, locked: boolean) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<Record<string, true>>({});
  const [waiting, setWaiting] = useState<Record<string, true>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<Record<string, Conflict>>({});
  const [serverLocked, setServerLocked] = useState(false);
  const entriesRef = useRef(entries);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inFlight = useRef(new Map<string, Promise<void>>());
  const attempts = useRef(new Map<string, number>());

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPipelineJson<{ blocks: NotebookBlock[]; locked: boolean }>(`/api/assessments/${encodeURIComponent(assessmentId)}/notebook`, { signal: controller.signal, cache: "no-store" })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const next: Record<string, Entry> = {};
        for (const block of payload.blocks) next[block.block_key] = { body: block.body, version: block.version, saved: block.body };
        entriesRef.current = next;
        setEntries(next);
        setServerLocked(payload.locked);
        setLoaded(true);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [assessmentId]);

  const clear = (setter: typeof setPending | typeof setWaiting, key: string) => setter((current) => {
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  });

  // Sends the heading's latest text; queues behind a save already in flight for the same heading.
  const send = useCallback((key: string): Promise<void> => {
    const previous = inFlight.current.get(key) ?? Promise.resolve();
    const run = previous.then(async () => {
      const entry = entriesRef.current[key];
      if (!entry || entry.body === entry.saved) { clear(setPending, key); return; }
      const body = entry.body;
      try {
        const payload = await fetchPipelineJson<{ block: NotebookBlock }>(`/api/assessments/${encodeURIComponent(assessmentId)}/notebook/${encodeURIComponent(key)}`, {
          method: "PUT",
          body: JSON.stringify({ body, if_match: entry.version }),
        });
        attempts.current.delete(key);
        const next = { ...entriesRef.current, [key]: { body: entriesRef.current[key]?.body ?? body, version: payload.block.version, saved: payload.block.body } };
        entriesRef.current = next;
        setEntries(next);
        clear(setWaiting, key);
        setFailed((current) => { if (!(key in current)) return current; const copy = { ...current }; delete copy[key]; return copy; });
        if (next[key].body !== next[key].saved) void send(key); else clear(setPending, key);
      } catch (error) {
        if (error instanceof PipelineApiError && error.status === 409) {
          const theirs = (error.payload as { block?: NotebookBlock | null } | undefined)?.block ?? null;
          const current = entriesRef.current[key];
          // Nothing of ours was lost if the other screen saved exactly what we last saw: continue from it.
          if (!theirs || theirs.body === current.saved) {
            const next = { ...entriesRef.current, [key]: { ...current, version: theirs?.version ?? 0 } };
            entriesRef.current = next;
            setEntries(next);
            void send(key);
            return;
          }
          setConflicts((existing) => ({ ...existing, [key]: { theirs } }));
          clear(setPending, key);
          return;
        }
        if (error instanceof PipelineApiError && error.status === 423) { setServerLocked(true); clear(setPending, key); return; }
        if (error instanceof PipelineApiError && error.status >= 400 && error.status < 500) {
          setFailed((current) => ({ ...current, [key]: error.message }));
          clear(setPending, key);
          return;
        }
        // Network or server trouble: keep the text here and try again by itself.
        const attempt = attempts.current.get(key) ?? 0;
        attempts.current.set(key, attempt + 1);
        setWaiting((current) => ({ ...current, [key]: true }));
        clearTimeout(timers.current.get(key));
        timers.current.set(key, setTimeout(() => void send(key), retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)]));
      }
    });
    inFlight.current.set(key, run.catch(() => undefined));
    return run;
  }, [assessmentId]);

  const change = useCallback((key: string, body: string) => {
    const current = entriesRef.current[key] ?? { body: "", version: 0, saved: "" };
    const next = { ...entriesRef.current, [key]: { ...current, body } };
    entriesRef.current = next;
    setEntries(next);
    setPending((existing) => ({ ...existing, [key]: true }));
    clearTimeout(timers.current.get(key));
    timers.current.set(key, setTimeout(() => void send(key), saveDelayMs));
  }, [send]);

  const flush = useCallback((key: string) => {
    clearTimeout(timers.current.get(key));
    void send(key);
  }, [send]);

  const resolve = useCallback((key: string, keep: "mine" | "theirs") => {
    const conflict = conflicts[key];
    if (!conflict) return;
    const current = entriesRef.current[key];
    const next = { ...entriesRef.current, [key]: keep === "theirs"
      ? { body: conflict.theirs.body, version: conflict.theirs.version, saved: conflict.theirs.body }
      : { body: current.body, version: conflict.theirs.version, saved: conflict.theirs.body } };
    entriesRef.current = next;
    setEntries(next);
    setConflicts((existing) => { const copy = { ...existing }; delete copy[key]; return copy; });
    if (keep === "mine") { setPending((existing) => ({ ...existing, [key]: true })); void send(key); }
  }, [conflicts, send]);

  // Send anything unsent when the page hides or this assessment closes.
  useEffect(() => {
    const flushAll = () => { for (const [key, entry] of Object.entries(entriesRef.current)) if (entry.body !== entry.saved) void send(key); };
    const onHide = () => { if (document.visibilityState === "hidden") flushAll(); };
    const pendingTimers = timers.current;
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", flushAll);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", flushAll);
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      flushAll();
    };
  }, [send]);

  const status: NotebookStatus = !loaded ? "loading"
    : Object.keys(failed).length || Object.keys(conflicts).length ? "failed"
    : Object.keys(waiting).length ? "waiting"
    : Object.keys(pending).length ? "saving" : "saved";

  return { entries, loaded, loadFailed, status, failed, conflicts, locked: locked || serverLocked, change, flush, resolve };
}

"use client";

import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { loadOfflineClientNotes, saveOfflineClientNotes } from "@/lib/offline/offline-assessment-store";
import type { ClientNoteDraft, NoteBlock } from "@/lib/pipeline/client-notes";
import { rememberLatestNote } from "./useLatestNotes";

export type NotesStatus = "loading" | "saved" | "saving" | "waiting" | "failed";
type Snapshot = {
  entries: Record<string, ClientNoteDraft>; loaded: boolean; loadFailed: boolean;
  pending: Record<string, true>; waiting: Record<string, true>; failed: Record<string, string>;
  conflicts: Record<string, { theirs: NoteBlock }>;
};
export const emptyNotes: Snapshot = { entries: {}, loaded: false, loadFailed: false, pending: {}, waiting: {}, failed: {}, conflicts: {} };
const retryDelays = [2_000, 5_000, 10_000, 20_000, 30_000];

// One owner per account/referral in this document. Closing a panel doesn't discard a
// save; multiple mounted views use the same text, version, and per-heading queue.
export class ClientNotesController {
  state = emptyNotes;
  private listeners = new Set<() => void>();
  private requests = new AbortController();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Set<string>();
  private attempts = new Map<string, number>();
  private recovery = Promise.resolve();
  private recoveredId?: string;
  private loading?: Promise<void>;
  private disposed = false;
  private recoveryReadable = true;
  private revision = 0;

  constructor(private principal: string, private referralId: number) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<Snapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private clear(field: "pending" | "waiting" | "failed" | "conflicts", key: string) {
    const next = { ...this.state[field] }; delete next[key]; this.update({ [field]: next });
  }
  private put(key: string, entry: ClientNoteDraft) {
    this.revision += 1;
    this.update({ entries: { ...this.state.entries, [key]: entry } });
  }

  load = (): Promise<void> => {
    if (this.loading) return this.loading;
    if (this.inFlight.size) return Promise.resolve();
    this.recoveryReadable = true;
    this.update({ loadFailed: false });
    this.loading = this.restore().catch(() => this.update({ loadFailed: true })).finally(() => { this.loading = undefined; });
    return this.loading;
  };
  private async restore() {
    const revision = this.revision;
    const [payload, recovered] = await Promise.all([
      fetchPipelineJson<{ blocks: NoteBlock[] }>(`/api/referrals/${this.referralId}/notes`, { signal: this.requests.signal, cache: "no-store" }),
      loadOfflineClientNotes(this.principal, this.referralId).catch(() => {
        // A blocked browser store must not prevent canonical server saves. Leave
        // the unreadable recovery copy intact and expose the unsaved status.
        this.recoveryReadable = false;
        this.update({ failed: { ...this.state.failed, _recovery: "Not saved" } });
        return null;
      }),
    ]);
    // A refresh begun before typing or a save acknowledgment must not replace
    // either. The next focus/reopen refresh or version conflict reconciles it.
    if (this.disposed || revision !== this.revision) return;
    const entries: Snapshot["entries"] = {};
    const conflicts: Snapshot["conflicts"] = {};
    const remote = new Map(payload.blocks.map((block) => [block.block_key, block]));
    for (const block of payload.blocks) entries[block.block_key] = { body: block.body, saved: block.body, version: block.version, updated_at: block.updated_at };
    // An in-memory edit is newer than a recovery read, including when Retry is clicked.
    for (const [key, draft] of Object.entries({ ...recovered?.entries, ...this.state.entries })) {
      if (draft.body === draft.saved) continue;
      const theirs = remote.get(key);
      const saved = theirs?.body ?? "";
      if (saved === draft.body) entries[key] = { body: saved, saved, version: theirs?.version ?? 0, updated_at: theirs?.updated_at };
      else if (saved === draft.saved || saved === draft.sent) entries[key] = { ...draft, saved, version: theirs?.version ?? 0, updated_at: theirs?.updated_at };
      else { entries[key] = draft; if (theirs) conflicts[key] = { theirs }; }
    }
    this.recoveredId = recovered?.recoveredId;
    this.update({ entries, conflicts, loaded: true, pending: {}, waiting: {}, failed: this.recoveryReadable ? {} : this.state.failed });
    this.preserve();
    this.flushAll();
  }

  private preserve() {
    if (!this.recoveryReadable) return;
    const entries = Object.fromEntries(Object.entries(this.state.entries).filter(([, entry]) => entry.body !== entry.saved));
    // Serialize snapshots so a slow encrypt/write can never replace a newer draft.
    this.recovery = this.recovery.catch(() => undefined).then(async () => {
      if (this.disposed) return;
      await saveOfflineClientNotes(this.principal, this.referralId, entries, this.recoveredId);
      this.recoveredId = undefined;
      this.clear("failed", "_recovery");
    }).catch(() => { if (Object.keys(entries).length) this.update({ failed: { ...this.state.failed, _recovery: "Not saved" } }); });
  }

  change = (key: string, body: string) => {
    if (!this.state.loaded || this.disposed) return;
    this.put(key, { ...(this.state.entries[key] ?? { version: 0, saved: "" }), body });
    this.update({ pending: { ...this.state.pending, [key]: true } });
    this.preserve();
    this.schedule(key, 700);
  };
  private schedule(key: string, delay: number) {
    clearTimeout(this.timers.get(key));
    if (!this.disposed) this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.send(key); }, delay));
  }
  flush = (key: string) => { clearTimeout(this.timers.get(key)); this.timers.delete(key); void this.send(key); };
  flushAll = () => { for (const key of Object.keys(this.state.entries)) this.flush(key); };

  private async send(key: string) {
    if (this.disposed || this.inFlight.has(key) || this.state.conflicts[key]) return;
    const entry = this.state.entries[key];
    if (!entry || entry.body === entry.saved) { this.clear("pending", key); return; }
    this.inFlight.add(key);
    this.update({ pending: { ...this.state.pending, [key]: true } });
    const previousSent = entry.sent;
    this.put(key, { ...entry, sent: entry.sent ?? entry.body });
    this.preserve();
    let again = false;
    try {
      const payload = await fetchPipelineJson<{ block: NoteBlock }>(`/api/referrals/${this.referralId}/notes/${encodeURIComponent(key)}`, {
        method: "PUT", signal: this.requests.signal, body: JSON.stringify({ body: entry.body, if_match: entry.version }),
      });
      if (this.disposed) return;
      this.accept(key, payload.block);
      again = true;
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof PipelineApiError && error.status === 409) {
        const theirs = (error.payload as { block?: NoteBlock | null })?.block;
        // Lost acknowledgments are successful saves, not user conflicts. Also
        // retain typing performed while that request was in flight.
        if (theirs && [entry.saved, entry.body, previousSent].includes(theirs.body)) {
          this.accept(key, theirs); again = true;
        } else if (theirs) {
          this.update({ conflicts: { ...this.state.conflicts, [key]: { theirs } } });
          this.clear("pending", key); this.clear("waiting", key);
        } else this.update({ failed: { ...this.state.failed, [key]: error.message } });
      } else if (error instanceof PipelineApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        this.update({ failed: { ...this.state.failed, [key]: error.message } });
        this.clear("pending", key);
      } else {
        const attempt = this.attempts.get(key) ?? 0;
        this.attempts.set(key, attempt + 1);
        this.update({ waiting: { ...this.state.waiting, [key]: true } });
        this.schedule(key, retryDelays[Math.min(attempt, retryDelays.length - 1)]);
      }
    } finally {
      this.inFlight.delete(key);
      if (again && !this.disposed) void this.send(key);
    }
  }

  private accept(key: string, block: NoteBlock) {
    this.put(key, { body: this.state.entries[key].body, saved: block.body, version: block.version, updated_at: block.updated_at });
    this.attempts.delete(key);
    this.clear("waiting", key); this.clear("failed", key);
    if (this.state.entries[key].body === block.body) this.clear("pending", key);
    this.preserve();
    rememberLatestNote(this.referralId, block.body, block.updated_at);
  }
  resolve = (key: string, keep: "mine" | "theirs") => {
    const conflict = this.state.conflicts[key];
    if (!conflict || this.disposed) return;
    if (keep === "theirs") this.put(key, { ...this.state.entries[key], body: conflict.theirs.body });
    this.accept(key, conflict.theirs);
    this.clear("conflicts", key);
    this.flush(key);
  };
  dispose() {
    this.disposed = true;
    this.requests.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
  canRelease() {
    return !this.listeners.size && !this.inFlight.size && !this.loading
      && Object.values(this.state.entries).every((entry) => entry.body === entry.saved);
  }
}

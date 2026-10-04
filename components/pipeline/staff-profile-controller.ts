"use client";

import { fetchCurrentPipelineUser, fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { loadOfflineStaffProfile, saveOfflineStaffProfile } from "@/lib/offline/offline-assessment-store";
import { emptyStaffProfile, parseStaffProfilePreferences, profilePreferences, reconcileProfileDraft, type StaffProfileDraft, type StaffProfilePreferences } from "@/lib/pipeline/staff-profile";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";

type State = {
  member: WorkspaceMember | null; draft: StaffProfileDraft; loading: boolean; saving: boolean;
  message?: { tone: "success" | "error"; text: string };
};
export const emptyProfileState: State = { member: null, draft: { base: emptyStaffProfile, form: profilePreferences(emptyStaffProfile) }, loading: true, saving: false };
const same = (a: StaffProfilePreferences, b: StaffProfilePreferences) => JSON.stringify(profilePreferences(a)) === JSON.stringify(profilePreferences(b));
const conflictMessage = "Your profile changed in another session. Your edits are still here. Review them, then save again.";
const failedMessage = "Your profile could not be saved. Your edits are still here.";

// Like Notes, the queue belongs to the account in this document, not the screen.
// Leaving Settings keeps saves alive. A reload restores the encrypted tab draft.
export class StaffProfileController {
  private state = emptyProfileState;
  private listeners = new Set<() => void>();
  private requests = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private loading?: Promise<void>;
  private recovery = Promise.resolve();
  private recoveredId?: string;
  private recoveryReadable = true;
  private readBeforeRetry = false;
  private attempts = 0;
  private disposed = false;

  constructor(private principal: string) {
    window.addEventListener("online", this.flush);
    window.addEventListener("pagehide", this.flush);
    window.addEventListener("beforeunload", this.beforeUnload);
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dirty = () => !same(this.state.draft.form, this.state.draft.base);
  private beforeUnload = (event: BeforeUnloadEvent) => { if (this.dirty() || this.state.saving || this.readBeforeRetry) event.preventDefault(); };
  private update(patch: Partial<State>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  load = () => {
    if (this.loading) return this.loading;
    if (this.state.member || this.disposed) return Promise.resolve();
    this.update({ loading: true, message: undefined });
    this.loading = this.restore().catch((error) => this.update({ message: { tone: "error", text: error instanceof Error ? error.message : "Your profile settings could not be loaded." } }))
      .finally(() => { this.update({ loading: false }); this.loading = undefined; });
    return this.loading;
  };
  private async restore() {
    const [payload, recovered] = await Promise.all([
      fetchPipelineJson<{ member: WorkspaceMember }>("/api/me/profile", { cache: "no-store", signal: this.requests.signal }),
      loadOfflineStaffProfile(this.principal).catch(() => { this.recoveryReadable = false; return null; }),
    ]);
    if (this.disposed) return;
    this.recoveredId = recovered?.recoveredId;
    const draft = recovered ? reconcileProfileDraft(recovered.draft, payload.member.profile)
      : { base: payload.member.profile, form: profilePreferences(payload.member.profile) };
    this.update({ member: payload.member, draft, message: draft.conflict ? { tone: "error", text: conflictMessage } : undefined });
    this.preserve();
    this.flush();
  }
  private preserve() {
    if (!this.recoveryReadable) return;
    const draft = this.dirty() || this.state.saving || this.readBeforeRetry || this.state.draft.conflict ? structuredClone(this.state.draft) : null;
    this.recovery = this.recovery.catch(() => undefined).then(async () => {
      if (this.disposed) return;
      await saveOfflineStaffProfile(this.principal, draft, this.recoveredId);
      this.recoveredId = undefined;
    }).catch(() => { if (this.dirty()) this.update({ message: { tone: "error", text: failedMessage } }); });
  }
  change = (field: keyof StaffProfilePreferences, value: string) => {
    if (!this.state.member || this.disposed) return;
    this.update({ draft: { ...this.state.draft, form: { ...this.state.draft.form, [field]: value || null } },
      message: this.state.draft.conflict ? this.state.message : undefined });
    this.preserve();
    this.schedule(700);
  };
  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (!this.disposed) this.timer = setTimeout(this.flush, delay);
  }
  flush = () => { clearTimeout(this.timer); void this.send(); };
  save = () => {
    if (this.state.draft.conflict) this.update({ draft: { ...this.state.draft, conflict: false }, message: undefined });
    this.preserve();
    this.flush();
  };
  finish = async () => {
    await this.send();
    await this.recovery;
    if (this.dirty() || this.readBeforeRetry || this.state.draft.conflict) throw new Error("Your profile changes have not been saved.");
  };
  private send(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.disposed || !this.state.member || this.state.draft.conflict || (!this.dirty() && !this.readBeforeRetry)) return Promise.resolve();
    this.inFlight = this.write().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  private async write() {
    this.update({ saving: true, message: undefined });
    let again = false;
    try {
      const { user } = await fetchCurrentPipelineUser();
      if (this.disposed || user.id !== this.principal) return;
      if (this.readBeforeRetry) {
        const { member } = await fetchPipelineJson<{ member: WorkspaceMember }>("/api/me/profile", { cache: "no-store", signal: this.requests.signal });
        if (this.disposed) return;
        this.reconcile(member);
        this.readBeforeRetry = false;
        if (!this.dirty() || this.state.draft.conflict) return;
      }
      const sent = { ...this.state.draft.form };
      const parsed = parseStaffProfilePreferences(sent);
      if (!parsed.ok) { this.update({ message: { tone: "error", text: parsed.message } }); return; }
      this.update({ draft: { ...this.state.draft, sent: parsed.profile } });
      this.preserve();
      const { member } = await fetchPipelineJson<{ member: WorkspaceMember }>("/api/me/profile", {
        method: "PATCH", signal: this.requests.signal,
        body: JSON.stringify({ if_match: this.state.draft.base.version, profile: parsed.profile }),
      });
      if (this.disposed) return;
      // Only acknowledge the submitted snapshot. Typing during the request wins.
      const form = { ...this.state.draft.form };
      for (const key of Object.keys(form) as Array<keyof StaffProfilePreferences>) if (form[key] === sent[key]) form[key] = member.profile[key];
      this.update({ member, draft: { base: member.profile, form }, message: same(form, member.profile) ? { tone: "success", text: "Profile saved." } : undefined });
      this.attempts = 0;
      again = this.dirty();
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof PipelineApiError && error.status === 409 && (error.payload as { member?: WorkspaceMember })?.member) {
        this.reconcile((error.payload as { member: WorkspaceMember }).member);
        again = this.dirty() && !this.state.draft.conflict;
      } else {
        this.update({ message: { tone: "error", text: error instanceof Error ? error.message : failedMessage } });
        if (!(error instanceof PipelineApiError) || error.status === 0 || error.status === 429 || error.status >= 500) {
          this.readBeforeRetry = true;
          this.schedule([2_000, 5_000, 10_000, 30_000][Math.min(this.attempts++, 3)]);
        }
      }
    } finally {
      this.update({ saving: false });
      this.preserve();
      if (again) this.schedule(0);
    }
  }
  private reconcile(member: WorkspaceMember) {
    const draft = reconcileProfileDraft(this.state.draft, member.profile);
    this.update({ member, draft, message: draft.conflict ? { tone: "error", text: conflictMessage }
      : same(draft.form, draft.base) ? { tone: "success", text: "Profile saved." } : undefined });
  }
  dispose() {
    this.disposed = true;
    this.requests.abort();
    clearTimeout(this.timer);
    window.removeEventListener("online", this.flush);
    window.removeEventListener("pagehide", this.flush);
    window.removeEventListener("beforeunload", this.beforeUnload);
  }
}

"use client";

import { fetchCurrentPipelineUser, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { flushOfflineAssessmentMutations, pendingOfflineAssessmentMutations, saveOfflineAssessmentDraft } from "@/lib/offline/offline-assessment-store";
import { saveLocalReferralRecovery, type ReferralLocalRecovery } from "@/lib/pipeline/referral-local-recovery";
import { saveServerReferralDraft, type ReferralRecoveryDraftKey } from "@/lib/pipeline/referral-draft-recovery";
import type { PipelineAssessmentDraft } from "@/lib/pipeline/user-workspace-state-types";
import type { RecipientFields } from "@/lib/pipeline/community-recipient-lists";
import type { MeetClientMessage } from "@/lib/notifications/meet-client-message";

// Last-resort copies live only in this document. They keep ordinary navigation
// usable during a simultaneous network/device-storage failure, not a reload.
type VolatileEntry = { principal: string; value: unknown; persist: () => Promise<void> };
const entries = new Map<string, VolatileEntry>();
let retrying = false;
let retryingAssessmentQueue = false;
let assessmentQueueMayBePending = true;
let activeAssessmentEditors = 0;
const activeRecoveryEditors = new Map<string, number>();
const changed = () => window.dispatchEvent(new Event("pipeline:volatile-recovery-changed"));

const referralKey = (reference: ReferralRecoveryDraftKey) => `referral:${String(reference ?? "new")}`;
const assessmentKey = (assessmentId: string) => `assessment:${assessmentId}`;
const handoffKey = (referralId: number, community: string) => `handoff:${referralId}:${community}`;
export type VolatileHandoffRecovery = {
  version: number;
  fields: RecipientFields & { message: MeetClientMessage };
  input: { to: string; cc: string };
};

export function rememberVolatileHandoffRecovery(principal: string, referralId: number, community: string, recovery: VolatileHandoffRecovery) {
  const endpoint = `/api/referrals/${referralId}/handoff-recipients`;
  entries.set(handoffKey(referralId, community), {
    principal, value: recovery,
    persist: async () => {
      if (recovery.input.to.trim() || recovery.input.cc.trim()) throw new Error("An unfinished address remains in the open tab.");
      const saved = await fetchPipelineJson<{ draft: (RecipientFields & { community: string; message?: MeetClientMessage }) | null; version: number }>(endpoint, { cache: "no-store" });
      if (saved.draft?.community === community && JSON.stringify({ to: saved.draft.to, cc: saved.draft.cc, message: saved.draft.message }) === JSON.stringify(recovery.fields)) return;
      if (saved.version !== recovery.version) throw new Error("The handoff changed in another session.");
      await fetchPipelineJson(endpoint, { method: "PUT", body: JSON.stringify({ if_match: saved.version, draft: { ...recovery.fields, community } }) });
    },
  });
  changed();
}

export async function currentVolatileHandoffRecovery(referralId: number, community: string) {
  const entry = entries.get(handoffKey(referralId, community));
  if (!entry) return null;
  const principal = (await fetchCurrentPipelineUser()).user?.id;
  return principal && entry.principal === principal ? entry.value as VolatileHandoffRecovery : null;
}

export function forgetVolatileHandoffRecovery(referralId: number, community: string, fields?: VolatileHandoffRecovery["fields"]) {
  const key = handoffKey(referralId, community);
  const current = entries.get(key)?.value as VolatileHandoffRecovery | undefined;
  if (!fields || current && JSON.stringify(current.fields) === JSON.stringify(fields) && !current.input.to.trim() && !current.input.cc.trim()) {
    if (entries.delete(key)) changed();
  }
}

export function rememberVolatileReferralRecovery(principal: string, reference: ReferralRecoveryDraftKey, recovery: ReferralLocalRecovery) {
  if (!principal) return;
  const hasFiles = Boolean(recovery.initialPacket || Object.keys(recovery.pendingDocuments).length || recovery.additionalFiles.length);
  entries.set(referralKey(reference), {
    principal, value: recovery,
    persist: async () => {
      try { await saveLocalReferralRecovery(principal, reference, recovery); }
      catch (localError) {
        if (hasFiles) throw localError;
        await saveServerReferralDraft(reference, recovery.draft);
      }
    },
  });
  changed();
}

export function volatileReferralRecovery(principal: string, reference: ReferralRecoveryDraftKey) {
  const entry = entries.get(referralKey(reference));
  return entry?.principal === principal ? entry.value as ReferralLocalRecovery : null;
}

export function forgetVolatileReferralRecovery(reference: ReferralRecoveryDraftKey, recovery?: ReferralLocalRecovery) {
  const key = referralKey(reference);
  if (!recovery || entries.get(key)?.value === recovery) {
    if (entries.delete(key)) changed();
  }
}

export function rememberVolatileAssessmentRecovery(principal: string, assessmentId: string, draft: PipelineAssessmentDraft) {
  if (!principal) return;
  entries.set(assessmentKey(assessmentId), {
    principal, value: draft,
    persist: () => saveOfflineAssessmentDraft(principal, assessmentId, draft),
  });
  changed();
}

export function volatileAssessmentRecovery(principal: string, assessmentId: string) {
  const entry = entries.get(assessmentKey(assessmentId));
  return entry?.principal === principal ? entry.value as PipelineAssessmentDraft : null;
}

export function forgetVolatileAssessmentRecovery(assessmentId: string, draft?: PipelineAssessmentDraft) {
  const key = assessmentKey(assessmentId);
  if (!draft || entries.get(key)?.value === draft) {
    if (entries.delete(key)) changed();
  }
}

export function hasVolatileRecoveries() { return entries.size > 0; }

export function noteAssessmentQueueChange() { assessmentQueueMayBePending = true; }

function registerRecoveryEditor(key: string) {
  activeRecoveryEditors.set(key, (activeRecoveryEditors.get(key) ?? 0) + 1);
  return () => {
    const remaining = (activeRecoveryEditors.get(key) ?? 1) - 1;
    if (remaining > 0) activeRecoveryEditors.set(key, remaining);
    else activeRecoveryEditors.delete(key);
  };
}

export function registerReferralEditor(reference: ReferralRecoveryDraftKey) { return registerRecoveryEditor(referralKey(reference)); }
export function registerHandoffEditor(referralId: number, community: string) { return registerRecoveryEditor(handoffKey(referralId, community)); }

export function registerAssessmentEditor() {
  activeAssessmentEditors += 1;
  return () => { activeAssessmentEditors = Math.max(0, activeAssessmentEditors - 1); };
}

// Outside the editor, replay only versioned/idempotent queued writes. A 409
// stays queued for the editor's existing three-way reconciliation on reopen.
export async function retryQueuedAssessmentChanges() {
  if (!assessmentQueueMayBePending || retryingAssessmentQueue || activeAssessmentEditors > 0 || !window.navigator.onLine) return;
  retryingAssessmentQueue = true;
  try {
    const principal = (await fetchCurrentPipelineUser()).user?.id;
    if (!principal) return;
    if (await pendingOfflineAssessmentMutations(principal) === 0) { assessmentQueueMayBePending = false; return; }
    const result = await flushOfflineAssessmentMutations(principal, async (mutation) => {
      await fetchPipelineJson(mutation.url, { method: mutation.method, body: mutation.body });
    }, { retainConflicts: true });
    assessmentQueueMayBePending = result.remaining > 0 && result.conflicts === 0;
  } catch { /* Keep the encrypted queue for the next retry. */ }
  finally { retryingAssessmentQueue = false; }
}

export async function retryVolatileRecoveries() {
  if (retrying || entries.size === 0 || !window.navigator.onLine) return;
  retrying = true;
  try {
    const principal = (await fetchCurrentPipelineUser()).user?.id;
    if (!principal) return;
    for (const [key, entry] of entries) {
      if (entry.principal !== principal || activeRecoveryEditors.has(key) || key.startsWith("assessment:") && activeAssessmentEditors > 0) continue;
      try {
        await entry.persist();
        if (entries.get(key) === entry && entries.delete(key)) changed();
      } catch { /* Keep the in-memory copy and retry when connectivity/storage returns. */ }
    }
  } catch { /* Identity or network is unavailable. Never persist under another account. */ }
  finally { retrying = false; }
}

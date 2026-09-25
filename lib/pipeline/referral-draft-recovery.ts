"use client";

import { clearLocalReferralRecovery, listLocalReferralRecoveries } from "@/lib/pipeline/referral-local-recovery";
import { currentOfflineRecoverySessionId } from "@/lib/offline/offline-assessment-store";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  parsePipelineReferralDraft,
  parsePipelineReferralDraftSummary,
  type PipelineReferralDraft,
  type PipelineReferralDraftSummary,
} from "@/lib/pipeline/user-workspace-state-types";
import { usesServerUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-client";

type DraftResponse = {
  draft?: unknown;
  version?: unknown;
};

export type ReferralRecoveryDraftKey = number | `new-${string}` | undefined;

const versions = new Map<string, number>();
const saveQueues = new Map<string, Promise<void>>();

export function usesServerReferralDrafts() {
  return usesServerUserWorkspaceState();
}

export async function loadServerReferralDraft(draftReference?: ReferralRecoveryDraftKey) {
  const key = draftKey(draftReference);
  const payload = await fetchPipelineJson<DraftResponse>(`/api/me/referral-drafts/${encodeURIComponent(key)}`, { cache: "no-store" }, { timeoutMs: 3_000 });
  const version = Number.isSafeInteger(payload.version) && Number(payload.version) >= 0 ? Number(payload.version) : 0;
  versions.set(key, version);
  if (!payload.draft) return null;
  return parsePipelineReferralDraft(payload.draft);
}

export async function listServerReferralDrafts() {
  const [server, local] = await Promise.allSettled([
    fetchPipelineJson<{ drafts?: unknown }>("/api/me/referral-drafts", { cache: "no-store" }, { timeoutMs: 3_000 }),
    listLocalReferralRecoveries(),
  ]);
  if (server.status === "rejected" && local.status === "rejected") throw server.reason;
  const raw = server.status === "fulfilled" ? server.value.drafts : [];
  const drafts = (Array.isArray(raw) ? raw : []).map(parsePipelineReferralDraftSummary)
    .filter((draft): draft is PipelineReferralDraftSummary => Boolean(draft));
  mergeLocalDraftSummaries(drafts, local);
  return drafts.sort((left, right) => Date.parse(right.saved_at) - Date.parse(left.saved_at));
}

function mergeLocalDraftSummaries(
  drafts: PipelineReferralDraftSummary[],
  local: PromiseSettledResult<Awaited<ReturnType<typeof listLocalReferralRecoveries>>>,
) {
  if (local.status === "fulfilled") {
    for (const recovery of local.value) {
      if (!/^new-[0-9a-f-]{36}$/i.test(recovery.reference)) continue;
      const current = drafts.find((draft) => draft.draft_key === recovery.reference);
      if (current && Date.parse(current.saved_at) >= Date.parse(recovery.draft.savedAt)) continue;
      const fields = Object.values(recovery.draft.fields);
      const summary: PipelineReferralDraftSummary = {
        draft_key: recovery.reference as `new-${string}`, version: current?.version ?? 0,
        saved_at: recovery.draft.savedAt,
        expires_at: new Date(Date.parse(recovery.draft.savedAt) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        client_name: recovery.draft.fields.name.value, community: recovery.draft.fields.community.value,
        packet_name: recovery.draft.initialPacketName,
        completed_fields: fields.filter((field) => field.value.trim()).length, total_fields: fields.length,
      };
      if (current) drafts.splice(drafts.indexOf(current), 1);
      drafts.push(summary);
    }
  }
}

export function saveServerReferralDraft(draftReference: ReferralRecoveryDraftKey, draft: PipelineReferralDraft) {
  const key = draftKey(draftReference);
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const recoverySessionId = await currentOfflineRecoverySessionId();
    const payload = await fetchPipelineJson<DraftResponse>(`/api/me/referral-drafts/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ if_match: versions.get(key) ?? 0, draft: { ...draft, recoverySessionId } }),
    }, { maxResponseBytes: 512 * 1024 });
    const version = Number(payload.version);
    if (Number.isSafeInteger(version) && version > 0) versions.set(key, version);
  });
  saveQueues.set(key, next);
  void next.catch(() => undefined).finally(() => {
    if (saveQueues.get(key) === next) saveQueues.delete(key);
  });
  return next;
}

export function clearServerReferralDraft(draftReference?: ReferralRecoveryDraftKey, expectedVersion?: number) {
  const key = draftKey(draftReference);
  if (Number.isSafeInteger(expectedVersion) && Number(expectedVersion) > 0) versions.set(key, Number(expectedVersion));
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    // A confirmed zero version has nothing this session may delete. A draft
    // created elsewhere would reject if_match: 0 anyway; never clear that draft.
    // Check inside the queue so an earlier save still gets its versioned delete.
    if (versions.get(key) === 0) {
      await clearLocalReferralRecovery(draftReference);
      return;
    }
    await fetchPipelineJson(`/api/me/referral-drafts/${encodeURIComponent(key)}`, {
      method: "DELETE",
      body: JSON.stringify({ if_match: versions.get(key) ?? 0 }),
    });
    versions.set(key, 0);
    await clearLocalReferralRecovery(draftReference);
  });
  saveQueues.set(key, next);
  void next.catch(() => undefined).finally(() => {
    if (saveQueues.get(key) === next) saveQueues.delete(key);
  });
  return next;
}

function draftKey(draftReference?: ReferralRecoveryDraftKey) {
  if (typeof draftReference === "number" && Number.isSafeInteger(draftReference) && draftReference > 0) {
    return String(draftReference);
  }
  if (typeof draftReference === "string" && /^new-[0-9a-f-]{36}$/i.test(draftReference)) {
    return draftReference;
  }
  return "new";
}

"use client";

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
  const payload = await fetchPipelineJson<DraftResponse>(`/api/me/referral-drafts/${encodeURIComponent(key)}`, { cache: "no-store" });
  const version = Number.isSafeInteger(payload.version) && Number(payload.version) >= 0 ? Number(payload.version) : 0;
  versions.set(key, version);
  if (!payload.draft) return null;
  return parsePipelineReferralDraft(payload.draft);
}

export async function listServerReferralDrafts() {
  const payload = await fetchPipelineJson<{ drafts?: unknown }>("/api/me/referral-drafts", { cache: "no-store" });
  if (!Array.isArray(payload.drafts)) return [];
  return payload.drafts
    .map(parsePipelineReferralDraftSummary)
    .filter((draft): draft is PipelineReferralDraftSummary => Boolean(draft));
}

export function saveServerReferralDraft(draftReference: ReferralRecoveryDraftKey, draft: PipelineReferralDraft) {
  const key = draftKey(draftReference);
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const payload = await fetchPipelineJson<DraftResponse>(`/api/me/referral-drafts/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ if_match: versions.get(key) ?? 0, draft }),
    }, { maxResponseBytes: 512 * 1024 });
    const version = Number(payload.version);
    if (Number.isSafeInteger(version) && version > 0) versions.set(key, version);
  });
  saveQueues.set(key, next);
  void next.finally(() => {
    if (saveQueues.get(key) === next) saveQueues.delete(key);
  });
  return next;
}

export function clearServerReferralDraft(draftReference?: ReferralRecoveryDraftKey, expectedVersion?: number) {
  const key = draftKey(draftReference);
  if (Number.isSafeInteger(expectedVersion) && Number(expectedVersion) > 0) versions.set(key, Number(expectedVersion));
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await fetchPipelineJson(`/api/me/referral-drafts/${encodeURIComponent(key)}`, {
      method: "DELETE",
      body: JSON.stringify({ if_match: versions.get(key) ?? 0 }),
    });
    versions.set(key, 0);
  });
  saveQueues.set(key, next);
  void next.finally(() => {
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

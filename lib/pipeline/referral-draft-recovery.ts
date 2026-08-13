"use client";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { isPipelineDesktopEnabled } from "@/lib/desktop/desktop-config";
import {
  parsePipelineReferralDraft,
  type PipelineReferralDraft,
} from "@/lib/pipeline/user-workspace-state-types";

type DraftResponse = {
  draft?: unknown;
  version?: unknown;
};

const versions = new Map<string, number>();
const saveQueues = new Map<string, Promise<void>>();

export function usesServerReferralDrafts() {
  return isPipelineDesktopEnabled();
}

export async function loadServerReferralDraft(referralId?: number) {
  const key = draftKey(referralId);
  const payload = await fetchPipelineJson<DraftResponse>(`/api/me/referral-drafts/${key}`, { cache: "no-store" });
  const version = Number.isSafeInteger(payload.version) && Number(payload.version) >= 0 ? Number(payload.version) : 0;
  versions.set(key, version);
  if (!payload.draft) return null;
  return parsePipelineReferralDraft(payload.draft);
}

export function saveServerReferralDraft(referralId: number | undefined, draft: PipelineReferralDraft) {
  const key = draftKey(referralId);
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const payload = await fetchPipelineJson<DraftResponse>(`/api/me/referral-drafts/${key}`, {
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

export function clearServerReferralDraft(referralId?: number) {
  const key = draftKey(referralId);
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await fetchPipelineJson(`/api/me/referral-drafts/${key}`, {
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

function draftKey(referralId?: number) {
  return referralId ? String(referralId) : "new";
}

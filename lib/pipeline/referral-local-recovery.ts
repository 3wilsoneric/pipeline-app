"use client";

import { fetchCurrentPipelineUser } from "@/lib/auth/authenticated-fetch";
import { currentOfflineRecoverySessionId, isActiveOtherRecoverySession, loadOfflineReferralDrafts, removeOfflineReferralDraft, saveOfflineReferralDraft } from "@/lib/offline/offline-assessment-store";
import { parsePipelineReferralDraft, type PipelineReferralDraft } from "@/lib/pipeline/user-workspace-state-types";
import type { ReferralRecoveryDraftKey } from "@/lib/pipeline/referral-draft-recovery";
import { isReferralDocumentCategory, type LabeledReferralFile } from "@/lib/pipeline/referral-document-labels";

export type ReferralLocalRecovery = {
  draft: PipelineReferralDraft;
  ownerPrincipalId: string;
  initialPacket: File | null;
  pendingDocuments: Record<string, File>;
  additionalFiles: LabeledReferralFile[];
};

type FileDescription = { key: string; name: string; type: string; size: number; lastModified: number; category?: LabeledReferralFile["category"] };
type RecoveryHeader = { reference: string; sessionId?: string; draft: PipelineReferralDraft; ownerPrincipalId: string; files: FileDescription[] };

// File bytes and their identifying metadata share the encrypted, expiring record.
// Blob framing avoids base64 copies of large intake packets.
export function encodeReferralRecovery(reference: ReferralRecoveryDraftKey, recovery: ReferralLocalRecovery, sessionId?: string) {
  const entries: Array<[string, File]> = Object.entries(recovery.pendingDocuments).map(([key, file]) => [`document:${key}`, file]);
  if (recovery.initialPacket) entries.push(["packet", recovery.initialPacket]);
  recovery.additionalFiles.forEach(({ file }, index) => entries.push([`additional:${index}`, file]));
  const header: RecoveryHeader = {
    reference: String(reference ?? "new"), ...(sessionId ? { sessionId } : {}), draft: recovery.draft, ownerPrincipalId: recovery.ownerPrincipalId,
    files: entries.map(([key, file]) => ({ key, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified,
      ...(key.startsWith("additional:") ? { category: recovery.additionalFiles[Number(key.slice(11))].category } : {}),
    })),
  };
  return new Blob([JSON.stringify(header), "\n", ...entries.map(([, file]) => file)]);
}

export function decodeReferralRecovery(buffer: ArrayBuffer): ReferralLocalRecovery & { reference: string; sessionId?: string } {
  const bytes = new Uint8Array(buffer);
  const boundary = bytes.indexOf(10);
  if (boundary < 0) throw new Error("The pending intake copy is incomplete.");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(0, boundary))) as RecoveryHeader;
  const draft = parsePipelineReferralDraft(header.draft);
  if (!draft) throw new Error("The pending intake copy is invalid.");
  const result: ReferralLocalRecovery & { reference: string; sessionId?: string } = {
    reference: header.reference, sessionId: header.sessionId, draft, ownerPrincipalId: header.ownerPrincipalId,
    initialPacket: null, pendingDocuments: {}, additionalFiles: [],
  };
  let offset = boundary + 1;
  for (const entry of header.files) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || offset + entry.size > bytes.length) throw new Error("A pending file is incomplete.");
    const file = new File([buffer.slice(offset, offset + entry.size)], entry.name, { type: entry.type, lastModified: entry.lastModified });
    offset += entry.size;
    if (entry.key === "packet") result.initialPacket = file;
    else if (entry.key.startsWith("document:")) result.pendingDocuments[entry.key.slice(9)] = file;
    else {
      if (entry.category !== undefined && !isReferralDocumentCategory(entry.category)) throw new Error("A pending file has an invalid document label.");
      result.additionalFiles.push({ file, category: entry.category ?? "other" });
    }
  }
  if (offset !== bytes.length) throw new Error("The pending intake copy has unexpected data.");
  return result;
}

export async function referralRecoveryPrincipal() {
  const { user } = await fetchCurrentPipelineUser();
  if (!user?.id) throw new Error("Your account could not be confirmed for the pending copy.");
  return user.id;
}

const queues = new Map<string, Promise<void>>();

export function saveLocalReferralRecovery(principal: string, reference: ReferralRecoveryDraftKey, recovery: ReferralLocalRecovery) {
  if (!principal) return Promise.reject(new Error("Your account is still loading."));
  const key = `${principal}:${reference ?? "new"}`;
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined)
    .then(async () => saveOfflineReferralDraft(principal, String(reference ?? "new"), encodeReferralRecovery(reference, recovery, await currentOfflineRecoverySessionId())));
  queues.set(key, next.catch(() => undefined));
  return next;
}

export async function listLocalReferralRecoveries() {
  const principal = await referralRecoveryPrincipal();
  const records = await loadOfflineReferralDrafts(principal);
  return records.map(decodeReferralRecovery);
}

export async function loadLocalReferralRecovery(reference: ReferralRecoveryDraftKey) {
  const drafts = await listLocalReferralRecoveries();
  const matching = drafts.filter((draft) => draft.reference === String(reference ?? "new"));
  const sessionId = await currentOfflineRecoverySessionId();
  const own = matching.find((draft) => draft.sessionId === sessionId);
  if (own) return own;
  for (const draft of matching) {
    if (!await isActiveOtherRecoverySession(draft.sessionId)) return draft;
  }
  return null;
}

export async function clearLocalReferralRecovery(reference: ReferralRecoveryDraftKey) {
  const principal = await referralRecoveryPrincipal();
  const key = `${principal}:${reference ?? "new"}`;
  await queues.get(key);
  await removeOfflineReferralDraft(principal, String(reference ?? "new"));
  queues.delete(key);
}

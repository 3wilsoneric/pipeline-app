import type { InitialDocumentCategory } from "@/lib/pipeline/referral-packet-upload";
import {
  type ReferralCanvasDirtyKey,
  type ReferralCanvasPacketField,
} from "@/lib/pipeline/referral-canvas-extraction";
import { isPersistedCanvasFieldKey } from "@/lib/pipeline/referral-canvas-persistence";
import type { ReferralCanvasFieldKey } from "@/lib/pipeline/referral-types";
import type { ReferralRecoveryDraftKey } from "@/lib/pipeline/referral-draft-recovery";

export type DraftValueSnapshot = {
  fields: Record<ReferralCanvasFieldKey, ReferralCanvasPacketField>;
  conserved: "yes" | "no" | "";
  tagsInput: string;
  documents: Record<string, string>;
  initialPacket: File | null;
};

export type ReferralSaveSnapshot = {
  dirtyKeys: Set<ReferralCanvasDirtyKey>;
  signatures: Map<ReferralCanvasDirtyKey, string>;
  initialPacket: File | null;
  initialPacketCategory: InitialDocumentCategory;
  pendingDocuments: Record<string, File>;
};

export function currentDraftValues(
  fields: DraftValueSnapshot["fields"],
  conserved: DraftValueSnapshot["conserved"],
  tagsInput: string,
  documents: Record<string, string>,
  initialPacket: File | null,
): DraftValueSnapshot {
  return { fields, conserved, tagsInput, documents, initialPacket };
}

export function captureReferralSaveSnapshot(
  dirtyKeys: ReadonlySet<ReferralCanvasDirtyKey>,
  values: DraftValueSnapshot,
  initialPacketCategory: InitialDocumentCategory,
  pendingDocuments: Record<string, File>,
): ReferralSaveSnapshot {
  const capturedDirtyKeys = new Set(dirtyKeys);
  return {
    dirtyKeys: capturedDirtyKeys,
    signatures: new Map([...capturedDirtyKeys].map((key) => [key, draftKeySignature(key, values)])),
    initialPacket: values.initialPacket,
    initialPacketCategory,
    pendingDocuments: { ...pendingDocuments },
  };
}

export function reconcileSavedDirtyKeys(
  activeDirtyKeys: ReadonlySet<ReferralCanvasDirtyKey>,
  saved: ReferralSaveSnapshot,
  current: DraftValueSnapshot,
  allSupportingDocumentsUploaded: boolean,
) {
  const remaining = new Set(activeDirtyKeys);
  for (const key of saved.dirtyKeys) {
    if (key === "initialPacket") {
      if (current.initialPacket === null) remaining.delete(key);
      continue;
    }
    if (key === "documents") {
      if (allSupportingDocumentsUploaded) remaining.delete(key);
      continue;
    }
    if (draftKeySignature(key, current) === saved.signatures.get(key)) remaining.delete(key);
  }
  return remaining;
}

export function referralSaveStatus(remainingChanges: number, uploadedInitialPacket: boolean) {
  if (remainingChanges > 0) return "Saved; newer changes remain";
  if (uploadedInitialPacket) return "Packet uploaded and ready for review";
  return `Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function referralDraftSaveStatus(savedAt: string, hasReferral: boolean, queuedFileCount: number) {
  if (!hasReferral && queuedFileCount > 0) {
    return `${savedAt} · ${queuedFileCount.toLocaleString()} file${queuedFileCount === 1 ? "" : "s"} queued`;
  }
  return savedAt === "Workspace loaded" ? "All changes saved" : savedAt;
}

export function draftKeySignature(key: ReferralCanvasDirtyKey, input: DraftValueSnapshot) {
  if (isPersistedCanvasFieldKey(key)) {
    return JSON.stringify([input.fields[key].value, input.fields[key].sourceFile ?? ""]);
  }
  if (key === "conserved") return input.conserved;
  if (key === "tags") return normalizeTags(input.tagsInput).join("\n");
  if (key === "documents") {
    return JSON.stringify(Object.entries(input.documents).sort(([left], [right]) => left.localeCompare(right)));
  }
  return input.initialPacket
    ? JSON.stringify([input.initialPacket.name, input.initialPacket.size, input.initialPacket.lastModified])
    : "";
}

export function mergePendingDocumentNames(
  savedDocuments: Record<string, string>,
  pending: Record<string, File>,
) {
  return Object.fromEntries([
    ...Object.entries(savedDocuments),
    ...Object.entries(pending).map(([requirementId, file]) => [requirementId, file.name]),
  ]);
}

export function normalizeTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

export function canvasDraftStorageKey(draftReference?: ReferralRecoveryDraftKey) {
  return `pipeline-referral-draft:${draftReference ?? "new"}`;
}

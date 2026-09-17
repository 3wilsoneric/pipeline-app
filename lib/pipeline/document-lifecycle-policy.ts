import type { AdmissionRequirement, Referral, ReferralFile } from "./referral-types";

export const documentUndoMilliseconds = 24 * 60 * 60 * 1000;

export type DocumentRecovery = {
  requirements: AdmissionRequirement[];
  packet?: Pick<Referral, "documentName" | "documentStatus" | "documentHash" | "documentSizeBytes">;
  packetVersion?: number;
};

export type LocalUploadedDocument = {
  file: ReferralFile;
  hash: string;
  packetId: string;
  deletedAt?: string;
  undoUntil?: string;
  deletionId?: string;
  purgedAt?: string;
  recovery?: DocumentRecovery;
};

// Remove the attachment, never the clinical values already entered from it.
export function detachDocument(referral: Referral, document: ReferralFile, now: string, isInitialPacket = false) {
  const linked = (referral.requirements ?? []).filter((item) => item.evidenceDocumentId === document.id);
  const packetMatches = isInitialPacket;
  const recovery: DocumentRecovery = {
    requirements: linked,
    packetVersion: (referral.sectionVersions?.documents ?? 1) + 1,
    ...(packetMatches ? { packet: {
      documentName: referral.documentName, documentStatus: referral.documentStatus,
      documentHash: referral.documentHash, documentSizeBytes: referral.documentSizeBytes,
    } } : {}),
  };
  return {
    recovery,
    referral: {
      ...referral,
      requirements: (referral.requirements ?? []).map((item) => linked.includes(item) ? {
        ...item, status: "needed" as const, evidenceDocumentId: undefined, evidenceDocumentName: undefined,
        version: (item.version ?? 1) + 1, updatedAt: now,
      } : item),
      ...(packetMatches ? { documentName: "", documentStatus: "Missing" as const, documentHash: undefined, documentSizeBytes: undefined } : {}),
    },
  };
}

export function restoreDocumentLinks(referral: Referral, recovery: DocumentRecovery, now: string): Referral {
  return {
    ...referral,
    requirements: (referral.requirements ?? []).map((item) => {
      const before = recovery.requirements.find((entry) => entry.id === item.id);
      // A replacement or a later checklist edit wins over this undo.
      if (!before || item.evidenceDocumentId || item.status !== "needed" || item.version !== (before.version ?? 1) + 1) return item;
      return { ...item, status: before.status, evidenceDocumentId: before.evidenceDocumentId,
        evidenceDocumentName: before.evidenceDocumentName, version: (item.version ?? 1) + 1, updatedAt: now };
    }),
    ...(!referral.documentName && referral.documentStatus === "Missing" && referral.sectionVersions?.documents === recovery.packetVersion ? recovery.packet ?? {} : {}),
  };
}

export function canRestoreDocument(document: Pick<LocalUploadedDocument, "deletedAt" | "deletionId" | "undoUntil" | "purgedAt">, deletionId: string, now = Date.now()) {
  return Boolean(document.deletedAt && document.deletionId === deletionId && !document.purgedAt
    && document.undoUntil && Date.parse(document.undoUntil) > now);
}

export function documentMutationDisposition(document: Pick<LocalUploadedDocument, "deletedAt" | "deletionId" | "undoUntil" | "purgedAt">, action: "delete" | "restore", deletionId?: string) {
  if (action === "delete") return document.deletedAt ? "replay" : "change";
  if (!document.deletedAt && document.deletionId === deletionId) return "replay";
  return canRestoreDocument(document, deletionId ?? "") ? "change" : "unavailable";
}

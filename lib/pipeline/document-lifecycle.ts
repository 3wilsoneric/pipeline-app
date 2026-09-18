import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import type { CompleteUploadResponse } from "@/lib/extraction/contracts";
import { getMockUploadDescriptor } from "@/lib/extraction/mock-store";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { isDocumentId } from "@/lib/extraction/document-assets";
import { toPipelinePath } from "./base-path";
import { documentMutationDisposition, detachDocument, documentUndoMilliseconds, restoreDocumentLinks, type DocumentRecovery } from "./document-lifecycle-policy";
import { getLocalUploadedDocument, getLocalDeletedPacket, getReferral, getReferralStoreReadiness, mutateLocalUploadedDocument, recordLocalUploadedDocument, type ReferralActor } from "./referral-store";
import type { Referral, ReferralFile } from "./referral-types";
import { incrementReferralSections, normalizeReferralSectionVersions } from "./referral-sections";
import { resolveReferralWorkflowStatusAfterReferralChange } from "./workflow-status";
import { canModifyReferral } from "./referral-ownership";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";

const categories: Record<string, ReferralFile["category"]> = {
  referral_packet: "Referral packet", face_sheet: "Face sheet", assessment: "Assessment", medication_list: "Medication list",
  tb_test: "TB test", signed_admission_agreement: "Admission agreement", conservatorship_document: "Conservatorship",
  lic_602: "LIC 602", lic_601_603: "LIC 601/603", provider_form: "Provider form", payer_verification: "Payer verification", responsible_party: "Responsible party",
};

async function deletedPacketGeneration(packetId: string) {
  if (getReferralStoreReadiness().mode !== "postgres") return (await getLocalDeletedPacket(packetId))?.deletionId ?? null;
  const sql = getPipelineSql();
  const rows = await sql<{ generation: string }[]>`select coalesce(d.deletion_id::text, d.document_id::text) as generation
    from pipeline.packet_upload_files f join pipeline.documents d on d.document_id = f.document_id
    where f.packet_id = ${packetId}::uuid and d.deleted_at is not null order by d.document_id limit 1`;
  return rows[0]?.generation ?? null;
}

export async function availableUploadPacketId(packetId?: string) {
  if (!packetId) return packetId;
  validateDurablePacketId(packetId);
  // A deliberate re-upload after deletion gets a fresh but retry-stable identity.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const generation = await deletedPacketGeneration(packetId);
    if (!generation) return packetId;
    const hex: string = createHash("sha256").update(`document-reupload:${packetId}:${generation}`).digest("hex");
    packetId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  throw new DocumentProcessingError("upload_generation_limit", 409, "This file has too many deleted upload attempts. Rename the file to upload it again.");
}

export async function assertPacketNotDeleted(packetId: string) {
  validateDurablePacketId(packetId);
  if (await deletedPacketGeneration(packetId)) throw new DocumentProcessingError("upload_deleted", 409, "This file was deleted. Select the file again to start a new upload, or restore it from Change history.");
}

function validateDurablePacketId(packetId: string) {
  if (getReferralStoreReadiness().mode === "postgres" && !isDocumentId(packetId)) throw new DocumentProcessingError("packet_id_invalid", 400, "packet_id must be a UUID.");
}

export async function assertDocumentAvailable(documentId: string) {
  if (getReferralStoreReadiness().mode !== "postgres") {
    if ((await getLocalUploadedDocument(documentId))?.deletedAt) throw new DocumentProcessingError("upload_deleted", 409, "This file was deleted. Select it again or restore it from Change history.");
    return;
  }
  const sql = getPipelineSql();
  const rows = await sql`select document_id from pipeline.documents where document_id = ${documentId}::uuid and deleted_at is null`;
  if (!rows.length) throw new DocumentProcessingError("upload_deleted", 409, "This file was deleted. Select it again or restore it from Change history.");
}

export async function recordUploadedDocuments(referralId: number, result: CompleteUploadResponse, actor: ReferralActor) {
  for (const document of result.documents ?? []) {
    if (getReferralStoreReadiness().mode === "postgres") {
      const sql = getPipelineSql();
      await sql`
        insert into pipeline.audit_events(entity_type, entity_id, action, actor_id, actor_name, changed_fields, after_values, metadata)
        values ('document', ${document.document_id}, 'document_uploaded', ${actor.id}, ${actor.name}, array['document'],
          ${sql.json({ document: document.filename })}, ${sql.json({ referral_id: referralId, document_id: document.document_id })})
        on conflict (entity_id) where entity_type = 'document' and action = 'document_uploaded' do nothing
      `;
    } else {
      const descriptor = getMockUploadDescriptor(result.packet_id, document.file_id);
      const referral = await getReferral(referralId);
      if (!referral || !descriptor?.sha256) throw new Error("The uploaded file metadata could not be recorded.");
      await recordLocalUploadedDocument({ hash: descriptor.sha256, packetId: result.packet_id, file: {
        id: document.document_id, name: document.filename, category: categories[document.category] ?? "Other",
        referralId, referralName: referral.name, community: referral.community, owner: referral.owner,
        uploadedAt: new Date().toISOString(), sizeBytes: descriptor.size, contentType: descriptor.content_type,
        status: "Uploaded", previewStatus: "ready", sourceSystem: "pipeline",
        previewUrl: toPipelinePath(`/api/files/${document.document_id}/preview`),
        downloadUrl: toPipelinePath(`/api/files/${document.document_id}/download`),
        ...(descriptor.content_type.startsWith("image/") ? { thumbnailUrl: toPipelinePath(`/api/files/${document.document_id}/preview`) } : {}),
      } }, actor);
    }
  }
}

export async function documentReferralIncludingDeleted(documentId: string) {
  if (getReferralStoreReadiness().mode !== "postgres") return (await getLocalUploadedDocument(documentId))?.file.referralId ?? null;
  const sql = getPipelineSql();
  const rows = await sql<{ referral_id: number }[]>`select referral_id from pipeline.documents where document_id = ${documentId}::uuid`;
  return rows[0] ? Number(rows[0].referral_id) : null;
}

export async function changeDocument(documentId: string, referralId: number, action: "delete" | "restore", actor: ReferralActor, user: PipelineUser, deletionId?: string) {
  const authorize = (referral: Referral) => {
    if (!canModifyReferral(referral, user) || referral.workspaceStatus === "historical") throw new DocumentProcessingError("file_access_changed", 403, "You no longer have permission to change files in this workspace.");
  };
  if (getReferralStoreReadiness().mode !== "postgres") {
    const document = await mutateLocalUploadedDocument(documentId, action, actor, authorize, deletionId);
    if (!document) throw new DocumentProcessingError("undo_unavailable", 409, "This file cannot be restored. Its recovery window may have expired or the file changed.");
    return { document_id: documentId, deletion_id: document.deletionId, undo_until: document.undoUntil };
  }
  const fallback = await getReferral(referralId);
  if (!fallback) throw new DocumentProcessingError("referral_not_found", 404, "Referral not found.");
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    // Same lock order as checklist writes: referral first, then its document.
    const referrals = await tx<{ data: Referral; version: number; section_versions: Referral["sectionVersions"]; owner_id: string; owner_name: string }[]>`
      select data, version, section_versions, owner_id, owner_name from pipeline.referrals where referral_id = ${referralId} and deleted_at is null for update
    `;
    if (!referrals[0]) throw new DocumentProcessingError("referral_not_found", 404, "Referral not found.");
    const rows = await tx<{
      file_name: string; category: string; deleted_at: Date | null; undo_until: Date | null;
      deletion_id: string | null; purged_at: Date | null; deletion_recovery: DocumentRecovery | null;
      packet_id: string | null;
    }[]>`select file_name, category, deleted_at, undo_until, deletion_id, purged_at, deletion_recovery,
      (select packet_id::text from pipeline.packet_upload_files where document_id = ${documentId}::uuid) as packet_id
      from pipeline.documents where document_id = ${documentId}::uuid and referral_id = ${referralId} for update`;
    const row = rows[0];
    if (!row) throw new DocumentProcessingError("file_not_found", 404, "File not found.");
    const current: Referral = { ...fallback, ...referrals[0].data, ownerId: referrals[0].owner_id, owner: referrals[0].owner_name,
      version: Number(referrals[0].version), sectionVersions: referrals[0].section_versions };
    authorize(current);
    if (postgresMutationReplay(row, action, deletionId)) return { document_id: documentId, deletion_id: row.deletion_id, undo_until: row.undo_until?.toISOString() };
    const now = new Date().toISOString();
    const file = { id: documentId, name: row.file_name, category: categories[row.category] ?? "Other" } as ReferralFile;
    const detached = detachDocument(current, file, now, current.packetId === row.packet_id);
    const next = action === "delete" ? detached.referral : restoreDocumentLinks(current, row.deletion_recovery ?? { requirements: [] }, now);
    const eventId = action === "delete" ? randomUUID() : row.deletion_id!;
    const undoUntil = action === "delete" ? new Date(Date.now() + documentUndoMilliseconds) : null;
    await tx`update pipeline.documents set deleted_at = ${action === "delete" ? new Date(now) : null},
      undo_until = ${undoUntil}, deletion_id = ${eventId}::uuid,
      deletion_recovery = ${action === "delete" ? tx.json(detached.recovery) : null},
      version = version + 1, updated_at = now() where document_id = ${documentId}::uuid`;
    await writeDocumentReferral(tx, current, next, actor);
    await tx`insert into pipeline.audit_events(entity_type, entity_id, action, actor_id, actor_name, changed_fields, after_values, metadata)
      values ('document', ${documentId}, ${action === "delete" ? "document_deleted" : "document_restored"}, ${actor.id}, ${actor.name},
        array['document'], ${tx.json({ document: row.file_name })},
        ${tx.json({ referral_id: referralId, document_id: documentId, deletion_id: eventId, undo_until: undoUntil?.toISOString() ?? null })})`;
    return { document_id: documentId, deletion_id: eventId, undo_until: undoUntil?.toISOString() };
  });
}

function postgresMutationReplay(row: { deleted_at: Date | null; deletion_id: string | null; undo_until: Date | null; purged_at: Date | null }, action: "delete" | "restore", deletionId?: string) {
  const disposition = documentMutationDisposition({ deletedAt: row.deleted_at?.toISOString(), deletionId: row.deletion_id ?? undefined,
    undoUntil: row.undo_until?.toISOString(), purgedAt: row.purged_at?.toISOString() }, action, deletionId);
  if (disposition === "unavailable") throw new DocumentProcessingError("undo_unavailable", 409, "This deletion is no longer available to undo.");
  return disposition === "replay";
}

async function writeDocumentReferral(tx: TransactionSql, current: Referral, next: Referral, actor: ReferralActor) {
  for (const item of next.requirements ?? []) {
    const before = current.requirements?.find((entry) => entry.id === item.id);
    if (!before || item.version === before.version) continue;
    await tx`update pipeline.work_items set status = ${item.status}, evidence_document_id = ${item.evidenceDocumentId ?? null}::uuid,
      evidence_document_name = ${item.evidenceDocumentName ?? null}, version = ${item.version ?? 1}, updated_at = now()
      where referral_id = ${current.id} and work_item_id = ${item.id}::uuid`;
  }
  const workflowStatus = resolveReferralWorkflowStatusAfterReferralChange(current, next);
  await tx`update pipeline.referrals set data = ${tx.json({ ...next, workflowStatus })}, document_sha256 = ${next.documentHash ?? null}, workflow_status = ${workflowStatus},
    version = version + 1, section_versions = ${tx.json(incrementReferralSections(normalizeReferralSectionVersions(current.sectionVersions), ["documents", "workflow"]))},
    updated_by = ${actor.id}, updated_by_name = ${actor.name}, updated_at = now() where referral_id = ${current.id}`;
  await tx`update pipeline.store_revisions set revision = revision + 1, updated_at = now() where store_name in ('referrals', 'documents')`;
}

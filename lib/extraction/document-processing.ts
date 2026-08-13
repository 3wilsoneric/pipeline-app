import "server-only";

import { randomUUID } from "node:crypto";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import type {
  CompleteUploadRequest,
  CompleteUploadResponse,
  CreateUploadUrlRequest,
  CreateUploadUrlResponse,
  ExtractedField,
  FieldAuditEvent,
  FieldCandidate,
  PacketFieldsResponse,
  PacketStatus,
  PacketStatusResponse,
  RetryFieldResponse,
  ReviewFieldRequest,
  ReviewFieldResponse,
} from "@/lib/extraction/contracts";

type Actor = { id: string; name: string };

type PacketRow = {
  packet_id: string;
  referral_id: number | string;
  status: PacketStatus;
  page_count: number;
  failure_code: string | null;
};

type UploadFileRow = {
  file_id: string;
  document_id: string;
  expected_byte_size: number | string;
  expected_sha256: string;
  blob_path: string;
  reservation_expires_at: Date | string;
  uploaded_at: Date | string | null;
  file_name: string;
  content_type: string;
  blob_container: string;
};

type FieldRow = {
  referral_field_id: string;
  field_key: string;
  proposed_value: unknown;
  final_value: unknown;
  confidence: number | string | null;
  review_status: "pending" | "confirmed" | "edited" | "rejected";
  source_document_id: string | null;
  source_page: number | null;
  evidence_blob_key: string | null;
  version: number;
};

type CandidateRow = {
  candidate_id: string;
  referral_field_id: string;
  source: FieldCandidate["source"];
  candidate_value: unknown;
  confidence: number | string;
  source_page: number | null;
  evidence_blob_key: string | null;
};

const requiredPacketFields = [
  "demographics.first_name",
  "demographics.last_name",
  "demographics.date_of_birth",
  "referral.source",
  "clinical.summary",
] as const;

export class DocumentProcessingError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409 | 410 | 413 | 415 | 502 | 503 = 400,
    message = code,
  ) {
    super(message);
    this.name = "DocumentProcessingError";
  }
}

export async function createDurableUploadTargets(
  input: CreateUploadUrlRequest,
  actor: Actor,
): Promise<CreateUploadUrlResponse> {
  const sql = getPipelineSql();
  const referralId = positiveInteger(input.referral_id, "referral_id");
  for (const file of input.files) {
    if (!file.sha256) {
      throw new DocumentProcessingError(
        "upload_digest_required",
        400,
        "A SHA-256 digest is required for every production upload.",
      );
    }
  }

  const packetId = input.packet_id ?? randomUUID();
  if (!uuid(packetId)) throw new DocumentProcessingError("packet_id_invalid", 400, "packet_id must be a UUID.");
  const signed = await getAzureBlobUploadSigner().createUploadUrls({ ...input, packet_id: packetId });
  const targetByFile = new Map(signed.uploads.map((target) => [target.file_id, target]));
  const rawContainer = process.env.AZURE_STORAGE_CONTAINER_RAW?.trim() || "raw";

  try {
    await sql.begin(async (tx) => {
      const referrals = await tx<{ referral_id: number | string; person_id: string }[]>`
        select referral_id, person_id from pipeline.referrals where referral_id = ${referralId} limit 1
      `;
      if (!referrals[0]) throw new DocumentProcessingError("referral_not_found", 404, "Referral not found.");

      const existing = await tx<{ packet_id: string; referral_id: number | string }[]>`
        select packet_id, referral_id from pipeline.packet_uploads where packet_id = ${packetId}::uuid limit 1
      `;
      if (existing[0]) {
        if (Number(existing[0].referral_id) !== referralId) {
          throw new DocumentProcessingError("packet_id_conflict", 409, "This packet id belongs to another referral.");
        }
        const existingFiles = await tx<{ file_id: string; expected_sha256: string; category: string }[]>`
          select pf.file_id, pf.expected_sha256, d.category
          from pipeline.packet_upload_files pf
          join pipeline.documents d on d.document_id = pf.document_id
          where pf.packet_id = ${packetId}::uuid order by pf.file_id
        `;
        const requestFiles = [...input.files].sort((a, b) => a.file_id.localeCompare(b.file_id));
        if (
          existingFiles.length !== requestFiles.length ||
          existingFiles.some((file, index) =>
            file.file_id !== requestFiles[index]?.file_id
              || file.expected_sha256 !== requestFiles[index]?.sha256
              || file.category !== (requestFiles[index]?.category ?? "referral_packet")
          )
        ) {
          throw new DocumentProcessingError("packet_payload_conflict", 409, "The packet id was already used with different files.");
        }
        return;
      }

      await tx`
        insert into pipeline.packet_uploads (
          packet_id, referral_id, source_type, submitting_facility, status, uploaded_by
        ) values (
          ${packetId}::uuid, ${referralId}, ${input.source_type}, ${input.submitting_facility.trim()},
          'received', ${actor.id}
        )
      `;

      for (const file of input.files) {
        const target = targetByFile.get(file.file_id);
        if (!target) throw new DocumentProcessingError("upload_target_missing", 503);
        const documents = await tx<{ document_id: string }[]>`
          insert into pipeline.documents (
            referral_id, person_id, category, file_name, content_type, byte_size, sha256,
            blob_container, blob_key, processing_status, uploaded_by, retention_until
          ) values (
            ${referralId}, ${referrals[0].person_id}::uuid, ${file.category ?? "referral_packet"}, ${file.filename},
            ${file.content_type.toLowerCase()}, ${file.size}, ${file.sha256!}, ${rawContainer},
            ${target.blob_path}, 'reserved', ${actor.id}, now() + interval '7 years'
          ) returning document_id
        `;
        await tx`
          insert into pipeline.packet_upload_files (
            packet_id, file_id, document_id, expected_byte_size, expected_sha256,
            blob_path, reservation_expires_at
          ) values (
            ${packetId}::uuid, ${file.file_id}, ${documents[0].document_id}::uuid,
            ${file.size}, ${file.sha256!}, ${target.blob_path}, ${target.expires_at}::timestamptz
          )
        `;
      }
    });
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    if (databaseCode(error) === "23505") {
      throw new DocumentProcessingError("duplicate_document", 409, "This packet was already uploaded for the referral.");
    }
    throw new DocumentProcessingError("upload_reservation_failed", 503, "Secure upload storage is temporarily unavailable.");
  }

  return signed;
}

export async function completeDurableUpload(
  input: CompleteUploadRequest,
): Promise<CompleteUploadResponse> {
  return completeDurableUploadWithMode(input, true);
}

export async function completeDurableManualUpload(
  input: CompleteUploadRequest,
): Promise<CompleteUploadResponse> {
  return completeDurableUploadWithMode(input, false);
}

async function completeDurableUploadWithMode(
  input: CompleteUploadRequest,
  queueExtraction: boolean,
): Promise<CompleteUploadResponse> {
  const sql = getPipelineSql();
  if (!uuid(input.packet_id)) throw new DocumentProcessingError("packet_id_invalid", 400);
  const packetRows = await sql<PacketRow[]>`
    select packet_id, referral_id, status, page_count, failure_code
    from pipeline.packet_uploads where packet_id = ${input.packet_id}::uuid limit 1
  `;
  const packet = packetRows[0];
  if (!packet) throw new DocumentProcessingError("packet_not_found", 404, "Packet not found.");

  const files = await sql<UploadFileRow[]>`
    select f.*, d.file_name, d.content_type, d.blob_container
    from pipeline.packet_upload_files f
    join pipeline.documents d on d.document_id = f.document_id
    where f.packet_id = ${input.packet_id}::uuid
    order by f.file_id
  `;
  const requested = [...input.uploaded_file_ids].sort();
  const expected = files.map((file) => file.file_id).sort();
  if (requested.length !== expected.length || requested.some((id, index) => id !== expected[index])) {
    throw new DocumentProcessingError("upload_set_mismatch", 409, "Complete every reserved file together.");
  }

  const priorJob = queueExtraction
    ? await sql<{ extraction_job_id: string }[]>`
        select extraction_job_id from pipeline.extraction_jobs
        where packet_id = ${input.packet_id}::uuid and job_type = 'referral_packet'
        order by queued_at desc limit 1
      `
    : [];
  if (files.every((file) => file.uploaded_at) && (!queueExtraction || priorJob[0])) {
    return {
      packet_id: input.packet_id,
      status: packet.status,
      ...(priorJob[0] ? { job_run_id: priorJob[0].extraction_job_id } : {}),
    };
  }

  const signer = getAzureBlobUploadSigner();
  const properties = await Promise.all(
    files.map((file) => signer.getBlobProperties(file.blob_container, file.blob_path)),
  );
  for (let index = 0; index < files.length; index += 1) {
    const property = properties[index];
    const file = files[index];
    if (!property.exists) throw new DocumentProcessingError("uploaded_blob_missing", 409, "One or more files did not finish uploading.");
    if (property.byteSize !== Number(file.expected_byte_size)) {
      throw new DocumentProcessingError("uploaded_blob_size_mismatch", 409, "An uploaded file size does not match its reservation.");
    }
  }

  const result = await sql.begin(async (tx) => {
    const locked = await tx<PacketRow[]>`
      select packet_id, referral_id, status, page_count, failure_code
      from pipeline.packet_uploads where packet_id = ${input.packet_id}::uuid for update
    `;
    if (!locked[0]) throw new DocumentProcessingError("packet_not_found", 404);
    await tx`
      update pipeline.packet_upload_files set uploaded_at = coalesce(uploaded_at, now())
      where packet_id = ${input.packet_id}::uuid
    `;
    await tx`
      update pipeline.documents d
      set processing_status = ${queueExtraction ? "quarantined" : "uploaded"}, malware_scan_status = 'pending',
          preview_status = ${queueExtraction ? "pending" : "unavailable"}, updated_at = now(), version = version + 1
      from pipeline.packet_upload_files f
      where f.packet_id = ${input.packet_id}::uuid and f.document_id = d.document_id
    `;
    await tx`
      update pipeline.packet_uploads set status = ${queueExtraction ? "normalizing" : "received"},
        completed_at = now(), updated_at = now()
      where packet_id = ${input.packet_id}::uuid
    `;

    let firstJobId = "";
    if (queueExtraction) for (const file of files) {
      for (const jobType of ["referral_packet", "document_preview"] as const) {
        const jobs = await tx<{ extraction_job_id: string }[]>`
          insert into pipeline.extraction_jobs (document_id, packet_id, job_type, status)
          values (${file.document_id}::uuid, ${input.packet_id}::uuid, ${jobType}, 'queued')
          on conflict (document_id, job_type) where status in ('queued', 'running')
          do update set next_attempt_at = least(pipeline.extraction_jobs.next_attempt_at, now()), updated_at = now()
          returning extraction_job_id
        `;
        if (jobType === "referral_packet" && !firstJobId) firstJobId = jobs[0].extraction_job_id;
      }
    }
    return firstJobId;
  });

  return {
    packet_id: input.packet_id,
    status: queueExtraction ? "normalizing" : "received",
    ...(result ? { job_run_id: result } : {}),
  };
}

export async function getDurablePacketStatus(packetId: string): Promise<PacketStatusResponse | null> {
  if (!uuid(packetId)) return null;
  const sql = getPipelineSql();
  const packets = await sql<PacketRow[]>`
    select packet_id, referral_id, status, page_count, failure_code
    from pipeline.packet_uploads where packet_id = ${packetId}::uuid limit 1
  `;
  if (!packets[0]) return null;
  const counts = await sql<{ fields_total: number | string; pending_review: number | string; conflicts: number | string }[]>`
    select count(distinct rf.referral_field_id) as fields_total,
      count(distinct rf.referral_field_id) filter (where rf.review_status = 'pending') as pending_review,
      count(distinct rf.referral_field_id) filter (where candidate_counts.value_count > 1) as conflicts
    from pipeline.packet_upload_files pf
    join pipeline.referral_fields rf on rf.source_document_id = pf.document_id
    left join lateral (
      select count(distinct candidate_value) as value_count
      from pipeline.extraction_candidates ec where ec.referral_field_id = rf.referral_field_id
    ) candidate_counts on true
    where pf.packet_id = ${packetId}::uuid
  `;
  const job = await sql<{ extraction_job_id: string; provider_job_id: string | null }[]>`
    select extraction_job_id, provider_job_id from pipeline.extraction_jobs
    where packet_id = ${packetId}::uuid and job_type = 'referral_packet'
    order by queued_at desc limit 1
  `;
  return {
    packet_id: packetId,
    status: packets[0].status,
    page_count: Number(packets[0].page_count),
    job_run_id: job[0]?.provider_job_id ?? job[0]?.extraction_job_id,
    counts: {
      fields_total: Number(counts[0]?.fields_total ?? 0),
      pending_review: Number(counts[0]?.pending_review ?? 0),
      conflicts: Number(counts[0]?.conflicts ?? 0),
    },
    ...(packets[0].failure_code ? { failure_reason: packets[0].failure_code } : {}),
  };
}

export async function getDurablePacketFields(packetId: string): Promise<PacketFieldsResponse | null> {
  if (!uuid(packetId)) return null;
  const sql = getPipelineSql();
  const packet = await sql<PacketRow[]>`
    select packet_id, referral_id, status, page_count, failure_code
    from pipeline.packet_uploads where packet_id = ${packetId}::uuid limit 1
  `;
  if (!packet[0]) return null;
  const rows = await sql<FieldRow[]>`
    select distinct rf.referral_field_id, rf.field_key, rf.proposed_value, rf.final_value,
      rf.confidence, rf.review_status, rf.source_document_id, rf.source_page,
      rf.evidence_blob_key, rf.version
    from pipeline.packet_upload_files pf
    join pipeline.referral_fields rf on rf.source_document_id = pf.document_id
    where pf.packet_id = ${packetId}::uuid
    order by rf.field_key
  `;
  const fieldIds = rows.map((row) => row.referral_field_id);
  const candidates = fieldIds.length
    ? await sql<CandidateRow[]>`
        select candidate_id, referral_field_id, source, candidate_value, confidence,
          source_page, evidence_blob_key
        from pipeline.extraction_candidates
        where referral_field_id in ${sql(fieldIds)}
        order by confidence desc, candidate_id
      `
    : [];
  const candidatesByField = new Map<string, FieldCandidate[]>();
  for (const candidate of candidates) {
    const list = candidatesByField.get(candidate.referral_field_id) ?? [];
    list.push(mapCandidate(packetId, candidate));
    candidatesByField.set(candidate.referral_field_id, list);
  }
  const fields = rows.map((row) => mapField(packetId, row, candidatesByField.get(row.referral_field_id) ?? []));
  const auditRows = await sql<{
    review_event_id: string; field_key: string; action: FieldAuditEvent["action"]; reviewer_id: string;
    previous_status: string | null; next_status: string | null; previous_value: unknown; next_value: unknown;
    reason_code: string | null; created_at: Date | string;
  }[]>`
    select e.review_event_id, rf.field_key, e.action, e.reviewer_id, e.previous_status,
      e.next_status, e.previous_value, e.next_value, e.reason_code, e.created_at
    from pipeline.field_review_events e
    join pipeline.referral_fields rf on rf.referral_field_id = e.referral_field_id
    where e.packet_id = ${packetId}::uuid order by e.created_at desc, e.review_event_id desc limit 500
  `;
  const missingItems = requiredPacketFields.filter((key) => {
    const field = fields.find((item) => item.field_key === key);
    return !field || field.review_status === "rejected" || !(field.final_value ?? field.proposed_value)?.trim();
  });
  const blockers = fields
    .filter((field) => field.review_status === "pending" || field.is_conflict)
    .map((field) => field.field_key);
  return {
    packet_id: packetId,
    fields,
    audit_events: auditRows.map((event) => ({
      event_id: event.review_event_id,
      packet_id: packetId,
      field_key: event.field_key,
      action: event.action,
      reviewer_id: event.reviewer_id,
      previous_status: reviewStatus(event.previous_status),
      next_status: reviewStatus(event.next_status),
      previous_value: jsonText(event.previous_value),
      next_value: jsonText(event.next_value),
      reason: event.reason_code ?? undefined,
      created_at: iso(event.created_at),
    })),
    packet_completeness: {
      required_total: requiredPacketFields.length,
      required_ready: requiredPacketFields.length - missingItems.length,
      missing_items: missingItems,
    },
    ehr_readiness: { ready: missingItems.length === 0 && blockers.length === 0, blockers: [...new Set([...missingItems, ...blockers])] },
  };
}

export async function reviewDurableField(
  packetId: string,
  fieldKey: string,
  input: ReviewFieldRequest,
  actor: Actor,
): Promise<ReviewFieldResponse | null> {
  if (!uuid(packetId)) return null;
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    const rows = await tx<FieldRow[]>`
      select rf.referral_field_id, rf.field_key, rf.proposed_value, rf.final_value,
        rf.confidence, rf.review_status, rf.source_document_id, rf.source_page,
        rf.evidence_blob_key, rf.version
      from pipeline.packet_upload_files pf
      join pipeline.referral_fields rf on rf.source_document_id = pf.document_id
      where pf.packet_id = ${packetId}::uuid and rf.field_key = ${fieldKey}
      limit 1 for update of rf
    `;
    const current = rows[0];
    if (!current) return null;
    if (Number(current.version) !== input.if_match) {
      throw new DocumentProcessingError(
        "field_version_conflict",
        409,
        "This extracted field changed in another session. Review the latest value before saving.",
      );
    }
    const nextStatus = input.action === "accept" ? "confirmed" : input.action;
    const nextValue = input.action === "edit" ? input.value!.trim() : input.action === "accept" ? current.proposed_value : null;
    const updated = await tx<FieldRow[]>`
      update pipeline.referral_fields
      set final_value = ${tx.json(nextValue as never)}, review_status = ${nextStatus}, reviewer_id = ${actor.id},
          reviewed_at = now(), version = version + 1, updated_at = now()
      where referral_field_id = ${current.referral_field_id}::uuid and version = ${current.version}
      returning referral_field_id, field_key, proposed_value, final_value, confidence, review_status,
        source_document_id, source_page, evidence_blob_key, version
    `;
    if (!updated[0]) throw new DocumentProcessingError("field_version_conflict", 409, "This field changed in another session.");
    const events = await tx<{ review_event_id: string; created_at: Date | string }[]>`
      insert into pipeline.field_review_events (
        packet_id, referral_field_id, action, reviewer_id, previous_status, next_status,
        previous_value, next_value
      ) values (
        ${packetId}::uuid, ${current.referral_field_id}::uuid, ${input.action}, ${actor.id},
        ${current.review_status}, ${nextStatus}, ${tx.json(current.final_value as never)}, ${tx.json(nextValue as never)}
      ) returning review_event_id, created_at
    `;
    const pending = await tx<{ count: number | string }[]>`
      select count(*) as count from pipeline.packet_upload_files pf
      join pipeline.referral_fields rf on rf.source_document_id = pf.document_id
      where pf.packet_id = ${packetId}::uuid and rf.review_status = 'pending'
    `;
    if (Number(pending[0]?.count ?? 0) === 0) {
      await tx`update pipeline.packet_uploads set status = 'reviewed', updated_at = now() where packet_id = ${packetId}::uuid`;
      await tx`
        update pipeline.documents d set processing_status = 'reviewed', updated_at = now(), version = version + 1
        from pipeline.packet_upload_files pf where pf.packet_id = ${packetId}::uuid and pf.document_id = d.document_id
      `;
    }
    return {
      field_key: fieldKey,
      version: Number(updated[0].version),
      review_status: contractReviewStatus(nextStatus),
      final_value: jsonText(nextValue),
      audit_event: {
        event_id: events[0].review_event_id,
        packet_id: packetId,
        field_key: fieldKey,
        action: input.action,
        reviewer_id: actor.id,
        previous_status: contractReviewStatus(current.review_status),
        next_status: contractReviewStatus(nextStatus),
        previous_value: jsonText(current.final_value),
        next_value: jsonText(nextValue),
        created_at: iso(events[0].created_at),
      },
    };
  });
}

export async function retryDurableField(
  packetId: string,
  fieldKey: string,
  actor: Actor,
): Promise<RetryFieldResponse | null> {
  if (!uuid(packetId)) return null;
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    const fields = await tx<FieldRow[]>`
      select rf.referral_field_id, rf.field_key, rf.proposed_value, rf.final_value,
        rf.confidence, rf.review_status, rf.source_document_id, rf.source_page,
        rf.evidence_blob_key, rf.version
      from pipeline.packet_upload_files pf
      join pipeline.referral_fields rf on rf.source_document_id = pf.document_id
      where pf.packet_id = ${packetId}::uuid and rf.field_key = ${fieldKey} limit 1
    `;
    if (!fields[0]?.source_document_id) return null;
    await tx`
      update pipeline.extraction_jobs set status = 'cancelled', completed_at = now(), updated_at = now()
      where document_id = ${fields[0].source_document_id}::uuid and job_type = 'referral_packet'
        and status in ('queued', 'running')
    `;
    const jobs = await tx<{ extraction_job_id: string }[]>`
      insert into pipeline.extraction_jobs (document_id, packet_id, job_type, status)
      values (${fields[0].source_document_id}::uuid, ${packetId}::uuid, 'referral_packet', 'queued')
      returning extraction_job_id
    `;
    const events = await tx<{ review_event_id: string; created_at: Date | string }[]>`
      insert into pipeline.field_review_events (
        packet_id, referral_field_id, action, reviewer_id, previous_status, next_status, reason_code
      ) values (
        ${packetId}::uuid, ${fields[0].referral_field_id}::uuid, 'retry', ${actor.id},
        ${fields[0].review_status}, 'pending', 'field_retry_requested'
      ) returning review_event_id, created_at
    `;
    await tx`
      update pipeline.referral_fields set review_status = 'pending', reviewer_id = null,
        reviewed_at = null, updated_at = now(), version = version + 1
      where referral_field_id = ${fields[0].referral_field_id}::uuid
    `;
    await tx`update pipeline.packet_uploads set status = 'extracting', updated_at = now() where packet_id = ${packetId}::uuid`;
    return {
      field_key: fieldKey,
      run_id: jobs[0].extraction_job_id,
      status: "queued",
      audit_event: {
        event_id: events[0].review_event_id,
        packet_id: packetId,
        field_key: fieldKey,
        action: "retry",
        reviewer_id: actor.id,
        previous_status: contractReviewStatus(fields[0].review_status),
        next_status: "pending",
        reason: "field_retry_requested",
        created_at: iso(events[0].created_at),
      },
    };
  });
}

function mapField(packetId: string, row: FieldRow, candidates: FieldCandidate[]): ExtractedField {
  const proposedValue = jsonText(row.proposed_value);
  const finalValue = jsonText(row.final_value);
  const distinct = new Set(candidates.map((candidate) => candidate.value).filter((value) => value !== null));
  return {
    field_key: row.field_key,
    version: Number(row.version),
    proposed_value: proposedValue,
    confidence: clampConfidence(row.confidence),
    review_status: contractReviewStatus(row.review_status),
    source_page_no: row.source_page ?? undefined,
    evidence_url: row.evidence_blob_key ? evidenceUrl(packetId, row.field_key) : undefined,
    is_conflict: distinct.size > 1,
    candidates,
    ...(row.review_status !== "pending" ? { final_value: finalValue } : {}),
  };
}

function mapCandidate(packetId: string, row: CandidateRow): FieldCandidate {
  return {
    candidate_id: row.candidate_id,
    source: row.source,
    value: jsonText(row.candidate_value),
    confidence: clampConfidence(row.confidence),
    source_page_no: row.source_page ?? undefined,
    evidence_url: row.evidence_blob_key ? evidenceUrl(packetId, row.referral_field_id) : undefined,
  };
}

function evidenceUrl(packetId: string, fieldKey: string) {
  return `/api/packets/${packetId}/evidence/${encodeURIComponent(fieldKey)}`;
}

function contractReviewStatus(value: string): "pending" | "accepted" | "edited" | "rejected" {
  if (value === "confirmed") return "accepted";
  if (value === "edited" || value === "rejected") return value;
  return "pending";
}

function reviewStatus(value: string | null) {
  return value ? contractReviewStatus(value) : undefined;
}

function jsonText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function clampConfidence(value: number | string | null) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function positiveInteger(value: string, label: string) {
  if (!/^\d{1,18}$/.test(value)) throw new DocumentProcessingError(`${label}_invalid`, 400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new DocumentProcessingError(`${label}_invalid`, 400);
  return parsed;
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

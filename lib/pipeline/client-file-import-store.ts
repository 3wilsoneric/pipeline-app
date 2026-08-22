import "server-only";

import { randomUUID } from "node:crypto";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import type {
  ClientFileImportReviewInput,
  ClientFileImportReviewItem,
} from "@/lib/pipeline/client-file-import-contracts";

type ReviewRow = Omit<ClientFileImportReviewItem,
  "source_byte_size" | "match_confidence" | "matched_referral_id" | "created_at" | "updated_at"
> & {
  source_byte_size: number | string | null;
  match_confidence: number | string | null;
  matched_referral_id: number | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  total_count?: number | string;
};

export function getClientFileImportReadiness() {
  const database = getPipelineDatabaseReadiness();
  return {
    ready: database.ready,
    mode: database.ready ? "postgres" as const : "unavailable" as const,
    message: database.ready ? null : "Client-file import review requires Pipeline PostgreSQL storage.",
  };
}

export async function listClientFileImportReviewItems(options: {
  query?: string;
  status?: "unmatched" | "candidate" | "confirmed" | "rejected" | "imported";
  limit?: number;
  offset?: number;
} = {}) {
  if (!getPipelineDatabaseReadiness().ready) {
    return { items: [] as ClientFileImportReviewItem[], total: 0, configured: false };
  }
  const sql = getPipelineSql();
  const query = options.query?.trim() || null;
  const status = options.status ?? null;
  const limit = bounded(options.limit, 100, 1, 200);
  const offset = bounded(options.offset, 0, 0, 100_000);
  const rows = await sql<ReviewRow[]>`
    select
      i.import_item_id::text,
      i.import_batch_id::text,
      b.source_system,
      i.source_item_id,
      i.source_canvas_id,
      i.source_client_name,
      i.source_resident_number,
      i.source_date_of_birth,
      i.source_community,
      i.source_file_name,
      i.source_content_type,
      i.source_byte_size,
      i.match_status,
      i.match_method,
      i.match_confidence,
      p.external_client_id as matched_pipeline_client_id,
      i.matched_canonical_client_id,
      i.matched_referral_id,
      i.version,
      i.created_at,
      i.updated_at,
      count(*) over()::integer as total_count
    from pipeline.client_file_import_items i
    join pipeline.client_file_import_batches b on b.import_batch_id = i.import_batch_id
    left join pipeline.people p on p.person_id = i.matched_person_id
    where (${status}::text is null or i.match_status = ${status})
      and (${query}::text is null or lower(concat_ws(' ',
        i.source_client_name, i.source_file_name, i.source_community, i.source_resident_number
      )) like ('%' || lower(${query}) || '%'))
    order by i.created_at, i.import_item_id
    limit ${limit} offset ${offset}
  `;
  return {
    items: rows.map(mapReviewRow),
    total: Number(rows[0]?.total_count ?? 0),
    configured: true,
  };
}

export async function reviewClientFileImportItem(
  itemId: string,
  input: ClientFileImportReviewInput,
  actor: PipelineUser,
) {
  if (!getPipelineDatabaseReadiness().ready) return { status: "unavailable" as const };
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    const current = (await tx<ReviewRow[]>`
      select
        i.import_item_id::text,
        i.import_batch_id::text,
        b.source_system,
        i.source_item_id,
        i.source_canvas_id,
        i.source_client_name,
        i.source_resident_number,
        i.source_date_of_birth,
        i.source_community,
        i.source_file_name,
        i.source_content_type,
        i.source_byte_size,
        i.match_status,
        i.match_method,
        i.match_confidence,
        p.external_client_id as matched_pipeline_client_id,
        i.matched_canonical_client_id,
        i.matched_referral_id,
        i.version,
        i.created_at,
        i.updated_at
      from pipeline.client_file_import_items i
      join pipeline.client_file_import_batches b on b.import_batch_id = i.import_batch_id
      left join pipeline.people p on p.person_id = i.matched_person_id
      where i.import_item_id = ${itemId}::uuid
      for update of i
    `)[0];
    if (!current) return { status: "not_found" as const };
    if (current.version !== input.if_match) return { status: "conflict" as const, item: mapReviewRow(current) };

    let personId: string | null = null;
    let canonicalClientId: string | null = null;
    let referralId: number | null = null;
    if (input.action === "create_client") {
      const externalClientId = `historical-${randomUUID()}`;
      const people = await tx<{ person_id: string }[]>`
        insert into pipeline.people (external_client_id, display_name, date_of_birth)
        values (${externalClientId}, ${current.source_client_name}, ${current.source_date_of_birth}::date)
        returning person_id
      `;
      personId = people[0].person_id;
    } else if (input.action === "confirm") {
      const target = input.target_client_id?.trim() ?? "";
      if (!target) return { status: "invalid_target" as const };
      if (target.startsWith("pipeline:")) {
        const pipelineClientId = target.slice("pipeline:".length).trim();
        const people = await tx<{ person_id: string }[]>`
          select person_id from pipeline.people where external_client_id = ${pipelineClientId} limit 1
        `;
        if (!people[0]) return { status: "invalid_target" as const };
        personId = people[0].person_id;
        if (input.referral_id) {
          const referrals = await tx<{ referral_id: number | string }[]>`
            select referral_id from pipeline.referrals
            where referral_id = ${input.referral_id} and person_id = ${personId}::uuid and deleted_at is null
            limit 1
          `;
          if (!referrals[0]) return { status: "invalid_referral" as const };
          referralId = Number(referrals[0].referral_id);
        }
      } else {
        canonicalClientId = target;
      }
    }

    const updated = (await tx<ReviewRow[]>`
      update pipeline.client_file_import_items i
      set match_status = ${input.action === "reject" ? "rejected" : "confirmed"},
          match_method = 'manual',
          match_confidence = ${input.action === "reject" ? null : 1},
          matched_person_id = ${personId}::uuid,
          matched_canonical_client_id = ${canonicalClientId},
          matched_referral_id = ${referralId},
          reviewed_by = ${actor.id},
          reviewed_at = now(),
          version = i.version + 1,
          updated_at = now()
      from pipeline.client_file_import_batches b
      left join pipeline.people p on p.person_id = ${personId}::uuid
      where i.import_item_id = ${itemId}::uuid and b.import_batch_id = i.import_batch_id
      returning
        i.import_item_id::text,
        i.import_batch_id::text,
        b.source_system,
        i.source_item_id,
        i.source_canvas_id,
        i.source_client_name,
        i.source_resident_number,
        i.source_date_of_birth,
        i.source_community,
        i.source_file_name,
        i.source_content_type,
        i.source_byte_size,
        i.match_status,
        i.match_method,
        i.match_confidence,
        p.external_client_id as matched_pipeline_client_id,
        i.matched_canonical_client_id,
        i.matched_referral_id,
        i.version,
        i.created_at,
        i.updated_at
    `)[0];
    await tx`
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        from_version, to_version, changed_fields, metadata
      ) values (
        'client_file_import_item', ${itemId}, ${input.action === "reject" ? "import_identity_rejected" : input.action === "create_client" ? "import_historical_client_created" : "import_identity_confirmed"},
        ${actor.id}, ${actor.name}, ${current.version}, ${updated.version},
        array['match_status', 'matched_identity'], ${tx.json({ source_system: current.source_system })}
      )
    `;
    return { status: "ok" as const, item: mapReviewRow(updated) };
  });
}

function mapReviewRow(row: ReviewRow): ClientFileImportReviewItem {
  return {
    ...row,
    source_date_of_birth: row.source_date_of_birth ? String(row.source_date_of_birth).slice(0, 10) : null,
    source_byte_size: row.source_byte_size === null ? null : Number(row.source_byte_size),
    match_confidence: row.match_confidence === null ? null : Number(row.match_confidence),
    matched_referral_id: row.matched_referral_id === null ? null : Number(row.matched_referral_id),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value!))) : fallback;
}

function iso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { normalizedOwnerAliases } from "@/lib/pipeline/referral-ownership";
import { isAssessorUser, scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { getReferralStoreReadiness, listReferrals } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";
import { listResidentLinks } from "@/lib/pipeline/resident-link-store";
import type { ClientWorkspaceDirectoryItem } from "@/lib/pipeline/client-workspace-contracts";

export type PipelineClientWorkspaceListOptions = {
  query?: string;
  community?: string;
  limit?: number;
  offset?: number;
  excludeConfirmed?: boolean;
};

export type ClinicalClientWorkspaceIdentity = {
  canonicalClientId: string;
  residentNumbers: string[];
};

export type ClinicalClientWorkspaceSummary = {
  referralCount: number;
  documentCount: number;
};

export async function listPipelineClientWorkspaces(
  user: PipelineUser,
  options: PipelineClientWorkspaceListOptions = {},
) {
  return getReferralStoreReadiness().mode === "postgres"
    ? listPostgresPipelineClientWorkspaces(user, options)
    : listLocalPipelineClientWorkspaces(user, options);
}

export async function getClinicalClientWorkspaceSummaries(
  user: PipelineUser,
  clients: ClinicalClientWorkspaceIdentity[],
) {
  const summaries = new Map<string, ClinicalClientWorkspaceSummary>();
  for (const client of clients) {
    summaries.set(client.canonicalClientId, { referralCount: 0, documentCount: 0 });
  }
  if (clients.length === 0 || getReferralStoreReadiness().mode !== "postgres") return summaries;

  const canonicalClientIds = clients.map((client) => client.canonicalClientId);
  const identityCanonicalIds: string[] = [];
  const identityKinds: string[] = [];
  const identityValues: string[] = [];
  for (const client of clients) {
    identityCanonicalIds.push(client.canonicalClientId);
    identityKinds.push("resident_key");
    identityValues.push(client.canonicalClientId);
    for (const residentNumber of client.residentNumbers) {
      const normalized = residentNumber.trim();
      if (!normalized) continue;
      identityCanonicalIds.push(client.canonicalClientId);
      identityKinds.push("resident_number");
      identityValues.push(normalized);
    }
  }

  const assessor = isAssessorUser(user);
  const ownerId = assessor ? user.id : null;
  const ownerNames = assessor ? normalizedOwnerAliases(user) : [];
  const sql = getPipelineSql();
  const rows = await sql<{
    canonical_client_id: string;
    referral_count: number | string;
    document_count: number | string;
  }[]>`
    with requested_clients as (
      select unnest(${canonicalClientIds}::text[]) as canonical_client_id
    ), requested_identities as (
      select * from unnest(
        ${identityCanonicalIds}::text[],
        ${identityKinds}::text[],
        ${identityValues}::text[]
      ) as identity(canonical_client_id, identity_kind, identity_value)
    ), visible_referrals as (
      select r.*
      from pipeline.referrals r
      where (
        ${ownerId}::text is null
        or r.owner_id = ${ownerId}
        or (r.owner_id is null and lower(trim(coalesce(r.owner_name, ''))) = any(${ownerNames}::text[]))
      )
    ), reviewed_people as (
      select distinct identity.canonical_client_id, rl.person_id
      from requested_identities identity
      join pipeline.resident_links rl
        on rl.status = 'confirmed'
       and (
         (identity.identity_kind = 'resident_key' and rl.resident_key = identity.identity_value)
         or (identity.identity_kind = 'resident_number' and rl.resident_number = identity.identity_value)
       )
      where ${ownerId}::text is null
        or exists (
          select 1 from visible_referrals access_referral
          where access_referral.referral_id = rl.referral_id
        )
    ), referral_counts as (
      select people.canonical_client_id, count(distinct referral.referral_id)::integer as referral_count
      from reviewed_people people
      join visible_referrals referral on referral.person_id = people.person_id
      group by people.canonical_client_id
    ), document_counts as (
      select requested.canonical_client_id, count(distinct document.document_id)::integer as document_count
      from requested_clients requested
      join pipeline.documents document
        on document.deleted_at is null
       and document.identity_status = 'linked'
       and (
         document.canonical_client_id = requested.canonical_client_id
         or exists (
           select 1 from reviewed_people people
           where people.canonical_client_id = requested.canonical_client_id
             and people.person_id = document.person_id
         )
       )
       and (
         ${ownerId}::text is null
         or document.referral_id is null
         or exists (
           select 1 from visible_referrals access_referral
           where access_referral.referral_id = document.referral_id
         )
       )
      group by requested.canonical_client_id
    )
    select
      requested.canonical_client_id,
      coalesce(referrals.referral_count, 0)::integer as referral_count,
      coalesce(documents.document_count, 0)::integer as document_count
    from requested_clients requested
    left join referral_counts referrals using (canonical_client_id)
    left join document_counts documents using (canonical_client_id)
  `;
  for (const row of rows) {
    summaries.set(row.canonical_client_id, {
      referralCount: Number(row.referral_count),
      documentCount: Number(row.document_count),
    });
  }
  return summaries;
}

type PipelineClientRow = {
  external_client_id: string;
  display_name: string;
  community: string | null;
  admission_date: string | null;
  referral_count: number | string;
  document_count: number | string;
  total_count: number | string;
};

async function listPostgresPipelineClientWorkspaces(
  user: PipelineUser,
  options: PipelineClientWorkspaceListOptions,
) {
  const sql = getPipelineSql();
  const query = options.query?.trim() || null;
  const community = options.community?.trim() || null;
  const limit = boundedLimit(options.limit);
  const offset = boundedOffset(options.offset);
  const assessor = isAssessorUser(user);
  const ownerId = assessor ? user.id : null;
  const ownerNames = assessor ? normalizedOwnerAliases(user) : [];
  const excludeConfirmed = options.excludeConfirmed !== false;
  const rows = await sql<PipelineClientRow[]>`
    with visible_referrals as (
      select r.*
      from pipeline.referrals r
      where (
        ${ownerId}::text is null
        or r.owner_id = ${ownerId}
        or (r.owner_id is null and lower(trim(coalesce(r.owner_name, ''))) = any(${ownerNames}::text[]))
      )
    ), client_rows as (
      select
        p.external_client_id,
        p.display_name,
        coalesce(
          (array_agg(vr.community order by vr.updated_at desc, vr.referral_id desc)
            filter (where vr.community is not null))[1]::text,
          (select d.client_community from pipeline.documents d
            where d.person_id = p.person_id and d.deleted_at is null and d.client_community is not null
            order by d.uploaded_at desc, d.document_id desc limit 1)
        ) as community,
        (array_agg(nullif(vr.data->>'admissionDate', '') order by vr.updated_at desc, vr.referral_id desc)
          filter (where coalesce(vr.data->>'admissionDate', '') <> ''))[1]::text as admission_date,
        count(distinct vr.referral_id)::integer as referral_count,
        (
          select count(*)::integer
          from pipeline.documents d
          where d.person_id = p.person_id and d.deleted_at is null
        ) as document_count
      from pipeline.people p
      left join visible_referrals vr on vr.person_id = p.person_id
      where p.external_client_id is not null
        and (
          exists (select 1 from visible_referrals access_referral where access_referral.person_id = p.person_id)
          or (${ownerId}::text is null and exists (
            select 1 from pipeline.documents access_document
            where access_document.person_id = p.person_id
              and access_document.deleted_at is null
              and access_document.identity_status = 'linked'
          ))
        ) and (
          not ${excludeConfirmed}
          or not exists (
            select 1 from pipeline.resident_links rl
            where rl.person_id = p.person_id and rl.status = 'confirmed'
          )
        )
      group by p.person_id, p.external_client_id, p.display_name
    )
    select *, count(*) over()::integer as total_count
    from client_rows
    where (${community}::text is null or client_rows.community = ${community})
      and (${query}::text is null
        or lower(concat_ws(' ', display_name, external_client_id, client_rows.community)) like ('%' || lower(${query}) || '%'))
    order by lower(display_name), external_client_id
    limit ${limit} offset ${offset}
  `;
  return {
    clients: rows.map(mapPipelineClientRow),
    total: Number(rows[0]?.total_count ?? 0),
  };
}

async function listLocalPipelineClientWorkspaces(
  user: PipelineUser,
  options: PipelineClientWorkspaceListOptions,
) {
  const referrals = await loadAllVisibleReferrals(user);
  const confirmed = options.excludeConfirmed === false
    ? new Set<string>()
    : await loadConfirmedPipelineClientIds();
  const grouped = new Map<string, Referral[]>();
  for (const referral of referrals) {
    const clientId = referral.clientId?.trim();
    if (!clientId || confirmed.has(clientId)) continue;
    if (options.community?.trim() && referral.community !== options.community.trim()) continue;
    const current = grouped.get(clientId) ?? [];
    current.push(referral);
    grouped.set(clientId, current);
  }
  const query = normalize(options.query ?? "");
  const clients = [...grouped.entries()]
    .map(([clientId, clientReferrals]) => mapLocalPipelineClient(clientId, clientReferrals))
    .filter((client) => !query || normalize([
      client.display_name,
      client.pipeline_client_id ?? "",
      ...client.community_names,
    ].join(" ")).includes(query))
    .sort((left, right) => left.display_name.localeCompare(right.display_name, "en")
      || left.canonical_client_id.localeCompare(right.canonical_client_id));
  const offset = boundedOffset(options.offset);
  const limit = boundedLimit(options.limit);
  return { clients: clients.slice(offset, offset + limit), total: clients.length };
}

async function loadAllVisibleReferrals(user: PipelineUser) {
  const referrals: Referral[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 500; page += 1) {
    const result = await listReferrals(scopeReferralListOptions(user, {
      limit: 200,
      cursor,
      workspaceStatus: "all",
    }));
    referrals.push(...result.referrals);
    cursor = result.next_cursor ?? undefined;
    if (!cursor) return referrals;
  }
  throw new Error("The local client workspace directory exceeded its safe pagination limit.");
}

async function loadConfirmedPipelineClientIds() {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 500; page += 1) {
    const result = await listResidentLinks({ status: "confirmed", limit: 200, cursor });
    for (const link of result.links) ids.add(link.pipeline_client_id);
    cursor = result.next_cursor ?? undefined;
    if (!cursor) return ids;
  }
  throw new Error("The resident-link store exceeded its safe pagination limit.");
}

function mapPipelineClientRow(row: PipelineClientRow): ClientWorkspaceDirectoryItem {
  const community = row.community?.trim() || null;
  return {
    canonical_client_id: `pipeline:${row.external_client_id}`,
    workspace_origin: "pipeline",
    pipeline_client_id: row.external_client_id,
    display_name: row.display_name,
    resident_numbers: [],
    current_resident: false,
    community_names: community ? [community] : [],
    current_community: community,
    unit: null,
    admit_date: isoDateOrNull(row.admission_date),
    care_level: null,
    episode_count: Number(row.referral_count),
    referral_count: Number(row.referral_count),
    document_count: Number(row.document_count),
  };
}

function mapLocalPipelineClient(clientId: string, referrals: Referral[]): ClientWorkspaceDirectoryItem {
  const sorted = [...referrals].sort((left, right) =>
    (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt));
  const latest = sorted[0];
  const communities = [...new Set(sorted.map((referral) => referral.community))];
  const documentNames = new Set<string>();
  for (const referral of sorted) {
    const addDocument = (name: string | null | undefined) => {
      const normalized = name?.trim().toLowerCase();
      if (normalized) documentNames.add(`${referral.id}:${normalized}`);
    };
    addDocument(referral.documentName);
    addDocument(referral.assessmentDocumentName);
    for (const requirement of referral.requirements ?? []) {
      addDocument(requirement.evidenceDocumentName);
    }
  }
  return {
    canonical_client_id: `pipeline:${clientId}`,
    workspace_origin: "pipeline",
    pipeline_client_id: clientId,
    display_name: latest.name,
    resident_numbers: [],
    current_resident: false,
    community_names: communities,
    current_community: latest.community,
    unit: null,
    admit_date: isoDateOrNull(latest.admissionDate),
    care_level: null,
    episode_count: sorted.length,
    referral_count: sorted.length,
    document_count: documentNames.size,
  };
}

function isoDateOrNull(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

function boundedLimit(value: number | undefined) {
  return Number.isFinite(value) ? Math.min(200, Math.max(1, Math.floor(value!))) : 200;
}

function boundedOffset(value: number | undefined) {
  return Number.isFinite(value) ? Math.min(100_000, Math.max(0, Math.floor(value!))) : 0;
}

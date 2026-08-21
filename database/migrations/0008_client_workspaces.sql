-- Client workspaces and durable document ownership.
-- Additive only: existing referrals, clinical links, and blobs are preserved.

begin;

alter table pipeline.documents
  add column if not exists source_system text not null default 'pipeline',
  add column if not exists source_external_id text,
  add column if not exists source_canvas_id text,
  add column if not exists document_date date,
  add column if not exists canonical_client_id text,
  add column if not exists client_display_name text,
  add column if not exists client_community text,
  add column if not exists identity_status text not null default 'unmatched';

alter table pipeline.packet_uploads
  add column if not exists processing_intent text not null default 'extract_referral';

alter table pipeline.packet_uploads
  drop constraint if exists packet_uploads_processing_intent_check;
alter table pipeline.packet_uploads
  add constraint packet_uploads_processing_intent_check
  check (processing_intent in ('extract_referral', 'preview_only'));

alter table pipeline.documents
  drop constraint if exists documents_source_system_check;
alter table pipeline.documents
  add constraint documents_source_system_check
  check (source_system in ('pipeline', 'alamo_platform', 'allo', 'import'));

alter table pipeline.documents
  drop constraint if exists documents_identity_status_check;
alter table pipeline.documents
  add constraint documents_identity_status_check
  check (identity_status in ('linked', 'candidate', 'unmatched'));

-- Referral ownership is authoritative for every document already attached to a
-- referral. This backfill is deterministic and does not perform name matching.
update pipeline.documents d
set person_id = r.person_id,
    identity_status = 'linked',
    updated_at = now()
from pipeline.referrals r
where d.referral_id = r.referral_id
  and (d.person_id is distinct from r.person_id or d.identity_status <> 'linked');

update pipeline.documents
set identity_status = 'linked', updated_at = now()
where person_id is not null and identity_status <> 'linked';

create unique index if not exists documents_source_external_unique_idx
  on pipeline.documents(source_system, source_external_id)
  where source_external_id is not null and deleted_at is null;

create index if not exists documents_client_inventory_idx
  on pipeline.documents(person_id, document_date desc nulls last, uploaded_at desc, document_id desc)
  where deleted_at is null;

create index if not exists documents_canonical_client_inventory_idx
  on pipeline.documents(canonical_client_id, document_date desc nulls last, uploaded_at desc, document_id desc)
  where deleted_at is null and canonical_client_id is not null;

create index if not exists documents_unmatched_review_idx
  on pipeline.documents(identity_status, uploaded_at, document_id)
  where deleted_at is null and identity_status in ('candidate', 'unmatched');

-- Convert unambiguous legacy filename evidence into actual document links.
with evidence_matches as (
  select wi.work_item_id, min(d.document_id::text)::uuid as document_id, count(*) as match_count
  from pipeline.work_items wi
  join pipeline.documents d
    on d.referral_id = wi.referral_id
   and lower(trim(d.file_name)) = lower(trim(wi.evidence_document_name))
   and d.deleted_at is null
  where wi.evidence_document_id is null
    and coalesce(trim(wi.evidence_document_name), '') <> ''
  group by wi.work_item_id
)
update pipeline.work_items wi
set evidence_document_id = matches.document_id,
    updated_at = now(),
    version = version + 1
from evidence_matches matches
where wi.work_item_id = matches.work_item_id
  and matches.match_count = 1;

create table if not exists pipeline.client_file_import_batches (
  import_batch_id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system in ('allo', 'import')),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'staged'
    check (status in ('staged', 'matching', 'ready', 'importing', 'complete', 'failed')),
  item_count integer not null default 0 check (item_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, manifest_sha256)
);

create table if not exists pipeline.client_file_import_items (
  import_item_id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references pipeline.client_file_import_batches(import_batch_id) on delete cascade,
  source_item_id text not null,
  source_canvas_id text,
  source_client_name text not null,
  source_resident_number text,
  source_date_of_birth date,
  source_community text,
  source_file_name text not null,
  source_content_type text,
  source_byte_size bigint check (source_byte_size is null or source_byte_size >= 0),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  source_locator text,
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'candidate', 'confirmed', 'rejected', 'imported')),
  match_method text check (match_method is null or match_method in (
    'resident_number_exact', 'pipeline_client_id', 'exact_name_dob', 'manual'
  )),
  match_confidence numeric(5,4) check (match_confidence is null or match_confidence between 0 and 1),
  matched_person_id uuid references pipeline.people(person_id),
  matched_canonical_client_id text,
  matched_referral_id bigint references pipeline.referrals(referral_id),
  imported_document_id uuid references pipeline.documents(document_id),
  reviewed_by text,
  reviewed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_batch_id, source_item_id)
);

create index if not exists client_file_import_review_idx
  on pipeline.client_file_import_items(import_batch_id, match_status, created_at, import_item_id)
  where match_status in ('unmatched', 'candidate');

insert into pipeline.store_revisions (store_name)
values ('client_workspaces'), ('client_file_imports')
on conflict (store_name) do nothing;

insert into pipeline.schema_migrations (migration_id)
values ('0008_client_workspaces')
on conflict (migration_id) do nothing;

revoke all on table pipeline.client_file_import_batches from public;
revoke all on table pipeline.client_file_import_items from public;

commit;

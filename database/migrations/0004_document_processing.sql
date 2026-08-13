begin;

drop index if exists pipeline.documents_sha256_referral_unique_idx;
create unique index if not exists documents_sha256_referral_unique_idx
  on pipeline.documents(referral_id, sha256)
  where referral_id is not null and deleted_at is null and processing_status <> 'failed';

create table if not exists pipeline.packet_uploads (
  packet_id uuid primary key default gen_random_uuid(),
  referral_id bigint not null references pipeline.referrals(referral_id) on delete cascade,
  source_type text not null check (source_type in ('fax', 'email', 'portal', 'manual')),
  submitting_facility text not null,
  status text not null check (status in (
    'received', 'normalizing', 'extracting', 'ready_for_review', 'reviewed', 'failed'
  )),
  uploaded_by text not null,
  page_count integer not null default 0 check (page_count >= 0),
  failure_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists packet_uploads_referral_date_idx
  on pipeline.packet_uploads(referral_id, created_at desc, packet_id);
create index if not exists packet_uploads_status_date_idx
  on pipeline.packet_uploads(status, updated_at, packet_id)
  where status not in ('reviewed', 'failed');

create table if not exists pipeline.packet_upload_files (
  packet_id uuid not null references pipeline.packet_uploads(packet_id) on delete cascade,
  file_id text not null,
  document_id uuid not null references pipeline.documents(document_id) on delete cascade,
  expected_byte_size bigint not null check (expected_byte_size > 0),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  blob_path text not null,
  reservation_expires_at timestamptz not null,
  uploaded_at timestamptz,
  primary key (packet_id, file_id),
  unique (document_id)
);

create index if not exists packet_upload_files_expiry_idx
  on pipeline.packet_upload_files(reservation_expires_at, packet_id)
  where uploaded_at is null;

create table if not exists pipeline.extraction_candidates (
  candidate_id uuid primary key default gen_random_uuid(),
  referral_field_id uuid not null references pipeline.referral_fields(referral_field_id) on delete cascade,
  source text not null check (source in ('document_intelligence', 'claude', 'human')),
  candidate_value jsonb,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  source_page integer check (source_page is null or source_page > 0),
  evidence_blob_key text,
  created_at timestamptz not null default now()
);

create index if not exists extraction_candidates_field_idx
  on pipeline.extraction_candidates(referral_field_id, confidence desc, candidate_id);

create table if not exists pipeline.field_review_events (
  review_event_id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references pipeline.packet_uploads(packet_id) on delete cascade,
  referral_field_id uuid not null references pipeline.referral_fields(referral_field_id) on delete cascade,
  action text not null check (action in ('accept', 'edit', 'reject', 'retry')),
  reviewer_id text not null,
  previous_status text,
  next_status text,
  previous_value jsonb,
  next_value jsonb,
  reason_code text,
  created_at timestamptz not null default now()
);

create index if not exists field_review_events_packet_date_idx
  on pipeline.field_review_events(packet_id, created_at desc, review_event_id);

alter table pipeline.extraction_jobs
  add column if not exists packet_id uuid references pipeline.packet_uploads(packet_id) on delete cascade,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists attempt_token uuid,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists provider_state text;

alter table pipeline.extraction_jobs
  drop constraint if exists extraction_jobs_status_check;
alter table pipeline.extraction_jobs
  add constraint extraction_jobs_status_check
  check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'dead_letter'));

create unique index if not exists extraction_jobs_active_document_type_idx
  on pipeline.extraction_jobs(document_id, job_type)
  where status in ('queued', 'running');
create index if not exists extraction_jobs_dead_letter_idx
  on pipeline.extraction_jobs(dead_lettered_at desc, extraction_job_id)
  where status = 'dead_letter';

create table if not exists pipeline.document_preview_pages (
  document_id uuid not null references pipeline.documents(document_id) on delete cascade,
  page_number integer not null check (page_number > 0),
  blob_container text not null,
  blob_key text not null,
  content_type text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  primary key (document_id, page_number),
  unique (blob_container, blob_key)
);

create table if not exists pipeline.document_artifacts (
  document_artifact_id uuid primary key default gen_random_uuid(),
  document_id uuid not null references pipeline.documents(document_id) on delete cascade,
  artifact_kind text not null check (artifact_kind in (
    'normalized_page', 'ocr_json', 'preview', 'evidence', 'extraction_output', 'other'
  )),
  blob_container text not null,
  blob_key text not null,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  created_at timestamptz not null default now(),
  unique (blob_container, blob_key)
);

create index if not exists document_artifacts_document_idx
  on pipeline.document_artifacts(document_id, artifact_kind, document_artifact_id);

create table if not exists pipeline.retention_events (
  retention_event_id uuid primary key default gen_random_uuid(),
  document_id uuid,
  event_type text not null check (event_type in ('soft_delete', 'blob_delete', 'blob_delete_failed', 'reservation_expired')),
  actor_id text not null,
  reason_code text not null,
  created_at timestamptz not null default now()
);

create index if not exists retention_events_document_date_idx
  on pipeline.retention_events(document_id, created_at desc, retention_event_id);

create index if not exists referrals_updated_keyset_idx
  on pipeline.referrals(updated_at desc, referral_id desc);
create index if not exists referrals_priority_updated_idx
  on pipeline.referrals(priority, updated_at desc, referral_id desc);
create index if not exists documents_uploaded_keyset_idx
  on pipeline.documents(uploaded_at desc, document_id desc)
  where deleted_at is null;
create index if not exists assessments_updated_keyset_idx
  on pipeline.assessments(updated_at desc, assessment_id desc);
create index if not exists resident_links_updated_keyset_idx
  on pipeline.resident_links(updated_at desc, resident_link_id desc);

insert into pipeline.store_revisions (store_name)
values ('documents'), ('extraction_jobs')
on conflict (store_name) do nothing;

insert into pipeline.schema_migrations (migration_id)
values ('0004_document_processing')
on conflict (migration_id) do nothing;

revoke all on all tables in schema pipeline from public;
revoke all on all sequences in schema pipeline from public;

commit;

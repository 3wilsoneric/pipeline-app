begin;

alter table pipeline.schema_migrations
  add column if not exists checksum_sha256 text;

alter table pipeline.documents
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists preview_status text not null default 'pending' check (preview_status in ('pending', 'processing', 'ready', 'failed', 'unavailable')),
  add column if not exists preview_blob_key text,
  add column if not exists preview_content_type text,
  add column if not exists page_count integer check (page_count is null or page_count >= 0),
  add column if not exists malware_scan_status text not null default 'pending' check (malware_scan_status in ('pending', 'clean', 'infected', 'failed')),
  add column if not exists retention_until timestamptz,
  add column if not exists failure_code text,
  add column if not exists deleted_at timestamptz;

create index if not exists documents_referral_date_idx
  on pipeline.documents(referral_id, uploaded_at desc, document_id)
  where deleted_at is null;

create index if not exists documents_preview_queue_idx
  on pipeline.documents(preview_status, updated_at, document_id)
  where preview_status in ('pending', 'processing') and deleted_at is null;

create index if not exists documents_scan_queue_idx
  on pipeline.documents(malware_scan_status, uploaded_at, document_id)
  where malware_scan_status in ('pending', 'failed') and deleted_at is null;

alter table pipeline.extraction_jobs
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_error_code text;

create index if not exists extraction_jobs_claim_idx
  on pipeline.extraction_jobs(status, next_attempt_at, queued_at, extraction_job_id)
  where status in ('queued', 'running');

alter table pipeline.idempotency_keys
  add column if not exists expires_at timestamptz;

create index if not exists idempotency_keys_expiry_idx
  on pipeline.idempotency_keys(expires_at)
  where expires_at is not null;

alter table pipeline.audit_events
  add column if not exists request_id uuid;

insert into pipeline.schema_migrations (migration_id)
values ('0003_operational_hardening')
on conflict (migration_id) do nothing;

revoke all on all tables in schema pipeline from public;
revoke all on all sequences in schema pipeline from public;

commit;

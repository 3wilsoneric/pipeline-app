-- Canonical client identity and an approval-gated outbox for future Alamo updates.
-- This migration is additive. It does not publish to Databricks or alter the
-- immutable 2026-08-18 client-database baseline.

begin;

alter table pipeline.assessments
  add column if not exists canonical_client_id text;

create index if not exists assessments_canonical_client_date_idx
  on pipeline.assessments(canonical_client_id, assessment_date desc, created_at desc)
  where canonical_client_id is not null;

create table if not exists pipeline.client_update_outbox (
  client_update_id uuid primary key default gen_random_uuid(),
  update_type text not null check (update_type in ('new_client', 'assessment')),
  canonical_client_id text,
  assessment_id text references pipeline.assessments(assessment_id),
  source_baseline_date date not null,
  payload jsonb not null,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'published', 'rejected', 'failed')),
  approved_by text,
  approved_at timestamptz,
  published_at timestamptz,
  error_code text,
  idempotency_key text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (update_type <> 'assessment' or assessment_id is not null),
  check (status in ('pending_approval', 'rejected', 'failed') or approved_at is not null)
);

create index if not exists client_update_outbox_review_idx
  on pipeline.client_update_outbox(status, created_at, client_update_id)
  where status in ('pending_approval', 'approved', 'failed');

revoke all on table pipeline.client_update_outbox from public;

insert into pipeline.schema_migrations (migration_id)
values ('0007_canonical_client_assessments')
on conflict (migration_id) do nothing;

commit;

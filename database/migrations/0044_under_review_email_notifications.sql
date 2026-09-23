-- One notification attempt per saved Under Review recommendation version.
-- An uncertain Graph send is never retried automatically, avoiding duplicate mail.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists pipeline.under_review_email_notifications (
  -- Keep identifiers without foreign keys: historical rollback drills remove
  -- parent tables while preserving this send ledger to prevent duplicate mail.
  recommendation_id uuid not null,
  recommendation_version integer not null check (recommendation_version > 0),
  referral_id bigint not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  primary key (recommendation_id, recommendation_version)
);

revoke all on table pipeline.under_review_email_notifications from public;

insert into pipeline.schema_migrations (migration_id)
values ('0044_under_review_email_notifications') on conflict (migration_id) do nothing;
commit;

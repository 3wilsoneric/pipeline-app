-- Aggregate interactions only: no entered text, client IDs, URLs or DOM content.
-- Independent from clinical records. An application rollback can leave this table intact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table if not exists pipeline.assessor_usage_minutes (
  principal_id text not null,
  session_id uuid not null,
  minute timestamptz not null check (minute = date_trunc('minute', minute)),
  interactions integer not null check (interactions between 0 and 600),
  primary key (principal_id, session_id, minute)
);
create index if not exists assessor_usage_period_idx on pipeline.assessor_usage_minutes(minute, principal_id);
insert into pipeline.schema_migrations (migration_id) values ('0049_assessor_usage') on conflict do nothing;
commit;

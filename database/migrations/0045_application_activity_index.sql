-- Bounded owner activity queries use time first, without scanning all history.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create index if not exists audit_events_created_idx
  on pipeline.audit_events(created_at desc, audit_event_id desc);
insert into pipeline.schema_migrations (migration_id)
values ('0045_application_activity_index') on conflict (migration_id) do nothing;
commit;

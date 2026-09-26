-- Query acceleration only; all audit history is retained.
begin;
set local lock_timeout = '5s';
drop index if exists pipeline.audit_events_created_idx;
delete from pipeline.schema_migrations where migration_id = '0045_application_activity_index';
commit;

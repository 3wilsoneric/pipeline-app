drop table if exists pipeline.client_update_outbox;
drop index if exists pipeline.assessments_canonical_client_date_idx;
alter table pipeline.assessments drop column if exists canonical_client_id;
delete from pipeline.schema_migrations where migration_id = '0007_canonical_client_assessments';

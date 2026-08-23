drop index if exists pipeline.referrals_county_created_idx;
alter table pipeline.referrals drop column if exists county;
delete from pipeline.schema_migrations where migration_id = '0014_workspace_county';

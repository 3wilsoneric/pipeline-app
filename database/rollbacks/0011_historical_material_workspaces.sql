-- Emergency rollback only. Imported historical workspaces must be removed or
-- converted before this rollback can satisfy the Pipeline-origin constraint.

delete from pipeline.referrals
where workspace_origin in ('allo', 'import');

drop index if exists pipeline.referrals_workspace_origin_project_idx;
drop index if exists pipeline.referrals_workspace_import_batch_idx;
drop index if exists pipeline.referrals_workspace_status_updated_idx;
drop index if exists pipeline.referrals_source_workspace_unique_idx;

alter table pipeline.referrals
  drop constraint if exists referrals_source_workspace_identity_check,
  drop constraint if exists referrals_source_material_count_check,
  drop constraint if exists referrals_workspace_status_check,
  drop constraint if exists referrals_workspace_origin_check,
  drop column if exists workspace_import_batch_id,
  drop column if exists source_material_count,
  drop column if exists source_project_name,
  drop column if exists source_project_id,
  drop column if exists source_workspace_name,
  drop column if exists source_workspace_id,
  drop column if exists workspace_status,
  drop column if exists workspace_origin;

drop table if exists pipeline.workspace_import_batches;

delete from pipeline.schema_migrations
where migration_id = '0011_historical_material_workspaces';

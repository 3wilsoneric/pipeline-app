delete from pipeline.workspace_members
where identity_status in ('provisional', 'merged');

drop index if exists pipeline.workspace_members_identity_status_idx;
drop index if exists pipeline.workspace_members_source_identity_unique_idx;

alter table pipeline.workspace_members
  drop constraint if exists workspace_members_merged_into_fkey,
  drop constraint if exists workspace_members_identity_state_check,
  drop constraint if exists workspace_members_identity_status_check;

alter table pipeline.workspace_members
  drop column if exists merged_into_principal_id,
  drop column if exists source_identity,
  drop column if exists source_system,
  drop column if exists identity_status;

alter table pipeline.workspace_members
  alter column email set not null,
  alter column last_seen_at set not null;

delete from pipeline.schema_migrations
where migration_id = '0010_provisional_workspace_members';

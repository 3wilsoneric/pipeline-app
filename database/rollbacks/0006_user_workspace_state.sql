drop index if exists pipeline.user_workspace_state_expiry_idx;
drop index if exists pipeline.user_workspace_state_principal_recent_idx;
drop table if exists pipeline.user_workspace_state;
delete from pipeline.schema_migrations where migration_id = '0006_user_workspace_state';

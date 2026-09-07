alter table pipeline.workspace_members
  drop constraint if exists workspace_members_profile_fields_check;

alter table pipeline.workspace_members
  drop column if exists profile_updated_at,
  drop column if exists profile_version,
  drop column if exists status_message,
  drop column if exists time_zone,
  drop column if exists work_phone,
  drop column if exists team,
  drop column if exists job_title,
  drop column if exists preferred_name;

delete from pipeline.schema_migrations
where migration_id = '0027_staff_profiles';

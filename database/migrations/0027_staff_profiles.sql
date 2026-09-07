-- Keep organization-owned identity separate from staff-editable profile preferences.

begin;

alter table pipeline.workspace_members
  add column if not exists preferred_name text,
  add column if not exists job_title text,
  add column if not exists team text,
  add column if not exists work_phone text,
  add column if not exists time_zone text,
  add column if not exists status_message text,
  add column if not exists profile_version integer not null default 1,
  add column if not exists profile_updated_at timestamptz;

alter table pipeline.workspace_members
  drop constraint if exists workspace_members_profile_fields_check;
alter table pipeline.workspace_members
  add constraint workspace_members_profile_fields_check
  check (
    (preferred_name is null or length(preferred_name) between 1 and 80)
    and (job_title is null or length(job_title) between 1 and 120)
    and (team is null or length(team) between 1 and 120)
    and (work_phone is null or length(work_phone) between 1 and 40)
    and (time_zone is null or length(time_zone) between 1 and 100)
    and (status_message is null or length(status_message) between 1 and 120)
    and profile_version > 0
  );

insert into pipeline.schema_migrations (migration_id)
values ('0027_staff_profiles')
on conflict (migration_id) do nothing;

commit;

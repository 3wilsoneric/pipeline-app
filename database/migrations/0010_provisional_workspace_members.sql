begin;

alter table pipeline.workspace_members
  alter column email drop not null,
  alter column last_seen_at drop not null;

alter table pipeline.workspace_members
  add column if not exists identity_status text not null default 'entra_linked',
  add column if not exists source_system text,
  add column if not exists source_identity text,
  add column if not exists merged_into_principal_id text;

alter table pipeline.workspace_members
  drop constraint if exists workspace_members_identity_status_check;
alter table pipeline.workspace_members
  add constraint workspace_members_identity_status_check
  check (identity_status in ('entra_linked', 'provisional', 'merged'));

alter table pipeline.workspace_members
  drop constraint if exists workspace_members_identity_state_check;
alter table pipeline.workspace_members
  add constraint workspace_members_identity_state_check
  check (
    (
      identity_status = 'entra_linked'
      and email is not null
      and last_seen_at is not null
      and merged_into_principal_id is null
    )
    or (
      identity_status = 'provisional'
      and email is null
      and last_seen_at is null
      and source_system is not null
      and source_identity is not null
      and merged_into_principal_id is null
    )
    or (
      identity_status = 'merged'
      and not active
      and merged_into_principal_id is not null
    )
  );

alter table pipeline.workspace_members
  drop constraint if exists workspace_members_merged_into_fkey;
alter table pipeline.workspace_members
  add constraint workspace_members_merged_into_fkey
  foreign key (merged_into_principal_id)
  references pipeline.workspace_members(principal_id)
  deferrable initially deferred;

create unique index if not exists workspace_members_source_identity_unique_idx
  on pipeline.workspace_members(source_system, source_identity)
  where source_system is not null and source_identity is not null and identity_status <> 'merged';

create index if not exists workspace_members_identity_status_idx
  on pipeline.workspace_members(identity_status, active, lower(display_name), principal_id);

insert into pipeline.schema_migrations (migration_id)
values ('0010_provisional_workspace_members')
on conflict (migration_id) do nothing;

commit;

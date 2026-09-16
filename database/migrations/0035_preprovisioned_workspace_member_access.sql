-- Verified Entra accounts can be linked before their first actual sign-in.
begin;

alter table pipeline.workspace_members
  drop constraint workspace_members_identity_state_check;
alter table pipeline.workspace_members
  add constraint workspace_members_identity_state_check
  check (
    (
      identity_status = 'entra_linked'
      and email is not null
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

insert into pipeline.schema_migrations (migration_id)
values ('0035_preprovisioned_workspace_member_access')
on conflict (migration_id) do nothing;

commit;

-- Application rollback can retain migration 0035. Restoring the older
-- constraint must never invent a sign-in or deactivate a provisioned account.
begin;

do $$
begin
  if exists (select 1 from pipeline.workspace_members
    where identity_status = 'entra_linked' and last_seen_at is null) then
    raise exception 'Cannot restore the older identity constraint while linked accounts have never signed in. Keep migration 0035 when rolling back the application.';
  end if;
end;
$$;

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

delete from pipeline.schema_migrations where migration_id = '0035_preprovisioned_workspace_member_access';

commit;

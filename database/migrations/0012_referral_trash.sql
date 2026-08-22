begin;

alter table pipeline.referrals
  add column if not exists deleted_at timestamptz,
  add column if not exists delete_after timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_by_name text;

alter table pipeline.referrals
  drop constraint if exists referrals_deletion_window_check;
alter table pipeline.referrals
  add constraint referrals_deletion_window_check
  check (
    (deleted_at is null and delete_after is null and deleted_by is null and deleted_by_name is null)
    or (
      deleted_at is not null
      and delete_after is not null
      and delete_after > deleted_at
      and nullif(trim(deleted_by), '') is not null
      and nullif(trim(deleted_by_name), '') is not null
    )
  );

create index if not exists referrals_trash_retention_idx
  on pipeline.referrals(delete_after, referral_id)
  where deleted_at is not null;

create index if not exists referrals_active_updated_idx
  on pipeline.referrals(updated_at desc, referral_id desc)
  where deleted_at is null;

insert into pipeline.schema_migrations (migration_id)
values ('0012_referral_trash')
on conflict (migration_id) do nothing;

commit;

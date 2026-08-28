begin;

-- Month and community navigation are based on the date the referral was
-- received, not the timestamp when its Pipeline record happened to be created.
create index if not exists referrals_workspace_received_idx
  on pipeline.referrals(workspace_status, received_date desc, referral_id desc)
  where deleted_at is null;

insert into pipeline.schema_migrations (migration_id)
values ('0017_referral_received_month')
on conflict (migration_id) do nothing;

commit;

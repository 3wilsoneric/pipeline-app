drop index if exists pipeline.referrals_workspace_month_idx;
drop trigger if exists referrals_set_pipeline_workspace_month on pipeline.referrals;
drop function if exists pipeline.set_pipeline_workspace_month();

alter table pipeline.referrals
  drop constraint if exists referrals_workspace_month_known_check,
  drop constraint if exists referrals_workspace_month_first_day_check,
  drop constraint if exists referrals_workspace_month_basis_check,
  drop column if exists workspace_month_basis,
  drop column if exists workspace_month;

create index if not exists referrals_workspace_received_idx
  on pipeline.referrals(workspace_status, received_date desc, referral_id desc)
  where deleted_at is null;

delete from pipeline.schema_migrations
where migration_id = '0024_workspace_month_provenance';

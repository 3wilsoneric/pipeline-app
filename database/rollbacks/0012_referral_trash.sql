drop index if exists pipeline.referrals_active_updated_idx;
drop index if exists pipeline.referrals_trash_retention_idx;

alter table pipeline.referrals
  drop constraint if exists referrals_deletion_window_check,
  drop column if exists deleted_by_name,
  drop column if exists deleted_by,
  drop column if exists delete_after,
  drop column if exists deleted_at;

delete from pipeline.schema_migrations
where migration_id = '0012_referral_trash';

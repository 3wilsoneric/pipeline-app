drop index if exists pipeline.referrals_workspace_received_idx;

delete from pipeline.schema_migrations
where migration_id = '0017_referral_received_month';

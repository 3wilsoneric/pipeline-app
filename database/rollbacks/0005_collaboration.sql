drop index if exists pipeline.audit_events_referral_version_idx;
drop table if exists pipeline.editing_presence;
alter table pipeline.referrals drop constraint if exists referrals_section_versions_object_check;
alter table pipeline.referrals drop column if exists section_versions;
delete from pipeline.schema_migrations where migration_id = '0005_collaboration';

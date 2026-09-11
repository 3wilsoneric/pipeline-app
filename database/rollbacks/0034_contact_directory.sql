drop table if exists pipeline.referral_contacts;
drop table if exists pipeline.contacts;

delete from pipeline.store_revisions where store_name = 'contacts';
delete from pipeline.schema_migrations where migration_id = '0034_contact_directory';

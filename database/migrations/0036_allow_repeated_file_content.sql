begin;

-- Content hashes verify bytes; each upload retains its own document identity.
drop index if exists pipeline.documents_sha256_referral_unique_idx;
drop index if exists pipeline.referrals_document_sha256_unique_idx;

insert into pipeline.schema_migrations (migration_id)
values ('0036_allow_repeated_file_content')
on conflict (migration_id) do nothing;

commit;

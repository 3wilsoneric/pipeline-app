begin;

-- Index restoration must fail rather than delete uploads accepted after rollout.
create unique index documents_sha256_referral_unique_idx
  on pipeline.documents(referral_id, sha256)
  where referral_id is not null and deleted_at is null and processing_status <> 'failed';
create unique index referrals_document_sha256_unique_idx
  on pipeline.referrals(document_sha256)
  where document_sha256 is not null;

delete from pipeline.schema_migrations
where migration_id = '0036_allow_repeated_file_content';

commit;

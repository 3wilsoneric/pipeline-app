-- Additive indexes for the bounded global Pipeline search paths.

begin;

create extension if not exists pg_trgm;

create index if not exists people_display_name_search_trgm_idx
  on pipeline.people using gin (lower(display_name) gin_trgm_ops);

create index if not exists people_external_client_search_trgm_idx
  on pipeline.people using gin (lower(external_client_id) gin_trgm_ops)
  where external_client_id is not null;

create index if not exists documents_file_name_search_trgm_idx
  on pipeline.documents using gin (lower(file_name) gin_trgm_ops)
  where deleted_at is null;

create index if not exists documents_client_name_search_trgm_idx
  on pipeline.documents using gin (lower(client_display_name) gin_trgm_ops)
  where deleted_at is null and client_display_name is not null;

create index if not exists documents_client_community_search_trgm_idx
  on pipeline.documents using gin (lower(client_community) gin_trgm_ops)
  where deleted_at is null and client_community is not null;

-- Existing referrals predate the broader chart search projection. Only values
-- already saved into the referral chart are added here; raw OCR artifacts and
-- SSNs remain outside global search.
update pipeline.referrals
set search_text = lower(concat_ws(' ',
  search_text,
  data->>'dob',
  data->>'gender',
  data->>'reportedAge',
  data->>'admissionDate',
  data->>'responsiblePerson',
  data->>'phone',
  data->>'email',
  data->>'payer',
  data->>'interview',
  data#>>'{assessment,preAssessment,demographics}',
  data#>>'{assessment,preAssessment,referralSource}',
  data#>>'{assessment,assessment,carry}',
  data#>>'{assessment,assessment,careNeeds}',
  data#>>'{assessment,assessment,riskLevel}',
  data#>>'{assessment,postAssessment,decision}',
  data#>>'{assessment,postAssessment,reason}'
));

insert into pipeline.schema_migrations (migration_id)
values ('0013_search_performance')
on conflict (migration_id) do nothing;

commit;

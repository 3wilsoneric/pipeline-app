begin;

alter table pipeline.referrals
  add column if not exists section_versions jsonb not null default '{
    "identity": 1,
    "intake": 1,
    "documents": 1,
    "assessment": 1,
    "workflow": 1,
    "decision": 1
  }'::jsonb;

alter table pipeline.referrals
  drop constraint if exists referrals_section_versions_object_check;
alter table pipeline.referrals
  add constraint referrals_section_versions_object_check
  check (jsonb_typeof(section_versions) = 'object');

create table if not exists pipeline.editing_presence (
  lease_id uuid primary key,
  referral_id bigint not null references pipeline.referrals(referral_id) on delete cascade,
  actor_id text not null,
  actor_name text not null,
  section text not null check (section in (
    'identity', 'intake', 'documents', 'assessment', 'workflow', 'decision'
  )),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > heartbeat_at)
);

create index if not exists editing_presence_referral_expiry_idx
  on pipeline.editing_presence(referral_id, expires_at, actor_id);

create index if not exists audit_events_referral_version_idx
  on pipeline.audit_events(entity_id, to_version desc, created_at desc)
  where entity_type = 'referral';

insert into pipeline.schema_migrations (migration_id)
values ('0005_collaboration')
on conflict (migration_id) do nothing;

commit;

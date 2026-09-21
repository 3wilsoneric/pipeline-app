-- Recipient access is separate from staff workspace access. No anonymous file URLs.
begin;
create table if not exists pipeline.admission_packet_links (
  packet_id uuid primary key,
  referral_id bigint not null references pipeline.referrals(referral_id) on delete cascade,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admission_packet_links_referral_idx
  on pipeline.admission_packet_links(referral_id, created_at desc);
insert into pipeline.schema_migrations (migration_id)
values ('0042_admission_packet_links') on conflict (migration_id) do nothing;
commit;

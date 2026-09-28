-- Client notes (docs/design/DECISIONS.md, "Notes"): notes attached to a referral, taken by the assessor
-- while preparing for and doing the interview; anyone who can open the referral reads them. One row per
-- heading with its own version, so one heading's save never overwrites another's. Additive.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table if not exists pipeline.client_note_blocks (
  referral_id bigint not null references pipeline.referrals(referral_id) on delete cascade,
  heading_key text not null check (heading_key ~ '^[a-z0-9_:-]{1,64}$'),
  body text not null default '' check (char_length(body) <= 20000),
  version integer not null default 1 check (version > 0),
  updated_by text not null,
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (referral_id, heading_key)
);
create index if not exists client_note_blocks_recent_idx on pipeline.client_note_blocks(referral_id, updated_at desc);
insert into pipeline.schema_migrations (migration_id)
values ('0046_client_notes') on conflict (migration_id) do nothing;
commit;

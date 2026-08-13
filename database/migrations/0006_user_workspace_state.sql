begin;

create table if not exists pipeline.user_workspace_state (
  principal_id text not null,
  state_kind text not null check (state_kind in ('recent_destination', 'referral_draft')),
  state_key text not null,
  payload jsonb not null,
  version bigint not null default 1 check (version > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (principal_id, state_kind, state_key),
  check (length(principal_id) between 1 and 256),
  check (length(state_key) between 1 and 256),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists user_workspace_state_principal_recent_idx
  on pipeline.user_workspace_state(principal_id, state_kind, updated_at desc);

create index if not exists user_workspace_state_expiry_idx
  on pipeline.user_workspace_state(expires_at);

insert into pipeline.schema_migrations (migration_id)
values ('0006_user_workspace_state')
on conflict (migration_id) do nothing;

commit;

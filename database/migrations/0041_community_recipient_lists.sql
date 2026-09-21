-- Shared mailing lists retain each committed version for audit and recovery.
begin;
create table if not exists pipeline.community_recipient_list_versions (
  community text not null check (community in ('San Pablo', 'Santa Clarita', 'Turlock', 'Victoria''s House', 'JC Wallace')),
  version integer not null check (version > 0),
  recipients jsonb not null check (
    recipients ? 'to' and recipients ? 'cc'
    and jsonb_typeof(recipients->'to') = 'array' and jsonb_typeof(recipients->'cc') = 'array'
    and jsonb_array_length(recipients->'to') + jsonb_array_length(recipients->'cc') <= 100
  ),
  source_dates jsonb not null check (jsonb_typeof(source_dates) = 'array'),
  actor_id text not null,
  mutation_id uuid,
  updated_at timestamptz not null default now(),
  primary key (community, version),
  unique (community, actor_id, mutation_id)
);
insert into pipeline.schema_migrations (migration_id)
values ('0041_community_recipient_lists') on conflict (migration_id) do nothing;
commit;

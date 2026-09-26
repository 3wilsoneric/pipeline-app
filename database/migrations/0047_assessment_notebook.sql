-- Interview notebook (docs/design/DECISIONS.md, "Interview notebook"): the assessor's preparation and
-- interview notes, part of the assessment record. One row per heading block with its own version, so
-- notes save independently of the assessment's answers and never conflict with them. Additive.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table if not exists pipeline.assessment_notebook_blocks (
  assessment_id text not null references pipeline.assessments(assessment_id) on delete cascade,
  block_key text not null check (block_key ~ '^[a-z0-9_:-]{1,64}$'),
  body text not null default '' check (char_length(body) <= 20000),
  version integer not null default 1 check (version > 0),
  updated_by text not null,
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (assessment_id, block_key)
);
insert into pipeline.schema_migrations (migration_id)
values ('0047_assessment_notebook') on conflict (migration_id) do nothing;
commit;

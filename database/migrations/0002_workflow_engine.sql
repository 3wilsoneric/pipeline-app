begin;

alter table pipeline.work_items
  add column if not exists evidence_document_name text;

alter table pipeline.admission_decisions
  add column if not exists decided_by_name text;

update pipeline.admission_decisions
set decided_by_name = decided_by
where decided_by_name is null;

alter table pipeline.admission_decisions
  alter column decided_by_name set not null;

alter table pipeline.admission_decisions
  add column if not exists updated_at timestamptz not null default now();

insert into pipeline.store_revisions (store_name)
values ('workflow')
on conflict (store_name) do nothing;

insert into pipeline.schema_migrations (migration_id)
values ('0002_workflow_engine')
on conflict (migration_id) do nothing;

revoke all on all tables in schema pipeline from public;
revoke all on all sequences in schema pipeline from public;

commit;

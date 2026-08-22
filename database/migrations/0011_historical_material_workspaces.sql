-- Preserve imported Allo canvases as first-class historical workspaces without
-- adding them to active referral queues or assessor performance measures.

begin;

create table if not exists pipeline.workspace_import_batches (
  workspace_import_batch_id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system in ('allo', 'import')),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'staged'
    check (status in ('staged', 'importing', 'complete', 'failed')),
  workspace_count integer not null default 0 check (workspace_count >= 0),
  material_count integer not null default 0 check (material_count >= 0),
  imported_workspace_count integer not null default 0 check (imported_workspace_count >= 0),
  imported_document_count integer not null default 0 check (imported_document_count >= 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, manifest_sha256)
);

alter table pipeline.referrals
  add column if not exists workspace_origin text not null default 'pipeline',
  add column if not exists workspace_status text not null default 'active',
  add column if not exists source_workspace_id text,
  add column if not exists source_workspace_name text,
  add column if not exists source_project_id text,
  add column if not exists source_project_name text,
  add column if not exists source_material_count integer not null default 0,
  add column if not exists workspace_import_batch_id uuid
    references pipeline.workspace_import_batches(workspace_import_batch_id);

alter table pipeline.referrals
  drop constraint if exists referrals_workspace_origin_check;
alter table pipeline.referrals
  add constraint referrals_workspace_origin_check
  check (workspace_origin in ('pipeline', 'allo', 'import'));

alter table pipeline.referrals
  drop constraint if exists referrals_workspace_status_check;
alter table pipeline.referrals
  add constraint referrals_workspace_status_check
  check (workspace_status in ('active', 'historical', 'archived'));

alter table pipeline.referrals
  drop constraint if exists referrals_source_material_count_check;
alter table pipeline.referrals
  add constraint referrals_source_material_count_check
  check (source_material_count >= 0);

alter table pipeline.referrals
  drop constraint if exists referrals_source_workspace_identity_check;
alter table pipeline.referrals
  add constraint referrals_source_workspace_identity_check
  check (
    (workspace_origin = 'pipeline' and source_workspace_id is null)
    or (workspace_origin in ('allo', 'import') and source_workspace_id is not null)
  );

create unique index if not exists referrals_source_workspace_unique_idx
  on pipeline.referrals(workspace_origin, source_workspace_id)
  where source_workspace_id is not null;

create index if not exists referrals_workspace_status_updated_idx
  on pipeline.referrals(workspace_status, updated_at desc, referral_id desc);

create index if not exists referrals_workspace_origin_project_idx
  on pipeline.referrals(workspace_origin, source_project_id, referral_id)
  where source_project_id is not null;

create index if not exists referrals_workspace_import_batch_idx
  on pipeline.referrals(workspace_import_batch_id, referral_id)
  where workspace_import_batch_id is not null;

revoke all on table pipeline.workspace_import_batches from public;

insert into pipeline.schema_migrations (migration_id)
values ('0011_historical_material_workspaces')
on conflict (migration_id) do nothing;

commit;

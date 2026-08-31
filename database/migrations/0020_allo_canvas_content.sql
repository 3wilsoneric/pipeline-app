-- Preserve native ALLO canvas text as immutable snapshots and review-gated
-- assessment-note candidates. Imported text never mutates an assessment here.

begin;

create table if not exists pipeline.canvas_content_import_batches (
  canvas_content_import_batch_id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system = 'allo'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'staged'
    check (status in ('staged', 'importing', 'complete', 'failed')),
  canvas_count integer not null default 0 check (canvas_count >= 0),
  block_count integer not null default 0 check (block_count >= 0),
  linked_canvas_count integer not null default 0 check (linked_canvas_count >= 0),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, manifest_sha256)
);

create table if not exists pipeline.canvas_content_snapshots (
  canvas_content_snapshot_id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system = 'allo'),
  source_canvas_id text not null,
  source_canvas_name text not null,
  source_project_id text,
  source_project_name text,
  source_locator text not null,
  capture_method text not null
    check (capture_method in ('browser_dom', 'copy_as_markdown', 'native_export')),
  captured_at timestamptz not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  raw_blob_container text,
  raw_blob_key text,
  block_count integer not null check (block_count >= 0),
  record_link_status text not null default 'not_evaluated'
    check (record_link_status in ('exact', 'missing', 'not_evaluated')),
  canonical_client_id text,
  canonical_link_status text not null default 'not_evaluated'
    check (canonical_link_status in ('ambiguous', 'confirmed', 'not_evaluated', 'unmatched')),
  canonical_match_method text
    check (canonical_match_method is null or canonical_match_method = 'exact_name_dob'),
  link_status text not null check (link_status in ('linked', 'unmatched', 'ambiguous')),
  referral_id bigint references pipeline.referrals(referral_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_system, source_canvas_id, source_sha256),
  check ((raw_blob_container is null) = (raw_blob_key is null)),
  check ((canonical_link_status = 'confirmed') = (canonical_client_id is not null)),
  check ((link_status = 'linked') = (referral_id is not null))
);

create table if not exists pipeline.canvas_content_import_batch_snapshots (
  canvas_content_import_batch_id uuid not null
    references pipeline.canvas_content_import_batches(canvas_content_import_batch_id) on delete cascade,
  canvas_content_snapshot_id uuid not null
    references pipeline.canvas_content_snapshots(canvas_content_snapshot_id) on delete cascade,
  snapshot_ordinal integer not null check (snapshot_ordinal > 0),
  primary key (canvas_content_import_batch_id, canvas_content_snapshot_id),
  unique (canvas_content_import_batch_id, snapshot_ordinal)
);

create index if not exists canvas_content_snapshots_canvas_idx
  on pipeline.canvas_content_snapshots(source_canvas_id, captured_at desc, canvas_content_snapshot_id);
create index if not exists canvas_content_snapshots_review_idx
  on pipeline.canvas_content_snapshots(link_status, captured_at, canvas_content_snapshot_id)
  where link_status <> 'linked';
create index if not exists canvas_content_snapshots_referral_idx
  on pipeline.canvas_content_snapshots(referral_id, captured_at desc, canvas_content_snapshot_id)
  where referral_id is not null;
create index if not exists canvas_content_snapshots_canonical_client_idx
  on pipeline.canvas_content_snapshots(canonical_client_id, captured_at desc, canvas_content_snapshot_id)
  where canonical_client_id is not null;

create table if not exists pipeline.canvas_content_blocks (
  canvas_content_block_id uuid primary key default gen_random_uuid(),
  canvas_content_snapshot_id uuid not null
    references pipeline.canvas_content_snapshots(canvas_content_snapshot_id) on delete cascade,
  source_block_id text not null,
  page_number integer check (page_number is null or page_number > 0),
  page_title text,
  ordinal integer not null check (ordinal > 0),
  block_type text not null
    check (block_type in ('checkbox', 'heading', 'input', 'list_item', 'paragraph', 'table_cell', 'text')),
  semantic_role text,
  heading_path text[] not null default '{}',
  text_content text not null,
  structured_value jsonb,
  source_locator text,
  bounding_box jsonb,
  created_at timestamptz not null default now(),
  unique (canvas_content_snapshot_id, source_block_id),
  unique (canvas_content_snapshot_id, ordinal),
  check (bounding_box is null or jsonb_typeof(bounding_box) = 'object')
);

create index if not exists canvas_content_blocks_page_order_idx
  on pipeline.canvas_content_blocks(canvas_content_snapshot_id, page_number, ordinal);

create table if not exists pipeline.canvas_content_field_candidates (
  canvas_content_candidate_id uuid primary key default gen_random_uuid(),
  canvas_content_snapshot_id uuid not null
    references pipeline.canvas_content_snapshots(canvas_content_snapshot_id) on delete cascade,
  referral_id bigint references pipeline.referrals(referral_id) on delete set null,
  canonical_client_id text,
  assessment_id text references pipeline.assessments(assessment_id) on delete set null,
  target_field_key text not null check (target_field_key = 'assessment_notes'),
  proposed_value jsonb not null,
  final_value jsonb,
  mapping_confidence numeric(5,4) not null check (mapping_confidence between 0 and 1),
  source_block_ids text[] not null check (cardinality(source_block_ids) > 0),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'accepted', 'edited', 'rejected', 'applied')),
  reviewed_by text,
  reviewed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canvas_content_snapshot_id, target_field_key),
  check (review_status = 'pending' or reviewed_at is not null),
  check (review_status <> 'applied' or assessment_id is not null),
  check (referral_id is not null or review_status in ('pending', 'rejected'))
);

create index if not exists canvas_content_candidates_review_idx
  on pipeline.canvas_content_field_candidates(review_status, created_at, canvas_content_candidate_id)
  where review_status in ('pending', 'accepted', 'edited');
create index if not exists canvas_content_candidates_referral_idx
  on pipeline.canvas_content_field_candidates(referral_id, created_at, canvas_content_candidate_id)
  where referral_id is not null;

create table if not exists pipeline.canvas_content_review_events (
  canvas_content_review_event_id uuid primary key default gen_random_uuid(),
  canvas_content_candidate_id uuid not null
    references pipeline.canvas_content_field_candidates(canvas_content_candidate_id) on delete cascade,
  action text not null check (action in ('accept', 'edit', 'reject', 'apply')),
  reviewer_id text not null,
  previous_status text not null,
  next_status text not null,
  previous_value jsonb,
  next_value jsonb,
  reason_code text,
  created_at timestamptz not null default now()
);

create index if not exists canvas_content_review_events_candidate_idx
  on pipeline.canvas_content_review_events(canvas_content_candidate_id, created_at, canvas_content_review_event_id);

insert into pipeline.store_revisions (store_name)
values ('allo_canvas_content')
on conflict (store_name) do nothing;

revoke all on table pipeline.canvas_content_import_batches from public;
revoke all on table pipeline.canvas_content_import_batch_snapshots from public;
revoke all on table pipeline.canvas_content_snapshots from public;
revoke all on table pipeline.canvas_content_blocks from public;
revoke all on table pipeline.canvas_content_field_candidates from public;
revoke all on table pipeline.canvas_content_review_events from public;

insert into pipeline.schema_migrations (migration_id)
values ('0020_allo_canvas_content')
on conflict (migration_id) do nothing;

commit;

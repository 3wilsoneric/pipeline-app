-- Store supervisor-defined field standards and historical-answer judgments.
-- The table intentionally stores no note text or source-canvas identifiers.

begin;

create table if not exists pipeline.note_lab_field_reviews (
  note_lab_field_review_id uuid primary key default gen_random_uuid(),
  reviewer_principal_id text not null
    check (length(reviewer_principal_id) between 1 and 320),
  calibration_version text not null
    check (length(calibration_version) between 1 and 128),
  scenario_id text not null
    check (length(scenario_id) between 1 and 128),
  target_field text not null
    check (length(target_field) between 1 and 128),
  selected_criterion_ids jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(selected_criterion_ids) = 'array'
      and jsonb_array_length(selected_criterion_ids) between 1 and 9
      and selected_criterion_ids <@ '[
        "direct_answer",
        "source_provenance",
        "timeframe_recency",
        "observable_specificity",
        "functional_safety_impact",
        "response_support_action",
        "uncertainty_conflict",
        "person_centered_language",
        "concise_nonduplicative"
      ]'::jsonb
    ),
  sample_id text null
    check (sample_id is null or length(sample_id) between 1 and 128),
  sample_disposition text null
    check (sample_disposition is null or sample_disposition in ('teach', 'revise', 'do_not_teach')),
  revision_reason_ids jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(revision_reason_ids) = 'array'
      and jsonb_array_length(revision_reason_ids) <= 10
      and revision_reason_ids <@ '[
        "does_not_answer_field",
        "missing_or_unclear_source",
        "missing_or_unclear_timeframe",
        "vague_label_or_judgment",
        "unsupported_inference",
        "missing_impact",
        "missing_response_or_action",
        "uncertainty_or_conflict_lost",
        "stigmatizing_or_identity_first",
        "duplicated_stale_or_irrelevant"
      ]'::jsonb
    ),
  submitted_at timestamptz not null default now(),
  unique (reviewer_principal_id, calibration_version, scenario_id),
  check (
    (sample_id is null and sample_disposition is null and jsonb_array_length(revision_reason_ids) = 0)
    or (sample_id is not null and sample_disposition = 'teach' and jsonb_array_length(revision_reason_ids) = 0)
    or (sample_id is not null and sample_disposition in ('revise', 'do_not_teach') and jsonb_array_length(revision_reason_ids) > 0)
  )
);

create index if not exists note_lab_field_reviews_reviewer_idx
  on pipeline.note_lab_field_reviews(
    reviewer_principal_id,
    calibration_version,
    submitted_at,
    note_lab_field_review_id
  );
create index if not exists note_lab_field_reviews_scenario_idx
  on pipeline.note_lab_field_reviews(calibration_version, scenario_id, submitted_at);

revoke all on table pipeline.note_lab_field_reviews from public;

insert into pipeline.schema_migrations (migration_id)
values ('0023_note_lab_field_reviews')
on conflict (migration_id) do nothing;

commit;

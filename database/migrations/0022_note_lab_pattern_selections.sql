-- Store field-level, multi-select answer-pattern calibration results separately
-- from the retired pairwise comparison experiment.

begin;

create table if not exists pipeline.note_lab_pattern_selections (
  note_lab_pattern_selection_id uuid primary key default gen_random_uuid(),
  reviewer_principal_id text not null
    check (length(reviewer_principal_id) between 1 and 320),
  calibration_version text not null
    check (length(calibration_version) between 1 and 128),
  scenario_id text not null
    check (length(scenario_id) between 1 and 128),
  target_field text not null
    check (length(target_field) between 1 and 128),
  selected_pattern_ids jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(selected_pattern_ids) = 'array'
      and jsonb_array_length(selected_pattern_ids) <= 5
      and selected_pattern_ids <@ '["brief_finding", "source_and_finding", "current_and_history", "impact_and_support", "structured_summary"]'::jsonb
    ),
  no_pattern_fits boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (reviewer_principal_id, calibration_version, scenario_id),
  check (
    (no_pattern_fits and jsonb_array_length(selected_pattern_ids) = 0)
    or (not no_pattern_fits and jsonb_array_length(selected_pattern_ids) > 0)
  )
);

create index if not exists note_lab_pattern_selections_reviewer_idx
  on pipeline.note_lab_pattern_selections(
    reviewer_principal_id,
    calibration_version,
    submitted_at,
    note_lab_pattern_selection_id
  );
create index if not exists note_lab_pattern_selections_scenario_idx
  on pipeline.note_lab_pattern_selections(calibration_version, scenario_id, submitted_at);

revoke all on table pipeline.note_lab_pattern_selections from public;

insert into pipeline.schema_migrations (migration_id)
values ('0022_note_lab_pattern_selections')
on conflict (migration_id) do nothing;

commit;

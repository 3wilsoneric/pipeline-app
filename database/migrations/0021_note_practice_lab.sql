-- Store supervisor note-quality comparisons as immutable, reviewer-scoped
-- observations. These votes never mutate clinical notes or referral records.

begin;

create table if not exists pipeline.note_lab_votes (
  note_lab_vote_id uuid primary key default gen_random_uuid(),
  reviewer_principal_id text not null
    check (length(reviewer_principal_id) between 1 and 320),
  sample_set_version text not null
    check (length(sample_set_version) between 1 and 128),
  pair_id text not null check (length(pair_id) between 1 and 128),
  left_sample_id text not null check (length(left_sample_id) between 1 and 128),
  right_sample_id text not null check (length(right_sample_id) between 1 and 128),
  preferred_sample_id text check (
    preferred_sample_id is null
    or preferred_sample_id in (left_sample_id, right_sample_id)
  ),
  choice text not null
    check (choice in ('left', 'right', 'tie', 'both_need_work', 'cannot_compare')),
  reason_codes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(reason_codes) = 'array' and jsonb_array_length(reason_codes) <= 9),
  submitted_at timestamptz not null default now(),
  unique (reviewer_principal_id, sample_set_version, pair_id),
  check (
    (choice = 'left' and preferred_sample_id = left_sample_id)
    or (choice = 'right' and preferred_sample_id = right_sample_id)
    or (choice not in ('left', 'right') and preferred_sample_id is null)
  ),
  check (choice = 'cannot_compare' or jsonb_array_length(reason_codes) > 0)
);

create index if not exists note_lab_votes_reviewer_idx
  on pipeline.note_lab_votes(reviewer_principal_id, sample_set_version, submitted_at, note_lab_vote_id);
create index if not exists note_lab_votes_sample_set_idx
  on pipeline.note_lab_votes(sample_set_version, pair_id, submitted_at);

revoke all on table pipeline.note_lab_votes from public;

insert into pipeline.schema_migrations (migration_id)
values ('0021_note_practice_lab')
on conflict (migration_id) do nothing;

commit;

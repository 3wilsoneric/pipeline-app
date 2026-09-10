begin;

-- Signed assessments remain immutable. Corrections are represented by a new
-- assessment row with explicit lineage back to the frozen submission.
alter table pipeline.assessments
  add column if not exists revision_root_id text,
  add column if not exists revision_number integer not null default 1,
  add column if not exists supersedes_assessment_id text references pipeline.assessments(assessment_id);

update pipeline.assessments
set revision_root_id = assessment_id
where revision_root_id is null;

alter table pipeline.assessments
  alter column revision_root_id set not null;

alter table pipeline.assessments
  drop constraint if exists assessments_revision_number_check;
alter table pipeline.assessments
  add constraint assessments_revision_number_check check (revision_number > 0);

create unique index if not exists assessments_revision_sequence_unique_idx
  on pipeline.assessments(revision_root_id, revision_number);
create index if not exists assessments_referral_revision_idx
  on pipeline.assessments(referral_id, revision_root_id, revision_number desc, updated_at desc);

create table if not exists pipeline.assessment_reviews (
  review_id uuid primary key default gen_random_uuid(),
  referral_id bigint not null references pipeline.referrals(referral_id) on delete cascade,
  assessment_id text not null references pipeline.assessments(assessment_id),
  assessment_version integer not null check (assessment_version > 0),
  recommendation_id uuid not null references pipeline.assessment_recommendations(recommendation_id),
  recommendation_version integer not null check (recommendation_version > 0),
  submission_number integer not null check (submission_number > 0),
  status text not null check (status in (
    'submitted', 'changes_requested', 'approved_for_placement', 'not_accepted'
  )),
  submitted_by text not null,
  submitted_by_name text not null,
  submitted_at timestamptz not null default now(),
  due_at timestamptz not null,
  assigned_reviewer_id text,
  assigned_reviewer_name text not null default 'Head supervisor',
  notification_status text not null default 'pending'
    check (notification_status in ('pending', 'acknowledged')),
  reviewed_by text,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 20000),
  successor_assessment_id text references pipeline.assessments(assessment_id),
  previous_review_id uuid references pipeline.assessment_reviews(review_id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id),
  unique (referral_id, submission_number)
);

create index if not exists assessment_reviews_open_queue_idx
  on pipeline.assessment_reviews(status, due_at, referral_id, submission_number)
  where status = 'submitted';
create index if not exists assessment_reviews_referral_history_idx
  on pipeline.assessment_reviews(referral_id, submission_number desc, review_id);

-- Preserve prior recommendation/decision evidence as review history. No
-- reviewer identity or correction request is inferred when it did not exist.
with ranked as (
  select ar.*,
    row_number() over (
      partition by ar.referral_id
      order by ar.recommended_at, ar.recommendation_id
    )::integer as submission_number
  from pipeline.assessment_recommendations ar
)
insert into pipeline.assessment_reviews (
  referral_id, assessment_id, assessment_version, recommendation_id,
  recommendation_version, submission_number, status, submitted_by,
  submitted_by_name, submitted_at, due_at, assigned_reviewer_name,
  notification_status, reviewed_by, reviewed_by_name, reviewed_at,
  review_note, version, created_at, updated_at
)
select
  ranked.referral_id,
  ranked.assessment_id,
  assessment.version,
  ranked.recommendation_id,
  ranked.version,
  ranked.submission_number,
  case decision.outcome
    when 'accepted' then 'approved_for_placement'
    when 'declined' then 'not_accepted'
    else 'submitted'
  end,
  ranked.recommended_by,
  ranked.recommended_by_name,
  ranked.recommended_at,
  ranked.recommended_at + interval '2 days',
  'Head supervisor',
  case when decision.decision_id is null then 'pending' else 'acknowledged' end,
  decision.decided_by,
  decision.decided_by_name,
  decision.decided_at,
  decision.reason_note,
  1,
  ranked.recommended_at,
  coalesce(decision.updated_at, ranked.updated_at)
from ranked
join pipeline.assessments assessment on assessment.assessment_id = ranked.assessment_id
left join pipeline.admission_decisions decision
  on decision.referral_id = ranked.referral_id
 and decision.recommendation_id = ranked.recommendation_id
on conflict (assessment_id) do nothing;

alter table pipeline.admission_decisions
  add column if not exists review_id uuid references pipeline.assessment_reviews(review_id),
  add column if not exists review_version integer,
  add column if not exists assessment_id text references pipeline.assessments(assessment_id),
  add column if not exists assessment_version integer;

update pipeline.admission_decisions decision
set review_id = review.review_id,
    review_version = review.version,
    assessment_id = review.assessment_id,
    assessment_version = review.assessment_version
from pipeline.assessment_reviews review
where review.referral_id = decision.referral_id
  and review.recommendation_id = decision.recommendation_id
  and decision.review_id is null;

alter table pipeline.referrals
  drop constraint if exists referrals_workflow_status_check;
alter table pipeline.referrals
  add constraint referrals_workflow_status_check check (workflow_status in (
    'intake_unassigned', 'intake_documents_needed', 'profile_incomplete',
    'ready_to_schedule', 'assessment_scheduled', 'assessment_in_progress',
    'waiting_for_information', 'assessment_ready_to_sign', 'assessment_signed',
    'recommendation_submitted', 'changes_requested', 'decision_pending',
    'approved_for_placement', 'accepted', 'admitted', 'declined', 'closed'
  ));

-- The legacy terminal stage means a move-in was recorded. Existing accepted
-- decisions that have not reached that stage are placement approvals only.
update pipeline.referrals referral
set workflow_status = case
  when referral.stage = 'Accepted / Admitted' then 'admitted'
  when decision.outcome = 'accepted' then 'approved_for_placement'
  else referral.workflow_status
end
from pipeline.admission_decisions decision
where decision.referral_id = referral.referral_id
  and (referral.stage = 'Accepted / Admitted' or decision.outcome = 'accepted');

revoke all on table pipeline.assessment_reviews from public;

insert into pipeline.schema_migrations (migration_id)
values ('0031_assessment_review_revisions')
on conflict (migration_id) do nothing;

commit;

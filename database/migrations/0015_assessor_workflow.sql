begin;

-- The referral assignment is the live source of truth for access, queues,
-- scheduling, and open assessment work. Existing owner_id/owner_name columns
-- are retained so this migration is additive and backward compatible.
alter table pipeline.referrals
  add column if not exists workflow_status text not null default 'intake_unassigned',
  add column if not exists assigned_at timestamptz,
  add column if not exists assignment_due_at timestamptz,
  add column if not exists assignment_version integer not null default 1;

alter table pipeline.referrals
  drop constraint if exists referrals_workflow_status_check;
alter table pipeline.referrals
  add constraint referrals_workflow_status_check check (workflow_status in (
    'intake_unassigned', 'intake_documents_needed', 'profile_incomplete',
    'ready_to_schedule', 'assessment_scheduled', 'assessment_in_progress',
    'waiting_for_information', 'assessment_ready_to_sign', 'assessment_signed',
    'recommendation_submitted', 'decision_pending', 'accepted', 'declined', 'closed'
  ));

alter table pipeline.referrals
  drop constraint if exists referrals_assignment_version_check;
alter table pipeline.referrals
  add constraint referrals_assignment_version_check check (assignment_version > 0);

-- Use only explicit legacy evidence. Do not manufacture historical assignees,
-- decisions, signatures, or precise transition timestamps.
update pipeline.referrals r
set workflow_status = case
  when r.stage = 'Accepted / Admitted' then 'accepted'
  when r.stage = 'Declined' then 'declined'
  when r.owner_id is null and lower(btrim(coalesce(r.owner_name, ''))) in ('', 'pending', 'unassigned', 'unknown') then 'intake_unassigned'
  when exists (
    select 1 from pipeline.assessments a
    where a.referral_id = r.referral_id and a.status = 'complete'
  ) then 'assessment_ready_to_sign'
  when exists (
    select 1 from pipeline.assessments a
    where a.referral_id = r.referral_id
  ) then 'assessment_in_progress'
  when coalesce(r.data->>'documentStatus', 'Missing') = 'Missing'
    and coalesce(r.data->>'packetId', '') = '' then 'intake_documents_needed'
  when r.stage in ('Packet Review', 'Assessment', 'Community Review') then 'profile_incomplete'
  else 'intake_documents_needed'
end;

create index if not exists referrals_workflow_assignment_idx
  on pipeline.referrals(workflow_status, owner_id, assignment_due_at, updated_at desc, referral_id desc)
  where deleted_at is null and closed_at is null;

alter table pipeline.assessments
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_duration_minutes integer,
  add column if not exists scheduled_method text,
  add column if not exists scheduled_location text,
  add column if not exists schedule_status text not null default 'unscheduled',
  add column if not exists started_at timestamptz,
  add column if not exists signed_at timestamptz,
  add column if not exists signed_by text,
  add column if not exists signed_by_name text,
  add column if not exists signature_version integer not null default 1;

alter table pipeline.assessments
  drop constraint if exists assessments_schedule_status_check;
alter table pipeline.assessments
  add constraint assessments_schedule_status_check
  check (schedule_status in ('unscheduled', 'scheduled', 'rescheduled', 'cancelled', 'no_show', 'completed'));

alter table pipeline.assessments
  drop constraint if exists assessments_scheduled_duration_check;
alter table pipeline.assessments
  add constraint assessments_scheduled_duration_check
  check (scheduled_duration_minutes is null or scheduled_duration_minutes between 15 and 480);

alter table pipeline.assessments
  drop constraint if exists assessments_scheduled_method_check;
alter table pipeline.assessments
  add constraint assessments_scheduled_method_check
  check (scheduled_method is null or scheduled_method in ('in_person', 'phone', 'video', 'record_review'));

alter table pipeline.assessments
  drop constraint if exists assessments_signature_version_check;
alter table pipeline.assessments
  add constraint assessments_signature_version_check check (signature_version > 0);

create index if not exists assessments_schedule_owner_idx
  on pipeline.assessments(schedule_status, scheduled_start_at, assessor_id, assessment_id)
  where schedule_status in ('scheduled', 'rescheduled');

create table if not exists pipeline.assessment_addenda (
  addendum_id uuid primary key default gen_random_uuid(),
  assessment_id text not null references pipeline.assessments(assessment_id) on delete cascade,
  version integer not null default 1 check (version > 0),
  note text not null check (char_length(btrim(note)) between 1 and 20000),
  reason_code text not null check (char_length(btrim(reason_code)) between 1 and 128),
  authored_by text not null,
  authored_by_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists assessment_addenda_assessment_idx
  on pipeline.assessment_addenda(assessment_id, created_at, addendum_id);

create table if not exists pipeline.assessment_recommendations (
  recommendation_id uuid primary key default gen_random_uuid(),
  referral_id bigint not null references pipeline.referrals(referral_id) on delete cascade,
  assessment_id text not null references pipeline.assessments(assessment_id) on delete cascade,
  outcome text not null check (outcome in ('accept', 'decline', 'needs_more_information')),
  reason_code text,
  reason_note text not null default '' check (char_length(reason_note) <= 20000),
  recommended_by text not null,
  recommended_by_name text not null,
  recommended_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (assessment_id)
);

create index if not exists assessment_recommendations_referral_idx
  on pipeline.assessment_recommendations(referral_id, recommended_at desc, recommendation_id);
create index if not exists assessment_recommendations_assessor_month_idx
  on pipeline.assessment_recommendations(recommended_by, recommended_at desc, recommendation_id);

alter table pipeline.admission_decisions
  add column if not exists recommendation_id uuid references pipeline.assessment_recommendations(recommendation_id),
  add column if not exists decided_by_role text;

alter table pipeline.work_items
  add column if not exists field_key text,
  add column if not exists requested_from text,
  add column if not exists requested_at timestamptz,
  add column if not exists follow_up_at timestamptz,
  add column if not exists unavailable_reason text;

alter table pipeline.work_items
  drop constraint if exists work_items_status_check;
alter table pipeline.work_items
  add constraint work_items_status_check check (status in (
    'needed', 'requested', 'received', 'reviewed', 'waived', 'expired',
    'unavailable', 'not_applicable'
  ));

alter table pipeline.work_items
  drop constraint if exists work_items_gate_check;
alter table pipeline.work_items
  add constraint work_items_gate_check check (gate in (
    'profile_completion', 'pre_assessment', 'admission_decision', 'move_in', 'ehr_export'
  ));

-- Materialize only requirements that can be proven from existing fields. A
-- populated value is marked received; a missing value remains needed. No
-- assignee, fact, request, or historical completion is inferred.
insert into pipeline.work_items (
  work_item_id, referral_id, person_id, type, label, gate, status,
  owner_id, owner_name, due_at, next_action, blocker, field_key,
  version, created_at, updated_at
)
select
  gen_random_uuid(), r.referral_id, r.person_id, 'profile_field', definition.label,
  'profile_completion',
  case
    when definition.field_key = 'date_of_birth'
      and coalesce(p.date_of_birth::text, r.data->>'dob', '') <> '' then 'received'
    when definition.field_key = 'community'
      and lower(btrim(coalesce(r.community, ''))) not in ('', 'unassigned', 'unknown', 'pending') then 'received'
    when definition.field_key = 'referral_source'
      and lower(btrim(coalesce(r.source, ''))) not in ('', 'referral packet', 'unknown', 'pending', 'not reported') then 'received'
    else 'needed'
  end,
  r.owner_id, r.owner_name,
  coalesce(r.assignment_due_at, r.created_at + interval '7 days'),
  definition.next_action, true, definition.field_key, 1, now(), now()
from pipeline.referrals r
join pipeline.people p on p.person_id = r.person_id
cross join (values
  ('date_of_birth', 'Date of birth', 'Confirm the client''s date of birth from a source document or referral contact.'),
  ('community', 'Community', 'Select the community responsible for this referral.'),
  ('referral_source', 'Referral source', 'Record the referring facility, county, or other referral source.')
) as definition(field_key, label, next_action)
where r.deleted_at is null
  and not exists (
    select 1
    from pipeline.work_items existing
    where existing.referral_id = r.referral_id
      and existing.type = 'profile_field'
      and existing.field_key = definition.field_key
  );

create index if not exists work_items_follow_up_idx
  on pipeline.work_items(follow_up_at, owner_id, referral_id, work_item_id)
  where status in ('needed', 'requested', 'expired');

create index if not exists audit_events_workflow_analytics_idx
  on pipeline.audit_events(action, created_at desc, actor_id, entity_type);

revoke all on table pipeline.assessment_addenda from public;
revoke all on table pipeline.assessment_recommendations from public;

insert into pipeline.store_revisions (store_name)
values ('workflow')
on conflict (store_name) do nothing;

insert into pipeline.schema_migrations (migration_id)
values ('0015_assessor_workflow')
on conflict (migration_id) do nothing;

commit;

begin;

alter table pipeline.assessments
  add column if not exists section_versions jsonb not null default '{
    "identity": 1,
    "prior_placement": 1,
    "prior_history": 1,
    "diagnosis_clinical": 1,
    "functional_adl": 1,
    "behavioral_risk": 1,
    "legal_conservatorship": 1,
    "medication": 1,
    "substance_use": 1,
    "social_support": 1,
    "provenance_qc": 1
  }'::jsonb;

alter table pipeline.assessments
  drop constraint if exists assessments_section_versions_object_check;
alter table pipeline.assessments
  add constraint assessments_section_versions_object_check
  check (jsonb_typeof(section_versions) = 'object');

alter table pipeline.user_workspace_state
  drop constraint if exists user_workspace_state_state_kind_check;
alter table pipeline.user_workspace_state
  add constraint user_workspace_state_state_kind_check
  check (state_kind in ('recent_destination', 'referral_draft', 'assessment_draft'));

alter table pipeline.editing_presence
  drop constraint if exists editing_presence_section_check;
alter table pipeline.editing_presence
  add constraint editing_presence_section_check
  check (section in (
    'identity', 'intake', 'documents', 'assessment', 'workflow', 'decision',
    'assessment:identity', 'assessment:prior_placement', 'assessment:prior_history',
    'assessment:diagnosis_clinical', 'assessment:functional_adl',
    'assessment:behavioral_risk', 'assessment:legal_conservatorship',
    'assessment:medication', 'assessment:substance_use',
    'assessment:social_support', 'assessment:provenance_qc'
  ));

create table if not exists pipeline.workspace_members (
  principal_id text primary key,
  display_name text not null,
  email text not null,
  roles text[] not null default '{}',
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(principal_id) between 1 and 256),
  check (length(display_name) between 1 and 200),
  check (length(email) between 3 and 320)
);

create index if not exists workspace_members_active_name_idx
  on pipeline.workspace_members(active, lower(display_name), principal_id);

revoke all on table pipeline.workspace_members from public;

insert into pipeline.schema_migrations (migration_id)
values ('0009_assessment_collaboration')
on conflict (migration_id) do nothing;

commit;

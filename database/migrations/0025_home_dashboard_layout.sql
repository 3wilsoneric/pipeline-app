-- Keep each user's Home module selection, order, and lock state in the existing
-- private per-principal workspace-state store.

begin;

alter table pipeline.user_workspace_state
  drop constraint if exists user_workspace_state_state_kind_check;
alter table pipeline.user_workspace_state
  add constraint user_workspace_state_state_kind_check
  check (state_kind in (
    'recent_destination',
    'referral_draft',
    'assessment_draft',
    'academy_progress',
    'operator_training_progress',
    'home_dashboard_layout'
  ));

insert into pipeline.schema_migrations (migration_id)
values ('0025_home_dashboard_layout')
on conflict (migration_id) do nothing;

commit;

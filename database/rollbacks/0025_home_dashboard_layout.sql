delete from pipeline.user_workspace_state
where state_kind = 'home_dashboard_layout';

alter table pipeline.user_workspace_state
  drop constraint if exists user_workspace_state_state_kind_check;
alter table pipeline.user_workspace_state
  add constraint user_workspace_state_state_kind_check
  check (state_kind in (
    'recent_destination',
    'referral_draft',
    'assessment_draft',
    'academy_progress',
    'operator_training_progress'
  ));

delete from pipeline.schema_migrations
where migration_id = '0025_home_dashboard_layout';

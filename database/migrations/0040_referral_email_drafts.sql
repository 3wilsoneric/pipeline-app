-- Private, versioned recipient drafts reuse the existing per-principal store.
begin;
alter table pipeline.user_workspace_state
  drop constraint if exists user_workspace_state_state_kind_check;
alter table pipeline.user_workspace_state
  add constraint user_workspace_state_state_kind_check
  check (state_kind in (
    'recent_destination', 'referral_draft', 'assessment_draft',
    'academy_progress', 'operator_training_progress', 'home_dashboard_layout',
    'workflow_continuity', 'referral_email_draft'
  ));
insert into pipeline.schema_migrations (migration_id)
values ('0040_referral_email_drafts') on conflict (migration_id) do nothing;
commit;

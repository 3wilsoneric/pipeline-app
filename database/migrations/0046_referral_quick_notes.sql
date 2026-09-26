-- Private quick notes: each person's own short reminder per referral ("where we are"),
-- kept in the existing per-principal workspace-state store. Additive: one new state kind.
begin;
alter table pipeline.user_workspace_state
  drop constraint if exists user_workspace_state_state_kind_check;
alter table pipeline.user_workspace_state
  add constraint user_workspace_state_state_kind_check
  check (state_kind in (
    'recent_destination', 'referral_draft', 'assessment_draft',
    'academy_progress', 'operator_training_progress', 'home_dashboard_layout',
    'workflow_continuity', 'referral_email_draft', 'referral_quick_note'
  ));
insert into pipeline.schema_migrations (migration_id)
values ('0046_referral_quick_notes') on conflict (migration_id) do nothing;
commit;

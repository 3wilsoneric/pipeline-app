-- Stop writes first. Never delete quick notes to make a rollback succeed.
begin;
lock table pipeline.user_workspace_state in access exclusive mode;
do $$ begin
  if exists (select 1 from pipeline.user_workspace_state where state_kind = 'referral_quick_note') then
    raise exception 'Quick notes exist. Keep the additive migration, or archive/recover them through an approved procedure before rollback.';
  end if;
end $$;
alter table pipeline.user_workspace_state drop constraint user_workspace_state_state_kind_check;
alter table pipeline.user_workspace_state add constraint user_workspace_state_state_kind_check
  check (state_kind in ('recent_destination', 'referral_draft', 'assessment_draft',
    'academy_progress', 'operator_training_progress', 'home_dashboard_layout', 'workflow_continuity', 'referral_email_draft'));
delete from pipeline.schema_migrations where migration_id = '0046_referral_quick_notes';
commit;

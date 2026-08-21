drop table if exists pipeline.workspace_members;

alter table pipeline.editing_presence
  drop constraint if exists editing_presence_section_check;
alter table pipeline.editing_presence
  add constraint editing_presence_section_check
  check (section in ('identity', 'intake', 'documents', 'assessment', 'workflow', 'decision'));

delete from pipeline.user_workspace_state where state_kind = 'assessment_draft';
alter table pipeline.user_workspace_state
  drop constraint if exists user_workspace_state_state_kind_check;
alter table pipeline.user_workspace_state
  add constraint user_workspace_state_state_kind_check
  check (state_kind in ('recent_destination', 'referral_draft'));

alter table pipeline.assessments
  drop constraint if exists assessments_section_versions_object_check;
alter table pipeline.assessments
  drop column if exists section_versions;

delete from pipeline.schema_migrations
where migration_id = '0009_assessment_collaboration';

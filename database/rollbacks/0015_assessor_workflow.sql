drop index if exists pipeline.audit_events_workflow_analytics_idx;
drop index if exists pipeline.work_items_follow_up_idx;

-- Preserve rollback viability after the new statuses have been used. These
-- mappings retain the closest legacy operational meaning without deleting work.
update pipeline.work_items
set status = case
  when status = 'unavailable' then 'expired'
  when status = 'not_applicable' then 'waived'
  else status
end,
gate = case when gate = 'profile_completion' then 'pre_assessment' else gate end
where status in ('unavailable', 'not_applicable') or gate = 'profile_completion';

delete from pipeline.work_items where type = 'profile_field';

alter table pipeline.work_items
  drop column if exists unavailable_reason,
  drop column if exists follow_up_at,
  drop column if exists requested_at,
  drop column if exists requested_from,
  drop column if exists field_key;

alter table pipeline.work_items drop constraint if exists work_items_status_check;
alter table pipeline.work_items add constraint work_items_status_check
  check (status in ('needed', 'requested', 'received', 'reviewed', 'waived', 'expired'));
alter table pipeline.work_items drop constraint if exists work_items_gate_check;
alter table pipeline.work_items add constraint work_items_gate_check
  check (gate in ('pre_assessment', 'admission_decision', 'move_in', 'ehr_export'));

alter table pipeline.admission_decisions
  drop column if exists decided_by_role,
  drop column if exists recommendation_id;

drop table if exists pipeline.assessment_recommendations;
drop table if exists pipeline.assessment_addenda;

drop index if exists pipeline.assessments_schedule_owner_idx;
alter table pipeline.assessments
  drop column if exists signature_version,
  drop column if exists signed_by_name,
  drop column if exists signed_by,
  drop column if exists signed_at,
  drop column if exists started_at,
  drop column if exists schedule_status,
  drop column if exists scheduled_location,
  drop column if exists scheduled_method,
  drop column if exists scheduled_duration_minutes,
  drop column if exists scheduled_start_at;

drop index if exists pipeline.referrals_workflow_assignment_idx;
alter table pipeline.referrals
  drop column if exists assignment_version,
  drop column if exists assignment_due_at,
  drop column if exists assigned_at,
  drop column if exists workflow_status;

delete from pipeline.schema_migrations where migration_id = '0015_assessor_workflow';

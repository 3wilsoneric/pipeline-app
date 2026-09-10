-- Map new states to the closest prior operational meaning before restoring the
-- prior constraint. Forward recovery remains preferred once review data exists.
update pipeline.referrals
set workflow_status = case
  when workflow_status = 'changes_requested' then 'assessment_signed'
  when workflow_status = 'approved_for_placement' then 'accepted'
  when workflow_status = 'admitted' then 'accepted'
  else workflow_status
end
where workflow_status in ('changes_requested', 'approved_for_placement', 'admitted');

alter table pipeline.referrals
  drop constraint if exists referrals_workflow_status_check;
alter table pipeline.referrals
  add constraint referrals_workflow_status_check check (workflow_status in (
    'intake_unassigned', 'intake_documents_needed', 'profile_incomplete',
    'ready_to_schedule', 'assessment_scheduled', 'assessment_in_progress',
    'waiting_for_information', 'assessment_ready_to_sign', 'assessment_signed',
    'recommendation_submitted', 'decision_pending', 'accepted', 'declined', 'closed'
  ));

alter table pipeline.admission_decisions
  drop column if exists assessment_version,
  drop column if exists assessment_id,
  drop column if exists review_version,
  drop column if exists review_id;

drop index if exists pipeline.assessment_reviews_referral_history_idx;
drop index if exists pipeline.assessment_reviews_open_queue_idx;
drop table if exists pipeline.assessment_reviews;

drop index if exists pipeline.assessments_referral_revision_idx;
drop index if exists pipeline.assessments_revision_sequence_unique_idx;
alter table pipeline.assessments
  drop constraint if exists assessments_revision_number_check,
  drop column if exists supersedes_assessment_id,
  drop column if exists revision_number,
  drop column if exists revision_root_id;

delete from pipeline.schema_migrations
where migration_id = '0031_assessment_review_revisions';

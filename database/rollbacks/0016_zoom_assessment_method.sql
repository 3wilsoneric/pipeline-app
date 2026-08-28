alter table pipeline.assessments
  drop constraint if exists assessments_scheduled_method_check;

update pipeline.assessments
set scheduled_method = 'video'
where scheduled_method = 'zoom';

alter table pipeline.assessments
  add constraint assessments_scheduled_method_check
  check (scheduled_method is null or scheduled_method in ('in_person', 'phone', 'video', 'record_review'));

delete from pipeline.schema_migrations
where migration_id = '0016_zoom_assessment_method';

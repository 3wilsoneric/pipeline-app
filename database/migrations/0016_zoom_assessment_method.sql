begin;

alter table pipeline.assessments
  drop constraint if exists assessments_scheduled_method_check;

alter table pipeline.assessments
  add constraint assessments_scheduled_method_check
  check (scheduled_method is null or scheduled_method in ('in_person', 'phone', 'zoom', 'video', 'record_review'));

insert into pipeline.schema_migrations (migration_id)
values ('0016_zoom_assessment_method')
on conflict (migration_id) do nothing;

commit;

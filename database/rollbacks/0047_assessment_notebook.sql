-- Prefer an application rollback that leaves the additive table in place. Never delete interview notes
-- to make a rollback succeed: they are part of the assessment record.
begin;
lock table pipeline.assessment_notebook_blocks in access exclusive mode;
do $$ begin
  if exists (select 1 from pipeline.assessment_notebook_blocks) then
    raise exception 'Interview notes exist. Retain this migration during application rollback.';
  end if;
end $$;
drop table pipeline.assessment_notebook_blocks;
delete from pipeline.schema_migrations where migration_id = '0047_assessment_notebook';
commit;

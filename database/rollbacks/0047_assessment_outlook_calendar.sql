-- Preserve the ledger across application rollback: a later rollout must not
-- recreate invitations after an uncertain Microsoft Graph response.
begin;
do $$
begin
  if not exists (select 1 from pipeline.schema_migrations where migration_id = '0047_assessment_outlook_calendar')
    or to_regclass('pipeline.assessment_outlook_calendar') is null then
    raise exception 'Assessment Outlook calendar ledger is incomplete; investigate before application rollback.';
  end if;
end;
$$;
commit;

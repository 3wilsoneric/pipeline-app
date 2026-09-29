-- Preserve the ledger across application rollback: a later rollout must not
-- recreate invitations after an uncertain Microsoft Graph response.
begin;
drop trigger if exists assessments_outlook_calendar_queue on pipeline.assessments;
drop trigger if exists assessments_outlook_calendar_remove on pipeline.assessments;
drop trigger if exists referrals_outlook_calendar_queue on pipeline.referrals;
drop function if exists pipeline.queue_assessment_outlook_calendar();
drop function if exists pipeline.queue_removed_assessment_outlook_calendar();
drop function if exists pipeline.queue_referral_outlook_calendar();
do $$
begin
  if to_regclass('pipeline.assessment_outlook_calendar') is null then
    raise exception 'Assessment Outlook calendar ledger is incomplete; investigate before application rollback.';
  end if;
end;
$$;
delete from pipeline.schema_migrations where migration_id = '0047_assessment_outlook_calendar';
commit;

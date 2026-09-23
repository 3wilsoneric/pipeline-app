-- Application rollback is safe without dropping notification claims. Keep the
-- delivery ledger so a later rollout cannot resend an uncertain Graph request.
begin;
do $$
begin
  if not exists (select 1 from pipeline.schema_migrations where migration_id = '0044_under_review_email_notifications')
    or to_regclass('pipeline.under_review_email_notifications') is null then
    raise exception 'Under Review email ledger is incomplete; investigate before application rollback.';
  end if;
end;
$$;
commit;

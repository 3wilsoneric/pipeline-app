-- Application-only rollback: retain deletion recovery and audit history.
-- Do not drop these additive columns/indexes or remove migration history.
-- Keep retention in dry-run while investigating deletion recovery; restore
-- the corrected file-restore application path rather than referral snapshots.
begin;

do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'pipeline' and table_name = 'documents'
      and column_name in ('deletion_id', 'undo_until', 'deletion_recovery', 'purged_at')) <> 4
    or to_regclass('pipeline.documents_undo_expiry_idx') is null
    or to_regclass('pipeline.document_uploaded_audit_once_idx') is null
    or not exists (select 1 from pipeline.schema_migrations where migration_id = '0037_document_undo') then
    raise exception 'Document recovery schema is incomplete; preserve the database and investigate before application rollback.';
  end if;
end;
$$;

commit;

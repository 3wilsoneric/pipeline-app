-- Application-only rollback to the retained 991c9a279e848e49 runtime.
-- Preserve explicit not_scanned states, authentic scan verdicts, packet
-- finalization, upload receipts, accepted answers and all audit history.
-- Never relabel an unscanned document as clean or reverse the data migration.
begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'pipeline.documents'::regclass
      and conname = 'documents_malware_scan_status_check'
      and pg_get_constraintdef(oid) like '%not_scanned%'
  ) or (select count(*) from information_schema.columns
    where table_schema = 'pipeline' and table_name = 'assessments'
      and column_name in ('meet_client_sent_at', 'meet_client_sent_version')) <> 2
  or (select count(*) from pipeline.schema_migrations
    where migration_id in ('0038_assessment_packet_finalization', '0039_document_scan_not_required')) <> 2 then
    raise exception 'Upload policy or packet finalization schema is incomplete; preserve the database and investigate before application rollback.';
  end if;
end;
$$;

commit;

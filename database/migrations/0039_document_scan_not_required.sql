begin;

-- The owner removed scanning from authenticated Pipeline uploads. Preserve
-- historical verdicts and identify unscanned uploads explicitly, never as clean.
alter table pipeline.documents
  drop constraint documents_malware_scan_status_check;
alter table pipeline.documents
  add constraint documents_malware_scan_status_check
  check (malware_scan_status in ('pending', 'clean', 'infected', 'failed', 'not_scanned'));

-- Release only completed Pipeline uploads. Reserved files and historical
-- imports without an upload receipt retain their existing state.
update pipeline.documents d
set malware_scan_status = 'not_scanned',
    processing_status = case when processing_status = 'quarantined' then 'uploaded' else processing_status end,
    version = version + 1, updated_at = now()
where d.malware_scan_status = 'pending' and d.deleted_at is null
  and exists (select 1 from pipeline.packet_upload_files f
    where f.document_id = d.document_id and f.uploaded_at is not null);

insert into pipeline.schema_migrations (migration_id)
values ('0039_document_scan_not_required') on conflict do nothing;

commit;

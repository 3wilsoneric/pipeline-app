begin;

alter table pipeline.documents
  add column if not exists deletion_id uuid,
  add column if not exists undo_until timestamptz,
  add column if not exists deletion_recovery jsonb,
  add column if not exists purged_at timestamptz;

create index if not exists documents_undo_expiry_idx
  on pipeline.documents(undo_until, document_id)
  where deleted_at is not null and undo_until is not null and purged_at is null;

create unique index if not exists document_uploaded_audit_once_idx
  on pipeline.audit_events(entity_id)
  where entity_type = 'document' and action = 'document_uploaded';

insert into pipeline.schema_migrations(migration_id) values ('0037_document_undo') on conflict do nothing;
commit;

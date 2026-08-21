-- Test and emergency rollback for migration 0008.
-- Prefer application rollback after client-file imports begin; dropping these
-- columns or staging tables discards 0008-only metadata.

delete from pipeline.schema_migrations where migration_id = '0008_client_workspaces';
delete from pipeline.store_revisions where store_name in ('client_workspaces', 'client_file_imports');

drop table if exists pipeline.client_file_import_items;
drop table if exists pipeline.client_file_import_batches;

drop index if exists pipeline.documents_unmatched_review_idx;
drop index if exists pipeline.documents_canonical_client_inventory_idx;
drop index if exists pipeline.documents_client_inventory_idx;
drop index if exists pipeline.documents_source_external_unique_idx;

alter table pipeline.documents
  drop constraint if exists documents_identity_status_check,
  drop constraint if exists documents_source_system_check,
  drop column if exists identity_status,
  drop column if exists client_community,
  drop column if exists client_display_name,
  drop column if exists canonical_client_id,
  drop column if exists document_date,
  drop column if exists source_canvas_id,
  drop column if exists source_external_id,
  drop column if exists source_system;

alter table pipeline.packet_uploads
  drop constraint if exists packet_uploads_processing_intent_check,
  drop column if exists processing_intent;

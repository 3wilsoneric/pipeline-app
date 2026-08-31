drop table if exists pipeline.canvas_content_review_events;
drop table if exists pipeline.canvas_content_field_candidates;
drop table if exists pipeline.canvas_content_blocks;
drop table if exists pipeline.canvas_content_import_batch_snapshots;
drop table if exists pipeline.canvas_content_snapshots;
drop table if exists pipeline.canvas_content_import_batches;
delete from pipeline.store_revisions where store_name = 'allo_canvas_content';
delete from pipeline.schema_migrations where migration_id = '0020_allo_canvas_content';

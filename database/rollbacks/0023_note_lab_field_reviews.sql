drop table if exists pipeline.note_lab_field_reviews;
delete from pipeline.schema_migrations
where migration_id = '0023_note_lab_field_reviews';

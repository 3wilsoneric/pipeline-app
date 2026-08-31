drop table if exists pipeline.note_lab_pattern_selections;

delete from pipeline.schema_migrations
where migration_id = '0022_note_lab_pattern_selections';

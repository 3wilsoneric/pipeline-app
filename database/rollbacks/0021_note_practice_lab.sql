drop table if exists pipeline.note_lab_votes;

delete from pipeline.schema_migrations
where migration_id = '0021_note_practice_lab';

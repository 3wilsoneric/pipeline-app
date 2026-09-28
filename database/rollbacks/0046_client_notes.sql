-- Prefer an application rollback that leaves the additive table in place. Never delete client notes to
-- make a rollback succeed.
begin;
lock table pipeline.client_note_blocks in access exclusive mode;
do $$ begin
  if exists (select 1 from pipeline.client_note_blocks) then
    raise exception 'Client notes exist. Retain this migration during application rollback.';
  end if;
end $$;
drop table pipeline.client_note_blocks;
delete from pipeline.schema_migrations where migration_id = '0046_client_notes';
commit;

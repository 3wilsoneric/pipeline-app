-- Prefer an application rollback that leaves the additive table in place.
begin;
do $$ begin
  if exists (select 1 from pipeline.community_recipient_list_versions) then
    raise exception 'Contact lists contain data. Retain this migration during application rollback.';
  end if;
end $$;
drop table pipeline.community_recipient_list_versions;
delete from pipeline.schema_migrations where migration_id = '0041_community_recipient_lists';
commit;

-- Prefer rolling back the application while retaining packet and audit records.
-- Never remove issued packet access to make a rollback succeed.
begin;
lock table pipeline.admission_packet_links in access exclusive mode;
do $$ begin
  if exists (select 1 from pipeline.admission_packet_links) then
    raise exception 'Packet records exist. Retain this migration and recipient routes during application rollback.';
  end if;
end $$;
drop table pipeline.admission_packet_links;
delete from pipeline.schema_migrations where migration_id = '0042_admission_packet_links';
commit;

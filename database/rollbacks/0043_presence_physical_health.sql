-- Application-only rollback. The expanded allowlist is backward compatible.
-- Keep the constraint and migration history: narrowing it would reintroduce the
-- presence failure and could reject valid, active physical-health leases.
begin;
do $$
begin
  if not exists (
    select 1 from pipeline.schema_migrations
    where migration_id = '0043_presence_physical_health'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'pipeline.editing_presence'::regclass
      and conname = 'editing_presence_section_check'
      and pg_get_constraintdef(oid) like '%assessment:physical_health%'
  ) then
    raise exception 'Presence schema is incomplete; investigate before application rollback.';
  end if;
end;
$$;
commit;

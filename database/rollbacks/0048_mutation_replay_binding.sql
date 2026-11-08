-- Application rollback is schema-compatible. Keep retry keys, fingerprints and
-- the migration ledger: erasing bindings can duplicate previously accepted work.
-- Do not run a database restore or drop this additive column for app rollback.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'pipeline' and table_name = 'idempotency_keys'
      and column_name = 'request_fingerprint'
  ) then
    raise exception 'Mutation replay ledger is incomplete; investigate before rollback.';
  end if;
end;
$$;

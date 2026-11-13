-- Application rollback is schema-compatible. Preserve collected usage and the
-- migration ledger; the prior application simply does not write this table.
do $$
begin
  if to_regclass('pipeline.assessor_usage_minutes') is null then
    raise exception 'Assessor usage ledger is missing; investigate before rollback.';
  end if;
end;
$$;

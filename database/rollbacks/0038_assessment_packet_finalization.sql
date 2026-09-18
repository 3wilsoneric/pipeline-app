-- Application rollback is safe with these additive columns retained. Keep the
-- delivery evidence; do not drop finalized timestamps during an app rollback.
select 1;

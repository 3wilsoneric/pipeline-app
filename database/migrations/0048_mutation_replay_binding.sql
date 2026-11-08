begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Retain the key namespace and uniqueness/locking semantics. NULL identifies
-- legacy entries that cannot safely prove the original principal and command.
alter table pipeline.idempotency_keys
  add column if not exists request_fingerprint text
  check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');

insert into pipeline.schema_migrations (migration_id)
values ('0048_mutation_replay_binding')
on conflict (migration_id) do nothing;

commit;

-- Presence is advisory; every current assessment section must be representable.
-- Backward compatible with earlier application versions. On application rollback,
-- retain this expanded constraint and migration history; do not discard leases.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table pipeline.editing_presence
  drop constraint editing_presence_section_check,
  add constraint editing_presence_section_check
  check (section in (
    'identity', 'intake', 'documents', 'assessment', 'workflow', 'decision',
    'assessment:identity', 'assessment:prior_placement', 'assessment:prior_history',
    'assessment:diagnosis_clinical', 'assessment:functional_adl',
    'assessment:behavioral_risk', 'assessment:legal_conservatorship',
    'assessment:medication', 'assessment:substance_use', 'assessment:physical_health',
    'assessment:social_support', 'assessment:provenance_qc'
  ));

insert into pipeline.schema_migrations (migration_id)
values ('0043_presence_physical_health') on conflict (migration_id) do nothing;
commit;

-- Signing records authorship; successful Meet the Client delivery finalizes answers.
begin;
alter table pipeline.assessments
  add column if not exists meet_client_sent_at timestamptz,
  add column if not exists meet_client_sent_version integer;

-- Preserve finality for packets already sent before this change. Never infer
-- sending from a signature, admission decision, or a failed delivery attempt.
with sent as (
  select distinct on (metadata->>'assessment_id')
    metadata->>'assessment_id' as assessment_id,
    created_at,
    case when metadata->>'assessment_version' ~ '^[0-9]{1,9}$'
      then (metadata->>'assessment_version')::integer end as assessment_version
  from pipeline.audit_events
  where action = 'meet_client_summary_sent' and entity_type = 'referral'
  order by metadata->>'assessment_id', created_at
)
update pipeline.assessments a
set meet_client_sent_at = sent.created_at,
    meet_client_sent_version = sent.assessment_version
from sent
where a.assessment_id = sent.assessment_id and a.meet_client_sent_at is null;

insert into pipeline.schema_migrations(migration_id)
values ('0038_assessment_packet_finalization') on conflict do nothing;
commit;

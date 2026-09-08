-- Imported Allo workspaces are immutable source history, not current referral work.
-- Preserve every source record, owner, document, and known outcome while removing
-- historical episodes from operational queues and incomplete-work calculations.

begin;

create temporary table historical_workspace_archive_targets on commit drop as
select
  r.referral_id,
  r.version as before_version,
  r.workspace_status as before_workspace_status,
  r.workflow_status as before_workflow_status,
  r.closed_at as before_closed_at,
  'historical' = any(coalesce(r.tags, array[]::text[])) as had_historical_tag,
  case
    when nullif(btrim(coalesce(r.data->>'admissionDate', '')), '') is not null
      or r.stage = 'Accepted / Admitted'
      or r.data->'admissionDecision'->>'outcome' = 'accepted' then 'admitted'
    when r.stage = 'Declined'
      or r.data->'admissionDecision'->>'outcome' = 'declined' then 'declined'
    else 'not_recorded'
  end as historical_outcome,
  case
    when nullif(btrim(coalesce(r.data->>'admissionDate', '')), '') is not null
      or r.stage = 'Accepted / Admitted'
      or r.data->'admissionDecision'->>'outcome' = 'accepted' then 'accepted'
    when r.stage = 'Declined'
      or r.data->'admissionDecision'->>'outcome' = 'declined' then 'declined'
    else 'closed'
  end as next_workflow_status
from pipeline.referrals r
where r.workspace_origin in ('allo', 'import')
  and r.workspace_status <> 'archived'
  and r.deleted_at is null;

update pipeline.referrals r
set workspace_status = 'historical',
    workflow_status = target.next_workflow_status,
    closed_at = coalesce(r.closed_at, now()),
    tags = case
      when 'historical' = any(coalesce(r.tags, array[]::text[])) then r.tags
      else array_append(coalesce(r.tags, array[]::text[]), 'historical')
    end,
    data = jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(r.data, '{}'::jsonb),
          '{workspaceStatus}',
          '"historical"'::jsonb,
          true
        ),
        '{workflowStatus}',
        to_jsonb(target.next_workflow_status),
        true
      ),
      '{historicalOutcome}',
      to_jsonb(target.historical_outcome),
      true
    ),
    version = r.version + 1,
    updated_by = 'system:historical-workspace-archive',
    updated_by_name = 'Historical workspace archive migration',
    updated_at = now()
from historical_workspace_archive_targets target
where r.referral_id = target.referral_id;

insert into pipeline.audit_events (
  entity_type, entity_id, action, actor_id, actor_name,
  from_version, to_version, changed_fields, metadata
)
select
  'referral', target.referral_id::text, 'historical_workspace_closed',
  'system:historical-workspace-archive', 'Historical workspace archive migration',
  target.before_version, target.before_version + 1,
  array['workspace_status', 'workflow_status', 'closed_at'],
  jsonb_build_object(
    'before_workspace_status', target.before_workspace_status,
    'before_workflow_status', target.before_workflow_status,
    'before_closed_at', target.before_closed_at,
    'had_historical_tag', target.had_historical_tag,
    'historical_outcome', target.historical_outcome,
    'decision_source', case
      when target.historical_outcome = 'admitted' then 'admission_history_or_recorded_outcome'
      when target.historical_outcome = 'declined' then 'recorded_decline'
      else 'not_recovered_from_structured_import'
    end
  )
from historical_workspace_archive_targets target;

update pipeline.store_revisions
set revision = revision + 1, updated_at = now()
where store_name in ('referrals', 'client_workspaces')
  and exists (select 1 from historical_workspace_archive_targets);

insert into pipeline.schema_migrations (migration_id)
values ('0029_historical_workspace_archive')
on conflict (migration_id) do nothing;

commit;

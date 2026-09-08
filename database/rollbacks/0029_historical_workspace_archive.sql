create temporary table historical_workspace_archive_rollback on commit drop as
select distinct on (event.entity_id)
  event.entity_id::bigint as referral_id,
  event.metadata
from pipeline.audit_events event
where event.entity_type = 'referral'
  and event.action = 'historical_workspace_closed'
order by event.entity_id, event.created_at desc, event.audit_event_id desc;

update pipeline.referrals r
set workspace_status = coalesce(target.metadata->>'before_workspace_status', 'active'),
    workflow_status = coalesce(target.metadata->>'before_workflow_status', r.workflow_status),
    closed_at = case
      when target.metadata ? 'before_closed_at'
        and target.metadata->>'before_closed_at' is not null
        then (target.metadata->>'before_closed_at')::timestamptz
      else null
    end,
    tags = case
      when coalesce((target.metadata->>'had_historical_tag')::boolean, false) then r.tags
      else array_remove(coalesce(r.tags, array[]::text[]), 'historical')
    end,
    data = jsonb_set(
      jsonb_set(
        (coalesce(r.data, '{}'::jsonb) - 'historicalOutcome'),
        '{workspaceStatus}',
        to_jsonb(coalesce(target.metadata->>'before_workspace_status', 'active')),
        true
      ),
      '{workflowStatus}',
      to_jsonb(coalesce(target.metadata->>'before_workflow_status', r.workflow_status)),
      true
    ),
    version = r.version + 1,
    updated_by = 'system:historical-workspace-archive-rollback',
    updated_by_name = 'Historical workspace archive rollback',
    updated_at = now()
from historical_workspace_archive_rollback target
where r.referral_id = target.referral_id;

delete from pipeline.audit_events
where entity_type = 'referral'
  and action = 'historical_workspace_closed';

update pipeline.store_revisions
set revision = revision + 1, updated_at = now()
where store_name in ('referrals', 'client_workspaces')
  and exists (select 1 from historical_workspace_archive_rollback);

delete from pipeline.schema_migrations
where migration_id = '0029_historical_workspace_archive';

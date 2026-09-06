create temporary table imported_workspace_lifecycle_rollback on commit drop as
select distinct on (event.entity_id)
  event.entity_id::bigint as referral_id,
  event.metadata
from pipeline.audit_events event
where event.entity_type = 'referral'
  and event.action = 'imported_workspace_reclassified'
order by event.entity_id, event.created_at desc, event.audit_event_id desc;

update pipeline.referrals r
set workspace_status = coalesce(target.metadata->>'before_workspace_status', 'historical'),
    stage = coalesce(target.metadata->>'before_stage', r.stage),
    workflow_status = coalesce(target.metadata->>'before_workflow_status', r.workflow_status),
    closed_at = case
      when target.metadata ? 'before_closed_at'
        and target.metadata->>'before_closed_at' is not null
        then (target.metadata->>'before_closed_at')::timestamptz
      else null
    end,
    data = jsonb_set(
      jsonb_set(
        coalesce(r.data, '{}'::jsonb),
        '{workspaceStatus}',
        to_jsonb(coalesce(target.metadata->>'before_workspace_status', 'historical')),
        true
      ),
      '{workflowStatus}',
      to_jsonb(coalesce(target.metadata->>'before_workflow_status', r.workflow_status)),
      true
    ),
    version = r.version + 1,
    updated_by = 'system:imported-workspace-lifecycle-rollback',
    updated_by_name = 'Workspace lifecycle rollback'
from imported_workspace_lifecycle_rollback target
where r.referral_id = target.referral_id;

delete from pipeline.audit_events
where entity_type = 'referral'
  and action = 'imported_workspace_reclassified';

update pipeline.store_revisions
set revision = revision + 1, updated_at = now()
where store_name in ('referrals', 'client_workspaces')
  and exists (select 1 from imported_workspace_lifecycle_rollback);

delete from pipeline.schema_migrations
where migration_id = '0026_imported_workspace_lifecycle';

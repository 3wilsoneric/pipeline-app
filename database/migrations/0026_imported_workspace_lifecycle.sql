-- Imported source provenance is independent from operational lifecycle.
-- Existing Allo/import workspaces become normal workspaces; admitted records
-- remain completed while records without a terminal outcome remain in process.

begin;

create temporary table imported_workspace_lifecycle_targets on commit drop as
select
  r.referral_id,
  r.version as before_version,
  r.workspace_status as before_workspace_status,
  r.stage as before_stage,
  r.workflow_status as before_workflow_status,
  r.closed_at as before_closed_at,
  case
    when nullif(btrim(coalesce(r.data->>'admissionDate', '')), '') is not null
      or r.stage = 'Accepted / Admitted' then 'Accepted / Admitted'
    else r.stage
  end as next_stage,
  case
    when nullif(btrim(coalesce(r.data->>'admissionDate', '')), '') is not null
      or r.stage = 'Accepted / Admitted' then 'accepted'
    when r.stage = 'Declined' then 'declined'
    when r.workflow_status in ('accepted', 'declined', 'closed') then r.workflow_status
    when r.owner_id is null
      and lower(btrim(coalesce(r.owner_name, ''))) in ('', 'pending', 'unassigned', 'unknown')
      then 'intake_unassigned'
    else 'profile_incomplete'
  end as next_workflow_status
from pipeline.referrals r
where r.workspace_origin in ('allo', 'import')
  and r.workspace_status = 'historical';

update pipeline.referrals r
set workspace_status = 'active',
    stage = target.next_stage,
    workflow_status = target.next_workflow_status,
    closed_at = case
      when target.next_workflow_status in ('accepted', 'declined', 'closed')
        then coalesce(r.closed_at, r.created_at)
      else null
    end,
    data = jsonb_set(
      jsonb_set(coalesce(r.data, '{}'::jsonb), '{workspaceStatus}', '"active"'::jsonb, true),
      '{workflowStatus}', to_jsonb(target.next_workflow_status), true
    ),
    version = r.version + 1,
    updated_by = 'system:imported-workspace-lifecycle',
    updated_by_name = 'Workspace lifecycle migration'
from imported_workspace_lifecycle_targets target
where r.referral_id = target.referral_id;

insert into pipeline.audit_events (
  entity_type, entity_id, action, actor_id, actor_name,
  from_version, to_version, changed_fields, metadata
)
select
  'referral', target.referral_id::text, 'imported_workspace_reclassified',
  'system:imported-workspace-lifecycle', 'Workspace lifecycle migration',
  target.before_version, target.before_version + 1,
  array['workspace_status', 'stage', 'workflow_status', 'closed_at'],
  jsonb_build_object(
    'before_workspace_status', target.before_workspace_status,
    'before_stage', target.before_stage,
    'before_workflow_status', target.before_workflow_status,
    'before_closed_at', target.before_closed_at
  )
from imported_workspace_lifecycle_targets target;

update pipeline.store_revisions
set revision = revision + 1, updated_at = now()
where store_name in ('referrals', 'client_workspaces')
  and exists (select 1 from imported_workspace_lifecycle_targets);

insert into pipeline.schema_migrations (migration_id)
values ('0026_imported_workspace_lifecycle')
on conflict (migration_id) do nothing;

commit;

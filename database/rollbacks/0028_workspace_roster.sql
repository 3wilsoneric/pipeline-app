create temporary table workspace_roster_reactivations on commit drop as
select distinct on (event.entity_id)
  event.entity_id as principal_id,
  event.before_values
from pipeline.audit_events event
where event.entity_type = 'workspace_member'
  and event.action = 'workspace_member_deactivated'
  and event.actor_id = 'system:workspace-roster'
order by event.entity_id, event.created_at desc, event.audit_event_id desc;

update pipeline.workspace_members member
set active = coalesce((reactivation.before_values->>'active')::boolean, true),
    updated_at = now()
from workspace_roster_reactivations reactivation
where member.principal_id = reactivation.principal_id;

-- Flush the initially deferred workspace-member self-reference before an
-- older rollback changes this table's shape in the same transaction.
set constraints pipeline.workspace_members_merged_into_fkey immediate;

delete from pipeline.audit_events
where entity_type = 'workspace_member'
  and action = 'workspace_member_deactivated'
  and actor_id = 'system:workspace-roster';

delete from pipeline.schema_migrations
where migration_id = '0028_workspace_roster';

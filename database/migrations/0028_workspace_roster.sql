-- Retire departed staff and the obsolete imported duplicate of the active supervisor.
-- Referral ownership remains untouched so historical attribution is preserved.

begin;

create temporary table workspace_roster_retirements on commit drop as
select principal_id, display_name, roles, active
from pipeline.workspace_members
where active
  and principal_id in (
    'provisional:allo:andrew-dominici',
    'provisional:allo:lily-florian',
    'provisional:allo:lorena-renaud',
    'provisional:allo:marta'
  );

insert into pipeline.audit_events (
  entity_type, entity_id, action, actor_id, actor_name,
  changed_fields, before_values, after_values, metadata
)
select
  'workspace_member', principal_id, 'workspace_member_deactivated',
  'system:workspace-roster', 'Workspace roster migration',
  array['active'],
  jsonb_build_object('active', active),
  jsonb_build_object('active', false),
  jsonb_build_object('display_name', display_name, 'roles', roles)
from workspace_roster_retirements;

update pipeline.workspace_members member
set active = false,
    updated_at = now()
from workspace_roster_retirements retirement
where member.principal_id = retirement.principal_id;

insert into pipeline.schema_migrations (migration_id)
values ('0028_workspace_roster')
on conflict (migration_id) do nothing;

commit;

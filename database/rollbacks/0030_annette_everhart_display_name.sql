begin;

update pipeline.workspace_members
set display_name = 'Annette',
    updated_at = now()
where principal_id = 'provisional:allo:annette';

update pipeline.referrals
set owner_name = case when owner_id = 'provisional:allo:annette' then 'Annette' else owner_name end,
    created_by_name = case when created_by = 'provisional:allo:annette' then 'Annette' else created_by_name end,
    updated_by_name = case when updated_by = 'provisional:allo:annette' then 'Annette' else updated_by_name end,
    deleted_by_name = case when deleted_by = 'provisional:allo:annette' then 'Annette' else deleted_by_name end,
    data = case
      when data->>'owner' = 'Annette Everhart' then jsonb_set(data, '{owner}', '"Annette"'::jsonb, true)
      else data
    end
where owner_id = 'provisional:allo:annette'
   or created_by = 'provisional:allo:annette'
   or updated_by = 'provisional:allo:annette'
   or deleted_by = 'provisional:allo:annette'
   or data->>'owner' = 'Annette Everhart';

update pipeline.assessments
set assessor_name = case when assessor_id = 'provisional:allo:annette' then 'Annette' else assessor_name end,
    signed_by_name = case when signed_by = 'provisional:allo:annette' then 'Annette' else signed_by_name end,
    created_by_name = case when created_by = 'provisional:allo:annette' then 'Annette' else created_by_name end,
    updated_by_name = case when updated_by = 'provisional:allo:annette' then 'Annette' else updated_by_name end,
    data = case
      when data->>'assessor' = 'Annette Everhart' then jsonb_set(data, '{assessor}', '"Annette"'::jsonb, true)
      else data
    end
where assessor_id = 'provisional:allo:annette'
   or signed_by = 'provisional:allo:annette'
   or created_by = 'provisional:allo:annette'
   or updated_by = 'provisional:allo:annette'
   or data->>'assessor' = 'Annette Everhart';

update pipeline.work_items
set owner_name = 'Annette',
    updated_at = now()
where owner_id = 'provisional:allo:annette';

update pipeline.admission_decisions
set decided_by_name = 'Annette',
    updated_at = now()
where decided_by = 'provisional:allo:annette';

update pipeline.resident_links
set created_by_name = case when created_by = 'provisional:allo:annette' then 'Annette' else created_by_name end,
    reviewed_by_name = case when reviewed_by = 'provisional:allo:annette' then 'Annette' else reviewed_by_name end,
    updated_at = now()
where created_by = 'provisional:allo:annette'
   or reviewed_by = 'provisional:allo:annette';

update pipeline.assessment_addenda
set authored_by_name = 'Annette'
where authored_by = 'provisional:allo:annette';

update pipeline.assessment_recommendations
set recommended_by_name = 'Annette',
    updated_at = now()
where recommended_by = 'provisional:allo:annette';

update pipeline.audit_events
set actor_name = 'Annette'
where actor_id = 'provisional:allo:annette';

update pipeline.editing_presence
set actor_name = 'Annette'
where actor_id = 'provisional:allo:annette';

update pipeline.store_revisions
set revision = revision + 1,
    updated_at = now()
where store_name in ('referrals', 'assessments', 'workflow');

delete from pipeline.schema_migrations
where migration_id = '0030_annette_everhart_display_name';

commit;

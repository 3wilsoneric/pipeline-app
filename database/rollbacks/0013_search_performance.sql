drop index if exists pipeline.documents_client_community_search_trgm_idx;
drop index if exists pipeline.documents_client_name_search_trgm_idx;
drop index if exists pipeline.documents_file_name_search_trgm_idx;
drop index if exists pipeline.people_external_client_search_trgm_idx;
drop index if exists pipeline.people_display_name_search_trgm_idx;

update pipeline.referrals r
set search_text = lower(concat_ws(' ',
  p.display_name,
  r.community,
  r.source,
  r.owner_name,
  r.stage,
  r.priority,
  r.data->>'documentStatus',
  r.data->>'packetStatus',
  r.data->>'note',
  array_to_string(r.tags, ' ')
))
from pipeline.people p
where p.person_id = r.person_id;

delete from pipeline.schema_migrations
where migration_id = '0013_search_performance';

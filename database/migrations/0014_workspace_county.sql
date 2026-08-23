begin;

alter table pipeline.referrals
  add column if not exists county text;

alter table pipeline.referrals
  drop constraint if exists referrals_county_length_check;
alter table pipeline.referrals
  add constraint referrals_county_length_check
  check (county is null or char_length(county) between 1 and 100);

with county_names(name) as (
  values
    ('Alameda'), ('Alpine'), ('Amador'), ('Butte'), ('Calaveras'), ('Colusa'),
    ('Contra Costa'), ('Del Norte'), ('El Dorado'), ('Fresno'), ('Glenn'), ('Humboldt'),
    ('Imperial'), ('Inyo'), ('Kern'), ('Kings'), ('Lake'), ('Lassen'), ('Los Angeles'),
    ('Madera'), ('Marin'), ('Mariposa'), ('Mendocino'), ('Merced'), ('Modoc'), ('Mono'),
    ('Monterey'), ('Napa'), ('Nevada'), ('Orange'), ('Placer'), ('Plumas'), ('Riverside'),
    ('Sacramento'), ('San Benito'), ('San Bernardino'), ('San Diego'), ('San Francisco'),
    ('San Joaquin'), ('San Luis Obispo'), ('San Mateo'), ('Santa Barbara'), ('Santa Clara'),
    ('Santa Cruz'), ('Shasta'), ('Sierra'), ('Siskiyou'), ('Solano'), ('Sonoma'),
    ('Stanislaus'), ('Sutter'), ('Tehama'), ('Trinity'), ('Tulare'), ('Tuolumne'),
    ('Ventura'), ('Yolo'), ('Yuba')
), evidence as (
  select r.referral_id,
    concat_ws(' ',
      nullif(r.data->>'county', ''),
      (
        select coalesce(nullif(field->>'final_value', ''), nullif(field->>'proposed_value', ''))
        from jsonb_array_elements(
          case when jsonb_typeof(r.data->'packetFields') = 'array' then r.data->'packetFields' else '[]'::jsonb end
        ) field
        where regexp_replace(lower(coalesce(field->>'field_key', '')), '[^a-z0-9]', '', 'g') like '%county'
        limit 1
      ),
      r.community,
      r.source_workspace_name,
      r.source_project_name,
      r.source,
      r.data->>'payer',
      array_to_string(r.tags, ' ')
    ) as value
  from pipeline.referrals r
  where r.county is null
), county_matches as (
  select e.referral_id, c.name,
    row_number() over (partition by e.referral_id order by length(c.name) desc) as match_rank
  from evidence e
  join county_names c on e.value ~* (
    '(^|[^a-z])' || replace(c.name, ' ', '[[:space:]]+') || '([[:space:]]+county)?([^a-z]|$)'
  )
)
update pipeline.referrals r
set county = m.name || ' County'
from county_matches m
where r.referral_id = m.referral_id and m.match_rank = 1;

update pipeline.referrals r
set county = case
  when concat_ws(' ', r.source_workspace_name, r.source_project_name, r.source, r.data->>'payer', array_to_string(r.tags, ' ')) ~* '(^|[^a-z])(COCO|CCC)([^a-z]|$)' then 'Contra Costa County'
  when concat_ws(' ', r.source_workspace_name, r.source_project_name, r.source, r.data->>'payer', array_to_string(r.tags, ' ')) ~* '(^|[^a-z])(LAC|LA)([^a-z]|$)' then 'Los Angeles County'
  when concat_ws(' ', r.source_workspace_name, r.source_project_name, r.source, r.data->>'payer', array_to_string(r.tags, ' ')) ~* '(^|[^a-z])SAC([^a-z]|$)' then 'Sacramento County'
  when concat_ws(' ', r.source_workspace_name, r.source_project_name, r.source, r.data->>'payer', array_to_string(r.tags, ' ')) ~* '(^|[^a-z])SB([^a-z]|$)' then 'San Bernardino County'
  when concat_ws(' ', r.source_workspace_name, r.source_project_name, r.source, r.data->>'payer', array_to_string(r.tags, ' ')) ~* '(^|[^a-z])SF([^a-z]|$)' then 'San Francisco County'
  else null
end
where r.county is null;

create index if not exists referrals_county_created_idx
  on pipeline.referrals(county, created_at desc, referral_id desc)
  where county is not null;

insert into pipeline.schema_migrations (migration_id)
values ('0014_workspace_county')
on conflict (migration_id) do nothing;

commit;

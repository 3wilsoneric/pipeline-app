-- Give workspace filing a trustworthy month-precision value. Imported Allo
-- projects carry their month in the project name; file timestamps remain file
-- provenance and must not be used as a substitute.

begin;

alter table pipeline.referrals
  add column if not exists workspace_month date,
  add column if not exists workspace_month_basis text not null default 'unknown';

update pipeline.referrals
set workspace_month = case
      when received_date is not null then date_trunc('month', received_date)::date
      else date_trunc('month', created_at at time zone 'UTC')::date
    end,
    workspace_month_basis = case
      when received_date is not null then 'received_date'
      else 'record_created_at'
    end
where workspace_origin = 'pipeline';

with source_parts as (
  select
    referral_id,
    coalesce(
      nullif(substring(source_project_name from '(20[0-9]{2})'), '')::integer,
      2000 + ((regexp_match(source_project_name, '(^|[^0-9])(2[0-9])([^0-9]|$)'))[2])::integer
    ) as source_year,
    case
      when source_project_name ~* '(^|[^a-z])(january|jan)([^a-z]|$)' then 1
      when source_project_name ~* '(^|[^a-z])(february|feb)([^a-z]|$)' then 2
      when source_project_name ~* '(^|[^a-z])march([^a-z]|$)' then 3
      when source_project_name ~* '(^|[^a-z])april([^a-z]|$)' then 4
      when source_project_name ~* '(^|[^a-z])may([^a-z]|turlock|$)' then 5
      when source_project_name ~* '(^|[^a-z])june([^a-z]|$)' then 6
      when source_project_name ~* '(^|[^a-z])july([^a-z]|$)' then 7
      when source_project_name ~* '(^|[^a-z])(august|aug)([^a-z]|$)' then 8
      when source_project_name ~* '(^|[^a-z])(september|septemeber|sept|sep)([^a-z]|$)' then 9
      when source_project_name ~* '(^|[^a-z])(october|oct)([^a-z]|$)' then 10
      when source_project_name ~* '(^|[^a-z])(november|nov)([^a-z]|$)' then 11
      when source_project_name ~* '(^|[^a-z])(december|dec)([^a-z]|$)' then 12
      else null
    end as source_month
  from pipeline.referrals
  where workspace_origin in ('allo', 'import')
)
update pipeline.referrals r
set workspace_month = case
      when parts.source_year is not null and parts.source_month is not null
        then make_date(parts.source_year, parts.source_month, 1)
      else null
    end,
    workspace_month_basis = case
      when parts.source_year is not null and parts.source_month is not null
        then 'source_project_name'
      else 'unknown'
    end
from source_parts parts
where parts.referral_id = r.referral_id;

alter table pipeline.referrals
  drop constraint if exists referrals_workspace_month_basis_check;
alter table pipeline.referrals
  add constraint referrals_workspace_month_basis_check
  check (workspace_month_basis in ('received_date', 'record_created_at', 'source_project_name', 'unknown'));

alter table pipeline.referrals
  drop constraint if exists referrals_workspace_month_first_day_check;
alter table pipeline.referrals
  add constraint referrals_workspace_month_first_day_check
  check (workspace_month is null or extract(day from workspace_month) = 1);

alter table pipeline.referrals
  drop constraint if exists referrals_workspace_month_known_check;
alter table pipeline.referrals
  add constraint referrals_workspace_month_known_check
  check ((workspace_month is null) = (workspace_month_basis = 'unknown'));

create or replace function pipeline.set_pipeline_workspace_month()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_origin = 'pipeline' then
    if new.received_date is not null then
      new.workspace_month := date_trunc('month', new.received_date)::date;
      new.workspace_month_basis := 'received_date';
    else
      new.workspace_month := date_trunc('month', new.created_at at time zone 'UTC')::date;
      new.workspace_month_basis := 'record_created_at';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists referrals_set_pipeline_workspace_month on pipeline.referrals;
create trigger referrals_set_pipeline_workspace_month
before insert or update of received_date, workspace_origin on pipeline.referrals
for each row execute function pipeline.set_pipeline_workspace_month();

drop index if exists pipeline.referrals_workspace_received_idx;
create index if not exists referrals_workspace_month_idx
  on pipeline.referrals(workspace_status, workspace_month desc nulls last, referral_id desc)
  where deleted_at is null;

update pipeline.store_revisions
set revision = revision + 1, updated_at = now()
where store_name in ('referrals', 'client_workspaces');

insert into pipeline.schema_migrations (migration_id)
values ('0024_workspace_month_provenance')
on conflict (migration_id) do nothing;

commit;

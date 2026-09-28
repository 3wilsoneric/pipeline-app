-- Queue Outlook meeting updates in the same transaction as the authoritative
-- assessment schedule. The worker never decides or changes Pipeline's schedule.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists pipeline.assessment_outlook_calendar (
  assessment_id text primary key,
  transaction_id uuid not null default gen_random_uuid(),
  event_id text,
  recipient_email text,
  desired_version bigint not null default 1,
  processed_version bigint not null default 0,
  status text not null default 'pending' check (status in ('pending', 'processing', 'synced')),
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists assessment_outlook_calendar_due_idx
  on pipeline.assessment_outlook_calendar(next_attempt_at, assessment_id)
  where status in ('pending', 'processing');

revoke all on table pipeline.assessment_outlook_calendar from public;

create or replace function pipeline.queue_assessment_outlook_calendar()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and (new.scheduled_start_at is null or new.schedule_status not in ('scheduled', 'rescheduled')) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.scheduled_start_at is not distinct from old.scheduled_start_at
    and new.scheduled_duration_minutes is not distinct from old.scheduled_duration_minutes
    and new.scheduled_method is not distinct from old.scheduled_method
    and new.scheduled_location is not distinct from old.scheduled_location
    and new.schedule_status is not distinct from old.schedule_status
    and new.assessor_id is not distinct from old.assessor_id then
    return new;
  end if;
  insert into pipeline.assessment_outlook_calendar (assessment_id)
  values (new.assessment_id)
  on conflict (assessment_id) do update set
    desired_version = pipeline.assessment_outlook_calendar.desired_version + 1,
    status = 'pending', next_attempt_at = now(), updated_at = now();
  return new;
end;
$$;

create trigger assessments_outlook_calendar_queue
after insert or update of scheduled_start_at, scheduled_duration_minutes, scheduled_method,
  scheduled_location, schedule_status, assessor_id on pipeline.assessments
for each row execute function pipeline.queue_assessment_outlook_calendar();

create or replace function pipeline.queue_removed_assessment_outlook_calendar()
returns trigger language plpgsql as $$
begin
  update pipeline.assessment_outlook_calendar
  set desired_version = desired_version + 1, status = 'pending',
    next_attempt_at = now(), updated_at = now()
  where assessment_id = old.assessment_id and event_id is not null;
  return old;
end;
$$;

create trigger assessments_outlook_calendar_remove
after delete on pipeline.assessments
for each row execute function pipeline.queue_removed_assessment_outlook_calendar();

create or replace function pipeline.queue_referral_outlook_calendar()
returns trigger language plpgsql as $$
begin
  if new.workspace_status is distinct from old.workspace_status
    or new.deleted_at is distinct from old.deleted_at then
    update pipeline.assessment_outlook_calendar item
    set desired_version = desired_version + 1, status = 'pending',
      next_attempt_at = now(), updated_at = now()
    from pipeline.assessments a
    where a.assessment_id = item.assessment_id and a.referral_id = new.referral_id;
  end if;
  return new;
end;
$$;

create trigger referrals_outlook_calendar_queue
after update of workspace_status, deleted_at on pipeline.referrals
for each row execute function pipeline.queue_referral_outlook_calendar();

insert into pipeline.schema_migrations (migration_id)
values ('0047_assessment_outlook_calendar') on conflict (migration_id) do nothing;
commit;

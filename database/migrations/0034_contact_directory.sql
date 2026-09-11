begin;

create table if not exists pipeline.contacts (
  contact_id uuid primary key default gen_random_uuid(),
  version integer not null default 1 check (version > 0),
  first_name text not null default '',
  last_name text not null default '',
  organization text not null default '',
  job_title text not null default '',
  phone text not null default '',
  email text not null default '',
  preferred_contact_method text not null default 'not_recorded'
    check (preferred_contact_method in ('phone', 'email', 'text', 'in_person', 'not_recorded')),
  best_contact_time text not null default '',
  notes text not null default '',
  active boolean not null default true,
  search_text text not null default '',
  created_by text not null,
  created_by_name text not null,
  updated_by text not null,
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(first_name) <> '' or btrim(last_name) <> '' or btrim(organization) <> '')
);

create index if not exists contacts_search_idx
  on pipeline.contacts using gin (search_text gin_trgm_ops)
  where active;

create index if not exists contacts_updated_idx
  on pipeline.contacts (updated_at desc, contact_id)
  where active;

create table if not exists pipeline.referral_contacts (
  referral_contact_id uuid primary key default gen_random_uuid(),
  referral_id bigint not null references pipeline.referrals(referral_id) on delete cascade,
  contact_id uuid not null references pipeline.contacts(contact_id) on delete restrict,
  version integer not null default 1 check (version > 0),
  role text not null check (role in ('scheduling_contact', 'responsible_person', 'legal_guardian', 'referral_source', 'family', 'case_manager', 'other')),
  relationship text not null default '',
  notes text not null default '',
  primary_for_scheduling boolean not null default false,
  created_by text not null,
  created_by_name text not null,
  updated_by text not null,
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referral_id, contact_id, role)
);

create unique index if not exists referral_contacts_one_primary_schedule_idx
  on pipeline.referral_contacts (referral_id)
  where primary_for_scheduling;

create index if not exists referral_contacts_referral_idx
  on pipeline.referral_contacts (referral_id, updated_at desc, referral_contact_id);

create index if not exists referral_contacts_contact_idx
  on pipeline.referral_contacts (contact_id, referral_id);

insert into pipeline.store_revisions (store_name, revision)
values ('contacts', 0)
on conflict (store_name) do nothing;

insert into pipeline.schema_migrations (migration_id)
values ('0034_contact_directory')
on conflict (migration_id) do nothing;

revoke all on pipeline.contacts, pipeline.referral_contacts from public;

commit;

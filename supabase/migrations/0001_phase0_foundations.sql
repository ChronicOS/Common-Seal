-- =====================================================================
-- Common Seal - Phase 0 foundations
-- Supabase (Postgres), Sydney region (ap-southeast-2)
--
-- Covers: tenancy, people and positions, documents, AI extraction with
-- human review, tasks and reminders, legal holds, retention and deletion,
-- AI system register, append-only audit log, row-level security.
--
-- Conventions
--   * Every tenant table carries organisation_id and has RLS enabled.
--   * Users never hard-delete records. Deletion runs through
--     deletion_requests and is executed by a server-side function using
--     the service role. Legal hold triggers still fire for that role.
--   * Files live in a private storage bucket with no user policies.
--     Access is by short-lived signed URL issued server-side after
--     app.can_read_document() passes.
-- =====================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------
create type public.member_role as enum
  ('owner', 'admin', 'secretary', 'legal', 'compliance', 'director', 'member', 'auditor');
create type public.org_tier as enum ('small', 'medium', 'large');
create type public.doc_sensitivity as enum ('standard', 'confidential', 'board', 'privileged');
create type public.doc_source as enum ('upload', 'email', 'm365', 'generated');
create type public.extraction_status as enum ('queued', 'running', 'needs_review', 'confirmed', 'failed');
create type public.field_status as enum ('proposed', 'confirmed', 'corrected', 'rejected');
create type public.task_status as enum ('open', 'in_progress', 'done', 'cancelled');
create type public.hold_status as enum ('active', 'released');
create type public.hold_scope_type as enum ('organisation', 'record');
create type public.deletion_status as enum ('pending', 'approved', 'rejected', 'blocked_by_hold', 'completed');

-- ---------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------
create table public.organisations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  tier         public.org_tier not null default 'small',
  data_region  text not null default 'ap-southeast-2',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.member_role not null default 'member',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where is_active;

-- ---------------------------------------------------------------------
-- Access helper functions (security definer so policies do not recurse)
-- ---------------------------------------------------------------------
create or replace function app.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organisation_id = p_org and m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function app.has_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organisation_id = p_org and m.user_id = auth.uid() and m.is_active
      and m.role = any (p_roles)
  );
$$;

-- Role groups used by policies
create or replace function app.admin_roles() returns public.member_role[]
language sql immutable as $$ select array['owner','admin']::public.member_role[] $$;

create or replace function app.records_roles() returns public.member_role[]
language sql immutable as $$ select array['owner','admin','secretary','legal','compliance']::public.member_role[] $$;

create or replace function app.contributor_roles() returns public.member_role[]
language sql immutable as $$ select array['owner','admin','secretary','legal','compliance','director','member']::public.member_role[] $$;

-- ---------------------------------------------------------------------
-- People and positions (authority attaches to positions, not people)
-- ---------------------------------------------------------------------
create table public.people (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete set null,
  full_name        text not null,
  email            text,
  is_external      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index people_org_idx on public.people (organisation_id);

create table public.positions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  title            text not null,
  description      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, title)
);

create table public.position_assignments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  position_id      uuid not null references public.positions (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  starts_on        date not null default current_date,
  ends_on          date,
  is_acting        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index position_assignments_position_idx on public.position_assignments (position_id);
create index position_assignments_person_idx on public.position_assignments (person_id);

-- ---------------------------------------------------------------------
-- Retention policies
-- ---------------------------------------------------------------------
create table public.retention_policies (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  name               text not null,
  applies_to         text not null,            -- e.g. 'meeting_capture', 'contract', 'minutes'
  retain_days        integer check (retain_days is null or retain_days >= 0), -- null = keep permanently
  requires_approval  boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organisation_id, name)
);

-- ---------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------
create table public.documents (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  title                text not null,
  kind                 text,                   -- e.g. 'contract', 'minutes', 'company_extract'
  sensitivity          public.doc_sensitivity not null default 'standard',
  is_restricted        boolean not null default false,  -- true = only records roles and explicit grants
  source               public.doc_source not null default 'upload',
  retention_policy_id  uuid references public.retention_policies (id) on delete set null,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index documents_org_idx on public.documents (organisation_id);

create table public.document_versions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  document_id      uuid not null references public.documents (id) on delete cascade,
  version_no       integer not null check (version_no > 0),
  storage_path     text not null,              -- '<organisation_id>/<document_id>/<version_no>/<file>'
  file_name        text not null,
  mime_type        text,
  size_bytes       bigint check (size_bytes is null or size_bytes >= 0),
  sha256           text not null,
  uploaded_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (document_id, version_no)
);
create index document_versions_org_idx on public.document_versions (organisation_id);

create table public.document_grants (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  document_id      uuid not null references public.documents (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  granted_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (document_id, user_id)
);
create index document_grants_user_idx on public.document_grants (user_id);

create or replace function app.can_read_document(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document
      and app.is_member(d.organisation_id)
      and (
        not d.is_restricted
        or app.has_role(d.organisation_id, app.records_roles())
        or exists (select 1 from public.document_grants g
                   where g.document_id = d.id and g.user_id = auth.uid())
      )
  );
$$;

-- ---------------------------------------------------------------------
-- AI system register (platform-wide) and extraction with human review
-- ---------------------------------------------------------------------
create table public.ai_systems (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  provider         text not null,
  model_id         text not null,
  processing_region text not null,             -- must be an Australian region
  purpose          text not null,
  risk_level       text not null default 'limited',
  human_oversight  text not null,              -- how a person confirms the output
  trains_on_customer_data boolean not null default false check (not trains_on_customer_data),
  approved_at      timestamptz,
  retired_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.extractions (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  document_version_id  uuid not null references public.document_versions (id) on delete cascade,
  ai_system_id         uuid not null references public.ai_systems (id),
  prompt_version       text not null,
  status               public.extraction_status not null default 'queued',
  error                text,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index extractions_version_idx on public.extractions (document_version_id);
create index extractions_org_idx on public.extractions (organisation_id);

create table public.extraction_fields (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  extraction_id    uuid not null references public.extractions (id) on delete cascade,
  field_key        text not null,              -- e.g. 'counterparty', 'renewal_date'
  proposed_value   jsonb,
  confidence       numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_page      integer,
  source_text      text,                       -- the passage the value was taken from
  status           public.field_status not null default 'proposed',
  final_value      jsonb,
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (extraction_id, field_key)
);
create index extraction_fields_org_idx on public.extraction_fields (organisation_id);

-- The reviewer is always the signed-in user; it cannot be supplied by the client.
create or replace function app.stamp_field_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status <> 'proposed' then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    if new.status = 'confirmed' then
      new.final_value := old.proposed_value;
    elsif new.status = 'corrected' and new.final_value is null then
      raise exception 'A corrected field needs a final value';
    end if;
  elsif new.status = old.status then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  -- AI output is immutable once written
  new.proposed_value := old.proposed_value;
  new.confidence     := old.confidence;
  new.source_page    := old.source_page;
  new.source_text    := old.source_text;
  return new;
end;
$$;
create trigger extraction_fields_review
  before update on public.extraction_fields
  for each row execute function app.stamp_field_review();

-- ---------------------------------------------------------------------
-- Tasks and reminders
-- ---------------------------------------------------------------------
create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  title                 text not null,
  detail                text,
  subject_table         text,                  -- record the task relates to
  subject_id            uuid,
  assignee_person_id    uuid references public.people (id) on delete set null,
  assignee_position_id  uuid references public.positions (id) on delete set null,
  due_at                timestamptz,
  status                public.task_status not null default 'open',
  origin                text not null default 'manual' check (origin in ('manual', 'workflow', 'ai', 'system')),
  created_by            uuid references auth.users (id) on delete set null,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index tasks_org_status_due_idx on public.tasks (organisation_id, status, due_at);
create index tasks_subject_idx on public.tasks (subject_table, subject_id);

create table public.reminders (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  task_id          uuid not null references public.tasks (id) on delete cascade,
  remind_at        timestamptz not null,
  channel          text not null default 'in_app' check (channel in ('in_app', 'email', 'teams')),
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index reminders_due_idx on public.reminders (remind_at) where sent_at is null;

-- ---------------------------------------------------------------------
-- Legal holds
-- ---------------------------------------------------------------------
create table public.legal_holds (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  name              text not null,
  matter_reference  text,
  reason            text not null,
  status            public.hold_status not null default 'active',
  placed_by         uuid references auth.users (id) on delete set null,
  placed_at         timestamptz not null default now(),
  released_by       uuid references auth.users (id) on delete set null,
  released_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((status = 'released') = (released_at is not null))
);
create index legal_holds_active_idx on public.legal_holds (organisation_id) where status = 'active';

create table public.legal_hold_scopes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  legal_hold_id    uuid not null references public.legal_holds (id) on delete cascade,
  scope_type       public.hold_scope_type not null,
  subject_table    text,
  subject_id       uuid,
  created_at       timestamptz not null default now(),
  check (
    (scope_type = 'organisation' and subject_table is null and subject_id is null)
    or (scope_type = 'record' and subject_table is not null and subject_id is not null)
  )
);
create index legal_hold_scopes_subject_idx on public.legal_hold_scopes (subject_table, subject_id);

-- True when an active hold covers the record. A hold on a document also
-- covers its versions.
create or replace function app.is_under_hold(p_org uuid, p_table text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.legal_holds h
    join public.legal_hold_scopes s on s.legal_hold_id = h.id
    where h.organisation_id = p_org
      and h.status = 'active'
      and (
        s.scope_type = 'organisation'
        or (s.subject_table = p_table and s.subject_id = p_id)
        or (p_table = 'document_versions' and s.subject_table = 'documents'
            and s.subject_id = (select v.document_id from public.document_versions v where v.id = p_id))
      )
  );
$$;

-- For the warning banner: any member may learn THAT a record is on hold,
-- without seeing the hold's name, matter or reason.
create or replace function public.record_on_hold(p_org uuid, p_table text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when app.is_member(p_org) then app.is_under_hold(p_org, p_table, p_id) else null end;
$$;

-- Blocks deletion of any held record, for every role including the service role.
create or replace function app.block_delete_under_hold()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if app.is_under_hold(old.organisation_id, tg_table_name, old.id) then
    raise exception 'Deletion blocked: % % is under an active legal hold', tg_table_name, old.id
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger documents_hold_guard before delete on public.documents
  for each row execute function app.block_delete_under_hold();
create trigger document_versions_hold_guard before delete on public.document_versions
  for each row execute function app.block_delete_under_hold();

-- ---------------------------------------------------------------------
-- Deletion requests and certificates
-- ---------------------------------------------------------------------
create table public.deletion_requests (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  subject_table        text not null,
  subject_id           uuid not null,
  reason               text not null,
  retention_policy_id  uuid references public.retention_policies (id) on delete set null,
  status               public.deletion_status not null default 'pending',
  requested_by         uuid not null references auth.users (id),
  requested_at         timestamptz not null default now(),
  decided_by           uuid references auth.users (id),
  decided_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (decided_by is null or decided_by <> requested_by)   -- two-person rule
);
create index deletion_requests_org_idx on public.deletion_requests (organisation_id, status);

create or replace function app.guard_deletion_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    new.status := 'pending';
    new.decided_by := null;
    new.decided_at := null;
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
    if new.decided_by is not distinct from old.requested_by then
      raise exception 'A deletion request cannot be decided by the person who raised it';
    end if;
  end if;
  -- A hold always wins over a pending or approved request
  if new.status in ('pending', 'approved')
     and app.is_under_hold(new.organisation_id, new.subject_table, new.subject_id) then
    new.status := 'blocked_by_hold';
  end if;
  return new;
end;
$$;
create trigger deletion_requests_guard
  before insert or update on public.deletion_requests
  for each row execute function app.guard_deletion_request();

create table public.deletion_certificates (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null,          -- no FK: the certificate outlives the tenant
  deletion_request_id  uuid,
  subject_table        text not null,
  subject_id           uuid not null,
  subject_description  text not null,
  file_hashes          text[] not null default '{}',
  external_results     jsonb not null default '{}'::jsonb,  -- e.g. Microsoft 365 deletion outcome
  deleted_at           timestamptz not null default now()
);
create index deletion_certificates_org_idx on public.deletion_certificates (organisation_id);

-- ---------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id               bigint generated always as identity primary key,
  organisation_id  uuid,                       -- no FK: the log outlives the tenant
  occurred_at      timestamptz not null default now(),
  actor_user_id    uuid,
  action           text not null,              -- insert | update | delete | read | export | ...
  table_name       text,
  record_id        uuid,
  old_data         jsonb,
  new_data         jsonb,
  context          jsonb not null default '{}'::jsonb
);
create index audit_log_org_time_idx on public.audit_log (organisation_id, occurred_at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

create or replace function app.reject_change()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.reject_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.reject_change();
create trigger deletion_certificates_append_only before update or delete on public.deletion_certificates
  for each row execute function app.reject_change();

create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);
  insert into public.audit_log (organisation_id, actor_user_id, action, table_name, record_id, old_data, new_data)
  values (
    case when tg_table_name = 'organisations' then (v_row ->> 'id')::uuid
         else (v_row ->> 'organisation_id')::uuid end,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

-- Reads of sensitive records are logged by the application through this call.
create or replace function public.log_read(p_org uuid, p_table text, p_id uuid, p_context jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_member(p_org) then
    raise exception 'Not a member of this organisation';
  end if;
  insert into public.audit_log (organisation_id, actor_user_id, action, table_name, record_id, context)
  values (p_org, auth.uid(), 'read', p_table, p_id, coalesce(p_context, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- updated_at maintenance and audit triggers on every tenant table
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'organisations', 'memberships', 'people', 'positions', 'position_assignments',
    'retention_policies', 'documents', 'ai_systems', 'extractions', 'extraction_fields',
    'tasks', 'reminders', 'legal_holds', 'deletion_requests'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
                   t || '_touch', t);
  end loop;

  foreach t in array array[
    'organisations', 'memberships', 'people', 'positions', 'position_assignments',
    'retention_policies', 'documents', 'document_versions', 'document_grants',
    'extractions', 'extraction_fields', 'tasks', 'reminders',
    'legal_holds', 'legal_hold_scopes', 'deletion_requests', 'deletion_certificates'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()',
                   t || '_audit', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges: nothing for anonymous users; RLS decides for signed-in users
-- ---------------------------------------------------------------------
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select, insert, update on all tables in schema public to authenticated;
revoke insert, update on public.audit_log, public.deletion_certificates, public.ai_systems from authenticated;
grant all on all tables in schema public to service_role;
revoke execute on function public.log_read(uuid, text, uuid, jsonb) from public, anon;
revoke execute on function public.record_on_hold(uuid, text, uuid) from public, anon;
grant execute on function public.log_read(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.record_on_hold(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.organisations         enable row level security;
alter table public.memberships           enable row level security;
alter table public.people                enable row level security;
alter table public.positions             enable row level security;
alter table public.position_assignments  enable row level security;
alter table public.retention_policies    enable row level security;
alter table public.documents             enable row level security;
alter table public.document_versions     enable row level security;
alter table public.document_grants       enable row level security;
alter table public.ai_systems            enable row level security;
alter table public.extractions           enable row level security;
alter table public.extraction_fields     enable row level security;
alter table public.tasks                 enable row level security;
alter table public.reminders             enable row level security;
alter table public.legal_holds           enable row level security;
alter table public.legal_hold_scopes     enable row level security;
alter table public.deletion_requests     enable row level security;
alter table public.deletion_certificates enable row level security;
alter table public.audit_log             enable row level security;

-- Organisations: created server-side (with the first owner membership)
create policy organisations_select on public.organisations for select to authenticated
  using (app.is_member(id));
create policy organisations_update on public.organisations for update to authenticated
  using (app.has_role(id, app.admin_roles())) with check (app.has_role(id, app.admin_roles()));

-- Memberships
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.has_role(organisation_id, app.admin_roles()));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (app.has_role(organisation_id, app.admin_roles()));
create policy memberships_update on public.memberships for update to authenticated
  using (app.has_role(organisation_id, app.admin_roles()))
  with check (app.has_role(organisation_id, app.admin_roles()));

-- People, positions, assignments
create policy people_select on public.people for select to authenticated
  using (app.is_member(organisation_id));
create policy people_insert on public.people for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy people_update on public.people for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy positions_select on public.positions for select to authenticated
  using (app.is_member(organisation_id));
create policy positions_insert on public.positions for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy positions_update on public.positions for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy position_assignments_select on public.position_assignments for select to authenticated
  using (app.is_member(organisation_id));
create policy position_assignments_insert on public.position_assignments for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy position_assignments_update on public.position_assignments for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

-- Retention policies
create policy retention_policies_select on public.retention_policies for select to authenticated
  using (app.is_member(organisation_id));
create policy retention_policies_insert on public.retention_policies for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy retention_policies_update on public.retention_policies for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

-- Documents: restricted documents need a records role or an explicit grant
create policy documents_select on public.documents for select to authenticated
  using (
    app.is_member(organisation_id)
    and (
      not is_restricted
      or app.has_role(organisation_id, app.records_roles())
      or exists (select 1 from public.document_grants g
                 where g.document_id = documents.id and g.user_id = auth.uid())
    )
  );
create policy documents_insert on public.documents for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()));
create policy documents_update on public.documents for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or created_by = auth.uid())
  with check (app.has_role(organisation_id, app.contributor_roles()));

create policy document_versions_select on public.document_versions for select to authenticated
  using (app.can_read_document(document_id));
create policy document_versions_insert on public.document_versions for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()) and app.can_read_document(document_id));

create policy document_grants_select on public.document_grants for select to authenticated
  using (user_id = auth.uid() or app.has_role(organisation_id, app.records_roles()));
create policy document_grants_insert on public.document_grants for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));

-- AI system register: readable by any signed-in user, maintained server-side
create policy ai_systems_select on public.ai_systems for select to authenticated using (true);

-- Extractions: written by the server-side pipeline; people only review fields
create policy extractions_select on public.extractions for select to authenticated
  using (app.is_member(organisation_id)
         and app.can_read_document((select v.document_id from public.document_versions v
                                    where v.id = extractions.document_version_id)));
create policy extraction_fields_select on public.extraction_fields for select to authenticated
  using (exists (select 1 from public.extractions e where e.id = extraction_fields.extraction_id));
create policy extraction_fields_review on public.extraction_fields for update to authenticated
  using (app.has_role(organisation_id, app.contributor_roles())
         and exists (select 1 from public.extractions e where e.id = extraction_fields.extraction_id))
  with check (app.has_role(organisation_id, app.contributor_roles()));

-- Tasks and reminders
create policy tasks_select on public.tasks for select to authenticated
  using (app.is_member(organisation_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()));
create policy tasks_update on public.tasks for update to authenticated
  using (app.has_role(organisation_id, app.contributor_roles()))
  with check (app.has_role(organisation_id, app.contributor_roles()));

create policy reminders_select on public.reminders for select to authenticated
  using (app.is_member(organisation_id));
create policy reminders_insert on public.reminders for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()));
create policy reminders_update on public.reminders for update to authenticated
  using (app.has_role(organisation_id, app.contributor_roles()))
  with check (app.has_role(organisation_id, app.contributor_roles()));

-- Legal holds: details visible only to records roles (use record_on_hold() for the banner)
create policy legal_holds_select on public.legal_holds for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()));
create policy legal_holds_insert on public.legal_holds for insert to authenticated
  with check (app.has_role(organisation_id, array['owner','admin','legal']::public.member_role[]));
create policy legal_holds_update on public.legal_holds for update to authenticated
  using (app.has_role(organisation_id, array['owner','admin','legal']::public.member_role[]))
  with check (app.has_role(organisation_id, array['owner','admin','legal']::public.member_role[]));

create policy legal_hold_scopes_select on public.legal_hold_scopes for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()));
create policy legal_hold_scopes_insert on public.legal_hold_scopes for insert to authenticated
  with check (app.has_role(organisation_id, array['owner','admin','legal']::public.member_role[]));

-- Deletion requests and certificates
create policy deletion_requests_select on public.deletion_requests for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()));
create policy deletion_requests_insert on public.deletion_requests for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy deletion_requests_update on public.deletion_requests for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy deletion_certificates_select on public.deletion_certificates for select to authenticated
  using (app.has_role(organisation_id, array['owner','admin','secretary','legal','compliance','auditor']::public.member_role[]));

-- Audit log: read-only, for oversight roles
create policy audit_log_select on public.audit_log for select to authenticated
  using (app.has_role(organisation_id, array['owner','admin','legal','compliance','auditor']::public.member_role[]));

-- ---------------------------------------------------------------------
-- File storage: one private bucket, no user policies.
-- Uploads and downloads use short-lived signed URLs issued server-side.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

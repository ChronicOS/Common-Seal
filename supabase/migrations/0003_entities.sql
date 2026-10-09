-- =====================================================================
-- Common Seal - 0003: entities, group structure and organic setup
--
-- Covers: entity records, dated ownership links, officeholdings, and
-- the prompt state behind "skip for now / come back later".
-- Also tightens table privileges left open by Supabase's defaults.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hardening: Supabase grants every privilege on new public tables to
-- the anon and authenticated roles by default. Row-level security
-- already blocks deletes (there are no delete policies), but TRUNCATE
-- is not subject to RLS, so remove what users should never hold.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke delete, truncate, references, trigger on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.entity_form as enum
  ('proprietary_company', 'public_company', 'trust', 'partnership', 'foreign_company', 'other');
create type public.entity_status as enum ('active', 'dormant', 'deregistered');
create type public.office_role as enum
  ('director', 'alternate_director', 'chair', 'secretary', 'public_officer');
create type public.prompt_status as enum ('skipped', 'snoozed', 'not_applicable', 'done');

-- ---------------------------------------------------------------------
-- Entities
-- ---------------------------------------------------------------------
create table public.entities (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 2 and 200),
  legal_form         public.entity_form,
  jurisdiction       text not null default 'AU',
  acn                text check (acn is null or acn ~ '^[0-9]{9}$'),
  abn                text check (abn is null or abn ~ '^[0-9]{11}$'),
  registered_office  text,
  incorporated_on    date,
  is_listed          boolean not null default false,
  status             public.entity_status not null default 'active',
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index entities_org_idx on public.entities (organisation_id);
create unique index entities_org_acn_idx on public.entities (organisation_id, acn) where acn is not null;

-- ---------------------------------------------------------------------
-- Ownership links (dated, so the chart can be drawn as at any date)
-- ---------------------------------------------------------------------
create table public.entity_relationships (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  parent_entity_id  uuid not null references public.entities (id) on delete cascade,
  child_entity_id   uuid not null references public.entities (id) on delete cascade,
  ownership_pct     numeric(6,3) check (ownership_pct is null or (ownership_pct > 0 and ownership_pct <= 100)),
  share_class       text,
  starts_on         date,
  ends_on           date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (parent_entity_id <> child_entity_id),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index entity_relationships_org_idx on public.entity_relationships (organisation_id);
create index entity_relationships_child_idx on public.entity_relationships (child_entity_id);
create index entity_relationships_parent_idx on public.entity_relationships (parent_entity_id);

-- Both ends must belong to the row's organisation, and a link may not
-- make an entity its own ancestor.
create or replace function app.guard_entity_relationship()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.entities e
      where e.id in (new.parent_entity_id, new.child_entity_id)
        and e.organisation_id = new.organisation_id) <> 2 then
    raise exception 'Both entities must belong to this organisation';
  end if;

  if new.ends_on is null or new.ends_on >= current_date then
    if exists (
      with recursive up as (
        select r.parent_entity_id
        from public.entity_relationships r
        where r.child_entity_id = new.parent_entity_id
          and r.id <> new.id
          and (r.ends_on is null or r.ends_on >= current_date)
        union
        select r.parent_entity_id
        from public.entity_relationships r
        join up on r.child_entity_id = up.parent_entity_id
        where r.id <> new.id
          and (r.ends_on is null or r.ends_on >= current_date)
      )
      select 1 from up where up.parent_entity_id = new.child_entity_id
    ) then
      raise exception 'This link would make an entity its own owner';
    end if;
  end if;
  return new;
end;
$$;
create trigger entity_relationships_guard
  before insert or update on public.entity_relationships
  for each row execute function app.guard_entity_relationship();

-- ---------------------------------------------------------------------
-- Officeholdings
-- ---------------------------------------------------------------------
create table public.officeholdings (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_id        uuid not null references public.entities (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  role             public.office_role not null,
  appointed_on     date,
  ceased_on        date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ceased_on is null or appointed_on is null or ceased_on >= appointed_on)
);
create index officeholdings_entity_idx on public.officeholdings (entity_id);
create index officeholdings_person_idx on public.officeholdings (person_id);

create or replace function app.guard_officeholding()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.entities e
                 where e.id = new.entity_id and e.organisation_id = new.organisation_id)
     or not exists (select 1 from public.people p
                    where p.id = new.person_id and p.organisation_id = new.organisation_id) then
    raise exception 'The entity and the person must belong to this organisation';
  end if;
  return new;
end;
$$;
create trigger officeholdings_guard
  before insert or update on public.officeholdings
  for each row execute function app.guard_officeholding();

-- ---------------------------------------------------------------------
-- Organic setup: what was skipped, snoozed or marked not applicable
-- ---------------------------------------------------------------------
create table public.profile_prompts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  subject_table    text not null,
  subject_id       uuid not null,
  field_key        text not null,
  status           public.prompt_status not null,
  remind_after     timestamptz,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (subject_table, subject_id, field_key)
);
create index profile_prompts_org_idx on public.profile_prompts (organisation_id);

-- ---------------------------------------------------------------------
-- Triggers: updated_at, audit, legal hold guard
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['entities', 'entity_relationships', 'officeholdings', 'profile_prompts'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
                   t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()',
                   t || '_audit', t);
  end loop;
end;
$$;

create trigger entities_hold_guard before delete on public.entities
  for each row execute function app.block_delete_under_hold();

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.entities, public.entity_relationships, public.officeholdings, public.profile_prompts
  from anon, authenticated;
grant select, insert, update
  on public.entities, public.entity_relationships, public.officeholdings, public.profile_prompts
  to authenticated;
grant all on public.entities, public.entity_relationships, public.officeholdings, public.profile_prompts
  to service_role;
grant execute on all functions in schema app to authenticated, service_role;

alter table public.entities             enable row level security;
alter table public.entity_relationships enable row level security;
alter table public.officeholdings       enable row level security;
alter table public.profile_prompts      enable row level security;

create policy entities_select on public.entities for select to authenticated
  using (app.is_member(organisation_id));
create policy entities_insert on public.entities for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy entities_update on public.entities for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy entity_relationships_select on public.entity_relationships for select to authenticated
  using (app.is_member(organisation_id));
create policy entity_relationships_insert on public.entity_relationships for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy entity_relationships_update on public.entity_relationships for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy officeholdings_select on public.officeholdings for select to authenticated
  using (app.is_member(organisation_id));
create policy officeholdings_insert on public.officeholdings for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy officeholdings_update on public.officeholdings for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy profile_prompts_select on public.profile_prompts for select to authenticated
  using (app.is_member(organisation_id));
create policy profile_prompts_insert on public.profile_prompts for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy profile_prompts_update on public.profile_prompts for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

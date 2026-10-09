-- =====================================================================
-- Common Seal - 0006: delegations of authority and signing
--
-- Rules are data, per entity. Authority to APPROVE (commit the company)
-- is kept separate from authority to EXECUTE (sign). A rule is held by
-- a position, by a statutory method of execution, or by an attorney
-- under a power of attorney. Rules are ended, never deleted.
-- =====================================================================

create type public.authority_kind as enum ('approve', 'execute');
create type public.holder_kind as enum ('position', 'statutory', 'attorney');

create table public.powers_of_attorney (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_id        uuid not null references public.entities (id) on delete cascade,
  attorney_name    text not null check (char_length(btrim(attorney_name)) >= 2),
  scope            text not null check (char_length(btrim(scope)) >= 2),
  granted_on       date,
  expires_on       date,
  revoked_on       date,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (expires_on is null or granted_on is null or expires_on >= granted_on)
);
create index powers_of_attorney_entity_idx on public.powers_of_attorney (entity_id);

create table public.delegation_rules (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  entity_id             uuid not null references public.entities (id) on delete cascade,
  authority             public.authority_kind not null,
  transaction_type      text not null default 'Any' check (char_length(btrim(transaction_type)) >= 2),
  holder_kind           public.holder_kind not null,
  position_id           uuid references public.positions (id) on delete restrict,
  power_of_attorney_id  uuid references public.powers_of_attorney (id) on delete restrict,
  statutory_basis       text,
  limit_amount          numeric(16,2) check (limit_amount is null or limit_amount >= 0),  -- null = no limit
  currency              text not null default 'AUD',
  conditions            text,
  delegated_from_id     uuid references public.delegation_rules (id) on delete set null,
  source_resolution_id  uuid references public.resolutions (id) on delete set null,
  starts_on             date,
  ends_on               date,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (
    (holder_kind = 'position'  and position_id is not null and power_of_attorney_id is null and statutory_basis is null)
    or (holder_kind = 'attorney'  and power_of_attorney_id is not null and position_id is null and statutory_basis is null)
    or (holder_kind = 'statutory' and statutory_basis is not null and position_id is null and power_of_attorney_id is null)
  )
);
create index delegation_rules_entity_idx on public.delegation_rules (entity_id, authority);

-- Everything a rule points at must sit in the same organisation, and an
-- onward delegation cannot exceed the authority it comes from.
create or replace function app.guard_delegation_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.delegation_rules%rowtype;
begin
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'The entity does not belong to this organisation';
  end if;
  if new.position_id is not null and not exists
     (select 1 from public.positions p where p.id = new.position_id and p.organisation_id = new.organisation_id) then
    raise exception 'The position does not belong to this organisation';
  end if;
  if new.power_of_attorney_id is not null and not exists
     (select 1 from public.powers_of_attorney a where a.id = new.power_of_attorney_id and a.entity_id = new.entity_id) then
    raise exception 'The power of attorney was not granted by this entity';
  end if;
  if new.source_resolution_id is not null and not exists
     (select 1 from public.resolutions r where r.id = new.source_resolution_id and r.organisation_id = new.organisation_id) then
    raise exception 'The resolution does not belong to this organisation';
  end if;

  if new.delegated_from_id is not null then
    select * into v_parent from public.delegation_rules d where d.id = new.delegated_from_id;
    if v_parent.id is null or v_parent.id = new.id or v_parent.entity_id <> new.entity_id
       or v_parent.authority <> new.authority then
      raise exception 'An onward delegation must come from a rule of the same kind for the same entity';
    end if;
    if v_parent.limit_amount is not null and (new.limit_amount is null or new.limit_amount > v_parent.limit_amount) then
      raise exception 'An onward delegation cannot exceed the limit of the authority it comes from (%)', v_parent.limit_amount;
    end if;
  end if;
  return new;
end;
$$;
create trigger delegation_rules_guard before insert or update on public.delegation_rules
  for each row execute function app.guard_delegation_rule();

create or replace function app.guard_power_of_attorney()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'The entity does not belong to this organisation';
  end if;
  return new;
end;
$$;
create trigger powers_of_attorney_guard before insert or update on public.powers_of_attorney
  for each row execute function app.guard_power_of_attorney();

do $$
declare
  t text;
begin
  foreach t in array array['powers_of_attorney', 'delegation_rules'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

grant execute on all functions in schema app to authenticated, service_role;

revoke all on public.powers_of_attorney, public.delegation_rules from anon, authenticated;
grant select, insert, update on public.powers_of_attorney, public.delegation_rules to authenticated;
grant all on public.powers_of_attorney, public.delegation_rules to service_role;

alter table public.powers_of_attorney enable row level security;
alter table public.delegation_rules   enable row level security;

-- Anyone in the organisation can look up who may approve or sign; records roles maintain the rules.
do $$
declare
  t text;
begin
  foreach t in array array['powers_of_attorney', 'delegation_rules'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.is_member(organisation_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()))', t || '_update', t);
  end loop;
end;
$$;

-- =====================================================================
-- Common Seal - 0007: contracts
--
-- Flow: a contract is filed, the approver is worked out from the
-- delegation rules, the approval is recorded, the signature is
-- recorded against a signing rule, and reminders are created.
-- Anything done out of order or outside authority is written to the
-- exceptions register for the board.
--
-- Status changes, approvals and signatures only happen through the
-- functions in this file, never by direct table writes.
-- =====================================================================

create type public.contract_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'signed', 'terminated');
create type public.approval_status as enum ('pending', 'approved', 'rejected');
create type public.exception_kind as enum ('signed_before_approval', 'signed_outside_authority');

create table public.counterparties (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 200),
  abn              text check (abn is null or abn ~ '^[0-9]{11}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index counterparties_org_name_idx on public.counterparties (organisation_id, lower(name));

create table public.contracts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  entity_id         uuid not null references public.entities (id) on delete restrict,
  counterparty_id   uuid not null references public.counterparties (id) on delete restrict,
  title             text not null check (char_length(btrim(title)) between 2 and 300),
  transaction_type  text not null default 'Any',
  value_amount      numeric(16,2) check (value_amount is null or value_amount >= 0),
  currency          text not null default 'AUD',
  starts_on         date,
  ends_on           date,
  notice_by         date,                 -- last day to give notice of non-renewal or termination
  auto_renews       boolean not null default false,
  summary           text,
  is_intragroup     boolean not null default false,
  status            public.contract_status not null default 'draft',
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index contracts_org_idx on public.contracts (organisation_id, status);

create table public.contract_approvals (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  contract_id      uuid not null references public.contracts (id) on delete cascade,
  rule_id          uuid references public.delegation_rules (id) on delete set null,
  required_holder  text not null,          -- who had to approve, as it stood when the request was made
  basis            text not null,          -- the rule relied on, in words
  status           public.approval_status not null default 'pending',
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  on_behalf        boolean not null default false,  -- recorded by someone other than the authority holder
  comment          text,
  created_at       timestamptz not null default now()
);
create index contract_approvals_contract_idx on public.contract_approvals (contract_id);

create table public.contract_signatures (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  contract_id      uuid not null references public.contracts (id) on delete cascade,
  rule_id          uuid references public.delegation_rules (id) on delete set null,
  capacity         text not null,          -- the signing authority relied on, in words
  signed_by        text not null,
  signed_on        date not null,
  recorded_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index contract_signatures_contract_idx on public.contract_signatures (contract_id);

create table public.authority_exceptions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  contract_id      uuid not null references public.contracts (id) on delete cascade,
  kind             public.exception_kind not null,
  detail           text not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index authority_exceptions_org_idx on public.authority_exceptions (organisation_id, created_at desc);

-- ---------------------------------------------------------------------
-- Which delegation rules cover a transaction, smallest sufficient first
-- ---------------------------------------------------------------------
create or replace function app.covering_rules(p_entity uuid, p_authority public.authority_kind, p_type text, p_amount numeric)
returns setof public.delegation_rules language sql stable security definer set search_path = '' as $$
  select r.*
  from public.delegation_rules r
  where r.entity_id = p_entity
    and r.authority = p_authority
    and (r.starts_on is null or r.starts_on <= current_date)
    and (r.ends_on is null or r.ends_on >= current_date)
    and (r.transaction_type = 'Any' or r.transaction_type = p_type)
    and (r.limit_amount is null or r.limit_amount >= coalesce(p_amount, 0))
    and (r.holder_kind <> 'attorney' or exists (
          select 1 from public.powers_of_attorney a
          where a.id = r.power_of_attorney_id and a.revoked_on is null
            and (a.expires_on is null or a.expires_on >= current_date)))
  order by r.limit_amount asc nulls last, r.created_at;
$$;

create or replace function app.rule_holder(p_rule public.delegation_rules)
returns text language sql stable security definer set search_path = '' as $$
  select case p_rule.holder_kind
    when 'position' then (select p.title from public.positions p where p.id = p_rule.position_id)
    when 'statutory' then p_rule.statutory_basis
    else (select a.attorney_name || ' (attorney)' from public.powers_of_attorney a where a.id = p_rule.power_of_attorney_id)
  end;
$$;

create or replace function app.rule_basis(p_rule public.delegation_rules)
returns text language sql stable set search_path = '' as $$
  select case when p_rule.transaction_type = 'Any' then 'Any transaction' else p_rule.transaction_type end
      || case when p_rule.limit_amount is null then ', no limit'
              else ', up to $' || to_char(p_rule.limit_amount, 'FM999,999,999,999,990') end
      || coalesce('. ' || p_rule.conditions, '');
$$;

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------
create or replace function app.guard_contract()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  -- coalesce matters: an unset setting is NULL, and NULL must not read as 'system'
  v_system boolean := coalesce(current_setting('app.contract_system', true), 'off') = 'on';
begin
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id)
     or not exists (select 1 from public.counterparties c where c.id = new.counterparty_id and c.organisation_id = new.organisation_id) then
    raise exception 'The entity and counterparty must belong to this organisation';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if new.status is distinct from old.status and not v_system then
    raise exception 'A contract''s status changes only through approval and signing';
  end if;
  if old.status not in ('draft', 'rejected') and not v_system and (
       new.entity_id <> old.entity_id or new.counterparty_id <> old.counterparty_id
       or new.transaction_type <> old.transaction_type
       or new.value_amount is distinct from old.value_amount) then
    raise exception 'The company, counterparty, type and value are fixed once a contract is sent for approval';
  end if;
  return new;
end;
$$;
create trigger contracts_guard before insert or update on public.contracts
  for each row execute function app.guard_contract();

create or replace function app.guard_counterparty()
returns trigger language plpgsql as $$
begin
  new.name := btrim(new.name);
  return new;
end;
$$;
create trigger counterparties_guard before insert or update on public.counterparties
  for each row execute function app.guard_counterparty();

do $$
declare
  t text;
begin
  foreach t in array array['counterparties', 'contracts'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['counterparties', 'contracts', 'contract_approvals', 'contract_signatures', 'authority_exceptions'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

create trigger contracts_hold_guard before delete on public.contracts
  for each row execute function app.block_delete_under_hold();
create trigger authority_exceptions_append_only before update or delete on public.authority_exceptions
  for each row execute function app.reject_change();
create trigger contract_signatures_append_only before update or delete on public.contract_signatures
  for each row execute function app.reject_change();

-- ---------------------------------------------------------------------
-- Workflow functions
-- ---------------------------------------------------------------------
create or replace function public.submit_contract(p_contract uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_c public.contracts%rowtype;
  v_rule public.delegation_rules%rowtype;
  v_approval uuid;
begin
  select * into v_c from public.contracts c where c.id = p_contract for update;
  if v_c.id is null or not (app.has_role(v_c.organisation_id, app.records_roles()) or v_c.created_by = auth.uid()) then
    raise exception 'You do not have permission to send this contract for approval';
  end if;
  if v_c.status not in ('draft', 'rejected') then
    raise exception 'This contract has already been sent for approval';
  end if;

  select * into v_rule from app.covering_rules(v_c.entity_id, 'approve', v_c.transaction_type, v_c.value_amount) limit 1;

  insert into public.contract_approvals (organisation_id, contract_id, rule_id, required_holder, basis)
  values (
    v_c.organisation_id, v_c.id, v_rule.id,
    coalesce(app.rule_holder(v_rule), 'The board'),
    case when v_rule.id is null then 'No delegate has authority for this type and value, so it goes to the board'
         else app.rule_basis(v_rule) end)
  returning id into v_approval;

  perform set_config('app.contract_system', 'on', true);
  update public.contracts set status = 'pending_approval' where id = v_c.id;
  perform set_config('app.contract_system', 'off', true);
  return v_approval;
end;
$$;

create or replace function public.decide_contract_approval(p_approval uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_a public.contract_approvals%rowtype;
  v_is_holder boolean;
begin
  select * into v_a from public.contract_approvals a where a.id = p_approval for update;
  if v_a.id is null or not app.is_member(v_a.organisation_id) then
    raise exception 'You do not have permission to decide this approval';
  end if;
  if v_a.status <> 'pending' then
    raise exception 'This approval has already been decided';
  end if;

  -- The caller is the authority holder if they currently hold the rule's position.
  select exists (
    select 1
    from public.delegation_rules r
    join public.position_assignments pa on pa.position_id = r.position_id
    join public.people p on p.id = pa.person_id
    where r.id = v_a.rule_id and p.user_id = auth.uid()
      and pa.starts_on <= current_date and (pa.ends_on is null or pa.ends_on >= current_date)
  ) into v_is_holder;

  if not (v_is_holder or app.has_role(v_a.organisation_id, app.records_roles())) then
    raise exception 'Only the authority holder, or a records role on their behalf, can decide this approval';
  end if;

  update public.contract_approvals
     set status = case when p_approve then 'approved' else 'rejected' end::public.approval_status,
         decided_by = auth.uid(), decided_at = now(), on_behalf = not v_is_holder,
         comment = nullif(btrim(coalesce(p_comment, '')), '')
   where id = v_a.id;

  perform set_config('app.contract_system', 'on', true);
  update public.contracts
     set status = case when p_approve then 'approved' else 'rejected' end::public.contract_status
   where id = v_a.contract_id;
  perform set_config('app.contract_system', 'off', true);
end;
$$;

create or replace function public.record_contract_signature(p_contract uuid, p_rule uuid, p_signed_by text, p_signed_on date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_c public.contracts%rowtype;
  v_rule public.delegation_rules%rowtype;
  v_exceptions integer := 0;
begin
  select * into v_c from public.contracts c where c.id = p_contract for update;
  if v_c.id is null or not app.has_role(v_c.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to record a signature';
  end if;
  if v_c.status in ('signed', 'terminated') then
    raise exception 'A signature is already recorded for this contract';
  end if;
  if char_length(btrim(coalesce(p_signed_by, ''))) < 2 or p_signed_on is null then
    raise exception 'Enter who signed and the date';
  end if;
  if p_signed_on > current_date + 1 then
    raise exception 'The signing date cannot be in the future';
  end if;

  if v_c.status <> 'approved' then
    insert into public.authority_exceptions (organisation_id, contract_id, kind, detail, created_by)
    values (v_c.organisation_id, v_c.id, 'signed_before_approval',
            format('Signed by %s on %s while the contract was "%s", not approved', btrim(p_signed_by),
                   to_char(p_signed_on, 'DD Mon YYYY'), replace(v_c.status::text, '_', ' ')), auth.uid());
    v_exceptions := v_exceptions + 1;
  end if;

  select * into v_rule
  from app.covering_rules(v_c.entity_id, 'execute', v_c.transaction_type, v_c.value_amount) r
  where r.id = p_rule;

  if v_rule.id is null then
    insert into public.authority_exceptions (organisation_id, contract_id, kind, detail, created_by)
    values (v_c.organisation_id, v_c.id, 'signed_outside_authority',
            format('Signed by %s on %s with no signing authority covering this type and value', btrim(p_signed_by),
                   to_char(p_signed_on, 'DD Mon YYYY')), auth.uid());
    v_exceptions := v_exceptions + 1;
  end if;

  insert into public.contract_signatures (organisation_id, contract_id, rule_id, capacity, signed_by, signed_on, recorded_by)
  values (v_c.organisation_id, v_c.id, v_rule.id,
          coalesce(app.rule_holder(v_rule), 'No recorded authority'), btrim(p_signed_by), p_signed_on, auth.uid());

  perform set_config('app.contract_system', 'on', true);
  update public.contracts set status = 'signed' where id = v_c.id;
  perform set_config('app.contract_system', 'off', true);

  -- Reminders are created from the dates on the contract, with no further input
  if v_c.notice_by is not null then
    insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
    values (v_c.organisation_id,
            format('%s: decide whether to renew or give notice', v_c.title),
            'contracts', v_c.id, (v_c.notice_by::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
  end if;
  if v_c.ends_on is not null then
    insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
    values (v_c.organisation_id,
            format('%s: contract ends', v_c.title),
            'contracts', v_c.id, (v_c.ends_on::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
  end if;
  return v_exceptions;
end;
$$;

revoke execute on function public.submit_contract(uuid) from public, anon;
revoke execute on function public.decide_contract_approval(uuid, boolean, text) from public, anon;
revoke execute on function public.record_contract_signature(uuid, uuid, text, date) from public, anon;
grant execute on function public.submit_contract(uuid) to authenticated;
grant execute on function public.decide_contract_approval(uuid, boolean, text) to authenticated;
grant execute on function public.record_contract_signature(uuid, uuid, text, date) to authenticated;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.counterparties, public.contracts, public.contract_approvals,
  public.contract_signatures, public.authority_exceptions from anon, authenticated;
grant select, insert, update on public.counterparties, public.contracts to authenticated;
grant select on public.contract_approvals, public.contract_signatures, public.authority_exceptions to authenticated;
grant all on public.counterparties, public.contracts, public.contract_approvals,
  public.contract_signatures, public.authority_exceptions to service_role;

alter table public.counterparties       enable row level security;
alter table public.contracts            enable row level security;
alter table public.contract_approvals   enable row level security;
alter table public.contract_signatures  enable row level security;
alter table public.authority_exceptions enable row level security;

create policy counterparties_select on public.counterparties for select to authenticated
  using (app.is_member(organisation_id));
create policy counterparties_insert on public.counterparties for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()));
create policy counterparties_update on public.counterparties for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy contracts_select on public.contracts for select to authenticated
  using (app.is_member(organisation_id));
create policy contracts_insert on public.contracts for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()));
create policy contracts_update on public.contracts for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or created_by = auth.uid())
  with check (app.has_role(organisation_id, app.contributor_roles()));

create policy contract_approvals_select on public.contract_approvals for select to authenticated
  using (app.is_member(organisation_id));
create policy contract_signatures_select on public.contract_signatures for select to authenticated
  using (app.is_member(organisation_id));
create policy authority_exceptions_select on public.authority_exceptions for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()));

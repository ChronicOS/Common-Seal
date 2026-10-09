-- =====================================================================
-- Common Seal - 0010: intercompany arrangements
--
-- An intercompany arrangement is a contract whose other side is another
-- entity in the group. It uses the same lifecycle as any contract, with
-- two differences: each side approves under its own delegation rules,
-- and each side signs. Part of the large tier.
-- =====================================================================

alter table public.contracts
  alter column counterparty_id drop not null,
  add column counterparty_entity_id uuid references public.entities (id) on delete restrict,
  add column arrangement_type text,
  add column pricing_basis text,
  add column interest_rate numeric(6,3) check (interest_rate is null or interest_rate >= 0),
  add constraint contracts_one_other_side check ((counterparty_id is not null) <> (counterparty_entity_id is not null)),
  add constraint contracts_not_with_itself check (counterparty_entity_id is null or counterparty_entity_id <> entity_id);

alter table public.contract_approvals add column entity_id uuid references public.entities (id) on delete set null;
alter table public.contract_signatures add column entity_id uuid references public.entities (id) on delete set null;

-- Existing rows belong to the contract's own entity
update public.contract_approvals a set entity_id = c.entity_id from public.contracts c where c.id = a.contract_id and a.entity_id is null;
-- Signatures are append-only, so lift that rule just for this one-off backfill
alter table public.contract_signatures disable trigger contract_signatures_append_only;
update public.contract_signatures s set entity_id = c.entity_id from public.contracts c where c.id = s.contract_id and s.entity_id is null;
alter table public.contract_signatures enable trigger contract_signatures_append_only;

create or replace function app.guard_contract()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := coalesce(current_setting('app.contract_system', true), 'off') = 'on';
begin
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'The entity must belong to this organisation';
  end if;
  if new.counterparty_id is not null and not exists
     (select 1 from public.counterparties c where c.id = new.counterparty_id and c.organisation_id = new.organisation_id) then
    raise exception 'The counterparty must belong to this organisation';
  end if;
  if new.counterparty_entity_id is not null then
    if not exists (select 1 from public.entities e
                   where e.id = new.counterparty_entity_id and e.organisation_id = new.organisation_id) then
      raise exception 'The other group entity must belong to this organisation';
    end if;
    if not exists (select 1 from public.organisations o where o.id = new.organisation_id and o.tier = 'large') then
      raise exception 'Intercompany arrangements are part of the large tier';
    end if;
  end if;
  new.is_intragroup := new.counterparty_entity_id is not null;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if new.status is distinct from old.status and not v_system then
    raise exception 'A contract''s status changes only through approval and signing';
  end if;
  if old.status not in ('draft', 'rejected') and not v_system and (
       new.entity_id <> old.entity_id
       or new.counterparty_id is distinct from old.counterparty_id
       or new.counterparty_entity_id is distinct from old.counterparty_entity_id
       or new.transaction_type <> old.transaction_type
       or new.value_amount is distinct from old.value_amount) then
    raise exception 'The parties, type and value are fixed once a contract is sent for approval';
  end if;
  return new;
end;
$$;

-- One approval per side. For an ordinary contract that is one; for an
-- intercompany arrangement, one for each group entity.
create or replace function public.submit_contract(p_contract uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_c public.contracts%rowtype;
  v_rule public.delegation_rules%rowtype;
  v_side uuid;
  v_approval uuid;
begin
  select * into v_c from public.contracts c where c.id = p_contract for update;
  if v_c.id is null or not (app.has_role(v_c.organisation_id, app.records_roles()) or v_c.created_by = auth.uid()) then
    raise exception 'You do not have permission to send this contract for approval';
  end if;
  if v_c.status not in ('draft', 'rejected') then
    raise exception 'This contract has already been sent for approval';
  end if;

  -- Close anything left open from an earlier round
  update public.contract_approvals
     set status = 'rejected', comment = 'Closed when the contract was sent for approval again'
   where contract_id = v_c.id and status = 'pending';

  foreach v_side in array array_remove(array[v_c.entity_id, v_c.counterparty_entity_id], null) loop
    v_rule := null;
    select * into v_rule from app.covering_rules(v_side, 'approve', v_c.transaction_type, v_c.value_amount) limit 1;
    insert into public.contract_approvals (organisation_id, contract_id, entity_id, rule_id, required_holder, basis)
    values (
      v_c.organisation_id, v_c.id, v_side, v_rule.id,
      coalesce(app.rule_holder(v_rule), 'The board'),
      case when v_rule.id is null then 'No delegate has authority for this type and value, so it goes to the board'
           else app.rule_basis(v_rule) end)
    returning id into v_approval;
  end loop;

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
  v_party public.counterparties%rowtype;
  v_is_holder boolean;
  v_next public.contract_status;
begin
  select * into v_a from public.contract_approvals a where a.id = p_approval for update;
  if v_a.id is null or not app.is_member(v_a.organisation_id) then
    raise exception 'You do not have permission to decide this approval';
  end if;
  if v_a.status <> 'pending' then
    raise exception 'This approval has already been decided';
  end if;

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

  if p_approve then
    select cp.* into v_party
    from public.counterparties cp join public.contracts c on c.counterparty_id = cp.id
    where c.id = v_a.contract_id;
    if v_party.dd_status = 'rejected' then
      raise exception 'Blocked: % was rejected in due diligence', v_party.name using errcode = 'P0001';
    end if;
    if v_party.dd_status = 'open' and v_party.risk_rating = 'high' then
      raise exception 'Blocked: % is rated high risk and its due diligence is not finished', v_party.name using errcode = 'P0001';
    end if;
  end if;

  update public.contract_approvals
     set status = case when p_approve then 'approved' else 'rejected' end::public.approval_status,
         decided_by = auth.uid(), decided_at = now(), on_behalf = not v_is_holder,
         comment = nullif(btrim(coalesce(p_comment, '')), '')
   where id = v_a.id;

  -- A refusal by either side stops the contract; approval needs every side.
  v_next := case
    when not p_approve then 'rejected'
    when exists (select 1 from public.contract_approvals a where a.contract_id = v_a.contract_id and a.status = 'pending') then 'pending_approval'
    else 'approved' end;

  perform set_config('app.contract_system', 'on', true);
  update public.contracts set status = v_next where id = v_a.contract_id and status is distinct from v_next;
  perform set_config('app.contract_system', 'off', true);
end;
$$;

drop function if exists public.record_contract_signature(uuid, uuid, text, date);

create or replace function public.record_contract_signature(
  p_contract uuid, p_rule uuid, p_signed_by text, p_signed_on date, p_entity uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_c public.contracts%rowtype;
  v_rule public.delegation_rules%rowtype;
  v_entity uuid;
  v_sides uuid[];
  v_exceptions integer := 0;
begin
  select * into v_c from public.contracts c where c.id = p_contract for update;
  if v_c.id is null or not app.has_role(v_c.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to record a signature';
  end if;
  if v_c.status in ('signed', 'terminated') then
    raise exception 'This contract is already fully signed';
  end if;
  v_sides := array_remove(array[v_c.entity_id, v_c.counterparty_entity_id], null);
  v_entity := coalesce(p_entity, v_c.entity_id);
  if not (v_entity = any (v_sides)) then
    raise exception 'That entity is not a party to this contract';
  end if;
  if exists (select 1 from public.contract_signatures s where s.contract_id = v_c.id and s.entity_id = v_entity) then
    raise exception 'A signature is already recorded for that entity';
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
  from app.covering_rules(v_entity, 'execute', v_c.transaction_type, v_c.value_amount) r
  where r.id = p_rule;

  if v_rule.id is null then
    insert into public.authority_exceptions (organisation_id, contract_id, kind, detail, created_by)
    values (v_c.organisation_id, v_c.id, 'signed_outside_authority',
            format('Signed by %s on %s with no signing authority covering this type and value', btrim(p_signed_by),
                   to_char(p_signed_on, 'DD Mon YYYY')), auth.uid());
    v_exceptions := v_exceptions + 1;
  end if;

  insert into public.contract_signatures (organisation_id, contract_id, entity_id, rule_id, capacity, signed_by, signed_on, recorded_by)
  values (v_c.organisation_id, v_c.id, v_entity, v_rule.id,
          coalesce(app.rule_holder(v_rule), 'No recorded authority'), btrim(p_signed_by), p_signed_on, auth.uid());

  -- The contract is signed once every side has signed
  if (select count(distinct s.entity_id) from public.contract_signatures s where s.contract_id = v_c.id) >= cardinality(v_sides) then
    perform set_config('app.contract_system', 'on', true);
    update public.contracts set status = 'signed' where id = v_c.id;
    perform set_config('app.contract_system', 'off', true);

    if v_c.notice_by is not null then
      insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
      values (v_c.organisation_id, format('%s: decide whether to renew or give notice', v_c.title),
              'contracts', v_c.id, (v_c.notice_by::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
    end if;
    if v_c.ends_on is not null then
      insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
      values (v_c.organisation_id, format('%s: contract ends', v_c.title),
              'contracts', v_c.id, (v_c.ends_on::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
    end if;
  end if;
  return v_exceptions;
end;
$$;

revoke execute on function public.submit_contract(uuid) from public, anon;
revoke execute on function public.decide_contract_approval(uuid, boolean, text) from public, anon;
revoke execute on function public.record_contract_signature(uuid, uuid, text, date, uuid) from public, anon;
grant execute on function public.submit_contract(uuid) to authenticated;
grant execute on function public.decide_contract_approval(uuid, boolean, text) to authenticated;
grant execute on function public.record_contract_signature(uuid, uuid, text, date, uuid) to authenticated;

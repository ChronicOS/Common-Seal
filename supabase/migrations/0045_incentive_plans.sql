-- 0045: Management incentive plans.
--
-- An incentive plan is now either an employee share option plan (ESOP) or a
-- management incentive plan (MIP). A MIP is usually for a small group of
-- senior managers and often has:
--   * its own class of shares (growth, hurdle or "sweet equity" shares);
--   * a hurdle: value only above a company valuation or return threshold;
--   * performance conditions;
--   * value that is only realised on an exit;
--   * shares paid for in full, funded by a company loan, or nil cost;
--   * settlement in shares or in cash (phantom units).
-- Grants gain performance conditions, any loan amount and terms, and a count
-- of units settled in cash. Cash-settled (phantom) units never reach the
-- register, so they cannot be exercised into shares.

alter table public.esop_plans
  add column if not exists plan_type             text not null default 'esop' check (plan_type in ('esop', 'mip')),
  add column if not exists hurdle_value          numeric(18,2) check (hurdle_value is null or hurdle_value >= 0),
  add column if not exists hurdle_note           text,
  add column if not exists performance_conditions text,
  add column if not exists exit_only             boolean,
  add column if not exists funding               text check (funding is null or funding in ('nil_cost', 'paid', 'loan_funded')),
  add column if not exists settlement            text not null default 'equity' check (settlement in ('equity', 'cash'));

alter table public.esop_grants
  add column if not exists performance_conditions text,
  add column if not exists loan_amount            numeric(18,2) check (loan_amount is null or loan_amount >= 0),
  add column if not exists loan_terms             text,
  add column if not exists settled                bigint not null default 0 check (settled >= 0);

alter table public.esop_grants drop constraint if exists esop_grants_check;
alter table public.esop_grants drop constraint if exists esop_grants_used_check;
alter table public.esop_grants add constraint esop_grants_used_check check (exercised + lapsed + settled <= number);
alter table public.esop_grants drop constraint if exists esop_grants_instrument_check;
alter table public.esop_grants add constraint esop_grants_instrument_check check (instrument in ('option', 'right', 'share', 'unit'));

grant insert (plan_type, hurdle_value, hurdle_note, performance_conditions, exit_only, funding, settlement),
      update (plan_type, hurdle_value, hurdle_note, performance_conditions, exit_only, funding, settlement)
  on public.esop_plans to authenticated;
grant insert (performance_conditions, loan_amount, loan_terms, settled),
      update (performance_conditions, loan_amount, loan_terms, settled)
  on public.esop_grants to authenticated;

-- Phantom units and cash-settled plans: no shares, so units are the only instrument
create or replace function app.guard_incentive_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_settlement text;
begin
  select p.settlement into v_settlement from public.esop_plans p where p.id = new.plan_id;
  if v_settlement = 'cash' and new.instrument <> 'unit' then
    raise exception 'A cash-settled plan grants units, not options, rights or shares';
  end if;
  if new.instrument = 'unit' and new.exercised <> 0 then
    raise exception 'Units are settled in cash, not exercised into shares';
  end if;
  return new;
end;
$$;
drop trigger if exists esop_grants_incentive_guard on public.esop_grants;
create trigger esop_grants_incentive_guard before insert or update on public.esop_grants for each row execute function app.guard_incentive_grant();

-- Issuing shares from a grant: units cannot be, and the remaining number takes settlements into account
create or replace function public.issue_from_instrument(
  p_source text, p_id uuid, p_shareholder uuid, p_class uuid, p_shares bigint, p_price numeric,
  p_effective_on date, p_certificate text default null, p_resolution uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_entity uuid;
  v_id uuid;
  g public.esop_grants%rowtype;
  c public.convertibles%rowtype;
  v_paid numeric;
  v_plan text;
begin
  if p_source = 'esop_grants' then
    select * into g from public.esop_grants x where x.id = p_id for update;
    v_org := g.organisation_id; v_entity := g.entity_id;
  elsif p_source = 'convertibles' then
    select * into c from public.convertibles x where x.id = p_id for update;
    v_org := c.organisation_id; v_entity := c.entity_id;
  else
    raise exception 'Unknown source';
  end if;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'You do not have permission to issue shares';
  end if;
  if coalesce(p_shares, 0) <= 0 then
    raise exception 'Give the number of shares issued';
  end if;
  if p_source = 'esop_grants' then
    select p.plan_type into v_plan from public.esop_plans p where p.id = g.plan_id;
    if g.instrument = 'unit' then
      raise exception 'Units are settled in cash and never issued as shares. Record the settlement instead.';
    end if;
    if p_shares > g.number - g.exercised - g.lapsed - g.settled then
      raise exception 'Only % remain under this grant', g.number - g.exercised - g.lapsed - g.settled;
    end if;
    v_paid := coalesce(p_price, g.exercise_price);
  else
    if c.status <> 'outstanding' then
      raise exception 'This instrument is no longer outstanding';
    end if;
    v_paid := coalesce(p_price, case when c.kind in ('safe', 'convertible_note') then round(c.principal / p_shares, 6) else c.exercise_price end, 0);
  end if;

  insert into public.share_movements (organisation_id, entity_id, kind, class_id, shares, to_holder_id, price_per_share, paid_per_share, effective_on,
                                      resolution_id, certificate_number, esop_grant_id, convertible_id, consideration)
  values (v_org, v_entity, 'issue', p_class, p_shares, p_shareholder, v_paid, v_paid, p_effective_on, p_resolution, nullif(btrim(coalesce(p_certificate, '')), ''),
          case when p_source = 'esop_grants' then p_id end, case when p_source = 'convertibles' then p_id end,
          case when p_source = 'esop_grants' then (case when v_plan = 'mip' then 'Management incentive plan: ' else 'Exercise of ESOP grant: ' end) || g.holder_name
               else 'Conversion of ' || replace(c.kind, '_', ' ') || ' held by ' || c.holder_name end)
  returning id into v_id;

  perform set_config('app.share_system', 'on', true);
  if p_source = 'esop_grants' then
    update public.esop_grants set exercised = exercised + p_shares where id = p_id;
  else
    update public.convertibles set status = case when kind in ('warrant', 'investor_option') then 'exercised' else 'converted' end where id = p_id;
  end if;
  perform set_config('app.share_system', 'off', true);
  return v_id;
end;
$$;

revoke execute on all functions in schema app from public, anon;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
grant execute on function app.can_store_dd_upload(text) to anon, authenticated, service_role;
grant execute on function app.can_read_ownership(uuid) to authenticated;
revoke execute on function public.issue_from_instrument(text, uuid, uuid, uuid, bigint, numeric, date, text, uuid) from public, anon;
grant execute on function public.issue_from_instrument(text, uuid, uuid, uuid, bigint, numeric, date, text, uuid) to authenticated;

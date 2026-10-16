-- 0044: Ownership. The register of members, share classes, and startup mode.
--
-- Register of members (Corporations Act s 168 and s 169): every company in
-- the group keeps a register of who holds its shares, of which class, how
-- many, the amounts paid and unpaid, and whether they are held for someone
-- else. Holdings are never typed in: they are worked out from the history of
-- share movements (issues, transfers, buy-backs, cancellations, redemptions,
-- conversions, splits and consolidations), so every number can be traced to
-- the event and the board approval behind it. A movement cannot be edited
-- once recorded, only voided with a reason (and the history keeps it). No
-- movement may leave anyone holding fewer than zero shares at any point.
--
-- ASIC: in Australia most changes must be notified to ASIC within 28 days
-- (usually on Form 484). Each movement carries its due date and when it was
-- lodged; anything overdue feeds the Risk Register and appears under For you.
--
-- Startup mode (a switch on each company) adds:
--   * the ESOP: plans, pool sizes and grants with vesting, leaver terms and
--     expiry; exercising a grant issues the shares through the register;
--   * convertibles: SAFEs, convertible notes, warrants and investor options
--     with their basic terms; converting one issues the shares the same way;
--   * investor rights on each share class: liquidation preference, ranking,
--     participation, anti-dilution, conversion, pro-rata, board seats,
--     information rights, redemption; and the shareholders' agreement terms
--     that affect an exit (drag, tag, first refusal, pre-emption);
--   * investor reserved matters, which gate contract approval: a contract
--     that needs investor consent cannot be approved until the consent is
--     recorded. A contract with no value recorded is treated as needing it
--     when a value threshold applies (unknown is never green);
--   * the employee share scheme reporting dates (statements by 14 July, the
--     ATO report by 14 August) for each year in which grants were made.
--
-- Who can see it: owners, administrators, the secretary, legal, compliance,
-- directors and auditors. Who can change it: owners, administrators, the
-- secretary, legal and compliance.

alter table public.entities add column if not exists startup_mode boolean not null default false;
grant update (startup_mode) on public.entities to authenticated;
grant select (startup_mode) on public.entities to authenticated;

create or replace function app.can_read_ownership(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, app.board_read_roles()) or app.has_role(p_org, array['auditor']::public.member_role[]);
$$;

-- ---------------------------------------------------------------------
-- Share classes, with investor rights
-- ---------------------------------------------------------------------
create table public.share_classes (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  entity_id             uuid not null references public.entities (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 1 and 100),
  code                  text check (code is null or char_length(code) <= 12),
  kind                  text not null default 'ordinary' check (kind in ('ordinary', 'preference', 'other')),
  votes_per_share       numeric(10,4) not null default 1 check (votes_per_share >= 0),
  dividend_rights       text,
  capital_rights        text,
  other_rights          text,
  issue_price           numeric(18,6) check (issue_price is null or issue_price >= 0),   -- original issue price, the base of a liquidation preference
  currency              text not null default 'AUD',
  -- Investor rights
  liq_pref_multiple     numeric(8,3) check (liq_pref_multiple is null or liq_pref_multiple >= 0),
  liq_participation     text check (liq_participation is null or liq_participation in ('non_participating', 'participating', 'capped')),
  liq_cap_multiple      numeric(8,3) check (liq_cap_multiple is null or liq_cap_multiple > 0),
  liq_seniority         integer check (liq_seniority is null or liq_seniority between 1 and 20),   -- 1 is paid first
  anti_dilution         text check (anti_dilution is null or anti_dilution in ('none', 'broad_based', 'narrow_based', 'full_ratchet')),
  converts_to_class_id  uuid references public.share_classes (id) on delete set null,
  conversion_ratio      numeric(18,8) not null default 1 check (conversion_ratio > 0),     -- shares of the other class for each share
  auto_conversion       text,          -- when it converts automatically (for example on an IPO)
  dividend_preference   text,
  pro_rata              text,
  board_seats           integer check (board_seats is null or board_seats between 0 and 20),
  information_rights    text,
  redemption            text,
  rights_source         text,          -- where the rights come from: constitution, shareholders' agreement, clause
  is_active             boolean not null default true,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (entity_id, name),
  check (liq_participation is distinct from 'capped' or liq_cap_multiple is not null)
);
create index share_classes_entity_idx on public.share_classes (entity_id);

-- Shareholders' agreement terms that affect an exit (one row per company)
create table public.ownership_terms (
  entity_id        uuid primary key references public.entities (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  agreement_dated  date,
  drag_along       text,
  tag_along        text,
  first_refusal    text,
  pre_emptive      text,
  exit_consents    text,     -- consents needed for a sale or IPO
  other_terms      text,
  updated_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Shareholders (members)
-- ---------------------------------------------------------------------
create table public.shareholders (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  entity_id         uuid not null references public.entities (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 300),
  kind              text not null default 'individual' check (kind in ('individual', 'company', 'trust', 'fund', 'other')),
  address           text,
  email             text,
  registration      text,        -- ACN, ABN or overseas number
  holder_entity_id  uuid references public.entities (id) on delete set null,   -- when the holder is in the group
  person_id         uuid references public.people (id) on delete set null,
  is_beneficial     boolean not null default true,
  held_for          text,        -- when not beneficial: for whom (s 169(5))
  notes             text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (is_beneficial or held_for is not null)
);
create index shareholders_entity_idx on public.shareholders (entity_id);

-- ---------------------------------------------------------------------
-- Share movements: the history the register is built from
-- ---------------------------------------------------------------------
create table public.share_movements (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  entity_id             uuid not null references public.entities (id) on delete cascade,
  kind                  text not null check (kind in ('issue', 'transfer', 'buy_back', 'cancellation', 'redemption', 'conversion', 'split', 'consolidation')),
  class_id              uuid not null references public.share_classes (id) on delete restrict,
  shares                bigint check (shares is null or shares > 0),
  from_holder_id        uuid references public.shareholders (id) on delete restrict,
  to_holder_id          uuid references public.shareholders (id) on delete restrict,
  to_class_id           uuid references public.share_classes (id) on delete restrict,    -- conversion
  to_shares             bigint check (to_shares is null or to_shares > 0),               -- conversion
  ratio_from            integer check (ratio_from is null or ratio_from > 0),            -- split or consolidation: ratio_from become ratio_to
  ratio_to              integer check (ratio_to is null or ratio_to > 0),
  price_per_share       numeric(18,6) check (price_per_share is null or price_per_share >= 0),
  paid_per_share        numeric(18,6) check (paid_per_share is null or paid_per_share >= 0),
  unpaid_per_share      numeric(18,6) not null default 0 check (unpaid_per_share >= 0),
  consideration         text,
  effective_on          date not null,
  resolution_id         uuid references public.resolutions (id) on delete set null,
  approval_note         text,          -- approval made outside the app (for example a circular resolution)
  certificate_number    text,
  cancelled_certificate text,
  asic_due_on           date,
  asic_lodged_on        date,
  asic_reference        text,
  esop_grant_id         uuid,
  convertible_id        uuid,
  notes                 text,
  voided_at             timestamptz,
  voided_by             uuid references auth.users (id) on delete set null,
  void_reason           text,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now()
);
create index share_movements_entity_idx on public.share_movements (entity_id, effective_on, created_at);

-- Replays the movements of one company in order and returns each holding.
-- Raises if any movement would take a holding below zero, or leave a
-- fraction of a share after a split or consolidation.
create or replace function app.share_positions(p_entity uuid, p_as_of date default null)
returns table (shareholder_id uuid, class_id uuid, shares numeric, paid numeric, unpaid numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  m record;
  pos jsonb := '{}'::jsonb;
  k text;
  k2 text;
  cur jsonb;
  have numeric;
  part numeric;
  p numeric;
  u numeric;
  hname text;
begin
  for m in
    select * from public.share_movements x
    where x.entity_id = p_entity and x.voided_at is null and (p_as_of is null or x.effective_on <= p_as_of)
    order by x.effective_on, x.created_at, x.id
  loop
    if m.kind in ('split', 'consolidation') then
      for k in select jsonb_object_keys(pos) loop
        if split_part(k, '|', 2) = m.class_id::text then
          cur := pos -> k;
          part := (cur ->> 's')::numeric * m.ratio_to / m.ratio_from;
          if part <> trunc(part) then
            select s.name into hname from public.shareholders s where s.id = split_part(k, '|', 1)::uuid;
            raise exception 'The % on % would leave % with a fraction of a share. Record a transfer or issue to round the holding first.',
              m.kind, to_char(m.effective_on, 'FMDD Mon YYYY'), hname;
          end if;
          pos := jsonb_set(pos, array[k], jsonb_build_object('s', part, 'p', cur -> 'p', 'u', cur -> 'u'));
        end if;
      end loop;
      continue;
    end if;

    -- Take shares away from the holder first (all kinds except issue)
    if m.kind <> 'issue' then
      k := m.from_holder_id::text || '|' || m.class_id::text;
      cur := coalesce(pos -> k, '{"s":0,"p":0,"u":0}'::jsonb);
      have := (cur ->> 's')::numeric;
      if have < m.shares then
        select s.name into hname from public.shareholders s where s.id = m.from_holder_id;
        raise exception '% would hold fewer than zero shares after the % on % (holds %, moving %)',
          hname, replace(m.kind, '_', '-'), to_char(m.effective_on, 'FMDD Mon YYYY'), have, m.shares;
      end if;
      p := (cur ->> 'p')::numeric * m.shares / have;
      u := (cur ->> 'u')::numeric * m.shares / have;
      if have = m.shares then
        pos := pos - k;
      else
        pos := jsonb_set(pos, array[k], jsonb_build_object('s', have - m.shares, 'p', (cur ->> 'p')::numeric - p, 'u', (cur ->> 'u')::numeric - u));
      end if;
    else
      p := m.shares * coalesce(m.paid_per_share, m.price_per_share, 0);
      u := m.shares * m.unpaid_per_share;
    end if;

    -- Give them to the receiver
    if m.kind in ('issue', 'transfer') then
      k2 := m.to_holder_id::text || '|' || m.class_id::text;
      cur := coalesce(pos -> k2, '{"s":0,"p":0,"u":0}'::jsonb);
      pos := jsonb_set(pos, array[k2], jsonb_build_object('s', (cur ->> 's')::numeric + m.shares, 'p', (cur ->> 'p')::numeric + p, 'u', (cur ->> 'u')::numeric + u));
    elsif m.kind = 'conversion' then
      k2 := m.from_holder_id::text || '|' || m.to_class_id::text;
      cur := coalesce(pos -> k2, '{"s":0,"p":0,"u":0}'::jsonb);
      pos := jsonb_set(pos, array[k2], jsonb_build_object('s', (cur ->> 's')::numeric + m.to_shares, 'p', (cur ->> 'p')::numeric + p, 'u', (cur ->> 'u')::numeric + u));
    end if;
  end loop;

  return query
  select split_part(e.key, '|', 1)::uuid, split_part(e.key, '|', 2)::uuid,
         round((e.value ->> 's')::numeric), round((e.value ->> 'p')::numeric, 2), round((e.value ->> 'u')::numeric, 2)
  from jsonb_each(pos) e
  where (e.value ->> 's')::numeric > 0;
end;
$$;

create or replace function public.share_register(p_entity uuid, p_as_of date default null)
returns table (shareholder_id uuid, class_id uuid, shares numeric, paid numeric, unpaid numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select e.organisation_id into v_org from public.entities e where e.id = p_entity;
  if v_org is null or not app.can_read_ownership(v_org) then
    raise exception 'You do not have permission to see this register';
  end if;
  return query select * from app.share_positions(p_entity, p_as_of);
end;
$$;

create or replace function app.guard_share_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  e public.entities%rowtype;
begin
  if tg_op = 'UPDATE' then
    if current_setting('app.share_system', true) is distinct from 'on' and (
         new.organisation_id, new.entity_id, new.kind, new.class_id, new.shares, new.from_holder_id, new.to_holder_id, new.to_class_id, new.to_shares,
         new.ratio_from, new.ratio_to, new.price_per_share, new.paid_per_share, new.unpaid_per_share, new.consideration, new.effective_on,
         new.asic_due_on, new.esop_grant_id, new.convertible_id, new.voided_at, new.voided_by, new.void_reason, new.created_by, new.created_at)
       is distinct from (
         old.organisation_id, old.entity_id, old.kind, old.class_id, old.shares, old.from_holder_id, old.to_holder_id, old.to_class_id, old.to_shares,
         old.ratio_from, old.ratio_to, old.price_per_share, old.paid_per_share, old.unpaid_per_share, old.consideration, old.effective_on,
         old.asic_due_on, old.esop_grant_id, old.convertible_id, old.voided_at, old.voided_by, old.void_reason, old.created_by, old.created_at) then
      raise exception 'A share movement cannot be changed once recorded. Void it with a reason and record it again.';
    end if;
    if new.resolution_id is not null and new.resolution_id is distinct from old.resolution_id
       and not exists (select 1 from public.resolutions r where r.id = new.resolution_id and r.organisation_id = new.organisation_id) then
      raise exception 'That resolution is not in this organisation';
    end if;
    if new.asic_lodged_on is not null and new.asic_lodged_on > current_date then
      raise exception 'The lodgement date cannot be in the future';
    end if;
    return new;
  end if;

  select * into e from public.entities x where x.id = new.entity_id;
  if e.id is null or e.organisation_id <> new.organisation_id then
    raise exception 'That company is not in this organisation';
  end if;
  if not exists (select 1 from public.share_classes c where c.id = new.class_id and c.entity_id = new.entity_id) then
    raise exception 'That share class does not belong to this company';
  end if;
  if new.to_class_id is not null and not exists (select 1 from public.share_classes c where c.id = new.to_class_id and c.entity_id = new.entity_id) then
    raise exception 'The new share class does not belong to this company';
  end if;
  if (new.from_holder_id is not null and not exists (select 1 from public.shareholders s where s.id = new.from_holder_id and s.entity_id = new.entity_id))
     or (new.to_holder_id is not null and not exists (select 1 from public.shareholders s where s.id = new.to_holder_id and s.entity_id = new.entity_id)) then
    raise exception 'That shareholder is not on this company''s register';
  end if;
  if new.resolution_id is not null and not exists (select 1 from public.resolutions r where r.id = new.resolution_id and r.organisation_id = new.organisation_id) then
    raise exception 'That resolution is not in this organisation';
  end if;
  if new.effective_on > current_date then
    raise exception 'A share movement cannot be dated in the future. Record it on the day it happens.';
  end if;

  if new.kind in ('split', 'consolidation') then
    if new.ratio_from is null or new.ratio_to is null then
      raise exception 'Give the ratio (for example 1 share becomes 10)';
    end if;
    if (new.kind = 'split' and new.ratio_to <= new.ratio_from) or (new.kind = 'consolidation' and new.ratio_to >= new.ratio_from) then
      raise exception 'A split makes more shares and a consolidation fewer: check the ratio';
    end if;
    new.shares := null; new.from_holder_id := null; new.to_holder_id := null;
  else
    if new.shares is null then
      raise exception 'Give the number of shares';
    end if;
    if new.kind = 'issue' then
      if new.to_holder_id is null then raise exception 'Say who the shares were issued to'; end if;
      if new.paid_per_share is null and new.price_per_share is null then
        raise exception 'Give the issue price and the amount paid per share (0 if nothing was paid)';
      end if;
      new.from_holder_id := null;
    elsif new.kind = 'transfer' then
      if new.from_holder_id is null or new.to_holder_id is null then raise exception 'Say who transferred the shares and who received them'; end if;
      if new.from_holder_id = new.to_holder_id then raise exception 'A transfer needs two different shareholders'; end if;
    elsif new.kind = 'conversion' then
      if new.from_holder_id is null or new.to_class_id is null or new.to_shares is null then
        raise exception 'Say whose shares converted, into which class, and how many shares they became';
      end if;
      if new.to_class_id = new.class_id then raise exception 'A conversion must be into a different class'; end if;
      new.to_holder_id := null;
    else
      if new.from_holder_id is null then raise exception 'Say whose shares were bought back, cancelled or redeemed'; end if;
      new.to_holder_id := null;
    end if;
  end if;

  -- ASIC notice: usually Form 484 within 28 days. Transfers only for proprietary companies.
  new.asic_due_on := case when upper(coalesce(e.jurisdiction, 'AU')) in ('AU', 'AUS', 'AUSTRALIA')
                            and (new.kind <> 'transfer' or e.legal_form = 'proprietary_company')
                          then new.effective_on + 28 end;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.voided_at := null; new.voided_by := null; new.void_reason := null;
  return new;
end;
$$;
create trigger share_movements_guard before insert or update on public.share_movements for each row execute function app.guard_share_movement();

-- After any change, replay the company's history: raises if a holding goes below zero
create or replace function app.check_share_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from app.share_positions(new.entity_id, null);
  return null;
end;
$$;
create trigger share_movements_check after insert or update on public.share_movements for each row execute function app.check_share_history();

create or replace function public.void_share_movement(p_movement uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select m.organisation_id into v_org from public.share_movements m where m.id = p_movement and m.voided_at is null;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'You do not have permission to void this movement';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why it is being voided';
  end if;
  perform set_config('app.share_system', 'on', true);
  update public.share_movements set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where id = p_movement;
  perform set_config('app.share_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- ESOP
-- ---------------------------------------------------------------------
create table public.esop_plans (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  entity_id           uuid not null references public.entities (id) on delete cascade,
  name                text not null check (char_length(btrim(name)) between 2 and 200),
  class_id            uuid references public.share_classes (id) on delete set null,   -- the shares granted options convert into
  pool_size           bigint not null check (pool_size > 0),
  adopted_on          date,
  resolution_id       uuid references public.resolutions (id) on delete set null,
  startup_concession  boolean,       -- relies on the startup tax concession (unknown if not answered)
  notes               text,
  status              text not null default 'active' check (status in ('active', 'closed')),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.esop_grants (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  entity_id         uuid not null references public.entities (id) on delete cascade,
  plan_id           uuid not null references public.esop_plans (id) on delete restrict,
  holder_name       text not null check (char_length(btrim(holder_name)) between 1 and 300),
  person_id         uuid references public.people (id) on delete set null,
  instrument        text not null default 'option' check (instrument in ('option', 'right', 'share')),
  number            bigint not null check (number > 0),
  exercise_price    numeric(18,6) not null default 0 check (exercise_price >= 0),
  granted_on        date not null,
  vesting_start_on  date,
  vesting_months    integer check (vesting_months is null or vesting_months between 0 and 240),
  cliff_months      integer check (cliff_months is null or cliff_months between 0 and 120),
  vesting_every     text not null default 'monthly' check (vesting_every in ('monthly', 'quarterly', 'annually')),
  acceleration      text,
  leaver_terms      text,
  expires_on        date,
  exercised         bigint not null default 0 check (exercised >= 0),
  lapsed            bigint not null default 0 check (lapsed >= 0),
  resolution_id     uuid references public.resolutions (id) on delete set null,
  notes             text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (exercised + lapsed <= number),
  check (cliff_months is null or vesting_months is null or cliff_months <= vesting_months)
);
create index esop_grants_plan_idx on public.esop_grants (plan_id);

create or replace function app.guard_esop()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.esop_plans%rowtype;
  v_used bigint;
begin
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if new.resolution_id is not null and not exists (select 1 from public.resolutions r where r.id = new.resolution_id and r.organisation_id = new.organisation_id) then
    raise exception 'That resolution is not in this organisation';
  end if;
  if tg_table_name = 'esop_plans' then
    if new.class_id is not null and not exists (select 1 from public.share_classes c where c.id = new.class_id and c.entity_id = new.entity_id) then
      raise exception 'That share class does not belong to this company';
    end if;
    if tg_op = 'UPDATE' then
      select coalesce(sum(g.number - g.lapsed), 0) into v_used from public.esop_grants g where g.plan_id = new.id;
      if new.pool_size < v_used then
        raise exception 'The pool cannot be smaller than what has already been granted (%)', v_used;
      end if;
    end if;
  else
    select * into v_plan from public.esop_plans p where p.id = new.plan_id;
    if v_plan.entity_id is distinct from new.entity_id then
      raise exception 'That plan is not for this company';
    end if;
    if tg_op = 'UPDATE' and current_setting('app.share_system', true) is distinct from 'on' and new.exercised <> old.exercised then
      raise exception 'Exercise a grant through Exercise, so the shares are issued on the register';
    end if;
    if new.person_id is not null and not exists (select 1 from public.people p where p.id = new.person_id and p.organisation_id = new.organisation_id) then
      raise exception 'That person is not in this organisation';
    end if;
    select coalesce(sum(g.number - g.lapsed), 0) into v_used from public.esop_grants g where g.plan_id = new.plan_id and g.id <> new.id;
    if v_used + new.number - new.lapsed > v_plan.pool_size then
      raise exception 'This grant would take the plan past its pool of % (% already granted)', v_plan.pool_size, v_used;
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;
create trigger esop_plans_guard before insert or update on public.esop_plans for each row execute function app.guard_esop();
create trigger esop_grants_guard before insert or update on public.esop_grants for each row execute function app.guard_esop();

-- ---------------------------------------------------------------------
-- Convertibles: SAFEs, notes, warrants and investor options
-- ---------------------------------------------------------------------
create table public.convertibles (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  entity_id           uuid not null references public.entities (id) on delete cascade,
  kind                text not null check (kind in ('safe', 'convertible_note', 'warrant', 'investor_option', 'other')),
  holder_name         text not null check (char_length(btrim(holder_name)) between 1 and 300),
  principal           numeric(18,2) check (principal is null or principal >= 0),
  currency            text not null default 'AUD',
  valuation_cap       numeric(18,2) check (valuation_cap is null or valuation_cap > 0),
  discount_pct        numeric(5,2) check (discount_pct is null or (discount_pct >= 0 and discount_pct < 100)),
  interest_rate       numeric(6,3) check (interest_rate is null or interest_rate >= 0),
  issued_on           date,
  maturity_on         date,
  conversion_trigger  text,
  converts_class_id   uuid references public.share_classes (id) on delete set null,
  mfn                 boolean,
  shares              bigint check (shares is null or shares > 0),          -- warrants and options: how many
  exercise_price      numeric(18,6) check (exercise_price is null or exercise_price >= 0),
  expires_on          date,
  status              text not null default 'outstanding' check (status in ('outstanding', 'converted', 'exercised', 'repaid', 'lapsed', 'cancelled')),
  resolution_id       uuid references public.resolutions (id) on delete set null,
  notes               text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index convertibles_entity_idx on public.convertibles (entity_id);

create or replace function app.guard_convertible()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if new.converts_class_id is not null and not exists (select 1 from public.share_classes c where c.id = new.converts_class_id and c.entity_id = new.entity_id) then
    raise exception 'That share class does not belong to this company';
  end if;
  if new.resolution_id is not null and not exists (select 1 from public.resolutions r where r.id = new.resolution_id and r.organisation_id = new.organisation_id) then
    raise exception 'That resolution is not in this organisation';
  end if;
  if new.kind in ('warrant', 'investor_option') and new.shares is null then
    raise exception 'Give the number of shares the % covers', replace(new.kind, '_', ' ');
  end if;
  if new.kind in ('safe', 'convertible_note') and new.principal is null then
    raise exception 'Give the amount invested';
  end if;
  if new.status in ('converted', 'exercised') and current_setting('app.share_system', true) is distinct from 'on'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'Convert or exercise through the register, so the shares are issued';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;
create trigger convertibles_guard before insert or update on public.convertibles for each row execute function app.guard_convertible();

-- Exercise an ESOP grant, or convert or exercise a convertible: issues the shares on the register
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
    if p_shares > g.number - g.exercised - g.lapsed then
      raise exception 'Only % remain under this grant', g.number - g.exercised - g.lapsed;
    end if;
    v_paid := coalesce(p_price, g.exercise_price);
  else
    if c.status <> 'outstanding' then
      raise exception 'This instrument is no longer outstanding';
    end if;
    -- For a SAFE or note the investment pays for the shares
    v_paid := coalesce(p_price, case when c.kind in ('safe', 'convertible_note') then round(c.principal / p_shares, 6) else c.exercise_price end, 0);
  end if;

  insert into public.share_movements (organisation_id, entity_id, kind, class_id, shares, to_holder_id, price_per_share, paid_per_share, effective_on,
                                      resolution_id, certificate_number, esop_grant_id, convertible_id, consideration)
  values (v_org, v_entity, 'issue', p_class, p_shares, p_shareholder, v_paid, v_paid, p_effective_on, p_resolution, nullif(btrim(coalesce(p_certificate, '')), ''),
          case when p_source = 'esop_grants' then p_id end, case when p_source = 'convertibles' then p_id end,
          case when p_source = 'esop_grants' then 'Exercise of ESOP grant to ' || g.holder_name
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

-- Employee share scheme reporting: one row per company per financial year (year ending 30 June)
create table public.ess_reports (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  entity_id            uuid not null references public.entities (id) on delete cascade,
  fy_end               integer not null check (fy_end between 2000 and 2100),
  statements_given_on  date,
  ato_lodged_on        date,
  notes                text,
  updated_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  unique (entity_id, fy_end)
);

-- ---------------------------------------------------------------------
-- Investor reserved matters and consents
-- ---------------------------------------------------------------------
create table public.reserved_matters (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete cascade,
  entity_id              uuid not null references public.entities (id) on delete cascade,
  matter                 text not null check (char_length(btrim(matter)) between 3 and 500),
  consent_from           text not null check (char_length(btrim(consent_from)) between 2 and 200),   -- for example "Series A majority"
  class_id               uuid references public.share_classes (id) on delete set null,
  clause                 text,
  all_contracts          boolean not null default false,
  contracts_from         numeric(18,2) check (contracts_from is null or contracts_from >= 0),    -- contracts of this value or more
  related_party          boolean not null default false,                                        -- contracts with group companies
  share_issues           boolean not null default false,                                        -- issuing shares, options or convertibles
  is_active              boolean not null default true,
  notes                  text,
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index reserved_matters_entity_idx on public.reserved_matters (entity_id) where is_active;

create table public.investor_consents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_id        uuid not null references public.entities (id) on delete cascade,
  matter_id        uuid not null references public.reserved_matters (id) on delete restrict,
  subject_table    text not null check (subject_table in ('contracts', 'share_movements', 'esop_grants', 'convertibles')),
  subject_id       uuid not null,
  given_by         text not null check (char_length(btrim(given_by)) between 2 and 300),
  given_on         date not null,
  notes            text,
  recorded_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (matter_id, subject_table, subject_id)
);

-- Reserved matters a contract triggers that have no consent yet
create or replace function app.contract_consents_missing(p_contract uuid)
returns table (matter_id uuid, matter text, consent_from text, reason text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.matter, m.consent_from,
         case when m.all_contracts then 'every contract'
              when m.related_party and c.is_intragroup then 'a contract with a group company'
              when c.value_amount is null then 'contracts of ' || to_char(m.contracts_from, 'FM999,999,999,990') || ' or more, and this contract has no value recorded'
              else 'contracts of ' || to_char(m.contracts_from, 'FM999,999,999,990') || ' or more' end
  from public.contracts c
  join public.entities e on e.id = c.entity_id and e.startup_mode
  join public.reserved_matters m on m.entity_id = c.entity_id and m.is_active
  where c.id = p_contract
    and (m.all_contracts
         or (m.related_party and c.is_intragroup)
         or (m.contracts_from is not null and (c.value_amount is null or c.value_amount >= m.contracts_from)))
    and not exists (select 1 from public.investor_consents ic where ic.matter_id = m.id and ic.subject_table = 'contracts' and ic.subject_id = c.id);
$$;

create or replace function app.guard_ownership_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if tg_op = 'UPDATE' and (new.entity_id <> old.entity_id or new.organisation_id <> old.organisation_id) then
    raise exception 'A record cannot move to another company';
  end if;
  if tg_table_name = 'share_classes' then
    if new.converts_to_class_id is not null and (new.converts_to_class_id = new.id
       or not exists (select 1 from public.share_classes c where c.id = new.converts_to_class_id and c.entity_id = new.entity_id)) then
      raise exception 'A class can only convert into another class of the same company';
    end if;
  elsif tg_table_name = 'shareholders' then
    if new.holder_entity_id is not null and not exists (select 1 from public.entities e where e.id = new.holder_entity_id and e.organisation_id = new.organisation_id) then
      raise exception 'That group company is not in this organisation';
    end if;
    if new.holder_entity_id = new.entity_id then
      raise exception 'A company cannot be its own shareholder';
    end if;
    if new.person_id is not null and not exists (select 1 from public.people p where p.id = new.person_id and p.organisation_id = new.organisation_id) then
      raise exception 'That person is not in this organisation';
    end if;
  elsif tg_table_name = 'reserved_matters' then
    if new.class_id is not null and not exists (select 1 from public.share_classes c where c.id = new.class_id and c.entity_id = new.entity_id) then
      raise exception 'That share class does not belong to this company';
    end if;
    if not (new.all_contracts or new.contracts_from is not null or new.related_party or new.share_issues) then
      -- A matter that the app cannot detect is still recorded, for reference
      null;
    end if;
  elsif tg_table_name = 'investor_consents' then
    if not exists (select 1 from public.reserved_matters m where m.id = new.matter_id and m.entity_id = new.entity_id) then
      raise exception 'That reserved matter is not for this company';
    end if;
    if new.given_on > current_date then
      raise exception 'The consent date cannot be in the future';
    end if;
    if (new.subject_table = 'contracts' and not exists (select 1 from public.contracts x where x.id = new.subject_id and x.entity_id = new.entity_id))
       or (new.subject_table = 'share_movements' and not exists (select 1 from public.share_movements x where x.id = new.subject_id and x.entity_id = new.entity_id))
       or (new.subject_table = 'esop_grants' and not exists (select 1 from public.esop_grants x where x.id = new.subject_id and x.entity_id = new.entity_id))
       or (new.subject_table = 'convertibles' and not exists (select 1 from public.convertibles x where x.id = new.subject_id and x.entity_id = new.entity_id)) then
      raise exception 'That record is not for this company';
    end if;
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    return new;
  end if;
  if tg_table_name in ('ownership_terms', 'ess_reports') then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  elsif tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;
create trigger share_classes_guard before insert or update on public.share_classes for each row execute function app.guard_ownership_row();
create trigger shareholders_guard before insert or update on public.shareholders for each row execute function app.guard_ownership_row();
create trigger ownership_terms_guard before insert or update on public.ownership_terms for each row execute function app.guard_ownership_row();
create trigger ess_reports_guard before insert or update on public.ess_reports for each row execute function app.guard_ownership_row();
create trigger reserved_matters_guard before insert or update on public.reserved_matters for each row execute function app.guard_ownership_row();
create trigger investor_consents_guard before insert on public.investor_consents for each row execute function app.guard_ownership_row();

-- ---------------------------------------------------------------------
-- Contract approval: investor consent gate
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.decide_contract_approval(uuid, boolean, text)'::regprocedure);
  if v_def not like '%contract_consents_missing%' then
    v_def := replace(v_def, $x$    end;
  end if;

  update public.contract_approvals$x$, $x$    end;
    declare
      rm record;
    begin
      select * into rm from app.contract_consents_missing(v_a.contract_id) limit 1;
      if rm.matter_id is not null then
        raise exception 'Blocked: investor consent is needed from % (%: %). Record the consent first.', rm.consent_from, rm.matter, rm.reason using errcode = 'P0001';
      end if;
    end;
  end if;

  update public.contract_approvals$x$);
    if v_def not like '%contract_consents_missing%' then
      raise exception 'Could not extend public.decide_contract_approval';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Ladder up: ASIC notices overdue
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%share_movements%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- Ownership: an ASIC notice of a share change not lodged by its due date
    select 'share_movements', sm.id, 'Ownership', v_legal,
           'ASIC notice overdue: ' || replace(initcap(replace(sm.kind, '_', ' ')), 'Buy Back', 'Buy-back') || ' of shares in ' || en.name
           || ', ' || to_char(sm.effective_on, 'FMDD Mon YYYY') || E'\n' || 'Due ' || to_char(sm.asic_due_on, 'FMDD Mon YYYY') || ' (usually Form 484). Late fees apply.',
           'Lodge the notice with ASIC and record the date',
           null::text,
           sm.asic_due_on
    from public.share_movements sm join public.entities en on en.id = sm.entity_id
    where sm.organisation_id = v_org and sm.voided_at is null and sm.asic_lodged_on is null
      and sm.asic_due_on is not null and sm.asic_due_on < current_date
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%share_movements%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: transfer forms, certificates, plan rules, offer letters, notes, consents
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%share_movements%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''share_movements'', ''share_classes'', ''esop_plans'', ''esop_grants'', ''convertibles'', ''investor_consents''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%share_movements%' then
    v_def := replace(v_def, $x$  else
    raise exception 'Files cannot be attached to that kind of record';$x$, $x$  elsif p_table in ('share_movements', 'share_classes', 'esop_plans', 'esop_grants', 'convertibles', 'investor_consents') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    v_ok := v_org is not null and app.has_role(v_org, app.records_roles());
  else
    raise exception 'Files cannot be attached to that kind of record';$x$);
    if v_def not like '%share_movements%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%share_movements%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.share_classes, public.ownership_terms, public.shareholders, public.share_movements, public.esop_plans, public.esop_grants,
  public.convertibles, public.ess_reports, public.reserved_matters, public.investor_consents from anon, authenticated;
grant select on public.share_classes, public.ownership_terms, public.shareholders, public.share_movements, public.esop_plans, public.esop_grants,
  public.convertibles, public.ess_reports, public.reserved_matters, public.investor_consents to authenticated;
grant insert (organisation_id, entity_id, name, code, kind, votes_per_share, dividend_rights, capital_rights, other_rights, issue_price, currency,
              liq_pref_multiple, liq_participation, liq_cap_multiple, liq_seniority, anti_dilution, converts_to_class_id, conversion_ratio, auto_conversion,
              dividend_preference, pro_rata, board_seats, information_rights, redemption, rights_source, is_active),
      update (name, code, kind, votes_per_share, dividend_rights, capital_rights, other_rights, issue_price, currency,
              liq_pref_multiple, liq_participation, liq_cap_multiple, liq_seniority, anti_dilution, converts_to_class_id, conversion_ratio, auto_conversion,
              dividend_preference, pro_rata, board_seats, information_rights, redemption, rights_source, is_active)
  on public.share_classes to authenticated;
grant insert (entity_id, organisation_id, agreement_dated, drag_along, tag_along, first_refusal, pre_emptive, exit_consents, other_terms),
      update (agreement_dated, drag_along, tag_along, first_refusal, pre_emptive, exit_consents, other_terms)
  on public.ownership_terms to authenticated;
grant insert (organisation_id, entity_id, name, kind, address, email, registration, holder_entity_id, person_id, is_beneficial, held_for, notes),
      update (name, kind, address, email, registration, holder_entity_id, person_id, is_beneficial, held_for, notes)
  on public.shareholders to authenticated;
grant insert (organisation_id, entity_id, kind, class_id, shares, from_holder_id, to_holder_id, to_class_id, to_shares, ratio_from, ratio_to,
              price_per_share, paid_per_share, unpaid_per_share, consideration, effective_on, resolution_id, approval_note, certificate_number,
              cancelled_certificate, asic_lodged_on, asic_reference, notes),
      update (resolution_id, approval_note, certificate_number, cancelled_certificate, asic_lodged_on, asic_reference, notes)
  on public.share_movements to authenticated;
grant insert (organisation_id, entity_id, name, class_id, pool_size, adopted_on, resolution_id, startup_concession, notes, status),
      update (name, class_id, pool_size, adopted_on, resolution_id, startup_concession, notes, status)
  on public.esop_plans to authenticated;
grant insert (organisation_id, entity_id, plan_id, holder_name, person_id, instrument, number, exercise_price, granted_on, vesting_start_on, vesting_months,
              cliff_months, vesting_every, acceleration, leaver_terms, expires_on, lapsed, resolution_id, notes),
      update (holder_name, person_id, instrument, number, exercise_price, granted_on, vesting_start_on, vesting_months,
              cliff_months, vesting_every, acceleration, leaver_terms, expires_on, lapsed, resolution_id, notes)
  on public.esop_grants to authenticated;
grant insert (organisation_id, entity_id, kind, holder_name, principal, currency, valuation_cap, discount_pct, interest_rate, issued_on, maturity_on,
              conversion_trigger, converts_class_id, mfn, shares, exercise_price, expires_on, status, resolution_id, notes),
      update (holder_name, principal, currency, valuation_cap, discount_pct, interest_rate, issued_on, maturity_on,
              conversion_trigger, converts_class_id, mfn, shares, exercise_price, expires_on, status, resolution_id, notes)
  on public.convertibles to authenticated;
grant insert (organisation_id, entity_id, fy_end, statements_given_on, ato_lodged_on, notes),
      update (statements_given_on, ato_lodged_on, notes)
  on public.ess_reports to authenticated;
grant insert (organisation_id, entity_id, matter, consent_from, class_id, clause, all_contracts, contracts_from, related_party, share_issues, is_active, notes),
      update (matter, consent_from, class_id, clause, all_contracts, contracts_from, related_party, share_issues, is_active, notes)
  on public.reserved_matters to authenticated;
grant insert (organisation_id, entity_id, matter_id, subject_table, subject_id, given_by, given_on, notes)
  on public.investor_consents to authenticated;
grant all on public.share_classes, public.ownership_terms, public.shareholders, public.share_movements, public.esop_plans, public.esop_grants,
  public.convertibles, public.ess_reports, public.reserved_matters, public.investor_consents to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['share_classes', 'ownership_terms', 'shareholders', 'share_movements', 'esop_plans', 'esop_grants',
                           'convertibles', 'ess_reports', 'reserved_matters', 'investor_consents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.can_read_ownership(organisation_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()))', t || '_insert', t);
    if t <> 'investor_consents' then
      execute format('create policy %I on public.%I for update to authenticated using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()))', t || '_update', t);
    end if;
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
    if t not in ('ownership_terms', 'ess_reports', 'share_movements', 'investor_consents') then
      execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    end if;
  end loop;
end;
$$;

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
grant execute on function app.can_store_dd_upload(text) to anon, authenticated, service_role;
revoke execute on function public.share_register(uuid, date), public.void_share_movement(uuid, text),
  public.issue_from_instrument(text, uuid, uuid, uuid, bigint, numeric, date, text, uuid) from public, anon;
grant execute on function public.share_register(uuid, date), public.void_share_movement(uuid, text),
  public.issue_from_instrument(text, uuid, uuid, uuid, bigint, numeric, date, text, uuid) to authenticated;
-- The policies call these as the signed-in user
grant execute on function app.can_read_ownership(uuid) to authenticated;

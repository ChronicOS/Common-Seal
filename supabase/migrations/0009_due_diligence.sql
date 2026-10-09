-- =====================================================================
-- Common Seal - 0009: due diligence, gifts and conflicts
--
-- Third parties and customers get a risk rating from a short set of
-- questions, a set of checks by topic (anti-bribery, sanctions, modern
-- slavery, customer identification), and a recorded decision. A party
-- that is rejected, or high risk and not yet cleared, blocks approval
-- of its contracts. Also adds the gifts and hospitality register and
-- the conflicts of interest register.
--
-- Screening results are entered by hand until a screening provider is
-- connected.
-- =====================================================================

create type public.party_kind as enum ('third_party', 'customer');
create type public.risk_level as enum ('low', 'medium', 'high');
create type public.dd_case_status as enum ('open', 'cleared', 'cleared_with_conditions', 'rejected');
create type public.dd_result as enum ('pending', 'clear', 'concern');
create type public.gift_direction as enum ('given', 'received');
create type public.declaration_status as enum ('recorded', 'pending', 'approved', 'declined');
create type public.conflict_status as enum ('open', 'managed', 'closed');

alter table public.counterparties
  add column kind public.party_kind not null default 'third_party',
  add column country text,
  add column risk_rating public.risk_level,
  add column dd_status public.dd_case_status,     -- null = no due diligence on record
  add column next_review_on date;

alter table public.organisations
  add column gift_approval_threshold numeric(12,2) not null default 200 check (gift_approval_threshold >= 0);

-- ---------------------------------------------------------------------
-- Due diligence cases and checks
-- ---------------------------------------------------------------------
create table public.dd_cases (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  counterparty_id  uuid not null references public.counterparties (id) on delete cascade,
  answers          jsonb not null default '{}'::jsonb,
  risk_rating      public.risk_level not null default 'low',
  status           public.dd_case_status not null default 'open',
  conditions       text,
  opened_by        uuid references auth.users (id) on delete set null,
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index dd_cases_one_open_idx on public.dd_cases (counterparty_id) where status = 'open';
create index dd_cases_org_idx on public.dd_cases (organisation_id, created_at desc);

create table public.dd_checks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  case_id          uuid not null references public.dd_cases (id) on delete cascade,
  topic            text not null check (topic in ('abc', 'sanctions', 'modern_slavery', 'aml_kyc')),
  result           public.dd_result not null default 'pending',
  notes            text,
  completed_by     uuid references auth.users (id) on delete set null,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (case_id, topic)
);

-- Rating rules. High: government links, a high-risk country, or acting on
-- our behalf outside a low-risk country. Medium: any one lesser factor.
create or replace function app.dd_rating(p_answers jsonb)
returns public.risk_level language sql immutable set search_path = '' as $$
  select case
    when coalesce((p_answers ->> 'government_links')::boolean, false)
      or p_answers ->> 'country_risk' = 'high'
      or (coalesce((p_answers ->> 'acts_on_our_behalf')::boolean, false)
          and coalesce(p_answers ->> 'country_risk', 'low') <> 'low')
      then 'high'
    when p_answers ->> 'country_risk' = 'medium'
      or coalesce((p_answers ->> 'acts_on_our_behalf')::boolean, false)
      or coalesce((p_answers ->> 'high_risk_sector')::boolean, false)
      or p_answers ->> 'annual_value' = 'over_1m'
      then 'medium'
    else 'low'
  end::public.risk_level;
$$;

create or replace function app.guard_dd_case()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := coalesce(current_setting('app.dd_system', true), 'off') = 'on';
begin
  if not v_system then
    raise exception 'Due diligence cases change only through the due diligence functions';
  end if;
  new.risk_rating := app.dd_rating(new.answers);
  return new;
end;
$$;
create trigger dd_cases_guard before insert or update on public.dd_cases
  for each row execute function app.guard_dd_case();

create or replace function app.guard_dd_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.dd_system', true), 'off') <> 'on' then
      raise exception 'Checks are created when a case is opened';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.dd_cases c where c.id = old.case_id and c.status = 'open') then
    raise exception 'This case has been decided, so its checks are locked';
  end if;
  if new.topic <> old.topic or new.case_id <> old.case_id then
    raise exception 'A check cannot be moved or renamed';
  end if;
  if new.result <> 'pending' then
    new.completed_by := auth.uid();
    new.completed_at := now();
  else
    new.completed_by := null;
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger dd_checks_guard before insert or update on public.dd_checks
  for each row execute function app.guard_dd_check();

-- The rating, status and review date on a party are set by the functions below, not by hand.
create or replace function app.guard_counterparty_dd()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.dd_system', true), 'off') <> 'on' and (
       new.risk_rating is distinct from old.risk_rating
       or new.dd_status is distinct from old.dd_status
       or new.next_review_on is distinct from old.next_review_on) then
    raise exception 'A party''s rating and due diligence status are set by its due diligence case';
  end if;
  return new;
end;
$$;
create trigger counterparties_dd_guard before update on public.counterparties
  for each row execute function app.guard_counterparty_dd();

create or replace function public.open_dd_case(p_counterparty uuid, p_answers jsonb, p_topics text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_case uuid;
  v_rating public.risk_level;
  v_topic text;
begin
  select c.organisation_id into v_org from public.counterparties c where c.id = p_counterparty;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'You do not have permission to open due diligence on this party';
  end if;
  if p_topics is null or cardinality(p_topics) = 0 then
    raise exception 'Choose at least one check';
  end if;
  if exists (select 1 from public.dd_cases d where d.counterparty_id = p_counterparty and d.status = 'open') then
    raise exception 'Due diligence is already open for this party';
  end if;

  perform set_config('app.dd_system', 'on', true);
  insert into public.dd_cases (organisation_id, counterparty_id, answers, opened_by)
  values (v_org, p_counterparty, coalesce(p_answers, '{}'::jsonb), auth.uid())
  returning id, risk_rating into v_case, v_rating;

  foreach v_topic in array (select array_agg(distinct t) from unnest(p_topics) t) loop
    insert into public.dd_checks (organisation_id, case_id, topic) values (v_org, v_case, v_topic);
  end loop;

  update public.counterparties set dd_status = 'open', risk_rating = v_rating where id = p_counterparty;
  perform set_config('app.dd_system', 'off', true);
  return v_case;
end;
$$;

create or replace function public.decide_dd_case(p_case uuid, p_outcome public.dd_case_status, p_conditions text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.dd_cases%rowtype;
  v_name text;
  v_review date;
  v_conditions text := nullif(btrim(coalesce(p_conditions, '')), '');
begin
  select * into v_c from public.dd_cases d where d.id = p_case for update;
  if v_c.id is null or not app.has_role(v_c.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to decide this case';
  end if;
  if v_c.status <> 'open' then
    raise exception 'This case has already been decided';
  end if;
  if p_outcome = 'open' then
    raise exception 'Choose an outcome';
  end if;
  if p_outcome <> 'rejected' and exists (select 1 from public.dd_checks k where k.case_id = v_c.id and k.result = 'pending') then
    raise exception 'Complete every check before clearing this party';
  end if;
  if p_outcome = 'cleared' and exists (select 1 from public.dd_checks k where k.case_id = v_c.id and k.result = 'concern') then
    raise exception 'A check raised a concern. Clear with conditions, or reject.';
  end if;
  if p_outcome = 'cleared_with_conditions' and v_conditions is null then
    raise exception 'State the conditions';
  end if;

  -- Higher-risk parties are reviewed yearly; others less often.
  v_review := case when p_outcome = 'rejected' then null
                   else current_date + case v_c.risk_rating when 'high' then interval '12 months'
                                                           when 'medium' then interval '24 months'
                                                           else interval '36 months' end end;

  perform set_config('app.dd_system', 'on', true);
  update public.dd_cases
     set status = p_outcome, conditions = v_conditions, decided_by = auth.uid(), decided_at = now()
   where id = v_c.id;
  update public.counterparties
     set dd_status = p_outcome, risk_rating = v_c.risk_rating, next_review_on = v_review
   where id = v_c.counterparty_id
   returning name into v_name;
  perform set_config('app.dd_system', 'off', true);

  if v_review is not null then
    insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
    values (v_c.organisation_id, format('%s: due diligence review', v_name), 'counterparties', v_c.counterparty_id,
            (v_review::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Contract gate: approval cannot be recorded for a rejected party, or a
-- high-risk party whose due diligence is still open.
-- ---------------------------------------------------------------------
create or replace function public.decide_contract_approval(p_approval uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_a public.contract_approvals%rowtype;
  v_party public.counterparties%rowtype;
  v_is_holder boolean;
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

  perform set_config('app.contract_system', 'on', true);
  update public.contracts
     set status = case when p_approve then 'approved' else 'rejected' end::public.contract_status
   where id = v_a.contract_id;
  perform set_config('app.contract_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Gifts and hospitality; conflicts of interest
-- ---------------------------------------------------------------------
create table public.gift_entries (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  declared_by      uuid references auth.users (id) on delete set null,
  staff_name       text not null check (char_length(btrim(staff_name)) >= 2),
  direction        public.gift_direction not null,
  other_party      text not null check (char_length(btrim(other_party)) >= 2),
  description      text not null check (char_length(btrim(description)) >= 2),
  value_amount     numeric(12,2) not null check (value_amount >= 0),
  occurred_on      date not null,
  public_official  boolean not null default false,
  status           public.declaration_status not null default 'recorded',
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index gift_entries_org_idx on public.gift_entries (organisation_id, occurred_on desc);

create or replace function app.guard_gift()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_threshold numeric;
begin
  if tg_op = 'INSERT' then
    select o.gift_approval_threshold into v_threshold from public.organisations o where o.id = new.organisation_id;
    new.declared_by := coalesce(auth.uid(), new.declared_by);
    -- Anything involving a public official, or over the threshold, needs a decision.
    new.status := case when new.public_official or new.value_amount > v_threshold then 'pending' else 'recorded' end;
    new.decided_by := null;
    new.decided_at := null;
    return new;
  end if;
  if new.staff_name <> old.staff_name or new.direction <> old.direction or new.other_party <> old.other_party
     or new.description <> old.description or new.value_amount <> old.value_amount
     or new.occurred_on <> old.occurred_on or new.public_official <> old.public_official then
    raise exception 'A declaration cannot be edited once made. Record a new one if it was wrong.';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status not in ('approved', 'declined') then
      raise exception 'Only a pending declaration can be approved or declined';
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end;
$$;
create trigger gift_entries_guard before insert or update on public.gift_entries
  for each row execute function app.guard_gift();

create table public.conflict_declarations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  declared_by      uuid references auth.users (id) on delete set null,
  person_name      text not null check (char_length(btrim(person_name)) >= 2),
  description      text not null check (char_length(btrim(description)) >= 5),
  related_party    text,
  declared_on      date not null default current_date,
  status           public.conflict_status not null default 'open',
  management_plan  text,
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index conflict_declarations_org_idx on public.conflict_declarations (organisation_id, declared_on desc);

create or replace function app.guard_conflict()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.declared_by := coalesce(auth.uid(), new.declared_by);
    new.status := 'open';
    new.management_plan := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;
  if new.person_name <> old.person_name or new.description <> old.description
     or new.related_party is distinct from old.related_party or new.declared_on <> old.declared_on then
    raise exception 'A declaration cannot be edited once made. Record a new one if it was wrong.';
  end if;
  if new.status = 'managed' and nullif(btrim(coalesce(new.management_plan, '')), '') is null then
    raise exception 'Say how the conflict is being managed';
  end if;
  if new.status is distinct from old.status or new.management_plan is distinct from old.management_plan then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
create trigger conflict_declarations_guard before insert or update on public.conflict_declarations
  for each row execute function app.guard_conflict();

-- ---------------------------------------------------------------------
-- Triggers, privileges and row-level security
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['dd_cases', 'dd_checks', 'gift_entries', 'conflict_declarations'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

revoke execute on function public.open_dd_case(uuid, jsonb, text[]) from public, anon;
revoke execute on function public.decide_dd_case(uuid, public.dd_case_status, text) from public, anon;
revoke execute on function public.decide_contract_approval(uuid, boolean, text) from public, anon;
grant execute on function public.open_dd_case(uuid, jsonb, text[]) to authenticated;
grant execute on function public.decide_dd_case(uuid, public.dd_case_status, text) to authenticated;
grant execute on function public.decide_contract_approval(uuid, boolean, text) to authenticated;
grant execute on all functions in schema app to authenticated, service_role;

revoke all on public.dd_cases, public.dd_checks, public.gift_entries, public.conflict_declarations from anon, authenticated;
grant select on public.dd_cases to authenticated;
grant select, update on public.dd_checks to authenticated;
grant select, insert, update on public.gift_entries, public.conflict_declarations to authenticated;
grant all on public.dd_cases, public.dd_checks, public.gift_entries, public.conflict_declarations to service_role;

alter table public.dd_cases              enable row level security;
alter table public.dd_checks             enable row level security;
alter table public.gift_entries          enable row level security;
alter table public.conflict_declarations enable row level security;

-- Due diligence detail is for the people who run it and the board
create policy dd_cases_select on public.dd_cases for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()));
create policy dd_checks_select on public.dd_checks for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()));
create policy dd_checks_update on public.dd_checks for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

-- People see their own declarations; records roles see and decide all of them
create policy gift_entries_select on public.gift_entries for select to authenticated
  using (declared_by = auth.uid() or app.has_role(organisation_id, app.records_roles()));
create policy gift_entries_insert on public.gift_entries for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()));
create policy gift_entries_update on public.gift_entries for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy conflict_declarations_select on public.conflict_declarations for select to authenticated
  using (declared_by = auth.uid() or app.has_role(organisation_id, app.records_roles()));
create policy conflict_declarations_insert on public.conflict_declarations for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()));
create policy conflict_declarations_update on public.conflict_declarations for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

-- 0037: Key employees, key contracts, disputes, and how they ladder up into the Risk Register.
--
-- Key employees: the people the business depends on, why, who would step in,
-- how ready they are, notice, restraint, retention and key person cover.
-- Unknown is recorded as unknown, never as fine.
--
-- Key contracts: any contract marked business critical, with the reason, the
-- contingency if it were lost, change of control, and a relationship owner.
-- Only the records roles can mark or unmark a contract as key.
--
-- Disputes: material litigation (brought by us, or against us), material
-- customer complaints, and employee disputes (active or potential), each
-- with particulars. Employee disputes are visible only to the records roles
-- and the person handling them.
--
-- Ladder up: risk_feed(review) lists what these registers say should be in a
-- risk review (key employees leaving, vacant or without a ready successor;
-- open disputes; key contracts ending or due for notice within six months),
-- in the matching risk category, and add_risk_feed adds them as risk items.
-- A risk item remembers where it came from, and so does its carried-forward
-- copy, so nothing is suggested twice. Employee dispute items never name the
-- employee.

-- ---------------------------------------------------------------------
-- Key employees
-- ---------------------------------------------------------------------
create table public.key_employees (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  entity_id             uuid references public.entities (id) on delete set null,
  full_name             text not null check (char_length(btrim(full_name)) between 2 and 200),
  position_title        text not null check (char_length(btrim(position_title)) between 2 and 200),
  function_name         text,
  why_key               text not null check (char_length(btrim(why_key)) >= 5),
  status                text not null default 'in_role' check (status in ('in_role', 'leaving', 'vacant')),
  leaving_on            date,
  successor_name        text,
  succession_readiness  text check (succession_readiness in ('ready_now', 'within_12_months', 'longer', 'none')),  -- null = not assessed
  notice_period         text,
  restraint             text not null default 'unknown' check (restraint in ('yes', 'no', 'unknown')),
  retention_notes       text,
  key_person_insurance  text not null default 'unknown' check (key_person_insurance in ('yes', 'no', 'unknown')),
  review_on             date,
  last_reviewed_on      date,
  is_active             boolean not null default true,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index key_employees_org_idx on public.key_employees (organisation_id, is_active);

create or replace function app.guard_key_employee()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if tg_op = 'UPDATE' then
    if new.organisation_id <> old.organisation_id then
      raise exception 'A record cannot move to another organisation';
    end if;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  if new.status = 'in_role' then
    new.leaving_on := null;
  end if;
  return new;
end;
$$;
create trigger key_employees_guard before insert or update on public.key_employees
  for each row execute function app.guard_key_employee();

-- ---------------------------------------------------------------------
-- Key contracts
-- ---------------------------------------------------------------------
alter table public.contracts add column if not exists is_key boolean not null default false;
alter table public.contracts add column if not exists key_reason text;
alter table public.contracts add column if not exists key_contingency text;
alter table public.contracts add column if not exists key_change_of_control text not null default 'unknown'
  check (key_change_of_control in ('yes', 'no', 'unknown'));
alter table public.contracts add column if not exists key_owner text;
alter table public.contracts add column if not exists key_marked_by uuid references auth.users (id) on delete set null;
alter table public.contracts add column if not exists key_marked_at timestamptz;

-- The key designation changes only through set_key_contract
create or replace function app.guard_key_contract()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.key_contract', true), 'off') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_key or new.key_reason is not null or new.key_contingency is not null or new.key_owner is not null or new.key_change_of_control <> 'unknown' then
      raise exception 'Mark a contract as key from Key Contracts';
    end if;
  elsif (new.is_key, new.key_reason, new.key_contingency, new.key_change_of_control, new.key_owner, new.key_marked_by, new.key_marked_at)
        is distinct from (old.is_key, old.key_reason, old.key_contingency, old.key_change_of_control, old.key_owner, old.key_marked_by, old.key_marked_at) then
    raise exception 'Mark a contract as key from Key Contracts';
  end if;
  return new;
end;
$$;
drop trigger if exists contracts_key_guard on public.contracts;
create trigger contracts_key_guard before insert or update on public.contracts
  for each row execute function app.guard_key_contract();

create or replace function public.set_key_contract(p_contract uuid, p_is_key boolean, p_reason text, p_contingency text, p_change_of_control text, p_owner text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.contracts where id = p_contract;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can mark a key contract';
  end if;
  if p_is_key and char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why the contract is business critical';
  end if;
  if coalesce(p_change_of_control, 'unknown') not in ('yes', 'no', 'unknown') then
    raise exception 'Change of control is yes, no or not known';
  end if;
  perform set_config('app.key_contract', 'on', true);
  update public.contracts set
    is_key = coalesce(p_is_key, false),
    key_reason = case when p_is_key then btrim(p_reason) else key_reason end,
    key_contingency = case when p_is_key then nullif(btrim(coalesce(p_contingency, '')), '') else key_contingency end,
    key_change_of_control = case when p_is_key then coalesce(p_change_of_control, 'unknown') else key_change_of_control end,
    key_owner = case when p_is_key then nullif(btrim(coalesce(p_owner, '')), '') else key_owner end,
    key_marked_by = auth.uid(),
    key_marked_at = now()
  where id = p_contract;
  perform set_config('app.key_contract', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------
create table public.disputes (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  entity_id          uuid references public.entities (id) on delete set null,
  kind               text not null check (kind in ('litigation', 'complaint', 'employee')),
  direction          text check (direction in ('by_us', 'against_us')),     -- litigation only
  stage              text check (stage in ('active', 'potential')),         -- employee disputes only
  title              text not null check (char_length(btrim(title)) between 3 and 300),
  other_party        text,
  claim_type         text,
  forum              text,            -- court, tribunal, regulator, ombudsman
  reference          text,            -- proceeding or complaint number
  particulars        text not null check (char_length(btrim(particulars)) >= 10),
  amount_claimed     numeric(16, 2) check (amount_claimed is null or amount_claimed >= 0),
  exposure_estimate  numeric(16, 2) check (exposure_estimate is null or exposure_estimate >= 0),
  currency           text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  prospects          text not null default 'unknown' check (prospects in ('strong', 'reasonable', 'weak', 'unknown')),
  regulator_involved text,
  external_advisers  text,
  next_step          text,
  next_date          date,
  owner_user_id      uuid references auth.users (id) on delete set null,
  opened_on          date,
  status             text not null default 'open' check (status in ('open', 'closed')),
  closed_on          date,
  outcome            text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((kind = 'litigation') = (direction is not null)),
  check ((kind = 'employee') = (stage is not null)),
  check (status = 'open' or (closed_on is not null and char_length(btrim(coalesce(outcome, ''))) >= 3))
);
create index disputes_org_idx on public.disputes (organisation_id, kind, status);

create or replace function app.guard_dispute()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if new.owner_user_id is not null and not exists (
       select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.owner_user_id and m.is_active) then
    raise exception 'The person handling it must be an active member of this organisation';
  end if;
  if tg_op = 'UPDATE' then
    if new.organisation_id <> old.organisation_id or new.kind <> old.kind then
      raise exception 'A dispute cannot change organisation or kind';
    end if;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  if new.status = 'open' then
    new.closed_on := null;
  end if;
  return new;
end;
$$;
create trigger disputes_guard before insert or update on public.disputes
  for each row execute function app.guard_dispute();

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.key_employees, public.disputes from anon, authenticated;
grant select on public.key_employees, public.disputes to authenticated;
grant insert (organisation_id, entity_id, full_name, position_title, function_name, why_key, status, leaving_on, successor_name, succession_readiness,
              notice_period, restraint, retention_notes, key_person_insurance, review_on, last_reviewed_on),
      update (entity_id, full_name, position_title, function_name, why_key, status, leaving_on, successor_name, succession_readiness,
              notice_period, restraint, retention_notes, key_person_insurance, review_on, last_reviewed_on, is_active)
  on public.key_employees to authenticated;
grant insert (organisation_id, entity_id, kind, direction, stage, title, other_party, claim_type, forum, reference, particulars, amount_claimed,
              exposure_estimate, currency, prospects, regulator_involved, external_advisers, next_step, next_date, owner_user_id, opened_on),
      update (entity_id, direction, stage, title, other_party, claim_type, forum, reference, particulars, amount_claimed, exposure_estimate,
              currency, prospects, regulator_involved, external_advisers, next_step, next_date, owner_user_id, opened_on, status, closed_on, outcome)
  on public.disputes to authenticated;
grant all on public.key_employees, public.disputes to service_role;

alter table public.key_employees enable row level security;
alter table public.disputes enable row level security;

create policy key_employees_select on public.key_employees for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]));
create policy key_employees_insert on public.key_employees for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy key_employees_update on public.key_employees for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

-- Litigation and complaints: the board and auditors. Employee disputes: the records roles and the handler only.
create policy disputes_select on public.disputes for select to authenticated
  using (case when kind = 'employee'
              then app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid()
              else app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or owner_user_id = auth.uid()
         end);
create policy disputes_insert on public.disputes for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy disputes_update on public.disputes for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid());

create trigger key_employees_touch before update on public.key_employees for each row execute function app.touch_updated_at();
create trigger key_employees_audit after insert or update or delete on public.key_employees for each row execute function app.audit_row();
create trigger disputes_touch before update on public.disputes for each row execute function app.touch_updated_at();
create trigger disputes_audit after insert or update or delete on public.disputes for each row execute function app.audit_row();

-- ---------------------------------------------------------------------
-- Ladder up into the Risk Register
-- ---------------------------------------------------------------------
alter table public.risk_items add column if not exists source_table text check (source_table in ('key_employees', 'disputes', 'contracts'));
alter table public.risk_items add column if not exists source_id uuid;
grant select (source_table, source_id) on public.risk_items to authenticated;

-- A carried-forward copy keeps the source of the item it came from
create or replace function app.risk_item_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.carried_from_id is not null and new.source_id is null then
    select i.source_table, i.source_id into new.source_table, new.source_id from public.risk_items i where i.id = new.carried_from_id;
  end if;
  return new;
end;
$$;
drop trigger if exists risk_items_source on public.risk_items;
create trigger risk_items_source before insert on public.risk_items
  for each row execute function app.risk_item_source();

-- Finds a category in the review by name, falling back to "Any other risk"
create or replace function app.risk_feed_category(p_review uuid, p_names text[])
returns uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.risk_requests q join public.risk_categories c on c.id = q.category_id
  where q.review_id = p_review and (lower(c.name) = any (p_names) or lower(c.name) = 'any other risk')
  order by (lower(c.name) = any (p_names)) desc, array_position(p_names, lower(c.name)), c.position
  limit 1;
$$;

create or replace function public.risk_feed(p_review uuid)
returns table (source_table text, source_id uuid, register text, category_id uuid, category_name text,
               title text, action text, actioner text, due_on date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_people uuid;
  v_legal uuid;
  v_commercial uuid;
begin
  select r.organisation_id into v_org from public.risk_reviews r where r.id = p_review;
  if v_org is null or not (app.has_role(v_org, app.records_roles()) or app.is_risk_owner(v_org)) then
    raise exception 'You do not have permission to see this';
  end if;
  v_people := app.risk_feed_category(p_review, array['people']);
  v_legal := app.risk_feed_category(p_review, array['legal and compliance', 'legal', 'compliance']);
  v_commercial := app.risk_feed_category(p_review, array['commercial']);

  return query
  with feed as (
    -- Key employees leaving, vacant, or without a successor ready now (not assessed counts as not ready)
    select 'key_employees'::text as source_table, k.id as source_id, 'Key Employees'::text as register, v_people as category_id,
           case k.status
             when 'vacant' then 'Key role vacant: ' || k.position_title
             when 'leaving' then 'Key employee leaving: ' || k.full_name || ', ' || k.position_title || coalesce(' (' || to_char(k.leaving_on, 'FMDD Mon YYYY') || ')', '')
             else 'Succession gap: ' || k.full_name || ', ' || k.position_title
           end
           || E'\n' || k.why_key
           || E'\nSuccessor: ' || coalesce(k.successor_name, 'none identified')
           || ' · Readiness: ' || coalesce(case k.succession_readiness when 'ready_now' then 'ready now' when 'within_12_months' then 'within 12 months'
                                                                      when 'longer' then 'more than 12 months' when 'none' then 'no successor' end, 'not assessed') as title,
           case when k.status = 'vacant' then 'Fill the role; interim cover in place'
                when k.successor_name is null then 'Identify a successor and a retention plan'
                else 'Develop the successor; review retention' end as action,
           null::text as actioner,
           coalesce(k.leaving_on, k.review_on) as due_on
    from public.key_employees k
    where k.organisation_id = v_org and k.is_active
      and (k.status in ('leaving', 'vacant') or k.succession_readiness is distinct from 'ready_now')
    union all
    -- Open disputes. Employee disputes never name the employee.
    select 'disputes', d.id,
           case d.kind when 'litigation' then 'Material Litigation' when 'complaint' then 'Material Customer Complaints' else 'Employee Disputes' end,
           case d.kind when 'litigation' then v_legal when 'complaint' then v_commercial else v_people end,
           case d.kind
             when 'litigation' then (case d.direction when 'by_us' then 'Litigation brought by us: ' else 'Litigation against us: ' end) || d.title
                                    || coalesce(E'\nOther party: ' || d.other_party, '') || coalesce(' · ' || d.forum, '') || coalesce(' · ' || d.reference, '')
                                    || coalesce(E'\nClaimed ' || d.currency || ' ' || to_char(d.amount_claimed, 'FM999,999,999,990'), '')
                                    || coalesce(' · estimated exposure ' || d.currency || ' ' || to_char(d.exposure_estimate, 'FM999,999,999,990'), '')
                                    || ' · prospects ' || case d.prospects when 'unknown' then 'not assessed' else d.prospects end
             when 'complaint' then 'Material customer complaint: ' || d.title || coalesce(E'\nCustomer: ' || d.other_party, '')
                                    || coalesce(E'\nRegulator: ' || d.regulator_involved, '')
             else 'Employee dispute (' || d.stage || '): ' || coalesce(d.claim_type, 'type not recorded')
                  || coalesce(', ' || (select e.name from public.entities e where e.id = d.entity_id), '')
           end,
           coalesce(nullif(btrim(d.next_step), ''), 'Continue to monitor'),
           (select coalesce(nullif(btrim(p.full_name), ''), u.email)::text from auth.users u left join public.people p on p.user_id = u.id and p.organisation_id = v_org where u.id = d.owner_user_id limit 1),
           d.next_date
    from public.disputes d
    where d.organisation_id = v_org and d.status = 'open'
    union all
    -- Key contracts ending, or due for notice, within six months (or already past)
    select 'contracts', c.id, 'Key Contracts', v_commercial,
           'Key contract ' || case when c.notice_by is not null and c.notice_by <= current_date + 183 then 'notice date ' || to_char(c.notice_by, 'FMDD Mon YYYY')
                                   else 'ends ' || to_char(c.ends_on, 'FMDD Mon YYYY') end
           || ': ' || c.title || coalesce(' with ' || (select cp.name from public.counterparties cp where cp.id = c.counterparty_id), '')
           || coalesce(E'\n' || c.key_reason, '')
           || E'\nContingency: ' || coalesce(c.key_contingency, 'none recorded'),
           'Decide whether to renew, renegotiate or exit',
           c.key_owner,
           coalesce(c.notice_by, c.ends_on)
    from public.contracts c
    where c.organisation_id = v_org and c.is_key and c.status not in ('terminated', 'rejected')
      and ((c.notice_by is not null and c.notice_by <= current_date + 183) or (c.ends_on is not null and c.ends_on <= current_date + 183))
  )
  select f.source_table, f.source_id, f.register, f.category_id, c.name, f.title, f.action, f.actioner, f.due_on
  from feed f left join public.risk_categories c on c.id = f.category_id
  where not exists (select 1 from public.risk_items i where i.review_id = p_review and i.source_id = f.source_id)
  order by f.register, f.title;
end;
$$;

-- Adds one suggestion (or all, when p_source is null) to the review as risk items.
-- p_category places a single suggestion in a chosen category (needed when the review has no matching one).
create or replace function public.add_risk_feed(p_review uuid, p_source uuid, p_category uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_status text;
  v_n integer := 0;
  f record;
begin
  select r.organisation_id, r.status into v_org, v_status from public.risk_reviews r where r.id = p_review;
  if v_org is null or not (app.has_role(v_org, app.records_roles()) or app.is_risk_owner(v_org)) then
    raise exception 'You do not have permission to do this';
  end if;
  if v_status <> 'collecting' then
    raise exception 'Items can be added only while the review is collecting input';
  end if;
  if p_category is not null and (p_source is null or not exists (select 1 from public.risk_requests q where q.review_id = p_review and q.category_id = p_category)) then
    raise exception 'Choose a category that is part of this review, for one item at a time';
  end if;
  for f in select * from public.risk_feed(p_review) x where (p_source is null or x.source_id = p_source) and coalesce(p_category, x.category_id) is not null loop
    insert into public.risk_items (organisation_id, review_id, category_id, position, title, action, actioner, due_on, entered_by, source_table, source_id)
    values (v_org, p_review, coalesce(p_category, f.category_id), 999, left(f.title, 4000), f.action, f.actioner, f.due_on, 'From ' || f.register, f.source_table, f.source_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on all functions in schema app from public, anon;
revoke execute on function public.set_key_contract(uuid, boolean, text, text, text, text), public.risk_feed(uuid), public.add_risk_feed(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_key_contract(uuid, boolean, text, text, text, text), public.risk_feed(uuid), public.add_risk_feed(uuid, uuid, uuid) to authenticated;

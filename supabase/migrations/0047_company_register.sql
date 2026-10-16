-- 0047: Company register.
--
-- For each company:
--   * more company details: principal place of business, ultimate holding
--     company (outside the group), whether it has its own constitution or
--     relies on the replaceable rules, and former names;
--   * corporate documents by category (certificate of registration,
--     constitution, application for registration, ASIC extracts and company
--     statements, consents to act, share certificates, resolutions and more),
--     with files attached;
--   * office holders' details that ASIC asks for (date and place of birth,
--     residential address, former names) and Director ID confirmation. Only
--     the records roles and the person themselves can see these;
--   * ASIC filings: flagged automatically when something happens that
--     usually needs notifying, with the form and due date:
--       - officer appointed (Form 484, 28 days)
--       - officer ceased (Form 484, 28 days)
--       - officer's residential address or name changed (Form 484, 28 days)
--       - registered office or principal place of business changed (Form 484, 28 days)
--       - ultimate holding company changed (Form 484, 28 days)
--       - company name changed (special resolution, then Form 205, 14 days)
--       - negative or no solvency resolution (Form 485, 7 days)
--     Share changes are already flagged on the share movements (0044).
--     An edit that might only be a correction, or an appointment with no date
--     (often an existing director being recorded for the first time), is
--     flagged "to check": someone confirms it is a real change (setting the
--     due date) or records why no filing is needed. Nothing is assumed;
--   * the annual review: review date (the registration anniversary),
--     statement received, details checked (28 days), fee paid (2 months),
--     directors' solvency resolution (2 months, unless a financial report was
--     lodged in the last 12 months), and Form 485 if it could not be passed.
--
-- Ladder up: filings past due and annual review steps past due feed the
-- Risk Register; filings due within 14 days appear under For you.

alter table public.entities
  add column if not exists principal_place          text,
  add column if not exists ultimate_holding_name    text,
  add column if not exists ultimate_holding_acn     text,
  add column if not exists ultimate_holding_country text,
  add column if not exists constitution_kind        text check (constitution_kind is null or constitution_kind in ('own', 'replaceable_rules')),
  add column if not exists former_names             text[] not null default '{}';
grant select (principal_place, ultimate_holding_name, ultimate_holding_acn, ultimate_holding_country, constitution_kind, former_names) on public.entities to authenticated;
grant update (principal_place, ultimate_holding_name, ultimate_holding_acn, ultimate_holding_country, constitution_kind) on public.entities to authenticated;

create or replace function app.can_read_register(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, app.board_read_roles()) or app.has_role(p_org, array['auditor']::public.member_role[]);
$$;

-- Is this a company ASIC regulates?
create or replace function app.asic_company(p_entity uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.entities e where e.id = p_entity
                 and upper(coalesce(e.jurisdiction, 'AU')) in ('AU', 'AUS', 'AUSTRALIA')
                 and (e.legal_form is null or e.legal_form in ('proprietary_company', 'public_company'))
                 and e.status <> 'deregistered');
$$;

-- ---------------------------------------------------------------------
-- Corporate documents
-- ---------------------------------------------------------------------
create table public.corporate_documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_id        uuid not null references public.entities (id) on delete cascade,
  category         text not null check (category in ('certificate_of_registration', 'constitution', 'application_for_registration', 'asic_extract',
                                                     'company_statement', 'consent_to_act', 'share_certificate', 'member_application', 'resolution',
                                                     'shareholders_agreement', 'trust_deed', 'registered_office_consent', 'director_id', 'other')),
  title            text not null check (char_length(btrim(title)) between 2 and 300),
  effective_on     date,
  person_id        uuid references public.people (id) on delete set null,     -- consents to act, Director ID confirmations
  share_movement_id uuid references public.share_movements (id) on delete set null,
  notes            text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index corporate_documents_entity_idx on public.corporate_documents (entity_id, category);

-- ---------------------------------------------------------------------
-- Office holders' personal details (one row per person)
-- ---------------------------------------------------------------------
create table public.officer_details (
  person_id                uuid primary key references public.people (id) on delete cascade,
  organisation_id          uuid not null references public.organisations (id) on delete cascade,
  date_of_birth            date check (date_of_birth is null or date_of_birth < current_date),
  place_of_birth           text,          -- town or city, and state or country
  residential_address      text,
  former_names             text,
  director_id_confirmed_on date,
  director_id              text check (director_id is null or director_id ~ '^[0-9 ]{15,20}$'),
  updated_by               uuid references auth.users (id) on delete set null,
  updated_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ASIC filings
-- ---------------------------------------------------------------------
create table public.asic_filings (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  entity_id            uuid not null references public.entities (id) on delete cascade,
  form                 text not null check (form in ('484', '205', '485', 'other')),
  kind                 text not null check (kind in ('appoint_officer', 'cease_officer', 'officer_details', 'registered_office', 'principal_place',
                                                   'ultimate_holding', 'company_name', 'solvency', 'other')),
  title                text not null,
  detail               jsonb not null default '{}'::jsonb,   -- what changed: old and new values, the person, the role
  source_table         text,
  source_id            uuid,
  event_on             date,
  due_on               date,
  status               text not null default 'to_lodge' check (status in ('to_check', 'to_lodge', 'lodged', 'not_required')),
  lodged_on            date,
  reference            text,          -- ASIC document number
  not_required_reason  text,
  decided_by           uuid references auth.users (id) on delete set null,
  decided_at           timestamptz,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  check (status <> 'lodged' or lodged_on is not null),
  check (status <> 'not_required' or not_required_reason is not null),
  check (status <> 'to_lodge' or due_on is not null)
);
create index asic_filings_entity_idx on public.asic_filings (entity_id, status);

create or replace function app.filing_days(p_form text)
returns integer language sql immutable as $$
  select case p_form when '205' then 14 when '485' then 7 else 28 end;
$$;

create or replace function app.add_filing(p_entity uuid, p_form text, p_kind text, p_title text, p_detail jsonb, p_source_table text, p_source_id uuid,
                                         p_event_on date, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if not app.asic_company(p_entity) then
    return;
  end if;
  select e.organisation_id into v_org from public.entities e where e.id = p_entity;
  -- One open flag per record and kind is enough
  if exists (select 1 from public.asic_filings f where f.entity_id = p_entity and f.kind = p_kind and f.source_id is not distinct from p_source_id
             and f.status in ('to_check', 'to_lodge') and f.kind <> 'officer_details') then
    update public.asic_filings f set detail = f.detail || p_detail, title = p_title
     where f.entity_id = p_entity and f.kind = p_kind and f.source_id is not distinct from p_source_id and f.status in ('to_check', 'to_lodge');
    return;
  end if;
  insert into public.asic_filings (organisation_id, entity_id, form, kind, title, detail, source_table, source_id, event_on, due_on, status, created_by)
  values (v_org, p_entity, p_form, p_kind, p_title, coalesce(p_detail, '{}'::jsonb), p_source_table, p_source_id, p_event_on,
          case when p_status = 'to_lodge' then coalesce(p_event_on, current_date) + app.filing_days(p_form) end, p_status, auth.uid());
end;
$$;

create or replace function app.role_label(p_role public.office_role)
returns text language sql immutable as $$
  select case p_role when 'director' then 'director' when 'alternate_director' then 'alternate director' when 'chair' then 'chair'
                     when 'secretary' then 'secretary' when 'public_officer' then 'public officer' end;
$$;

-- Office holders appointed or ceasing
create or replace function app.flag_officeholding()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  -- Chairs and public officers are not ASIC office holders
  if new.role not in ('director', 'alternate_director', 'secretary') then
    return null;
  end if;
  select p.full_name into v_name from public.people p where p.id = new.person_id;
  if tg_op = 'INSERT' then
    if new.ceased_on is null then
      perform app.add_filing(new.entity_id, '484', 'appoint_officer', 'Appointment of ' || v_name || ' as ' || app.role_label(new.role),
        jsonb_build_object('person_id', new.person_id, 'role', new.role, 'appointed_on', new.appointed_on), 'officeholdings', new.id, new.appointed_on,
        -- No date, or recorded long after the event: probably already on ASIC's record
        case when new.appointed_on is not null and new.appointed_on >= current_date - 28 then 'to_lodge' else 'to_check' end);
    end if;
  elsif new.ceased_on is not null and old.ceased_on is null then
    -- Added and removed on the same day: maybe a mistake being undone, maybe a real cessation of someone
    -- recorded for the first time today. Never assumed: flagged to check.
    perform app.add_filing(new.entity_id, '484', 'cease_officer', v_name || ' ceased as ' || app.role_label(new.role),
      jsonb_build_object('person_id', new.person_id, 'role', new.role, 'ceased_on', new.ceased_on, 'appointed_on', new.appointed_on), 'officeholdings', new.id, new.ceased_on,
      case when new.created_at::date = current_date then 'to_check' else 'to_lodge' end);
  elsif new.appointed_on is distinct from old.appointed_on and new.appointed_on is not null then
    -- A date added later: refresh any open appointment flag's details
    update public.asic_filings set detail = detail || jsonb_build_object('appointed_on', new.appointed_on), event_on = new.appointed_on,
           due_on = case when status = 'to_lodge' then new.appointed_on + 28 else due_on end
     where source_id = new.id and kind = 'appoint_officer' and status in ('to_check', 'to_lodge');
  end if;
  return null;
end;
$$;
create trigger officeholdings_asic after insert or update on public.officeholdings for each row execute function app.flag_officeholding();

-- Company details changing
create or replace function app.flag_entity_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.registered_office is distinct from old.registered_office and old.registered_office is not null then
    perform app.add_filing(new.id, '484', 'registered_office', 'Change of registered office',
      jsonb_build_object('old', old.registered_office, 'new', new.registered_office), 'entities', new.id, current_date, 'to_check');
  end if;
  if new.principal_place is distinct from old.principal_place and old.principal_place is not null then
    perform app.add_filing(new.id, '484', 'principal_place', 'Change of principal place of business',
      jsonb_build_object('old', old.principal_place, 'new', new.principal_place), 'entities', new.id, current_date, 'to_check');
  end if;
  if new.ultimate_holding_name is distinct from old.ultimate_holding_name and old.ultimate_holding_name is not null then
    perform app.add_filing(new.id, '484', 'ultimate_holding', 'Change of ultimate holding company',
      jsonb_build_object('old', old.ultimate_holding_name, 'new', new.ultimate_holding_name, 'acn', new.ultimate_holding_acn, 'country', new.ultimate_holding_country), 'entities', new.id, current_date, 'to_check');
  end if;
  if new.name is distinct from old.name then
    new.former_names := array_append(old.former_names, old.name);
    perform app.add_filing(new.id, '205', 'company_name', 'Change of company name to ' || new.name,
      jsonb_build_object('old', old.name, 'new', new.name), 'entities', new.id, current_date, 'to_check');
  end if;
  return new;
end;
$$;
create trigger entities_asic before update on public.entities for each row execute function app.flag_entity_change();

-- Office holders' own details changing
create or replace function app.flag_officer_details()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  h record;
  v_name text;
begin
  if tg_op = 'UPDATE' and new.residential_address is distinct from old.residential_address and old.residential_address is not null then
    select p.full_name into v_name from public.people p where p.id = new.person_id;
    for h in select distinct o.entity_id from public.officeholdings o where o.person_id = new.person_id and o.ceased_on is null
               and o.role in ('director', 'alternate_director', 'secretary') loop
      perform app.add_filing(h.entity_id, '484', 'officer_details', 'Change of residential address: ' || v_name,
        jsonb_build_object('person_id', new.person_id, 'old', old.residential_address, 'new', new.residential_address), 'officer_details', new.person_id, current_date, 'to_check');
    end loop;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;
create trigger officer_details_asic before insert or update on public.officer_details for each row execute function app.flag_officer_details();

create or replace function app.flag_person_name()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  h record;
begin
  if new.full_name is distinct from old.full_name then
    for h in select distinct o.entity_id from public.officeholdings o where o.person_id = new.id and o.ceased_on is null
               and o.role in ('director', 'alternate_director', 'secretary') loop
      perform app.add_filing(h.entity_id, '484', 'officer_details', 'Change of name: ' || old.full_name || ' to ' || new.full_name,
        jsonb_build_object('person_id', new.id, 'old', old.full_name, 'new', new.full_name), 'people', new.id, current_date, 'to_check');
    end loop;
  end if;
  return null;
end;
$$;
create trigger people_asic after update on public.people for each row execute function app.flag_person_name();

-- Decide a flag: a real change (to lodge, with the date it happened) or not needed (with the reason)
create or replace function public.decide_filing(p_filing uuid, p_needed boolean, p_event_on date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f public.asic_filings%rowtype;
begin
  select * into f from public.asic_filings x where x.id = p_filing for update;
  if f.id is null or not app.has_role(f.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  if f.status not in ('to_check', 'to_lodge') then
    raise exception 'This has already been dealt with';
  end if;
  if p_needed then
    if p_event_on is null or p_event_on > current_date then
      raise exception 'Give the date the change happened';
    end if;
    update public.asic_filings set status = 'to_lodge', event_on = p_event_on, due_on = p_event_on + app.filing_days(form), decided_by = auth.uid(), decided_at = now()
     where id = p_filing;
  else
    if char_length(btrim(coalesce(p_reason, ''))) < 5 then
      raise exception 'Say why no filing is needed';
    end if;
    update public.asic_filings set status = 'not_required', not_required_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now() where id = p_filing;
  end if;
end;
$$;

create or replace function public.lodge_filing(p_filing uuid, p_lodged_on date, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f public.asic_filings%rowtype;
begin
  select * into f from public.asic_filings x where x.id = p_filing for update;
  if f.id is null or not app.has_role(f.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  if f.status = 'lodged' then
    raise exception 'Already recorded as lodged';
  end if;
  if p_lodged_on is null or p_lodged_on > current_date then
    raise exception 'Give the date it was lodged';
  end if;
  if f.event_on is not null and p_lodged_on < f.event_on then
    raise exception 'It cannot have been lodged before the change happened';
  end if;
  update public.asic_filings set status = 'lodged', lodged_on = p_lodged_on, reference = nullif(btrim(coalesce(p_reference, '')), ''),
         due_on = coalesce(due_on, coalesce(event_on, p_lodged_on) + app.filing_days(form)), decided_by = auth.uid(), decided_at = now()
   where id = p_filing;
end;
$$;

-- Something else to file (another form or a change the app cannot see)
create or replace function public.add_asic_filing(p_entity uuid, p_form text, p_title text, p_event_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select e.organisation_id into v_org from public.entities e where e.id = p_entity;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then
    raise exception 'Say what needs filing';
  end if;
  insert into public.asic_filings (organisation_id, entity_id, form, kind, title, event_on, due_on, status, created_by)
  values (v_org, p_entity, coalesce(p_form, 'other'), 'other', btrim(p_title), p_event_on, coalesce(p_event_on, current_date) + app.filing_days(coalesce(p_form, 'other')), 'to_lodge', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Annual review
-- ---------------------------------------------------------------------
create table public.annual_reviews (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete cascade,
  entity_id                uuid not null references public.entities (id) on delete cascade,
  review_date              date not null,
  statement_received_on    date,
  details_checked_on       date,
  fee_paid_on              date,
  financial_report_lodged  boolean not null default false,   -- a financial report lodged in the last 12 months: no solvency resolution needed
  solvency_outcome         text check (solvency_outcome is null or solvency_outcome in ('positive', 'negative')),
  solvency_resolution_on   date,
  resolution_id            uuid references public.resolutions (id) on delete set null,
  form485_lodged_on        date,
  notes                    text,
  updated_by               uuid references auth.users (id) on delete set null,
  updated_at               timestamptz not null default now(),
  unique (entity_id, review_date),
  check (solvency_outcome is null or solvency_resolution_on is not null)
);

create or replace function app.guard_register_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'officer_details' then
    if not exists (select 1 from public.people p where p.id = new.person_id and p.organisation_id = new.organisation_id) then
      raise exception 'That person is not in this organisation';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if tg_op = 'UPDATE' and new.entity_id <> old.entity_id then
    raise exception 'A record cannot move to another company';
  end if;
  if tg_table_name = 'corporate_documents' then
    if new.person_id is not null and not exists (select 1 from public.people p where p.id = new.person_id and p.organisation_id = new.organisation_id) then
      raise exception 'That person is not in this organisation';
    end if;
    if new.share_movement_id is not null and not exists (select 1 from public.share_movements m where m.id = new.share_movement_id and m.entity_id = new.entity_id) then
      raise exception 'That share movement is not for this company';
    end if;
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  elsif tg_table_name = 'annual_reviews' then
    if new.resolution_id is not null and not exists (select 1 from public.resolutions r where r.id = new.resolution_id and r.organisation_id = new.organisation_id) then
      raise exception 'That resolution is not in this organisation';
    end if;
    if greatest(new.statement_received_on, new.details_checked_on, new.fee_paid_on, new.solvency_resolution_on, new.form485_lodged_on) > current_date then
      raise exception 'Dates cannot be in the future';
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger corporate_documents_guard before insert or update on public.corporate_documents for each row execute function app.guard_register_row();
create trigger officer_details_guard before insert or update on public.officer_details for each row execute function app.guard_register_row();
create trigger annual_reviews_guard before insert or update on public.annual_reviews for each row execute function app.guard_register_row();

-- A negative solvency resolution, or none in time, needs Form 485 within 7 days
create or replace function app.flag_solvency()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.solvency_outcome = 'negative' and (tg_op = 'INSERT' or old.solvency_outcome is distinct from 'negative') then
    perform app.add_filing(new.entity_id, '485', 'solvency', 'Negative solvency resolution (review date ' || to_char(new.review_date, 'FMDD Mon YYYY') || ')',
      jsonb_build_object('review_date', new.review_date), 'annual_reviews', new.id, new.solvency_resolution_on, 'to_lodge');
  end if;
  return null;
end;
$$;
create trigger annual_reviews_asic after insert or update on public.annual_reviews for each row execute function app.flag_solvency();

-- ---------------------------------------------------------------------
-- Ladder up: filings past due, and annual review steps past due
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements',
                          'credit_facilities', 'asic_filings', 'entities'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%asic_filings%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- Company register: ASIC filings past their due date
    select 'asic_filings', af.id, 'Company register', v_legal,
           'ASIC filing overdue: ' || af.title || ' (' || en.name || ')' || E'\n' || 'Form ' || af.form || ' was due ' || to_char(af.due_on, 'FMDD Mon YYYY') || '. Late fees apply.',
           'Lodge it with ASIC and record the date', null::text, af.due_on
    from public.asic_filings af join public.entities en on en.id = af.entity_id
    where af.organisation_id = v_org and af.status = 'to_lodge' and af.due_on < current_date
    union all
    -- Company register: annual review fee or solvency resolution past 2 months after the review date
    select 'entities', en.id, 'Company register', v_legal,
           'Annual review overdue: ' || en.name || E'\n' || concat_ws(' · ',
             case when ar.fee_paid_on is null then 'review fee not recorded as paid' end,
             case when ar.solvency_resolution_on is null and not coalesce(ar.financial_report_lodged, false) then 'no solvency resolution recorded' end)
           || ' (review date ' || to_char(rv.review_date, 'FMDD Mon YYYY') || ')',
           'Pay the fee and pass the solvency resolution, or lodge Form 485', null::text, (rv.review_date + interval '2 months')::date
    from public.entities en
    -- The registration anniversary this year (29 February becomes 28 February)
    cross join lateral (select make_date(extract(year from current_date)::int, extract(month from en.incorporated_on)::int, 1) as m1) mm
    cross join lateral (select (mm.m1 + (least(extract(day from en.incorporated_on)::int,
                                              extract(day from (mm.m1 + interval '1 month' - interval '1 day'))::int) - 1)) as this_year) y
    cross join lateral (select case when y.this_year <= current_date then y.this_year else (y.this_year - interval '1 year')::date end as review_date) rv
    left join public.annual_reviews ar on ar.entity_id = en.id and ar.review_date = rv.review_date
    where en.organisation_id = v_org and en.incorporated_on is not null and app.asic_company(en.id)
      and rv.review_date > en.incorporated_on
      and current_date > (rv.review_date + interval '2 months')::date
      and (ar.fee_paid_on is null or (ar.solvency_resolution_on is null and not coalesce(ar.financial_report_lodged, false)))
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%asic_filings%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: corporate documents, and evidence of lodgement
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%corporate_documents%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''corporate_documents'', ''asic_filings'', ''annual_reviews''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%corporate_documents%' then
    v_def := replace(v_def, $x$  elsif p_table in ('bank_accounts', 'credit_facilities') then$x$, $x$  elsif p_table in ('corporate_documents', 'asic_filings', 'annual_reviews') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    v_ok := v_org is not null and app.has_role(v_org, app.records_roles());
  elsif p_table in ('bank_accounts', 'credit_facilities') then$x$);
    if v_def not like '%corporate_documents%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%corporate_documents%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.corporate_documents, public.officer_details, public.asic_filings, public.annual_reviews from anon, authenticated;
grant select on public.corporate_documents, public.officer_details, public.asic_filings, public.annual_reviews to authenticated;
grant insert (organisation_id, entity_id, category, title, effective_on, person_id, share_movement_id, notes),
      update (category, title, effective_on, person_id, share_movement_id, notes)
  on public.corporate_documents to authenticated;
grant insert (person_id, organisation_id, date_of_birth, place_of_birth, residential_address, former_names, director_id_confirmed_on, director_id),
      update (date_of_birth, place_of_birth, residential_address, former_names, director_id_confirmed_on, director_id)
  on public.officer_details to authenticated;
grant insert (organisation_id, entity_id, review_date, statement_received_on, details_checked_on, fee_paid_on, financial_report_lodged, solvency_outcome,
              solvency_resolution_on, resolution_id, form485_lodged_on, notes),
      update (statement_received_on, details_checked_on, fee_paid_on, financial_report_lodged, solvency_outcome, solvency_resolution_on, resolution_id,
              form485_lodged_on, notes)
  on public.annual_reviews to authenticated;
-- asic_filings: no direct writes; only through the triggers and functions above
grant all on public.corporate_documents, public.officer_details, public.asic_filings, public.annual_reviews to service_role;

alter table public.corporate_documents enable row level security;
alter table public.officer_details enable row level security;
alter table public.asic_filings enable row level security;
alter table public.annual_reviews enable row level security;

create policy corporate_documents_select on public.corporate_documents for select to authenticated using (app.can_read_register(organisation_id));
create policy corporate_documents_insert on public.corporate_documents for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy corporate_documents_update on public.corporate_documents for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
-- Personal details: the records roles, and the person themselves
create policy officer_details_select on public.officer_details for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or exists (select 1 from public.people p where p.id = person_id and p.user_id = auth.uid()));
create policy officer_details_insert on public.officer_details for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()) or exists (select 1 from public.people p where p.id = person_id and p.user_id = auth.uid()));
create policy officer_details_update on public.officer_details for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or exists (select 1 from public.people p where p.id = person_id and p.user_id = auth.uid()))
  with check (app.has_role(organisation_id, app.records_roles()) or exists (select 1 from public.people p where p.id = person_id and p.user_id = auth.uid()));
create policy asic_filings_select on public.asic_filings for select to authenticated using (app.can_read_register(organisation_id));
create policy annual_reviews_select on public.annual_reviews for select to authenticated using (app.can_read_register(organisation_id));
create policy annual_reviews_insert on public.annual_reviews for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy annual_reviews_update on public.annual_reviews for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));

create trigger corporate_documents_touch before update on public.corporate_documents for each row execute function app.touch_updated_at();
create trigger corporate_documents_audit after insert or update or delete on public.corporate_documents for each row execute function app.audit_row();
create trigger officer_details_audit after insert or update or delete on public.officer_details for each row execute function app.audit_row();
create trigger asic_filings_audit after insert or update or delete on public.asic_filings for each row execute function app.audit_row();
create trigger annual_reviews_audit after insert or update or delete on public.annual_reviews for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
grant execute on function app.can_store_dd_upload(text) to anon, authenticated, service_role;
grant execute on function app.can_read_ownership(uuid) to authenticated;
grant execute on function app.can_read_finance(uuid) to authenticated;
grant execute on function app.can_read_register(uuid) to authenticated;
revoke execute on function public.decide_filing(uuid, boolean, date, text), public.lodge_filing(uuid, date, text), public.add_asic_filing(uuid, text, text, date) from public, anon;
grant execute on function public.decide_filing(uuid, boolean, date, text), public.lodge_filing(uuid, date, text), public.add_asic_filing(uuid, text, text, date) to authenticated;

-- 0038: Sanctions assessments.
--
-- An assessment covers one counterparty, contract or transaction. It records:
--   * who and what: the party, our company, the contract, a description;
--   * screening: who was screened (the party, its owners, directors and banks),
--     against which lists, when, with what tool, and the result;
--   * countries involved (where the party is, origin, destination, transit, banks);
--   * nine yes / no / not known questions (dual-use, sectors, end use,
--     transshipment, US and UK/EU connections, red flags, ownership, contract clause).
--
-- The database rates it (stop, high, medium, low, or incomplete) and gives the
-- reasons. Unknown is never low: anything not screened, unanswered or "not known"
-- makes a low result "incomplete". Countries are rated from the organisation's own
-- list (seeded with a starter list to confirm against DFAT), so legal or compliance
-- can keep it current.
--
-- Decisions: proceed, proceed with conditions, permit or licence required, or do
-- not proceed. Only the records roles decide; only a low risk can be decided by
-- the person who raised it; a stop can only be "do not proceed" or "permit or
-- licence required"; incomplete cannot proceed. Each decision sets a re-screen
-- date (12 months, or 6 for high). Screening evidence attaches as files.
--
-- Ladder up: high and stop assessments awaiting decision, permits not yet
-- recorded, and overdue re-screens feed the Risk Register under Legal and Compliance.

-- ---------------------------------------------------------------------
-- The organisation's country list
-- ---------------------------------------------------------------------
create table public.sanctions_countries (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  country          text not null check (char_length(btrim(country)) between 2 and 120),
  level            text not null check (level in ('comprehensive', 'extensive', 'targeted')),
  regimes          text,
  notes            text,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index sanctions_countries_unique on public.sanctions_countries (organisation_id, lower(country));

create or replace function app.guard_sanctions_country()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.organisation_id <> old.organisation_id then
    raise exception 'A country cannot move to another organisation';
  end if;
  new.country := btrim(new.country);
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
create trigger sanctions_countries_guard before insert or update on public.sanctions_countries
  for each row execute function app.guard_sanctions_country();

-- Starter list, from DFAT's list of regimes implemented under Australian sanctions law
-- (UN and autonomous) plus regimes commonly relevant through US, UK or EU connections.
-- To be confirmed and kept current by legal or compliance.
create or replace function public.ensure_sanctions_countries(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not app.is_member(p_org) then
    raise exception 'You are not a member of this organisation';
  end if;
  if exists (select 1 from public.sanctions_countries where organisation_id = p_org) then
    return 0;
  end if;
  insert into public.sanctions_countries (organisation_id, country, level, regimes, notes) values
    (p_org, 'North Korea (DPRK)', 'comprehensive', 'Australia (autonomous); UN; US; UK; EU', 'Treat any dealing as prohibited without legal advice.'),
    (p_org, 'Iran', 'extensive', 'Australia (autonomous); UN; US (comprehensive); UK; EU', 'US sanctions are comprehensive. Check for any US connection.'),
    (p_org, 'Syria', 'extensive', 'Australia (autonomous); US; UK; EU', 'Regimes have been changing. Confirm current position before relying on this.'),
    (p_org, 'Russia', 'extensive', 'Australia (autonomous, Russia/Ukraine); US; UK; EU', 'Wide trade, finance and services restrictions and many designated persons.'),
    (p_org, 'Belarus', 'extensive', 'US; UK; EU; Australia (designations under the Russia/Ukraine regime)', null),
    (p_org, 'Crimea and Sevastopol', 'comprehensive', 'Australia (autonomous, Russia/Ukraine); US; UK; EU', 'Occupied region of Ukraine.'),
    (p_org, 'Donetsk', 'comprehensive', 'Australia (autonomous, Russia/Ukraine); US; UK; EU', 'Occupied region of Ukraine.'),
    (p_org, 'Luhansk', 'comprehensive', 'Australia (autonomous, Russia/Ukraine); US; UK; EU', 'Occupied region of Ukraine.'),
    (p_org, 'Kherson', 'comprehensive', 'Australia (autonomous, Russia/Ukraine); UK; EU', 'Occupied parts of the region.'),
    (p_org, 'Zaporizhzhia', 'comprehensive', 'Australia (autonomous, Russia/Ukraine); UK; EU', 'Occupied parts of the region.'),
    (p_org, 'Cuba', 'extensive', 'US (comprehensive embargo)', 'Mainly relevant where there is a US connection.'),
    (p_org, 'Venezuela', 'targeted', 'US; UK; EU', null),
    (p_org, 'Myanmar', 'targeted', 'Australia (autonomous); US; UK; EU', 'Arms embargo and designated persons.'),
    (p_org, 'Libya', 'targeted', 'Australia (autonomous); UN', 'Arms embargo and designated persons.'),
    (p_org, 'Zimbabwe', 'targeted', 'Australia (autonomous)', 'Designated persons and arms.'),
    (p_org, 'Serbia and Montenegro (former FRY)', 'targeted', 'Australia (autonomous)', 'Designated persons.'),
    (p_org, 'Afghanistan', 'targeted', 'UN (Taliban); Australia', 'Designated persons.'),
    (p_org, 'Central African Republic', 'targeted', 'UN', null),
    (p_org, 'Democratic Republic of the Congo', 'targeted', 'UN', null),
    (p_org, 'Guinea-Bissau', 'targeted', 'UN', null),
    (p_org, 'Iraq', 'targeted', 'UN', null),
    (p_org, 'Lebanon', 'targeted', 'UN', null),
    (p_org, 'Somalia', 'targeted', 'UN', null),
    (p_org, 'South Sudan', 'targeted', 'UN', null),
    (p_org, 'Sudan', 'targeted', 'UN', null),
    (p_org, 'Yemen', 'targeted', 'UN', null);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Assessments
-- ---------------------------------------------------------------------
create table public.sanctions_assessments (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  counterparty_id    uuid references public.counterparties (id) on delete set null,
  contract_id        uuid references public.contracts (id) on delete set null,
  entity_id          uuid references public.entities (id) on delete set null,
  subject_name       text not null check (char_length(btrim(subject_name)) between 2 and 300),
  subject_type       text not null default 'company' check (subject_type in ('company', 'individual', 'vessel', 'other')),
  description        text,
  countries          text[] not null default '{}',
  -- Screening
  screened_on        date,
  screened_by        text,
  screening_tool     text,
  lists_checked      text[] not null default '{}',
  persons_screened   text,
  screening_result   text check (screening_result in ('no_match', 'potential_match', 'confirmed_match')),   -- null = not screened
  screening_notes    text,
  -- Questions: key -> 'yes' | 'no' | 'unknown'
  answers            jsonb not null default '{}'::jsonb,
  -- Set by the database
  risk_level         text not null default 'incomplete' check (risk_level in ('stop', 'high', 'medium', 'low', 'incomplete')),
  risk_reasons       text[] not null default '{}',
  -- Workflow
  status             text not null default 'draft' check (status in ('draft', 'submitted', 'decided', 'withdrawn')),
  submitted_at       timestamptz,
  outcome            text check (outcome in ('proceed', 'proceed_conditions', 'licence_required', 'do_not_proceed')),
  conditions         text,
  decision_note      text,
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  licence_reference  text,
  licence_expires_on date,
  next_screen_on     date,
  previous_id        uuid references public.sanctions_assessments (id) on delete set null,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index sanctions_assessments_org_idx on public.sanctions_assessments (organisation_id, status);
create index sanctions_assessments_party_idx on public.sanctions_assessments (counterparty_id);

-- The questions and which answer is adverse
create or replace function app.sanctions_questions()
returns table (key text, adverse text) language sql immutable as $$
  values ('owned_controlled', 'yes'), ('military_dual_use', 'yes'), ('restricted_sector', 'yes'), ('end_use_known', 'no'),
         ('transshipment', 'yes'), ('us_nexus', 'yes'), ('eu_uk_nexus', 'yes'), ('red_flags', 'yes'), ('contract_clause', 'no');
$$;

-- The rating and its reasons
create or replace function app.rate_sanctions(p public.sanctions_assessments)
returns table (level text, reasons text[]) language plpgsql stable security definer set search_path = '' as $$
declare
  v_rank integer := 1;            -- 1 low, 2 medium, 3 high, 4 stop
  v_reasons text[] := '{}';
  v_missing text[] := '{}';
  v_country record;
  v_any_listed boolean := false;
  v_serious boolean := false;      -- a comprehensive or extensive country is involved
  a jsonb := coalesce(p.answers, '{}'::jsonb);
  q record;
  v_label constant jsonb := jsonb_build_object(
    'owned_controlled', 'ownership or control', 'military_dual_use', 'military or dual-use goods', 'restricted_sector', 'sanctioned sectors',
    'end_use_known', 'end user and end use', 'transshipment', 're-export or transshipment', 'us_nexus', 'US connection',
    'eu_uk_nexus', 'UK or EU connection', 'red_flags', 'red flags', 'contract_clause', 'sanctions clause');
begin
  -- Screening
  if p.screening_result is null then
    v_missing := array_append(v_missing, 'not screened');
  elsif p.screening_result = 'confirmed_match' then
    v_rank := 4; v_reasons := array_append(v_reasons, 'Screening found a confirmed match on a sanctions list');
  elsif p.screening_result = 'potential_match' then
    v_rank := greatest(v_rank, 3); v_reasons := array_append(v_reasons, 'Screening found a potential match that has not been ruled out');
  end if;
  if p.screening_result is not null and p.screened_on is not null and p.screened_on < current_date - 30 then
    v_reasons := array_append(v_reasons, ('Screening is ' || (current_date - p.screened_on) || ' days old'));
  end if;
  if p.screening_result is not null and coalesce(array_length(p.lists_checked, 1), 0) = 0 then
    v_missing := array_append(v_missing, 'lists checked not recorded');
  end if;

  -- Countries
  if coalesce(array_length(p.countries, 1), 0) = 0 then
    v_missing := array_append(v_missing, 'countries not recorded');
  end if;
  for v_country in
    select c.country, c.level from public.sanctions_countries c
    where c.organisation_id = p.organisation_id and lower(c.country) in (select lower(btrim(x)) from unnest(p.countries) x)
  loop
    v_any_listed := true;
    v_serious := v_serious or v_country.level in ('comprehensive', 'extensive');
    if v_country.level = 'comprehensive' then
      v_rank := 4; v_reasons := array_append(v_reasons, (v_country.country || ': comprehensive sanctions'));
    elsif v_country.level = 'extensive' then
      v_rank := greatest(v_rank, 3); v_reasons := array_append(v_reasons, (v_country.country || ': extensive sanctions'));
    else
      v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, (v_country.country || ': targeted sanctions'));
    end if;
  end loop;

  -- Questions
  for q in select * from app.sanctions_questions() loop
    if coalesce(a ->> q.key, '') not in ('yes', 'no') then
      v_missing := array_append(v_missing, ((v_label ->> q.key) || ' not known'));
    end if;
  end loop;
  if a ->> 'military_dual_use' = 'yes' then v_rank := greatest(v_rank, 3); v_reasons := array_append(v_reasons, 'Military, dual-use or export-controlled items'); end if;
  if a ->> 'red_flags' = 'yes' then v_rank := greatest(v_rank, 3); v_reasons := array_append(v_reasons, 'Red flags noted'); end if;
  if a ->> 'owned_controlled' = 'yes' then
    v_rank := greatest(v_rank, case when v_serious then 3 else 2 end);
    v_reasons := array_append(v_reasons, ('Owned or controlled by a government or by people in a listed country' || case when v_any_listed then ', with a listed country involved' else '' end));
  end if;
  if a ->> 'us_nexus' = 'yes' and v_any_listed then
    v_rank := greatest(v_rank, case when v_serious then 3 else 2 end);
    v_reasons := array_append(v_reasons, 'US connection with a listed country involved');
  end if;
  if a ->> 'eu_uk_nexus' = 'yes' and v_any_listed then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'UK or EU connection with a listed country involved'); end if;
  if a ->> 'restricted_sector' = 'yes' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Sanctioned sector'); end if;
  if a ->> 'transshipment' = 'yes' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Re-export or transshipment possible'); end if;
  if a ->> 'end_use_known' = 'no' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'End user or end use not known'); end if;
  if a ->> 'contract_clause' = 'no' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'No sanctions clause in the contract'); end if;

  if array_length(v_missing, 1) > 0 then
    v_reasons := array_append(v_reasons, ('Missing: ' || array_to_string(v_missing, ', ')));
  end if;
  level := case
    when v_rank = 4 then 'stop'
    when v_rank = 3 then 'high'
    when array_length(v_missing, 1) > 0 then 'incomplete'   -- unknown is never low or medium
    when v_rank = 2 then 'medium'
    else 'low' end;
  reasons := v_reasons;
  return next;
end;
$$;

create or replace function app.guard_sanctions_assessment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if coalesce(current_setting('app.sanctions_system', true), 'off') <> 'on' then
    if tg_op = 'UPDATE' then
      if new.organisation_id <> old.organisation_id then
        raise exception 'An assessment cannot move to another organisation';
      end if;
      if old.status <> 'draft' then
        raise exception 'Only a draft can be changed. Ask legal or compliance to return it to draft.';
      end if;
      if (new.status, new.outcome, new.decided_by, new.decided_at, new.submitted_at, new.next_screen_on, new.licence_reference, new.licence_expires_on, new.conditions, new.decision_note)
         is distinct from (old.status, old.outcome, old.decided_by, old.decided_at, old.submitted_at, old.next_screen_on, old.licence_reference, old.licence_expires_on, old.conditions, old.decision_note) then
        raise exception 'Use Submit or Decide to change the status';
      end if;
    else
      new.status := 'draft'; new.outcome := null; new.decided_by := null; new.decided_at := null; new.submitted_at := null;
      new.next_screen_on := null; new.licence_reference := null; new.licence_expires_on := null; new.conditions := null; new.decision_note := null;
      new.created_by := coalesce(auth.uid(), new.created_by);
    end if;
  end if;
  if new.counterparty_id is not null and not exists (select 1 from public.counterparties c where c.id = new.counterparty_id and c.organisation_id = new.organisation_id) then
    raise exception 'That third party is not in this organisation';
  end if;
  if new.contract_id is not null and not exists (select 1 from public.contracts c where c.id = new.contract_id and c.organisation_id = new.organisation_id) then
    raise exception 'That contract is not in this organisation';
  end if;
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if new.screened_on is not null and new.screened_on > current_date then
    raise exception 'The screening date cannot be in the future';
  end if;
  if exists (select 1 from jsonb_each_text(coalesce(new.answers, '{}'::jsonb)) e
             where e.key not in (select key from app.sanctions_questions()) or e.value not in ('yes', 'no', 'unknown')) then
    raise exception 'Answers must be yes, no or not known';
  end if;
  new.countries := array(select distinct btrim(x) from unnest(new.countries) x where btrim(x) <> '');
  select * into r from app.rate_sanctions(new);
  new.risk_level := r.level;
  new.risk_reasons := r.reasons;
  return new;
end;
$$;
create trigger sanctions_assessments_guard before insert or update on public.sanctions_assessments
  for each row execute function app.guard_sanctions_assessment();

-- Re-rate open assessments when the country list changes
create or replace function app.rerate_sanctions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.sanctions_system', 'on', true);
  update public.sanctions_assessments set updated_at = now()
  where organisation_id = coalesce(new.organisation_id, old.organisation_id) and status in ('draft', 'submitted');
  perform set_config('app.sanctions_system', 'off', true);
  return null;
end;
$$;
create trigger sanctions_countries_rerate after insert or update or delete on public.sanctions_countries
  for each row execute function app.rerate_sanctions();

-- ---------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------
create or replace function public.submit_sanctions(p_assessment uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.sanctions_assessments%rowtype;
begin
  select * into s from public.sanctions_assessments where id = p_assessment for update;
  if s.id is null or not (s.created_by = auth.uid() or app.has_role(s.organisation_id, app.records_roles())) then
    raise exception 'You do not have permission to do this';
  end if;
  if s.status <> 'draft' then
    raise exception 'Only a draft can be submitted';
  end if;
  perform set_config('app.sanctions_system', 'on', true);
  update public.sanctions_assessments set status = 'submitted', submitted_at = now() where id = s.id returning risk_level into s.risk_level;
  perform set_config('app.sanctions_system', 'off', true);
  return s.risk_level;
end;
$$;

create or replace function public.decide_sanctions(p_assessment uuid, p_outcome text, p_conditions text, p_note text, p_next_screen_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.sanctions_assessments%rowtype;
begin
  select * into s from public.sanctions_assessments where id = p_assessment for update;
  if s.id is null or not app.has_role(s.organisation_id, app.records_roles()) then
    raise exception 'Only legal, compliance, the company secretary, an owner or an administrator can decide';
  end if;
  if s.status <> 'submitted' then
    raise exception 'Only a submitted assessment can be decided';
  end if;
  if p_outcome not in ('proceed', 'proceed_conditions', 'licence_required', 'do_not_proceed') then
    raise exception 'Choose an outcome';
  end if;
  if s.created_by = auth.uid() and s.risk_level <> 'low' then
    raise exception 'Someone other than the person who raised it must decide an assessment that is not low risk';
  end if;
  if s.risk_level = 'stop' and p_outcome not in ('do_not_proceed', 'licence_required') then
    raise exception 'A stop result can only be "do not proceed" or "permit or licence required"';
  end if;
  if s.risk_level = 'incomplete' and p_outcome in ('proceed', 'proceed_conditions') then
    raise exception 'The assessment is incomplete. Return it to draft to finish it, or decide not to proceed.';
  end if;
  if p_outcome = 'proceed_conditions' and char_length(btrim(coalesce(p_conditions, ''))) < 5 then
    raise exception 'State the conditions';
  end if;
  if p_outcome in ('do_not_proceed', 'licence_required') and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Give the reason';
  end if;
  if p_next_screen_on is not null and p_next_screen_on <= current_date then
    raise exception 'The re-screen date must be in the future';
  end if;
  perform set_config('app.sanctions_system', 'on', true);
  update public.sanctions_assessments set
    status = 'decided', outcome = p_outcome,
    conditions = nullif(btrim(coalesce(p_conditions, '')), ''),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''),
    decided_by = auth.uid(), decided_at = now(),
    next_screen_on = case when p_outcome = 'do_not_proceed' then null
                          else coalesce(p_next_screen_on, (current_date + case when s.risk_level in ('high', 'stop') then interval '6 months' else interval '12 months' end)::date) end
  where id = s.id;
  perform set_config('app.sanctions_system', 'off', true);
end;
$$;

create or replace function public.record_sanctions_licence(p_assessment uuid, p_reference text, p_expires_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.sanctions_assessments%rowtype;
begin
  select * into s from public.sanctions_assessments where id = p_assessment for update;
  if s.id is null or not app.has_role(s.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  if s.outcome is distinct from 'licence_required' then
    raise exception 'This assessment does not need a permit or licence';
  end if;
  if char_length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception 'Give the permit or licence reference';
  end if;
  perform set_config('app.sanctions_system', 'on', true);
  update public.sanctions_assessments set licence_reference = btrim(p_reference), licence_expires_on = p_expires_on,
    next_screen_on = least(coalesce(next_screen_on, p_expires_on), coalesce(p_expires_on, next_screen_on))
  where id = s.id;
  perform set_config('app.sanctions_system', 'off', true);
end;
$$;

-- Back to draft (for more work), or withdrawn (no longer needed)
create or replace function public.reopen_sanctions(p_assessment uuid, p_withdraw boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.sanctions_assessments%rowtype;
begin
  select * into s from public.sanctions_assessments where id = p_assessment for update;
  if s.id is null or not (app.has_role(s.organisation_id, app.records_roles()) or (s.created_by = auth.uid() and s.status in ('draft', 'submitted'))) then
    raise exception 'You do not have permission to do this';
  end if;
  if s.status = 'decided' and not p_withdraw then
    raise exception 'A decided assessment is not reopened. Start a re-screen instead.';
  end if;
  perform set_config('app.sanctions_system', 'on', true);
  update public.sanctions_assessments set status = case when p_withdraw then 'withdrawn' else 'draft' end, submitted_at = null where id = s.id;
  perform set_config('app.sanctions_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Files: screening reports and other evidence
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%sanctions_assessments%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''insurance_policies''', '''insurance_policies'', ''sanctions_assessments''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%sanctions_assessments%' then
    v_def := replace(v_def, $x$  else
    raise exception 'Files cannot be attached to that kind of record';$x$, $x$  elsif p_table = 'sanctions_assessments' then
    select s.organisation_id, (app.has_role(s.organisation_id, app.records_roles()) or s.created_by = auth.uid()) into v_org, v_ok
    from public.sanctions_assessments s where s.id = p_id;
  else
    raise exception 'Files cannot be attached to that kind of record';$x$);
    if v_def not like '%sanctions_assessments%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%sanctions_assessments%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Ladder up into the Risk Register (extends risk_feed from 0037)
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments'));

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%sanctions_assessments%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- Sanctions: high or stop awaiting a decision, a permit still to be recorded, or a re-screen overdue
    select 'sanctions_assessments', s.id, 'Sanctions', v_legal,
           case
             when s.status = 'submitted' then 'Sanctions assessment awaiting decision (' || s.risk_level || ' risk): ' || s.subject_name
             when s.outcome = 'licence_required' and s.licence_reference is null then 'Sanctions permit or licence not yet obtained: ' || s.subject_name
             else 'Sanctions re-screen overdue: ' || s.subject_name || ' (due ' || to_char(s.next_screen_on, 'FMDD Mon YYYY') || ')'
           end
           || coalesce(E'\n' || array_to_string(s.risk_reasons[1:3], '; '), ''),
           case when s.status = 'submitted' then 'Decide the assessment' when s.outcome = 'licence_required' and s.licence_reference is null then 'Apply for the permit; do not proceed until granted' else 'Re-screen the party' end,
           null::text,
           case when s.status = 'submitted' then null else s.next_screen_on end
    from public.sanctions_assessments s
    where s.organisation_id = v_org
      and ((s.status = 'submitted' and s.risk_level in ('high', 'stop'))
           or (s.status = 'decided' and s.outcome = 'licence_required' and s.licence_reference is null)
           or (s.status = 'decided' and s.outcome <> 'do_not_proceed' and s.next_screen_on < current_date
               and not exists (select 1 from public.sanctions_assessments n where n.previous_id = s.id and n.status <> 'withdrawn')))
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%sanctions_assessments%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.sanctions_countries, public.sanctions_assessments from anon, authenticated;
grant select on public.sanctions_countries, public.sanctions_assessments to authenticated;
grant insert (organisation_id, country, level, regimes, notes), update (country, level, regimes, notes), delete on public.sanctions_countries to authenticated;
grant insert (organisation_id, counterparty_id, contract_id, entity_id, subject_name, subject_type, description, countries, screened_on, screened_by,
              screening_tool, lists_checked, persons_screened, screening_result, screening_notes, answers, previous_id),
      update (counterparty_id, contract_id, entity_id, subject_name, subject_type, description, countries, screened_on, screened_by,
              screening_tool, lists_checked, persons_screened, screening_result, screening_notes, answers)
  on public.sanctions_assessments to authenticated;
grant all on public.sanctions_countries, public.sanctions_assessments to service_role;

alter table public.sanctions_countries enable row level security;
alter table public.sanctions_assessments enable row level security;

create policy sanctions_countries_select on public.sanctions_countries for select to authenticated using (app.is_member(organisation_id));
create policy sanctions_countries_insert on public.sanctions_countries for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy sanctions_countries_update on public.sanctions_countries for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy sanctions_countries_delete on public.sanctions_countries for delete to authenticated using (app.has_role(organisation_id, app.records_roles()));

create policy sanctions_assessments_select on public.sanctions_assessments for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or created_by = auth.uid());
create policy sanctions_assessments_insert on public.sanctions_assessments for insert to authenticated
  with check (app.has_role(organisation_id, app.contributor_roles()));
create policy sanctions_assessments_update on public.sanctions_assessments for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or created_by = auth.uid())
  with check (app.has_role(organisation_id, app.records_roles()) or created_by = auth.uid());

create trigger sanctions_countries_touch before update on public.sanctions_countries for each row execute function app.touch_updated_at();
create trigger sanctions_countries_audit after insert or update or delete on public.sanctions_countries for each row execute function app.audit_row();
create trigger sanctions_assessments_touch before update on public.sanctions_assessments for each row execute function app.touch_updated_at();
create trigger sanctions_assessments_audit after insert or update or delete on public.sanctions_assessments for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
revoke execute on function public.ensure_sanctions_countries(uuid), public.submit_sanctions(uuid),
  public.decide_sanctions(uuid, text, text, text, date), public.record_sanctions_licence(uuid, text, date),
  public.reopen_sanctions(uuid, boolean) from public, anon;
grant execute on function public.ensure_sanctions_countries(uuid), public.submit_sanctions(uuid),
  public.decide_sanctions(uuid, text, text, text, date), public.record_sanctions_licence(uuid, text, date),
  public.reopen_sanctions(uuid, boolean) to authenticated;

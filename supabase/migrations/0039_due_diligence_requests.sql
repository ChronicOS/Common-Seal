-- 0039: Due diligence requests for third parties.
--
-- Adding a third party now means asking for due diligence on it. Anyone in the
-- business (the "business owner") can request it, before any binding commitment:
--   1. The third party: type, where it is and works, what it will do, expected value,
--      who owns the relationship, and why due diligence is needed now.
--   2. Scope: some engagements need no due diligence (an NDA only, standard
--      government fees, retailers and end consumers, card purchases under the
--      expenses policy, low-value purchases in low-corruption-risk countries...).
--      Those are recorded as exemptions with the reason, and kept.
--   3. Risk questions, each yes / no / not known. They give the inherent risk
--      (low, medium, high) with the reasons. Not known never gives low.
--   4. The checks follow the risk: basic screening for everyone (politically
--      exposed and special interest persons, sanctions lists, ownership by
--      designated persons, state ownership, other official lists, adverse media);
--      a red flag report for medium; enhanced due diligence and a questionnaire
--      to the third party for high. Customers and distributors also get
--      identification checks. A target date follows the risk (5, 10 or 20 working days).
-- Legal or compliance completes the checks and gives the engagement advice:
-- cleared, cleared with conditions (with mitigations to complete before or during
-- the engagement), or rejected. Only a low risk can be decided by the person who
-- asked for it. If the business owner disagrees, they escalate; the final decision
-- (and who made it) is recorded.
--
-- Contracts: approval is blocked while due diligence is open (any risk), when the
-- party was rejected (unless a senior decision accepted the risk), and while any
-- "before the engagement" mitigation is outstanding.

-- ---------------------------------------------------------------------
-- More about the third party
-- ---------------------------------------------------------------------
alter table public.counterparties add column if not exists party_type text check (party_type in
  ('supplier', 'service_provider', 'distributor', 'sales_agent', 'process_agent', 'joint_venture', 'sub_contractor',
   'research_partner', 'customer', 'donation_recipient', 'other'));
alter table public.counterparties add column if not exists registration_number text;
alter table public.counterparties add column if not exists website text;
alter table public.counterparties add column if not exists countries text[] not null default '{}';
alter table public.counterparties add column if not exists description text;
alter table public.counterparties add column if not exists business_owner_user_id uuid references auth.users (id) on delete set null;
alter table public.counterparties add column if not exists annual_value numeric(16, 2) check (annual_value is null or annual_value >= 0);
alter table public.counterparties add column if not exists currency text not null default 'AUD';

-- ---------------------------------------------------------------------
-- Cases: who asked, why, by when, the reasons and the escalation
-- ---------------------------------------------------------------------
alter table public.dd_cases add column if not exists trigger_reason text;
alter table public.dd_cases add column if not exists requested_by uuid references auth.users (id) on delete set null;
alter table public.dd_cases add column if not exists target_on date;
alter table public.dd_cases add column if not exists risk_reasons text[] not null default '{}';
alter table public.dd_cases add column if not exists concerns text;
alter table public.dd_cases add column if not exists escalation_note text;
alter table public.dd_cases add column if not exists escalated_at timestamptz;
alter table public.dd_cases add column if not exists escalated_by uuid references auth.users (id) on delete set null;
alter table public.dd_cases add column if not exists final_decision text check (final_decision in ('proceed', 'proceed_conditions', 'do_not_proceed'));
alter table public.dd_cases add column if not exists final_decided_by_name text;
alter table public.dd_cases add column if not exists final_decision_note text;
alter table public.dd_cases add column if not exists final_decided_at timestamptz;

alter table public.dd_checks drop constraint if exists dd_checks_topic_check;
alter table public.dd_checks add constraint dd_checks_topic_check check (topic in
  ('abc', 'sanctions', 'modern_slavery', 'aml_kyc',
   'pep', 'sip', 'official_lists', 'sanctions_ownership', 'state_owned', 'adverse_media',
   'red_flag', 'enhanced', 'questionnaire'));

-- The questions (version 2) and how each answer counts
create or replace function app.dd_questions()
returns table (key text, adverse text, weight text, label text) language sql immutable as $$
  values
    ('government_interaction', 'yes', 'high',   'deals with government officials or state bodies for us'),
    ('government_links',       'yes', 'high',   'is, or is owned or run by, a government official, politically exposed person or the state'),
    ('acts_on_our_behalf',     'yes', 'medium', 'acts on our behalf'),
    ('unusual_payment',        'yes', 'high',   'asks for unusual payment terms'),
    ('ownership_unclear',      'yes', 'high',   'ownership is unclear or not disclosed'),
    ('adverse_history',        'yes', 'high',   'has a known history of misconduct'),
    ('high_risk_sector',       'yes', 'medium', 'works in a higher-risk sector'),
    ('large_value',            'yes', 'medium', 'expected value is over AUD 250,000 a year'),
    ('sub_contractors',        'yes', 'medium', 'will sub-contract 25% or more'),
    ('labour_risk',            'yes', 'medium', 'has modern slavery risk indicators'),
    ('has_compliance_policies','no',  'medium', 'has no code of conduct or anti-bribery policy');
$$;

-- Rating: version 2 answers; earlier cases keep the original rules
create or replace function app.dd_assess(p_answers jsonb)
returns table (level public.risk_level, reasons text[]) language plpgsql immutable set search_path = '' as $$
declare
  v_rank integer := 1;
  v_reasons text[] := '{}';
  v_unknown text[] := '{}';
  q record;
  v_country text := p_answers ->> 'country_risk';
begin
  if coalesce(p_answers ->> 'v', '1') <> '2' then
    level := app.dd_rating(p_answers);
    reasons := '{}';
    return next;
    return;
  end if;
  -- Corruption risk of the countries involved (Transparency International CPI): high below 40, medium 40 to 59
  if v_country = 'high' then
    v_rank := 3; v_reasons := array_append(v_reasons, 'Countries with a high corruption risk (CPI below 40)');
  elsif v_country = 'medium' then
    v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Countries with a medium corruption risk (CPI 40 to 59)');
  elsif coalesce(v_country, '') <> 'low' then
    v_unknown := array_append(v_unknown, 'country corruption risk');
  end if;
  for q in select * from app.dd_questions() loop
    if coalesce(p_answers ->> q.key, '') not in ('yes', 'no') then
      v_unknown := array_append(v_unknown, q.label);
    elsif p_answers ->> q.key = q.adverse then
      v_rank := greatest(v_rank, case q.weight when 'high' then 3 else 2 end);
      v_reasons := array_append(v_reasons, upper(left(q.label, 1)) || substr(q.label, 2));
    end if;
  end loop;
  -- Acting for us where corruption risk is not low is high
  if p_answers ->> 'acts_on_our_behalf' = 'yes' and coalesce(v_country, '') in ('medium', 'high') then
    v_rank := 3;
  end if;
  if array_length(v_unknown, 1) > 0 then
    v_rank := greatest(v_rank, 2);   -- not known is never low
    v_reasons := array_append(v_reasons, 'Not known: ' || array_to_string(v_unknown, '; '));
  end if;
  level := (case v_rank when 3 then 'high' when 2 then 'medium' else 'low' end)::public.risk_level;
  reasons := v_reasons;
  return next;
end;
$$;

create or replace function app.guard_dd_case()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if coalesce(current_setting('app.dd_system', true), 'off') <> 'on' then
    raise exception 'Due diligence cases change only through the due diligence functions';
  end if;
  select * into r from app.dd_assess(new.answers);
  new.risk_rating := r.level;
  new.risk_reasons := r.reasons;
  return new;
end;
$$;

-- Working days from today (Monday to Friday)
create or replace function app.add_working_days(p_from date, p_days integer)
returns date language plpgsql immutable as $$
declare
  d date := p_from;
  n integer := 0;
begin
  while n < p_days loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return d;
end;
$$;

-- ---------------------------------------------------------------------
-- Exemptions (out of scope) and mitigations
-- ---------------------------------------------------------------------
create table public.dd_exemptions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  counterparty_id  uuid not null references public.counterparties (id) on delete cascade,
  exemption        text not null check (exemption in ('nda_only', 'temporary_worker', 'health_professional', 'government_charges',
                                                      'retailer_or_consumer', 'corporate_card', 'single_event', 'office_supplies', 'low_value_low_risk')),
  reason           text not null check (char_length(btrim(reason)) >= 10),
  evidence         text,
  recorded_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index dd_exemptions_party_idx on public.dd_exemptions (counterparty_id);

create table public.dd_mitigations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  case_id          uuid not null references public.dd_cases (id) on delete cascade,
  action           text not null check (char_length(btrim(action)) >= 5),
  timing           text not null check (timing in ('before', 'during')),
  owner_name       text,
  due_on           date,
  done_at          timestamptz,
  done_by          uuid references auth.users (id) on delete set null,
  done_note        text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index dd_mitigations_case_idx on public.dd_mitigations (case_id);

-- ---------------------------------------------------------------------
-- Requesting due diligence
-- ---------------------------------------------------------------------
-- Creates the third party (or uses an existing one), records the answers and
-- opens the case with the checks its risk calls for.
create or replace function public.request_due_diligence(p_org uuid, p_counterparty uuid, p_party jsonb, p_trigger text, p_answers jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_party uuid := p_counterparty;
  v_case uuid;
  v_rating public.risk_level;
  v_type text := nullif(p_party ->> 'party_type', '');
  v_topics text[] := array['pep', 'sip', 'sanctions', 'sanctions_ownership', 'state_owned', 'official_lists', 'adverse_media'];
  v_answers jsonb := coalesce(p_answers, '{}'::jsonb) || '{"v":"2"}'::jsonb;
  v_topic text;
  v_countries text[];
begin
  if not app.has_role(p_org, app.contributor_roles()) then
    raise exception 'You do not have permission to request due diligence';
  end if;
  if char_length(btrim(coalesce(p_trigger, ''))) < 3 then
    raise exception 'Say why due diligence is needed now';
  end if;
  select array(select btrim(x) from jsonb_array_elements_text(coalesce(p_party -> 'countries', '[]'::jsonb)) x where btrim(x) <> '') into v_countries;

  perform set_config('app.dd_system', 'on', true);
  if v_party is null then
    if char_length(btrim(coalesce(p_party ->> 'name', ''))) < 2 then
      raise exception 'Give the third party''s name';
    end if;
    insert into public.counterparties (organisation_id, name, kind, country, party_type, registration_number, website, countries, description,
                                       business_owner_user_id, annual_value, currency)
    values (p_org, btrim(p_party ->> 'name'),
            (case when v_type in ('customer', 'distributor') then 'customer' else 'third_party' end)::public.party_kind,
            nullif(btrim(coalesce(p_party ->> 'country', '')), ''), v_type,
            nullif(btrim(coalesce(p_party ->> 'registration_number', '')), ''), nullif(btrim(coalesce(p_party ->> 'website', '')), ''),
            v_countries, nullif(btrim(coalesce(p_party ->> 'description', '')), ''),
            coalesce(nullif(p_party ->> 'business_owner_user_id', '')::uuid, auth.uid()),
            nullif(p_party ->> 'annual_value', '')::numeric, coalesce(nullif(p_party ->> 'currency', ''), 'AUD'))
    returning id into v_party;
  else
    if not exists (select 1 from public.counterparties c where c.id = v_party and c.organisation_id = p_org) then
      raise exception 'That third party is not in this organisation';
    end if;
    update public.counterparties set
      party_type = coalesce(v_type, party_type),
      country = coalesce(nullif(btrim(coalesce(p_party ->> 'country', '')), ''), country),
      registration_number = coalesce(nullif(btrim(coalesce(p_party ->> 'registration_number', '')), ''), registration_number),
      website = coalesce(nullif(btrim(coalesce(p_party ->> 'website', '')), ''), website),
      countries = case when cardinality(v_countries) > 0 then v_countries else countries end,
      description = coalesce(nullif(btrim(coalesce(p_party ->> 'description', '')), ''), description),
      business_owner_user_id = coalesce(nullif(p_party ->> 'business_owner_user_id', '')::uuid, business_owner_user_id, auth.uid()),
      annual_value = coalesce(nullif(p_party ->> 'annual_value', '')::numeric, annual_value)
    where id = v_party;
  end if;
  if exists (select 1 from public.dd_cases d where d.counterparty_id = v_party and d.status = 'open') then
    raise exception 'Due diligence is already open for this third party';
  end if;

  select level into v_rating from app.dd_assess(v_answers);
  if v_type in ('customer', 'distributor') then v_topics := array_append(v_topics, 'aml_kyc'); end if;
  if v_answers ->> 'labour_risk' in ('yes', 'unknown') or v_answers ->> 'labour_risk' is null then v_topics := array_append(v_topics, 'modern_slavery'); end if;
  if v_rating in ('medium', 'high') then v_topics := array_append(v_topics, 'red_flag'); end if;
  if v_rating = 'high' then v_topics := v_topics || array['enhanced', 'questionnaire']; end if;

  insert into public.dd_cases (organisation_id, counterparty_id, answers, opened_by, requested_by, trigger_reason, target_on)
  values (p_org, v_party, v_answers, auth.uid(), auth.uid(), btrim(p_trigger),
          app.add_working_days(current_date, case v_rating when 'high' then 20 when 'medium' then 10 else 5 end))
  returning id into v_case;
  foreach v_topic in array v_topics loop
    insert into public.dd_checks (organisation_id, case_id, topic) values (p_org, v_case, v_topic) on conflict do nothing;
  end loop;
  update public.counterparties set dd_status = 'open', risk_rating = v_rating where id = v_party;
  perform set_config('app.dd_system', 'off', true);
  return v_case;
end;
$$;

-- Out of scope: no due diligence needed, with the reason kept on record
create or replace function public.record_dd_exemption(p_org uuid, p_counterparty uuid, p_party jsonb, p_exemption text, p_reason text, p_evidence text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_party uuid := p_counterparty;
  v_id uuid;
  v_type text := nullif(p_party ->> 'party_type', '');
begin
  if not app.has_role(p_org, app.contributor_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Explain why due diligence is not needed';
  end if;
  if v_party is null then
    if char_length(btrim(coalesce(p_party ->> 'name', ''))) < 2 then
      raise exception 'Give the third party''s name';
    end if;
    insert into public.counterparties (organisation_id, name, kind, country, party_type, description, business_owner_user_id, annual_value)
    values (p_org, btrim(p_party ->> 'name'),
            (case when v_type in ('customer', 'distributor') then 'customer' else 'third_party' end)::public.party_kind,
            nullif(btrim(coalesce(p_party ->> 'country', '')), ''), v_type, nullif(btrim(coalesce(p_party ->> 'description', '')), ''),
            coalesce(nullif(p_party ->> 'business_owner_user_id', '')::uuid, auth.uid()), nullif(p_party ->> 'annual_value', '')::numeric)
    returning id into v_party;
  elsif not exists (select 1 from public.counterparties c where c.id = v_party and c.organisation_id = p_org) then
    raise exception 'That third party is not in this organisation';
  end if;
  insert into public.dd_exemptions (organisation_id, counterparty_id, exemption, reason, evidence, recorded_by)
  values (p_org, v_party, p_exemption, btrim(p_reason), nullif(btrim(coalesce(p_evidence, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Advice, mitigations and escalation
-- ---------------------------------------------------------------------
create or replace function public.set_dd_concerns(p_case uuid, p_concerns text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.dd_cases where id = p_case;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  perform set_config('app.dd_system', 'on', true);
  update public.dd_cases set concerns = nullif(btrim(coalesce(p_concerns, '')), '') where id = p_case;
  perform set_config('app.dd_system', 'off', true);
end;
$$;

create or replace function public.add_dd_mitigation(p_case uuid, p_action text, p_timing text, p_owner text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.dd_cases%rowtype;
  v_id uuid;
begin
  select * into c from public.dd_cases where id = p_case;
  if c.id is null or not app.has_role(c.organisation_id, app.records_roles()) then
    raise exception 'Only legal or compliance can set mitigations';
  end if;
  if c.status not in ('open', 'cleared_with_conditions') then
    raise exception 'Mitigations are for open cases, or cases cleared with conditions';
  end if;
  insert into public.dd_mitigations (organisation_id, case_id, action, timing, owner_name, due_on, created_by)
  values (c.organisation_id, c.id, btrim(p_action), p_timing, nullif(btrim(coalesce(p_owner, '')), ''), p_due, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- The business owner implements mitigations; they or legal/compliance mark them done
create or replace function public.complete_dd_mitigation(p_mitigation uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.dd_mitigations%rowtype;
  c public.dd_cases%rowtype;
begin
  select * into m from public.dd_mitigations where id = p_mitigation for update;
  select * into c from public.dd_cases where id = m.case_id;
  if m.id is null or not (app.has_role(m.organisation_id, app.records_roles()) or c.requested_by = auth.uid()
                          or exists (select 1 from public.counterparties p where p.id = c.counterparty_id and p.business_owner_user_id = auth.uid())) then
    raise exception 'You do not have permission to do this';
  end if;
  update public.dd_mitigations set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, auth.uid()),
    done_note = nullif(btrim(coalesce(p_note, '')), '') where id = m.id;
end;
$$;

create or replace function public.escalate_dd_case(p_case uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.dd_cases%rowtype;
begin
  select * into c from public.dd_cases where id = p_case for update;
  if c.id is null or not (c.requested_by = auth.uid() or app.has_role(c.organisation_id, app.records_roles())
                          or exists (select 1 from public.counterparties p where p.id = c.counterparty_id and p.business_owner_user_id = auth.uid())) then
    raise exception 'You do not have permission to do this';
  end if;
  if c.status not in ('rejected', 'cleared_with_conditions') then
    raise exception 'Only a rejection or conditions can be escalated';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'Explain why you disagree';
  end if;
  perform set_config('app.dd_system', 'on', true);
  update public.dd_cases set escalation_note = btrim(p_note), escalated_at = now(), escalated_by = auth.uid(),
    final_decision = null, final_decided_by_name = null, final_decision_note = null, final_decided_at = null where id = c.id;
  perform set_config('app.dd_system', 'off', true);
end;
$$;

-- The senior decision after an escalation, recorded by legal or compliance
create or replace function public.resolve_dd_escalation(p_case uuid, p_decision text, p_decided_by text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.dd_cases%rowtype;
begin
  select * into c from public.dd_cases where id = p_case for update;
  if c.id is null or not app.has_role(c.organisation_id, app.records_roles()) then
    raise exception 'Only legal or compliance records the final decision';
  end if;
  if c.escalated_at is null then
    raise exception 'This case has not been escalated';
  end if;
  if p_decision not in ('proceed', 'proceed_conditions', 'do_not_proceed') then
    raise exception 'Choose the decision';
  end if;
  if char_length(btrim(coalesce(p_decided_by, ''))) < 3 then
    raise exception 'Say who made the decision (name and title)';
  end if;
  perform set_config('app.dd_system', 'on', true);
  update public.dd_cases set final_decision = p_decision, final_decided_by_name = btrim(p_decided_by),
    final_decision_note = nullif(btrim(coalesce(p_note, '')), ''), final_decided_at = now() where id = c.id;
  perform set_config('app.dd_system', 'off', true);
end;
$$;

-- Only a low risk can be decided by the person who asked for it
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.decide_dd_case(uuid, public.dd_case_status, text)'::regprocedure);
  if v_def not like '%person who asked for it must decide%' then
    v_def := replace(v_def, $x$  if p_outcome = 'open' then$x$, $x$  if v_c.requested_by = auth.uid() and v_c.risk_rating <> 'low' then
    raise exception 'Someone other than the person who asked for it must decide a % risk case', v_c.risk_rating;
  end if;
  if p_outcome = 'open' then$x$);
    if v_def not like '%person who asked for it must decide%' then
      raise exception 'Could not extend public.decide_dd_case';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Contract gate: open due diligence (any risk), a rejection without a senior decision to proceed,
-- or an outstanding "before the engagement" mitigation blocks approval
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.decide_contract_approval(uuid, boolean, text)'::regprocedure);
  if v_def not like '%before the engagement%' then
    v_def := replace(v_def, $x$    if v_party.dd_status = 'rejected' then$x$, $x$    if v_party.dd_status = 'rejected' and not exists (
         select 1 from public.dd_cases d where d.counterparty_id = v_party.id and d.status = 'rejected'
           and d.final_decision in ('proceed', 'proceed_conditions')
           and d.decided_at = (select max(x.decided_at) from public.dd_cases x where x.counterparty_id = v_party.id)) then$x$);
    v_def := replace(v_def, $x$    if v_party.dd_status = 'open' and v_party.risk_rating = 'high' then
      raise exception 'Blocked: % is rated high risk and its due diligence is not finished', v_party.name using errcode = 'P0001';
    end if;$x$, $x$    if v_party.dd_status = 'open' then
      raise exception 'Blocked: due diligence on % is not finished', v_party.name using errcode = 'P0001';
    end if;
    if exists (select 1 from public.dd_mitigations m join public.dd_cases d on d.id = m.case_id
               where d.counterparty_id = v_party.id and m.timing = 'before' and m.done_at is null) then
      raise exception 'Blocked: % has mitigations to complete before the engagement', v_party.name using errcode = 'P0001';
    end if;$x$);
    if v_def not like '%before the engagement%' then
      raise exception 'Could not extend public.decide_contract_approval';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.dd_exemptions, public.dd_mitigations from anon, authenticated;
grant select on public.dd_exemptions, public.dd_mitigations to authenticated;
grant all on public.dd_exemptions, public.dd_mitigations to service_role;
alter table public.dd_exemptions enable row level security;
alter table public.dd_mitigations enable row level security;

-- The business owner who asked can follow their own case
create policy dd_cases_select_own on public.dd_cases for select to authenticated
  using (requested_by = auth.uid() and app.is_member(organisation_id));
create policy dd_exemptions_select on public.dd_exemptions for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or recorded_by = auth.uid());
create policy dd_mitigations_select on public.dd_mitigations for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles())
         or exists (select 1 from public.dd_cases d where d.id = case_id and d.requested_by = auth.uid()));

create trigger dd_exemptions_audit after insert or update or delete on public.dd_exemptions for each row execute function app.audit_row();
create trigger dd_mitigations_audit after insert or update or delete on public.dd_mitigations for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
revoke execute on function public.request_due_diligence(uuid, uuid, jsonb, text, jsonb), public.record_dd_exemption(uuid, uuid, jsonb, text, text, text),
  public.set_dd_concerns(uuid, text), public.add_dd_mitigation(uuid, text, text, text, date), public.complete_dd_mitigation(uuid, text),
  public.escalate_dd_case(uuid, text), public.resolve_dd_escalation(uuid, text, text, text) from public, anon;
grant execute on function public.request_due_diligence(uuid, uuid, jsonb, text, jsonb), public.record_dd_exemption(uuid, uuid, jsonb, text, text, text),
  public.set_dd_concerns(uuid, text), public.add_dd_mitigation(uuid, text, text, text, date), public.complete_dd_mitigation(uuid, text),
  public.escalate_dd_case(uuid, text), public.resolve_dd_escalation(uuid, text, text, text) to authenticated;

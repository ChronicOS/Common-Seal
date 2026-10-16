-- 0042: Due diligence questionnaire to the third party, and a simpler request.
--
-- The business owner now gives only the basics (who the third party is, what
-- it will do, where, the expected value, why now). The third party completes a
-- questionnaire by personal link, with no account needed:
--   * company details: legal name, registration number, date of incorporation,
--     registered address, website, whether it is a corporation;
--   * current office holders (directors, secretary, other officers);
--   * shareholders, if a corporation (name, percentage);
--   * whether there is any active or threatened litigation, any insolvency
--     event, or any adverse press coverage, involving the company or any of
--     its directors (with details);
--   * confirmation that it holds the licences, authorisations, permits and
--     professional memberships needed to operate where it proposes to (and
--     what they are);
--   * a declaration by a named person, with a typed signature.
--
-- Rating (version 3): from the kind of third party (agents high; distributors,
-- joint ventures, sub-contractors and donation recipients medium), the value
-- (over AUD 250,000 a year is at least medium), and the questionnaire (insolvency,
-- adverse press or licences not confirmed are high; litigation is medium). Until
-- the questionnaire comes back, nothing is rated low. When it comes back the case
-- is re-rated, its questionnaire check is marked clear or concern, and the
-- deeper checks a higher rating calls for are added.

create table public.dd_questionnaires (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  case_id          uuid not null references public.dd_cases (id) on delete cascade,
  token            text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  contact_name     text,
  contact_email    text check (contact_email is null or contact_email like '%_@_%'),
  status           text not null default 'sent' check (status in ('sent', 'submitted', 'cancelled')),
  sent_at          timestamptz,
  opened_at        timestamptz,
  submitted_at     timestamptz,
  answers          jsonb,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index dd_questionnaires_case_idx on public.dd_questionnaires (case_id);
create unique index dd_questionnaires_one_open on public.dd_questionnaires (case_id) where status = 'sent';

-- Rating: version 3 added; earlier versions unchanged
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.dd_assess(jsonb)'::regprocedure);
  if v_def not like '%version 3%' then
    v_def := replace(v_def, $x$  if coalesce(p_answers ->> 'v', '1') <> '2' then$x$, $x$  -- version 3: kind of party, value and the third party's questionnaire
  if p_answers ->> 'v' = '3' then
    if p_answers ->> 'party_type' in ('sales_agent', 'process_agent') then
      v_rank := 3; v_reasons := array_append(v_reasons, 'Acts for us with customers or officials (agent)');
    elsif p_answers ->> 'party_type' in ('distributor', 'joint_venture', 'sub_contractor', 'donation_recipient') then
      v_rank := 2; v_reasons := array_append(v_reasons, 'Type of third party carries more risk');
    end if;
    if p_answers ->> 'large_value' = 'yes' then
      v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Expected value over AUD 250,000 a year');
    end if;
    if coalesce(p_answers ->> 'questionnaire', 'pending') <> 'returned' then
      v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'The third party has not returned its questionnaire');
    else
      if p_answers ->> 'q_insolvency' = 'yes' then v_rank := 3; v_reasons := array_append(v_reasons, 'Insolvency event disclosed'); end if;
      if p_answers ->> 'q_press' = 'yes' then v_rank := 3; v_reasons := array_append(v_reasons, 'Adverse press coverage disclosed'); end if;
      if p_answers ->> 'q_licences' = 'no' then v_rank := 3; v_reasons := array_append(v_reasons, 'Licences, permits or memberships not confirmed'); end if;
      if p_answers ->> 'q_litigation' = 'yes' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Active or threatened litigation disclosed'); end if;
    end if;
    level := (case v_rank when 3 then 'high' when 2 then 'medium' else 'low' end)::public.risk_level;
    reasons := v_reasons;
    return next;
    return;
  end if;
  if coalesce(p_answers ->> 'v', '1') <> '2' then$x$);
    if v_def not like '%version 3%' then
      raise exception 'Could not extend app.dd_assess';
    end if;
    execute v_def;
  end if;
end;
$$;

-- The request now takes only the basics; the risk comes from the kind of party, the value and the questionnaire
create or replace function public.request_due_diligence(p_org uuid, p_counterparty uuid, p_party jsonb, p_trigger text, p_answers jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_party uuid := p_counterparty;
  v_case uuid;
  v_rating public.risk_level;
  v_type text := nullif(p_party ->> 'party_type', '');
  v_value numeric := nullif(p_party ->> 'annual_value', '')::numeric;
  v_topics text[] := array['pep', 'sip', 'sanctions', 'sanctions_ownership', 'state_owned', 'official_lists', 'adverse_media', 'questionnaire', 'modern_slavery'];
  v_answers jsonb;
  v_topic text;
  v_countries text[];
begin
  if not app.has_role(p_org, app.contributor_roles()) then
    raise exception 'You do not have permission to request due diligence';
  end if;
  if char_length(btrim(coalesce(p_trigger, ''))) < 3 then
    raise exception 'Say why due diligence is needed now';
  end if;
  if v_type is null then
    raise exception 'Choose what kind of third party it is';
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
            coalesce(nullif(p_party ->> 'business_owner_user_id', '')::uuid, auth.uid()), v_value, coalesce(nullif(p_party ->> 'currency', ''), 'AUD'))
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
      annual_value = coalesce(v_value, annual_value)
    where id = v_party;
    select annual_value into v_value from public.counterparties where id = v_party;
  end if;
  if exists (select 1 from public.dd_cases d where d.counterparty_id = v_party and d.status = 'open') then
    raise exception 'Due diligence is already open for this third party';
  end if;

  v_answers := coalesce(p_answers, '{}'::jsonb) || jsonb_build_object('v', '3', 'party_type', v_type, 'questionnaire', 'pending',
                 'large_value', case when v_value is null then 'unknown' when v_value > 250000 then 'yes' else 'no' end);
  select level into v_rating from app.dd_assess(v_answers);
  if v_type in ('customer', 'distributor') then v_topics := array_append(v_topics, 'aml_kyc'); end if;
  if v_rating in ('medium', 'high') then v_topics := array_append(v_topics, 'red_flag'); end if;
  if v_rating = 'high' then v_topics := array_append(v_topics, 'enhanced'); end if;

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

-- Who can send the questionnaire: legal or compliance, whoever asked, or the business owner
create or replace function app.can_send_dd_questionnaire(p_case uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dd_cases d join public.counterparties p on p.id = d.counterparty_id
                 where d.id = p_case and app.is_member(d.organisation_id)
                   and (app.has_role(d.organisation_id, app.records_roles()) or d.requested_by = auth.uid() or p.business_owner_user_id = auth.uid()));
$$;

create or replace function public.send_dd_questionnaire(p_case uuid, p_contact_name text, p_contact_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.dd_cases%rowtype;
  v_token text;
begin
  select * into c from public.dd_cases where id = p_case;
  if c.id is null or not app.can_send_dd_questionnaire(p_case) then
    raise exception 'You do not have permission to send this questionnaire';
  end if;
  if c.status <> 'open' then
    raise exception 'Due diligence on this third party is not open';
  end if;
  if p_contact_email is not null and btrim(p_contact_email) <> '' and btrim(p_contact_email) not like '%_@_%._%' then
    raise exception 'That email address does not look right';
  end if;
  select token into v_token from public.dd_questionnaires where case_id = p_case and status = 'sent';
  if v_token is not null then
    update public.dd_questionnaires set contact_name = coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), contact_name),
      contact_email = coalesce(nullif(btrim(coalesce(p_contact_email, '')), ''), contact_email) where token = v_token;
    return v_token;
  end if;
  insert into public.dd_questionnaires (organisation_id, case_id, contact_name, contact_email, sent_at, created_by)
  values (c.organisation_id, c.id, nullif(btrim(coalesce(p_contact_name, '')), ''), nullif(btrim(coalesce(p_contact_email, '')), ''), now(), auth.uid())
  returning token into v_token;
  return v_token;
end;
$$;

create or replace function public.cancel_dd_questionnaire(p_questionnaire uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.dd_questionnaires%rowtype;
begin
  select * into q from public.dd_questionnaires where id = p_questionnaire;
  if q.id is null or not app.can_send_dd_questionnaire(q.case_id) then
    raise exception 'You do not have permission to do this';
  end if;
  update public.dd_questionnaires set status = 'cancelled' where id = q.id and status = 'sent';
end;
$$;

-- The personal link (no sign-in)
create or replace function public.dd_questionnaire(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.dd_questionnaires%rowtype;
  p public.counterparties%rowtype;
  v_org text;
begin
  select * into q from public.dd_questionnaires where token = p_token and char_length(coalesce(p_token, '')) = 64;
  if q.id is null or q.status = 'cancelled' then
    raise exception 'This link is not valid. Ask the person who sent it for a new one.';
  end if;
  select cp.* into p from public.counterparties cp join public.dd_cases d on d.counterparty_id = cp.id where d.id = q.case_id;
  select name into v_org from public.organisations where id = q.organisation_id;
  if q.status = 'sent' and q.opened_at is null then
    update public.dd_questionnaires set opened_at = now() where id = q.id;
  end if;
  return jsonb_build_object(
    'organisation', v_org, 'party_name', p.name, 'country', p.country, 'countries', to_jsonb(p.countries),
    'registration_number', p.registration_number, 'website', p.website, 'description', p.description,
    'contact_name', q.contact_name, 'submitted_at', q.submitted_at, 'answers', case when q.status = 'submitted' then q.answers else null end);
end;
$$;

create or replace function public.submit_dd_questionnaire(p_token text, p_answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.dd_questionnaires%rowtype;
  c public.dd_cases%rowtype;
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  v_answers jsonb;
  v_rating public.risk_level;
  v_adverse text[] := '{}';
  v_t text;
begin
  select * into q from public.dd_questionnaires where token = p_token and char_length(coalesce(p_token, '')) = 64 for update;
  if q.id is null or q.status = 'cancelled' then
    raise exception 'This link is not valid. Ask the person who sent it for a new one.';
  end if;
  if q.status = 'submitted' then
    raise exception 'This questionnaire has already been submitted. Thank you.';
  end if;
  -- What must be there
  if char_length(btrim(coalesce(a #>> '{company,legal_name}', ''))) < 2 then raise exception 'Give the legal name'; end if;
  if coalesce(jsonb_array_length(a -> 'officers'), 0) = 0 then raise exception 'List at least one current office holder'; end if;
  if a #>> '{company,is_corporation}' = 'yes' and coalesce(jsonb_array_length(a -> 'shareholders'), 0) = 0 then raise exception 'List the shareholders'; end if;
  foreach v_t in array array['litigation', 'insolvency', 'press'] loop
    if coalesce(a #>> array[v_t, 'answer'], '') not in ('yes', 'no') then raise exception 'Answer every question'; end if;
    if a #>> array[v_t, 'answer'] = 'yes' and char_length(btrim(coalesce(a #>> array[v_t, 'details'], ''))) < 5 then
      raise exception 'Give details for each "yes" answer';
    end if;
    if a #>> array[v_t, 'answer'] = 'yes' then v_adverse := array_append(v_adverse, v_t); end if;
  end loop;
  if coalesce(a #>> '{licences,confirmed}', '') not in ('yes', 'no') then raise exception 'Confirm whether you hold the licences and permits needed'; end if;
  if a #>> '{licences,confirmed}' = 'no' then v_adverse := array_append(v_adverse, 'licences'); end if;
  if coalesce(a #>> '{declaration,agreed}', '') <> 'true' or char_length(btrim(coalesce(a #>> '{declaration,signed_name}', ''))) < 3
     or char_length(btrim(coalesce(a #>> '{declaration,position}', ''))) < 2 then
    raise exception 'Complete the declaration: tick it, and give your name and position';
  end if;

  update public.dd_questionnaires set status = 'submitted', submitted_at = now(), answers = a where id = q.id;

  -- Re-rate the case and record the questionnaire check
  select * into c from public.dd_cases where id = q.case_id for update;
  if c.status = 'open' then
    perform set_config('app.dd_system', 'on', true);
    v_answers := c.answers || jsonb_build_object('questionnaire', 'returned',
      'q_litigation', a #>> '{litigation,answer}', 'q_insolvency', a #>> '{insolvency,answer}', 'q_press', a #>> '{press,answer}',
      'q_licences', a #>> '{licences,confirmed}');
    update public.dd_cases set answers = v_answers where id = c.id returning risk_rating into v_rating;
    update public.counterparties set risk_rating = v_rating,
      registration_number = coalesce(registration_number, nullif(btrim(coalesce(a #>> '{company,registration_number}', '')), '')),
      website = coalesce(website, nullif(btrim(coalesce(a #>> '{company,website}', '')), ''))
    where id = c.counterparty_id;
    if v_rating in ('medium', 'high') then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'red_flag') on conflict do nothing;
    end if;
    if v_rating = 'high' then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'enhanced') on conflict do nothing;
    end if;
    perform set_config('app.dd_system', 'off', true);
    update public.dd_checks set result = case when cardinality(v_adverse) > 0 then 'concern' else 'clear' end::public.dd_result,
      notes = 'Questionnaire returned ' || to_char(now() at time zone 'Australia/Sydney', 'FMDD Mon YYYY') || ' by ' || btrim(a #>> '{declaration,signed_name}')
              || case when cardinality(v_adverse) > 0 then '. Disclosed: ' || array_to_string(v_adverse, ', ') else '. Nothing adverse disclosed.' end
    where case_id = c.id and topic = 'questionnaire' and result = 'pending';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.dd_questionnaires from anon, authenticated;
grant select (id, organisation_id, case_id, contact_name, contact_email, status, sent_at, opened_at, submitted_at, answers, created_by, created_at)
  on public.dd_questionnaires to authenticated;
grant all on public.dd_questionnaires to service_role;
alter table public.dd_questionnaires enable row level security;
create policy dd_questionnaires_select on public.dd_questionnaires for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.can_send_dd_questionnaire(case_id));

-- The link code is readable only by those who can send it
create or replace function public.dd_questionnaire_link(p_case uuid)
returns text language sql stable security definer set search_path = '' as $$
  select q.token from public.dd_questionnaires q where q.case_id = p_case and q.status = 'sent' and app.can_send_dd_questionnaire(p_case);
$$;

revoke execute on all functions in schema app from public, anon;
revoke execute on function public.send_dd_questionnaire(uuid, text, text), public.cancel_dd_questionnaire(uuid), public.dd_questionnaire(text),
  public.submit_dd_questionnaire(text, jsonb), public.dd_questionnaire_link(uuid) from public, anon;
grant execute on function public.send_dd_questionnaire(uuid, text, text), public.cancel_dd_questionnaire(uuid), public.dd_questionnaire_link(uuid) to authenticated;
grant execute on function public.dd_questionnaire(text), public.submit_dd_questionnaire(text, jsonb) to anon, authenticated;

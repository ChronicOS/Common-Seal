-- 0061: Due diligence on individuals, and automated screening (Dilisense).
--
-- Due Diligence now covers two kinds of subject:
--   Entities     companies, partnerships, trusts and other organisations (as before)
--   Individuals  people engaged directly: consultants, agents, introducers, advisers, sole traders
--
-- An individual's personal details (date of birth, gender, citizenship) sit in their own table that
-- only the people who can see due diligence cases can read, not every member who can see the list
-- of third parties.
--
-- Screening: a sanctions, politically exposed persons and watch-list search through Dilisense. The
-- search runs on the server (edge function screen-party) with the organisation's API key, which never
-- reaches the browser. Results are recorded only by the server, so nobody can record a clean result
-- that did not happen. Someone in Legal or Compliance then reviews each possible match as "not a
-- match" or "a match", and the case's checks follow:
--   - no possible matches: the sanctions, PEP and other-lists checks are marked clear (if still pending)
--   - every possible match reviewed as not a match: the same
--   - a confirmed match: the matching check becomes a concern (sanctions, PEP, or other lists)
-- Adverse media is not covered by this screening and stays a manual check.

-- ---------------------------------------------------------------------
-- Entity or individual
-- ---------------------------------------------------------------------
alter table public.counterparties
  add column if not exists subject_type text not null default 'entity' check (subject_type in ('entity', 'individual'));

create table if not exists public.dd_individual_details (
  counterparty_id  uuid primary key references public.counterparties (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  date_of_birth    date check (date_of_birth is null or (date_of_birth > '1900-01-01' and date_of_birth < current_date)),
  gender           text check (gender is null or gender in ('male', 'female')),
  citizenship      text check (citizenship is null or citizenship ~ '^[A-Z]{2}$'),
  role_title       text check (role_title is null or char_length(role_title) <= 200),
  employer         text check (employer is null or char_length(employer) <= 200),
  updated_at       timestamptz not null default now()
);
alter table public.dd_individual_details enable row level security;
revoke all on public.dd_individual_details from anon, authenticated;
grant select, insert, update on public.dd_individual_details to authenticated;
drop policy if exists dd_individual_details_select on public.dd_individual_details;
create policy dd_individual_details_select on public.dd_individual_details for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles())
         or exists (select 1 from public.counterparties c where c.id = counterparty_id and c.business_owner_user_id = auth.uid() and app.is_member(c.organisation_id)));
drop policy if exists dd_individual_details_insert on public.dd_individual_details;
create policy dd_individual_details_insert on public.dd_individual_details for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles())
              and exists (select 1 from public.counterparties c where c.id = counterparty_id and c.organisation_id = dd_individual_details.organisation_id and c.subject_type = 'individual'));
drop policy if exists dd_individual_details_update on public.dd_individual_details;
create policy dd_individual_details_update on public.dd_individual_details for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
drop trigger if exists dd_individual_details_touch on public.dd_individual_details;
create trigger dd_individual_details_touch before update on public.dd_individual_details for each row execute function app.touch_updated_at();
drop trigger if exists dd_individual_details_audit on public.dd_individual_details;
create trigger dd_individual_details_audit after insert or delete or update on public.dd_individual_details for each row execute function app.audit_row();

-- Writes the personal details from a request's party JSON (used by the two request functions below)
create or replace function app.dd_save_individual(p_org uuid, p_party uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.dd_individual_details (counterparty_id, organisation_id, date_of_birth, gender, citizenship, role_title, employer)
  values (p_party, p_org, nullif(p_details ->> 'date_of_birth', '')::date, nullif(p_details ->> 'gender', ''),
          upper(nullif(btrim(coalesce(p_details ->> 'citizenship', '')), '')), nullif(btrim(coalesce(p_details ->> 'role_title', '')), ''),
          nullif(btrim(coalesce(p_details ->> 'employer', '')), ''))
  on conflict (counterparty_id) do update set
    date_of_birth = coalesce(excluded.date_of_birth, public.dd_individual_details.date_of_birth),
    gender = coalesce(excluded.gender, public.dd_individual_details.gender),
    citizenship = coalesce(excluded.citizenship, public.dd_individual_details.citizenship),
    role_title = coalesce(excluded.role_title, public.dd_individual_details.role_title),
    employer = coalesce(excluded.employer, public.dd_individual_details.employer);
end;
$$;

-- request_due_diligence: knows about individuals. Individuals get the screening checks, the red flag
-- and enhanced reports when the risk calls for them, and no company questionnaire.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.request_due_diligence(uuid, uuid, jsonb, text, jsonb)'::regprocedure);
  if v_def not like '%v_subject%' then
    v_def := replace(v_def, $x$  v_countries text[];
begin$x$, $x$  v_countries text[];
  v_subject text := case when p_party ->> 'subject_type' = 'individual' then 'individual' else 'entity' end;
begin$x$);
    v_def := replace(v_def, $x$    insert into public.counterparties (organisation_id, name, kind, country, party_type, registration_number, website, countries, description,
                                       business_owner_user_id, annual_value, currency)
    values (p_org, btrim(p_party ->> 'name'),$x$, $x$    insert into public.counterparties (organisation_id, name, kind, country, party_type, registration_number, website, countries, description,
                                       business_owner_user_id, annual_value, currency, subject_type)
    values (p_org, btrim(p_party ->> 'name'),$x$);
    v_def := replace(v_def, $x$            coalesce(nullif(p_party ->> 'business_owner_user_id', '')::uuid, auth.uid()), v_value, coalesce(nullif(p_party ->> 'currency', ''), 'AUD'))
    returning id into v_party;$x$, $x$            coalesce(nullif(p_party ->> 'business_owner_user_id', '')::uuid, auth.uid()), v_value, coalesce(nullif(p_party ->> 'currency', ''), 'AUD'), v_subject)
    returning id into v_party;$x$);
    v_def := replace(v_def, $x$    select annual_value into v_value from public.counterparties where id = v_party;
  end if;$x$, $x$    select annual_value, subject_type into v_value, v_subject from public.counterparties where id = v_party;
  end if;
  if v_subject = 'individual' then
    perform app.dd_save_individual(p_org, v_party, p_party);
    v_topics := array['pep', 'sanctions', 'official_lists', 'adverse_media'];
  end if;$x$);
    v_def := replace(v_def, $x$jsonb_build_object('v', '3', 'party_type', v_type, 'questionnaire', 'pending',$x$,
                            $x$jsonb_build_object('v', '3', 'party_type', v_type, 'subject_type', v_subject, 'questionnaire', case when v_subject = 'individual' then 'not_applicable' else 'pending' end,$x$);
    if v_def not like '%v_subject text%' or v_def not like '%dd_save_individual%' or v_def not like '%, v_subject)%' or v_def not like '%''subject_type'', v_subject%' then
      raise exception 'Could not update public.request_due_diligence';
    end if;
    execute v_def;
  end if;
end;
$$;

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.record_dd_exemption(uuid, uuid, jsonb, text, text, text)'::regprocedure);
  if v_def not like '%subject_type%' then
    v_def := replace(v_def, $x$    insert into public.counterparties (organisation_id, name, kind, country, party_type, description, business_owner_user_id, annual_value)$x$,
                            $x$    insert into public.counterparties (organisation_id, name, kind, country, party_type, description, business_owner_user_id, annual_value, subject_type)$x$);
    v_def := replace(v_def, $x$            coalesce(nullif(p_party ->> 'business_owner_user_id', '')::uuid, auth.uid()), nullif(p_party ->> 'annual_value', '')::numeric)
    returning id into v_party;$x$, $x$            coalesce(nullif(p_party ->> 'business_owner_user_id', '')::uuid, auth.uid()), nullif(p_party ->> 'annual_value', '')::numeric,
            case when p_party ->> 'subject_type' = 'individual' then 'individual' else 'entity' end)
    returning id into v_party;
    if p_party ->> 'subject_type' = 'individual' then
      perform app.dd_save_individual(p_org, v_party, p_party);
    end if;$x$);
    if v_def not like '%dd_save_individual%' then
      raise exception 'Could not update public.record_dd_exemption';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Rating for individuals: the requester answers a short set of questions instead of the company
-- questionnaire. Not known is never low.
create or replace function app.dd_individual_questions()
returns table (key text, label text, adverse text, weight text) language sql immutable set search_path = '' as $$
  values ('ind_official', 'a government official, politically exposed person, or close relative or associate of one', 'yes', 'high'),
         ('ind_dealings_officials', 'will deal with government officials for us', 'yes', 'high'),
         ('ind_unusual_payment', 'asked for unusual payment terms', 'yes', 'high'),
         ('ind_adverse', 'known history of fraud, bribery, sanctions, insolvency or criminal matters', 'yes', 'high'),
         ('ind_connections', 'related to or recommended by someone in our organisation, a customer or an official', 'yes', 'medium'),
         ('ind_qualified', 'qualifications or licences for the work not confirmed', 'no', 'medium');
$$;

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.dd_assess(jsonb)'::regprocedure);
  if v_def not like '%dd_individual_questions%' then
    v_def := replace(v_def, $x$    if coalesce(p_answers ->> 'questionnaire', 'pending') <> 'returned' then$x$, $x$    if p_answers ->> 'subject_type' = 'individual' then
      if p_answers ->> 'country_risk' = 'high' then
        v_rank := 3; v_reasons := array_append(v_reasons, 'Works in countries with a high corruption risk (CPI below 40)');
      elsif p_answers ->> 'country_risk' = 'medium' then
        v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Works in countries with a medium corruption risk (CPI 40 to 59)');
      elsif coalesce(p_answers ->> 'country_risk', '') <> 'low' then
        v_unknown := array_append(v_unknown, 'country corruption risk');
      end if;
      for q in select * from app.dd_individual_questions() loop
        if coalesce(p_answers ->> q.key, '') not in ('yes', 'no') then
          v_unknown := array_append(v_unknown, q.label);
        elsif p_answers ->> q.key = q.adverse then
          v_rank := greatest(v_rank, case q.weight when 'high' then 3 else 2 end);
          v_reasons := array_append(v_reasons, upper(left(q.label, 1)) || substr(q.label, 2));
        end if;
      end loop;
      if array_length(v_unknown, 1) > 0 then
        v_rank := greatest(v_rank, 2);
        v_reasons := array_append(v_reasons, 'Not known: ' || array_to_string(v_unknown, '; '));
      end if;
    elsif coalesce(p_answers ->> 'questionnaire', 'pending') <> 'returned' then$x$);
    if v_def not like '%dd_individual_questions%' then
      raise exception 'Could not update app.dd_assess';
    end if;
    execute v_def;
  end if;
end;
$$;

-- An existing third party recorded the wrong way round can be switched (records roles only)
create or replace function public.set_dd_subject_type(p_party uuid, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.counterparties where id = p_party;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'Not allowed';
  end if;
  if p_type not in ('entity', 'individual') then
    raise exception 'Choose entity or individual';
  end if;
  update public.counterparties set subject_type = p_type where id = p_party;
  if p_type = 'individual' then
    insert into public.dd_individual_details (counterparty_id, organisation_id) values (p_party, v_org) on conflict do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Screening results
-- ---------------------------------------------------------------------
create table if not exists public.dd_screenings (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  counterparty_id  uuid not null references public.counterparties (id) on delete cascade,
  case_id          uuid references public.dd_cases (id) on delete set null,
  provider         text not null default 'dilisense',
  subject_type     text not null check (subject_type in ('entity', 'individual')),
  query            jsonb not null,
  total_hits       integer not null check (total_hits >= 0),
  hits             jsonb not null default '[]'::jsonb,
  reviews          jsonb not null default '{}'::jsonb,
  outcome          text not null default 'to_review' check (outcome in ('no_matches', 'to_review', 'cleared', 'match')),
  screened_by      uuid references auth.users (id) on delete set null,
  screened_at      timestamptz not null default now(),
  reviewed_at      timestamptz
);
create index if not exists dd_screenings_party_idx on public.dd_screenings (counterparty_id, screened_at desc);
alter table public.dd_screenings enable row level security;
revoke all on public.dd_screenings from anon, authenticated;
grant select on public.dd_screenings to authenticated;
grant all on public.dd_screenings to service_role;
drop policy if exists dd_screenings_select on public.dd_screenings;
create policy dd_screenings_select on public.dd_screenings for select to authenticated using (app.has_role(organisation_id, app.board_read_roles()));
drop trigger if exists dd_screenings_audit on public.dd_screenings;
create trigger dd_screenings_audit after insert or delete or update on public.dd_screenings for each row execute function app.audit_row();

-- What to search for. Called by the edge function with the signed-in person's own token, so the
-- usual permission check applies: only people who can work on due diligence can screen.
create or replace function public.dd_screening_target(p_party uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  select jsonb_build_object('organisation_id', c.organisation_id, 'counterparty_id', c.id, 'name', c.name, 'subject_type', c.subject_type,
                            'date_of_birth', d.date_of_birth, 'gender', d.gender, 'citizenship', d.citizenship)
    into v
  from public.counterparties c left join public.dd_individual_details d on d.counterparty_id = c.id
  where c.id = p_party and app.has_role(c.organisation_id, app.records_roles());
  if v is null then
    raise exception 'Not allowed';
  end if;
  return v;
end;
$$;

-- The query behind an earlier screening, for its PDF report (same permission check)
create or replace function public.dd_screening_report_target(p_screening uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('subject_type', s.subject_type, 'query', s.query, 'counterparty_id', s.counterparty_id, 'case_id', s.case_id)
  from public.dd_screenings s where s.id = p_screening and app.has_role(s.organisation_id, app.records_roles());
$$;

-- Topic a list source belongs to
create or replace function app.dd_screen_topic(p_source_type text)
returns text language sql immutable set search_path = '' as $$
  select case upper(coalesce(p_source_type, '')) when 'SANCTION' then 'sanctions' when 'PEP' then 'pep' else 'official_lists' end;
$$;

-- Moves the open case's screening checks to follow a screening's outcome
create or replace function app.dd_apply_screening(p_screening uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.dd_screenings%rowtype;
  v_topic text;
  v_matched text[];
  v_when text;
  v_case uuid;
  v_left integer;
begin
  select * into s from public.dd_screenings where id = p_screening;
  select count(*) into v_left from jsonb_array_elements(s.hits) h where not (s.reviews ? (h ->> 'id'));
  select id into v_case from public.dd_cases where counterparty_id = s.counterparty_id and status = 'open';
  if v_case is null then
    return;
  end if;
  v_when := to_char(s.screened_at at time zone 'Australia/Sydney', 'DD Mon YYYY');
  select coalesce(array_agg(distinct app.dd_screen_topic(h ->> 'source_type')), '{}') into v_matched
  from jsonb_array_elements(s.hits) h where s.reviews -> (h ->> 'id') ->> 'decision' = 'match';
  perform set_config('app.dd_system', 'on', true);
  foreach v_topic in array array['sanctions', 'pep', 'official_lists'] loop
    if v_topic = any (v_matched) then
      update public.dd_checks set result = 'concern',
             notes = concat_ws(E'\n', nullif(notes, ''), 'Screening ' || v_when || ': confirmed match. See the screening results.')
       where case_id = v_case and topic = v_topic and result <> 'concern';
    elsif v_left = 0 and not (v_topic = 'pep' and s.subject_type = 'entity') then
      update public.dd_checks set result = 'clear',
             notes = concat_ws(E'\n', nullif(notes, ''),
                       'Screening ' || v_when || ' (Dilisense): ' || case when s.outcome = 'no_matches' then 'no possible matches.' else 'possible matches reviewed; none on this list is this ' || case when s.subject_type = 'individual' then 'person.' else 'organisation.' end end)
       where case_id = v_case and topic = v_topic and result = 'pending';
    end if;
  end loop;
  perform set_config('app.dd_system', 'off', true);
end;
$$;

-- Records a screening. Only the server can call this (service role): results cannot be typed in.
create or replace function public.record_dd_screening(p_party uuid, p_user uuid, p_query jsonb, p_total integer, p_hits jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.counterparties%rowtype;
  v_id uuid;
begin
  select * into c from public.counterparties where id = p_party;
  if c.id is null then
    raise exception 'Unknown third party';
  end if;
  -- the checks record who did this
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  insert into public.dd_screenings (organisation_id, counterparty_id, case_id, subject_type, query, total_hits, hits, outcome, screened_by)
  values (c.organisation_id, c.id, (select id from public.dd_cases where counterparty_id = c.id and status = 'open'), c.subject_type, p_query,
          p_total, coalesce(p_hits, '[]'::jsonb), case when p_total = 0 then 'no_matches' else 'to_review' end, p_user)
  returning id into v_id;
  perform app.dd_apply_screening(v_id);
  return v_id;
end;
$$;

-- A reviewer's call on one possible match
create or replace function public.review_dd_screening_hit(p_screening uuid, p_record text, p_decision text, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.dd_screenings%rowtype;
  v_reviews jsonb;
  v_left integer;
  v_outcome text;
begin
  select * into s from public.dd_screenings where id = p_screening for update;
  if s.id is null or not app.has_role(s.organisation_id, array['owner', 'admin', 'legal', 'compliance']::public.member_role[]) then
    raise exception 'Only Legal, Compliance or an administrator can review screening matches';
  end if;
  if not exists (select 1 from jsonb_array_elements(s.hits) h where h ->> 'id' = p_record) then
    raise exception 'That record is not in this screening';
  end if;
  if p_decision not in ('match', 'not_a_match', 'undo') then
    raise exception 'Choose match or not a match';
  end if;
  if p_decision = 'match' and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Say why it is a match';
  end if;
  if p_decision = 'not_a_match' and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Say why it is not a match (for example a different date of birth or country)';
  end if;
  if p_decision = 'undo' then
    v_reviews := s.reviews - p_record;
  else
    v_reviews := s.reviews || jsonb_build_object(p_record, jsonb_build_object('decision', p_decision, 'note', btrim(p_note), 'by', auth.uid(),
                   'by_name', coalesce((select nullif(btrim(pe.full_name), '') from public.people pe where pe.user_id = auth.uid() and pe.organisation_id = s.organisation_id limit 1),
                                       (select u.email from auth.users u where u.id = auth.uid())), 'at', now()));
  end if;
  select count(*) into v_left from jsonb_array_elements(s.hits) h where not (v_reviews ? (h ->> 'id'));
  -- A confirmed match shows straight away; "cleared" only once every possible match has been reviewed
  v_outcome := case when exists (select 1 from jsonb_each(v_reviews) r where r.value ->> 'decision' = 'match') then 'match'
                    when v_left = 0 then 'cleared' else 'to_review' end;
  update public.dd_screenings set reviews = v_reviews, outcome = v_outcome, reviewed_at = case when v_left = 0 then now() end
   where id = p_screening;
  perform app.dd_apply_screening(p_screening);
  return v_outcome;
end;
$$;

-- risk feed / For you: possible matches waiting for review show in the reviewer's list via the inbox (app side)

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
grant execute on function app.can_store_dd_upload(text) to anon, authenticated, service_role;
grant execute on function app.can_read_ownership(uuid) to authenticated;
grant execute on function app.can_read_finance(uuid) to authenticated;
grant execute on function app.can_read_register(uuid) to authenticated;
grant execute on function app.is_obligation_owner(uuid) to authenticated;
grant execute on function app.whs_managers() to authenticated;
grant execute on function app.privacy_managers() to authenticated;
grant execute on function app.valid_info_kinds(text[]) to authenticated;
grant execute on function app.can_read_document(uuid) to authenticated;
grant execute on function app.can_read_abc(uuid) to authenticated;
grant execute on function app.can_read_regulatory(uuid) to authenticated;
grant execute on function app.conf_can_read(uuid), app.conf_can_manage(uuid) to authenticated;
revoke execute on function public.reminder_batch(), public.reminder_sent(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.reminder_batch(), public.reminder_sent(uuid, uuid, text[]) to service_role;
revoke execute on function public.record_dd_screening(uuid, uuid, jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_dd_screening(uuid, uuid, jsonb, integer, jsonb) to service_role;
revoke execute on function public.dd_screening_target(uuid), public.dd_screening_report_target(uuid), public.review_dd_screening_hit(uuid, text, text, text),
                           public.set_dd_subject_type(uuid, text) from public, anon;
grant execute on function public.dd_screening_target(uuid), public.dd_screening_report_target(uuid), public.review_dd_screening_hit(uuid, text, text, text),
                          public.set_dd_subject_type(uuid, text) to authenticated;

-- 0062: The third-party questionnaire, version 2, and screening everyone it names.
--
-- The questionnaire sent to organisations is replaced by a lighter one (form 2):
--   1-6   business details, website, countries, employees, years in business, contact details
--   7     owners and shareholders: equity held, and whether any is a government official or agency
--   8-9   office holders and key management
--   10    nature of services: description, dealings with officials or regulated individuals, sub-contractors
--   11    compliance record, and links to government officials (now or formerly, including family)
--   12    code of conduct / anti-corruption policy and training (copies uploaded)
--   then the attestation, signed with name, title and date.
-- Questionnaires already sent keep the old form (form 1) and still work.
--
-- Once it comes back, one click screens the organisation and every person it names through Dilisense,
-- straight from the answers. Nobody retypes a name. Anyone the questionnaire says is, or is linked to,
-- a government official is flagged on their screening, and the PEP check becomes a concern at once.
-- The sanctions, PEP and other-lists checks only clear once every screening for the case has been run
-- and every possible match reviewed.

-- ---------------------------------------------------------------------
-- Form number and uploads
-- ---------------------------------------------------------------------
alter table public.dd_questionnaires add column if not exists form integer;
update public.dd_questionnaires set form = 1 where form is null;
alter table public.dd_questionnaires alter column form set default 2;
alter table public.dd_questionnaires alter column form set not null;

alter table public.dd_questionnaire_files drop constraint if exists dd_questionnaire_files_kind_check;
alter table public.dd_questionnaire_files add constraint dd_questionnaire_files_kind_check
  check (kind in ('company_extract', 'licence', 'insurance', 'policy', 'training', 'other'));

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.register_dd_upload(text, text, text, text, bigint, text)'::regprocedure);
  if v_def not like '%''policy''%' then
    v_def := replace(v_def, $x$p_kind not in ('company_extract', 'licence', 'insurance', 'other')$x$, $x$p_kind not in ('company_extract', 'licence', 'insurance', 'policy', 'training', 'other')$x$);
    v_def := replace(v_def, $x$>= 12 then
    raise exception 'Up to 12 files can be uploaded';$x$, $x$>= 20 then
    raise exception 'Up to 20 files can be uploaded';$x$);
    if v_def not like '%''policy''%' or v_def not like '%Up to 20 files%' then
      raise exception 'Could not update public.register_dd_upload';
    end if;
    execute v_def;
  end if;
end;
$$;

-- The link page says which form to show
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.dd_questionnaire(text)'::regprocedure);
  if v_def not like '%''form'', q.form%' then
    v_def := replace(v_def, $x$'contact_name', q.contact_name,$x$, $x$'contact_name', q.contact_name, 'form', q.form,$x$);
    if v_def not like '%''form'', q.form%' then
      raise exception 'Could not update public.dd_questionnaire';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Submitting: form 1 keeps its old rules; form 2 has its own
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if to_regprocedure('app.dd_submit_form1(text, jsonb)') is null then
    v_def := pg_get_functiondef('public.submit_dd_questionnaire(text, jsonb)'::regprocedure);
    v_def := replace(v_def, 'FUNCTION public.submit_dd_questionnaire(', 'FUNCTION app.dd_submit_form1(');
    if v_def not like '%app.dd_submit_form1(%' then
      raise exception 'Could not keep the form 1 rules';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Rating: the form 2 answers (version 3 cases)
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.dd_assess(jsonb)'::regprocedure);
  if v_def not like '%q_compliance_record%' then
    v_def := replace(v_def, $x$      if p_answers ->> 'q_connections' = 'yes' then$x$, $x$      if p_answers ->> 'q_compliance_record' = 'yes' then v_rank := 3; v_reasons := array_append(v_reasons, 'Investigation, legal proceedings or sanctions disclosed'); end if;
      if p_answers ->> 'q_gov_interaction' = 'yes' then v_rank := 3; v_reasons := array_append(v_reasons, 'Deals with government officials or regulated professionals for us'); end if;
      if p_answers ->> 'q_code' = 'no' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'No written code of conduct or anti-corruption policy'); end if;
      if p_answers ->> 'q_training' = 'no' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Staff not trained on compliance policies'); end if;
      if p_answers ->> 'q_connections' = 'yes' then$x$);
    if v_def not like '%q_compliance_record%' then
      raise exception 'Could not update app.dd_assess';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Everyone a form 2 answer names, as screening subjects
create or replace function app.dd_named_people(a jsonb)
returns table (key text, name text, subject_type text, role text, date_of_birth date, country text, declared_pep boolean)
language sql immutable set search_path = '' as $$
  with flagged as (select jsonb_array_elements_text(coalesce(a #> '{government,people}', '[]'::jsonb)) as k),
  raw as (
    select 'owner:' || (o.i - 1) as key, btrim(o.v ->> 'name') as name,
           case when o.v ->> 'type' = 'individual' then 'individual' else 'entity' end as subject_type,
           'Owner' || case when coalesce(o.v ->> 'percent', '') <> '' then ' (' || (o.v ->> 'percent') || '%)' else '' end
             || case when o.v ->> 'type' = 'government' then ', government body' else '' end as role,
           case when o.v ->> 'type' = 'individual' and coalesce(o.v ->> 'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then (o.v ->> 'dob')::date end as date_of_birth,
           nullif(btrim(coalesce(o.v ->> 'country', '')), '') as country,
           (o.v ->> 'government' = 'yes' or o.v ->> 'type' = 'government' or ('owner:' || (o.i - 1)) in (select k from flagged)) as declared_pep
    from jsonb_array_elements(coalesce(a -> 'owners', '[]'::jsonb)) with ordinality o(v, i)
    union all
    select 'officer:' || (o.i - 1), btrim(o.v ->> 'name'), 'individual', coalesce(nullif(btrim(o.v ->> 'position'), ''), 'Office holder'),
           case when coalesce(o.v ->> 'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then (o.v ->> 'dob')::date end,
           nullif(btrim(coalesce(o.v ->> 'country', '')), ''), ('officer:' || (o.i - 1)) in (select k from flagged)
    from jsonb_array_elements(coalesce(a -> 'officers', '[]'::jsonb)) with ordinality o(v, i)
    union all
    select 'manager:' || (o.i - 1), btrim(o.v ->> 'name'), 'individual', coalesce(nullif(btrim(o.v ->> 'title'), ''), 'Key management'),
           case when coalesce(o.v ->> 'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then (o.v ->> 'dob')::date end,
           nullif(btrim(coalesce(o.v ->> 'country', '')), ''), ('manager:' || (o.i - 1)) in (select k from flagged)
    from jsonb_array_elements(coalesce(a -> 'management', '[]'::jsonb)) with ordinality o(v, i)
  )
  select key, name, subject_type, role, date_of_birth, country, declared_pep from raw where char_length(coalesce(name, '')) >= 2;
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
  v_gov_people text;
  v_state_owned boolean;
  v_files integer;
begin
  select * into q from public.dd_questionnaires where token = p_token and char_length(coalesce(p_token, '')) = 64 and link_expires_at > now() for update;
  if q.id is null or q.status = 'cancelled' then
    raise exception 'This link is not valid or has expired. Ask the person who sent it for a new one.';
  end if;
  if q.form = 1 then
    perform app.dd_submit_form1(p_token, p_answers);
    return;
  end if;
  if q.status = 'submitted' then
    raise exception 'This questionnaire has already been submitted. Thank you.';
  end if;
  select * into c from public.dd_cases where id = q.case_id for update;

  -- 1-6 the business and who to contact
  if char_length(btrim(coalesce(a #>> '{business,legal_name}', ''))) < 2 then raise exception 'Give the full legal name of the business'; end if;
  if char_length(btrim(coalesce(a #>> '{business,countries}', ''))) < 2 then raise exception 'List the countries you operate in'; end if;
  if coalesce(a #>> '{business,employees}', '') = '' then raise exception 'Give the number of employees'; end if;
  if coalesce(a #>> '{business,years}', '') = '' then raise exception 'Say how long the business has operated'; end if;
  if char_length(btrim(coalesce(a #>> '{contact,name}', ''))) < 2 or char_length(regexp_replace(coalesce(a #>> '{contact,phone}', ''), '\D', '', 'g')) < 6
     or char_length(btrim(coalesce(a #>> '{contact,address}', ''))) < 5 then
    raise exception 'Complete the contact details (name, phone, email and address)';
  end if;
  if coalesce(a #>> '{contact,email}', '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'The contact email does not look right'; end if;
  -- 7-9 owners, office holders and management
  if coalesce(jsonb_array_length(a -> 'owners'), 0) = 0 then raise exception 'List every owner or shareholder'; end if;
  if exists (select 1 from jsonb_array_elements(a -> 'owners') o
             where char_length(btrim(coalesce(o ->> 'name', ''))) < 2 or coalesce(o ->> 'percent', '') !~ '^\d{1,3}(\.\d{1,4})?$'
                or coalesce(o ->> 'type', '') not in ('individual', 'company', 'government') or coalesce(o ->> 'government', '') not in ('yes', 'no')) then
    raise exception 'For each owner give the name, the percentage held, what kind of owner it is, and whether it is a government official or agency';
  end if;
  if coalesce(jsonb_array_length(a -> 'officers'), 0) = 0 or exists (select 1 from jsonb_array_elements(a -> 'officers') o where char_length(btrim(coalesce(o ->> 'name', ''))) < 2) then
    raise exception 'List the office holders (directors and secretary) by name';
  end if;
  if coalesce(jsonb_array_length(a -> 'management'), 0) = 0 or exists (select 1 from jsonb_array_elements(a -> 'management') o where char_length(btrim(coalesce(o ->> 'name', ''))) < 2) then
    raise exception 'List your key management by name';
  end if;
  -- 10 nature of services
  if char_length(btrim(coalesce(a #>> '{services,description}', ''))) < 10 then raise exception 'Describe the services you would provide'; end if;
  foreach v_t in array array['gov_interaction', 'sub_contractors', 'record', 'government'] loop
    if coalesce(a #>> array[v_t, 'answer'], '') not in ('yes', 'no') then raise exception 'Answer every question'; end if;
    if a #>> array[v_t, 'answer'] = 'yes' and char_length(btrim(coalesce(a #>> array[v_t, 'details'], ''))) < 5 then
      raise exception 'Give details for each "yes" answer';
    end if;
  end loop;
  -- 12 compliance framework
  select count(*) into v_files from public.dd_questionnaire_files f where f.questionnaire_id = q.id;
  if coalesce(a #>> '{framework,code}', '') not in ('yes', 'no') or coalesce(a #>> '{framework,training}', '') not in ('yes', 'no') then
    raise exception 'Answer the questions about your policies and training';
  end if;
  if a #>> '{framework,code}' = 'yes' and not exists (select 1 from public.dd_questionnaire_files f where f.questionnaire_id = q.id and f.kind = 'policy') then
    raise exception 'Upload a copy of your code of conduct or anti-corruption policy';
  end if;
  if a #>> '{framework,training}' = 'yes' and coalesce(a #>> '{framework,cannot_upload}', '') <> 'true'
     and not exists (select 1 from public.dd_questionnaire_files f where f.questionnaire_id = q.id and f.kind = 'training') then
    raise exception 'Upload your training materials, or tick that you cannot upload them';
  end if;
  -- attestation
  if coalesce(a #>> '{declaration,agreed}', '') <> 'true' or char_length(btrim(coalesce(a #>> '{declaration,signed_name}', ''))) < 3
     or char_length(btrim(coalesce(a #>> '{declaration,title}', ''))) < 2 then
    raise exception 'Complete the attestation: tick it, and give your name and title';
  end if;
  a := jsonb_set(a, '{declaration,signed_on}', to_jsonb(to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD')));

  -- What it discloses
  select string_agg(p.name || ' (' || p.role || ')', '; ') into v_gov_people from app.dd_named_people(a) p where p.declared_pep;
  v_state_owned := exists (select 1 from jsonb_array_elements(a -> 'owners') o where o ->> 'type' = 'government');
  if a #>> '{record,answer}' = 'yes' then v_adverse := array_append(v_adverse, 'investigation, proceedings or sanctions'); end if;
  if a #>> '{government,answer}' = 'yes' or v_gov_people is not null then v_adverse := array_append(v_adverse, 'government links'); end if;
  if a #>> '{gov_interaction,answer}' = 'yes' then v_adverse := array_append(v_adverse, 'dealings with officials or regulated professionals'); end if;
  if a #>> '{sub_contractors,answer}' = 'yes' then v_adverse := array_append(v_adverse, 'sub-contractors'); end if;
  if a #>> '{framework,code}' = 'no' then v_adverse := array_append(v_adverse, 'no code of conduct or anti-corruption policy'); end if;
  if a #>> '{framework,training}' = 'no' then v_adverse := array_append(v_adverse, 'no compliance training'); end if;

  update public.dd_questionnaires set status = 'submitted', submitted_at = now(), answers = a || jsonb_build_object('form', 2) where id = q.id;

  if c.status = 'open' then
    perform set_config('app.dd_system', 'on', true);
    v_answers := c.answers || jsonb_build_object('questionnaire', 'returned',
      'q_compliance_record', a #>> '{record,answer}',
      'q_government', case when a #>> '{government,answer}' = 'yes' or v_gov_people is not null then 'yes' else 'no' end,
      'q_gov_interaction', a #>> '{gov_interaction,answer}', 'q_sub', a #>> '{sub_contractors,answer}',
      'q_code', a #>> '{framework,code}', 'q_training', a #>> '{framework,training}');
    update public.dd_cases set answers = v_answers where id = c.id returning risk_rating into v_rating;
    update public.counterparties set risk_rating = v_rating,
      website = coalesce(website, nullif(btrim(coalesce(a #>> '{business,website}', '')), ''))
    where id = c.counterparty_id;
    if v_rating in ('medium', 'high') then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'red_flag') on conflict do nothing;
    end if;
    if v_rating = 'high' then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'enhanced') on conflict do nothing;
    end if;
    update public.dd_checks set result = case when cardinality(v_adverse) > 0 then 'concern' else 'clear' end::public.dd_result,
      notes = 'Questionnaire returned ' || to_char(now() at time zone 'Australia/Sydney', 'FMDD Mon YYYY') || ' by ' || btrim(a #>> '{declaration,signed_name}') || ', ' || btrim(a #>> '{declaration,title}')
              || case when cardinality(v_adverse) > 0 then '. Disclosed: ' || array_to_string(v_adverse, ', ') else '. Nothing adverse disclosed.' end
              || case when v_files > 0 then ' · ' || v_files || ' file(s) uploaded' else '' end
    where case_id = c.id and topic = 'questionnaire' and result = 'pending';
    -- Declared government links go straight to the PEP check; government owners to state ownership
    if v_gov_people is not null or a #>> '{government,answer}' = 'yes' then
      update public.dd_checks set result = 'concern',
        notes = concat_ws(E'\n', nullif(notes, ''), 'Declared in the questionnaire: ' || coalesce(v_gov_people, 'a link to a government official') || '. ' || coalesce(nullif(btrim(a #>> '{government,details}'), ''), ''))
      where case_id = c.id and topic = 'pep' and result <> 'concern';
    end if;
    if v_state_owned then
      update public.dd_checks set result = 'concern',
        notes = concat_ws(E'\n', nullif(notes, ''), 'Declared in the questionnaire: a government body is an owner.')
      where case_id = c.id and topic = 'state_owned' and result <> 'concern';
    end if;
    perform set_config('app.dd_system', 'off', true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Screening everyone the questionnaire names
-- ---------------------------------------------------------------------
alter table public.dd_screenings
  add column if not exists subject_key text not null default 'party',
  add column if not exists subject_name text,
  add column if not exists subject_role text,
  add column if not exists declared_pep boolean not null default false;
create index if not exists dd_screenings_case_idx on public.dd_screenings (case_id, subject_key, screened_at desc);

-- Who to screen for a case: the third party itself, and everyone its returned questionnaire names
-- (one entry per distinct person or organisation: someone who is both a director and a manager is screened once)
create or replace function app.dd_case_targets(p_case uuid)
returns table (key text, name text, subject_type text, role text, date_of_birth date, gender text, declared_pep boolean, ord integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.dd_cases%rowtype;
  p public.counterparties%rowtype;
  d public.dd_individual_details%rowtype;
  a jsonb;
begin
  select * into c from public.dd_cases where id = p_case;
  select * into p from public.counterparties where id = c.counterparty_id;
  select * into d from public.dd_individual_details where counterparty_id = p.id;
  select q.answers into a from public.dd_questionnaires q where q.case_id = c.id and q.status = 'submitted' and q.form = 2 order by q.submitted_at desc limit 1;
  return query select 'party'::text, coalesce(nullif(btrim(a #>> '{business,legal_name}'), ''), p.name), p.subject_type,
                      case when p.subject_type = 'individual' then 'The individual' else 'The organisation' end, d.date_of_birth, d.gender, false, 0;
  if a is not null then
    return query
      select min(n.key), min(n.name), n.subject_type, string_agg(distinct n.role, ', '), max(n.date_of_birth), null::text, bool_or(n.declared_pep),
             min(case split_part(n.key, ':', 1) when 'owner' then 1 when 'officer' then 2 else 3 end)
      from app.dd_named_people(a) n
      group by lower(regexp_replace(n.name, '\s+', ' ', 'g')), n.subject_type;
  end if;
end;
$$;

-- The same list for the edge function, called with the signed-in person's token (the usual permission check)
create or replace function public.dd_case_screen_targets(p_case uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.dd_cases%rowtype;
begin
  select * into c from public.dd_cases where id = p_case;
  if c.id is null or not app.has_role(c.organisation_id, app.records_roles()) then
    raise exception 'Not allowed';
  end if;
  return jsonb_build_object('organisation_id', c.organisation_id, 'counterparty_id', c.counterparty_id, 'case_id', c.id,
    'targets', (select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name, 'subject_type', t.subject_type, 'role', t.role,
                                                    'date_of_birth', t.date_of_birth, 'gender', t.gender, 'declared_pep', t.declared_pep) order by t.ord, t.name)
                from app.dd_case_targets(p_case) t));
end;
$$;

-- The case's checks follow ALL of its screenings: the latest one per subject.
--   a confirmed match on any of them  -> that topic is a concern at once
--   every subject screened and every possible match reviewed -> pending topics clear
create or replace function app.dd_apply_case_screening(p_case uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_topic text;
  v_matched text[];
  v_left integer;
  v_party boolean;
  v_people boolean;
  v_subjects integer;
  v_hits integer;
  v_missing integer;
  v_waiting boolean;
  v_when text;
begin
  if p_case is null or not exists (select 1 from public.dd_cases where id = p_case and status = 'open') then
    return;
  end if;
  -- Everyone the questionnaire names must be screened, and a questionnaire still out means more names may come
  select count(*) into v_missing from app.dd_case_targets(p_case) t
   where not exists (select 1 from public.dd_screenings s where s.case_id = p_case and s.subject_key = t.key);
  v_waiting := exists (select 1 from public.dd_questionnaires q where q.case_id = p_case and q.status = 'sent' and q.form = 2);
  with latest as (
    select distinct on (s.subject_key) s.* from public.dd_screenings s where s.case_id = p_case order by s.subject_key, s.screened_at desc
  ), hits as (
    select l.reviews, h from latest l, jsonb_array_elements(l.hits) h
  )
  select coalesce((select array_agg(distinct app.dd_screen_topic(h ->> 'source_type')) from hits where reviews -> (h ->> 'id') ->> 'decision' = 'match'), '{}'),
         (select count(*) from hits where not (reviews ? (h ->> 'id'))),
         exists (select 1 from latest where subject_key = 'party'),
         exists (select 1 from latest where subject_type = 'individual'),
         (select count(*) from latest),
         (select coalesce(sum(total_hits), 0) from latest)
    into v_matched, v_left, v_party, v_people, v_subjects, v_hits;
  v_when := to_char(now() at time zone 'Australia/Sydney', 'DD Mon YYYY');

  perform set_config('app.dd_system', 'on', true);
  foreach v_topic in array array['sanctions', 'pep', 'official_lists'] loop
    if v_topic = any (v_matched) then
      update public.dd_checks set result = 'concern',
             notes = concat_ws(E'\n', nullif(notes, ''), 'Screening ' || v_when || ': confirmed match. See the screening results.')
       where case_id = p_case and topic = v_topic and result <> 'concern';
    elsif v_left = 0 and v_party and v_missing = 0 and not v_waiting and (v_topic <> 'pep' or v_people) then
      update public.dd_checks set result = 'clear',
             notes = concat_ws(E'\n', nullif(notes, ''), 'Screening ' || v_when || ' (Dilisense): ' || v_subjects || ' subject(s) screened'
               || case when v_hits = 0 then '; no possible matches.' else '; possible matches reviewed, none on this list is a match.' end)
       where case_id = p_case and topic = v_topic and result = 'pending';
    end if;
  end loop;
  perform set_config('app.dd_system', 'off', true);
end;
$$;

drop function if exists public.record_dd_screening(uuid, uuid, jsonb, integer, jsonb);
create or replace function public.record_dd_screening(p_party uuid, p_user uuid, p_query jsonb, p_total integer, p_hits jsonb, p_subject jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.counterparties%rowtype;
  v_id uuid;
  v_case uuid;
begin
  select * into c from public.counterparties where id = p_party;
  if c.id is null then
    raise exception 'Unknown third party';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select id into v_case from public.dd_cases where counterparty_id = c.id and status = 'open';
  insert into public.dd_screenings (organisation_id, counterparty_id, case_id, subject_type, query, total_hits, hits, outcome, screened_by,
                                    subject_key, subject_name, subject_role, declared_pep)
  values (c.organisation_id, c.id, v_case,
          case when p_subject ->> 'subject_type' in ('entity', 'individual') then p_subject ->> 'subject_type' else c.subject_type end,
          p_query, p_total, coalesce(p_hits, '[]'::jsonb), case when p_total = 0 then 'no_matches' else 'to_review' end, p_user,
          coalesce(nullif(p_subject ->> 'key', ''), 'party'), coalesce(nullif(p_subject ->> 'name', ''), c.name), nullif(p_subject ->> 'role', ''),
          coalesce((p_subject ->> 'declared_pep')::boolean, false))
  returning id into v_id;
  perform app.dd_apply_case_screening(v_case);
  return v_id;
end;
$$;

-- Reviews now update the case as a whole
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.review_dd_screening_hit(uuid, text, text, text)'::regprocedure);
  if v_def not like '%dd_apply_case_screening%' then
    v_def := replace(v_def, 'perform app.dd_apply_screening(p_screening);', 'perform app.dd_apply_case_screening(s.case_id);');
    if v_def not like '%dd_apply_case_screening%' then
      raise exception 'Could not update public.review_dd_screening_hit';
    end if;
    execute v_def;
  end if;
end;
$$;

-- A single screen of the party (individuals, or before the questionnaire is back) is the 'party' subject
create or replace function public.dd_screening_target(p_party uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  select jsonb_build_object('organisation_id', c.organisation_id, 'counterparty_id', c.id, 'name', c.name, 'subject_type', c.subject_type,
                            'date_of_birth', d.date_of_birth, 'gender', d.gender, 'citizenship', d.citizenship,
                            'key', 'party', 'role', case when c.subject_type = 'individual' then 'The individual' else 'The organisation' end)
    into v
  from public.counterparties c left join public.dd_individual_details d on d.counterparty_id = c.id
  where c.id = p_party and app.has_role(c.organisation_id, app.records_roles());
  if v is null then
    raise exception 'Not allowed';
  end if;
  return v;
end;
$$;

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
revoke execute on function public.record_dd_screening(uuid, uuid, jsonb, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_dd_screening(uuid, uuid, jsonb, integer, jsonb, jsonb) to service_role;
revoke execute on function public.dd_case_screen_targets(uuid), public.dd_screening_target(uuid) from public, anon;
grant execute on function public.dd_case_screen_targets(uuid), public.dd_screening_target(uuid) to authenticated;
grant execute on function public.dd_questionnaire(text), public.submit_dd_questionnaire(text, jsonb) to anon, authenticated;

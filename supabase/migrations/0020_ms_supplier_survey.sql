-- =====================================================================
-- Common Seal - 0020: modern slavery supplier survey
--
-- A yearly campaign: choose the third parties and contacts, send each a
-- personal link, collect their answers, rate each one, escalate
-- concerns to Legal, then feed the statement. Also extends the
-- statement with joint reporting, the approval route, the CEO's
-- signature and publication on the website and the register.
--
-- The questionnaire is the first thing in Common Seal that works
-- without signing in. Two functions are open to the public; each does
-- nothing without the long random code in a supplier's own link, and
-- can only read or answer that one questionnaire.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The question set (the same for every organisation, for now)
-- ---------------------------------------------------------------------
create table public.ms_questions (
  code               text primary key,
  position           integer not null unique,
  section            text not null,
  prompt             text not null,           -- {organisation} is replaced with the sender's name
  kind               text not null default 'yesno' check (kind in ('yesno', 'countries')),
  -- The answer that raises a flag
  adverse            text check (adverse in ('yes', 'no')),
  -- Serious flags go to Legal as a concern; the rest are counted as gaps
  serious            boolean not null default false,
  detail_prompt      text,
  detail_on          text check (detail_on in ('yes', 'no')),
  wording_to_confirm boolean not null default false
);

insert into public.ms_questions (code, position, section, prompt, kind, adverse, serious, detail_prompt, detail_on, wording_to_confirm) values
('under_18',        1, 'Employment', 'Do you employ any persons under the age of 18?', 'yesno', 'yes', true, 'Please provide details of the duties they perform', 'yes', false),
('voluntary',       2, 'Employment', 'Are all your workers working voluntarily, and free to leave their jobs (after a reasonable period of notice)?', 'yesno', 'no', true, null, null, false),
('retain_documents',3, 'Employment', 'Do you require workers to hand over and retain personal property or identity documents (including passports or work permits) as a condition of employment?', 'yesno', 'yes', true, null, null, false),
('recruitment_fees',4, 'Employment', 'Do you require workers to pay any money (or relinquish any part of their earning) to secure a job or other employment-related benefits?', 'yesno', 'yes', true, null, null, false),
('migrant_workers', 5, 'Employment', 'Do you employ migrant workers?', 'yesno', null, false, 'Please provide details of the duties they perform', 'yes', false),
('minimum_wage',    6, 'Pay', 'Are your workers paid minimum wage (or above) in accordance with local laws?', 'yesno', 'no', true, null, null, false),
('written_terms',   7, 'Pay', 'Are written employment agreements and payslips provided to the workers?', 'yesno', 'no', false, null, null, false),
('paid_on_time',    8, 'Pay', 'Do you pay wages on time and in full?', 'yesno', 'no', true, null, null, false),
('deductions',      9, 'Pay', 'Do you make deductions from workers'' wages for accommodation, meals, transport, tools of trade training, uniforms or personal protective equipment?', 'yesno', 'yes', false, null, null, false),
('hours_over_60',  10, 'Working hours', 'Do working hours for any of your workers exceed 60 hours per week (including overtime) or the maximum number of working hours set by local law, whichever is lower?', 'yesno', 'yes', true, null, null, false),
('overtime_12',    11, 'Working hours', 'Do any workers regularly work more than 12 hours overtime?', 'yesno', 'yes', false, null, null, false),
('overtime_rate',  12, 'Working hours', 'Is the overtime rate higher than the regular hourly rate?', 'yesno', 'no', false, null, null, false),
('day_off',        13, 'Working hours', 'Do workers get at least one day off per week?', 'yesno', 'no', false, null, null, false),
('breaks',         14, 'Working hours', 'Do workers get time off and breaks in accordance with local laws?', 'yesno', 'no', false, null, null, false),
('hours_monitored',15, 'Working hours', 'Do you implement adequate controls to ensure workers are being compensated fairly and that work hours are being regularly monitored?', 'yesno', 'no', false, null, null, false),
('payroll_records',16, 'Working hours', 'Do you retain timesheets and payroll records for all workers?', 'yesno', 'no', false, null, null, false),
('association',    17, 'Fair treatment', 'Do you respect the rights of your employees to associate freely, form and join labour unions, seek representation, join works councils, and engage in collective bargaining in accordance with local laws?', 'yesno', 'no', false, null, null, true),
('humane_treatment',18,'Fair treatment', 'Do you have protections in place to ensure that workers are not subject to inhumane, harsh or unreasonable treatment, including sexual harassment, sexual abuse, physical punishment, and mental or physical coercion?', 'yesno', 'no', true, null, null, true),
('discrimination', 19, 'Fair treatment', 'Do you have appropriate controls in place to ensure that no worker is discriminated against based on age, disability, ethnicity, family status, gender, national origin or race, or any other characteristic protected by law?', 'yesno', 'no', false, null, null, true),
('parental_leave', 20, 'Fair treatment', 'Do you provide parental and carers leave at a minimum as required by local law?', 'yesno', 'no', false, null, null, false),
('community',      21, 'Community', 'Do you listen to the concerns of local residents/communities and provide healthy and safe living conditions for those residents/communities?', 'yesno', 'no', false, null, null, false),
('local_support',  22, 'Community', 'Do you support local job creation, local sourcing, and the provision of local education, training and infrastructure?', 'yesno', 'no', false, null, null, false),
('countries',      23, 'Operations', 'In which country or countries are your manufacturing facilities located?', 'countries', null, false, null, null, false),
('policy',         24, 'Policies and training', 'Do you have a published policy or policies addressing the Code of Conduct topics covered in this questionnaire (that is, voluntary employment, working conditions, freedom of association and fair treatment)?', 'yesno', 'no', false, null, null, true),
('training',       25, 'Policies and training', 'Do you communicate and train workers on these policies at least annually?', 'yesno', 'no', false, null, null, false),
('grievance',      26, 'Policies and training', 'Do you have appropriate grievance reporting mechanisms in place (including to facilitate anonymous reporting) for workers?', 'yesno', 'no', false, null, null, false),
('discipline',     27, 'Policies and training', 'Do you discipline or terminate workers who are guilty of mistreatment of other workers or other misconduct?', 'yesno', 'no', false, null, null, false),
('aware_of_issues',28, 'Modern slavery', 'Are you aware of any Modern Slavery issues or risks within your organization or your supply chain?', 'yesno', 'yes', true, 'Please provide details', 'yes', false),
('convicted',      29, 'Modern slavery', 'Has your organization or any organization in your supply chain been convicted of an offence in respect of Modern Slavery or been the subject of investigation by any regulatory body regarding any offence or alleged offence in respect of Modern Slavery?', 'yesno', 'yes', true, 'Please provide details.', 'yes', true),
('code_records',   30, 'Records', 'Do you create and maintain records as required by the {organisation} Supplier Code of Conduct?', 'yesno', 'no', false, null, null, false),
('transactions',   31, 'Records', 'Are all financial transactions fully and accurately documented, in particular, any payments or transfers of value made on behalf of {organisation} or relating to {organisation} products?', 'yesno', 'no', false, null, null, false),
('audits_suppliers',32,'Your supply chain', 'Do you audit your suppliers to assess whether Modern Slavery issues or risks exist within your supply chain?', 'yesno', 'no', false, null, null, false),
('supplier_terms', 33, 'Your supply chain', 'Do your suppliers have contractual obligations to you to ensure Modern Slavery compliance?', 'yesno', 'no', false, null, null, false),
('own_statement',  34, 'Your supply chain', 'Do you publish an annual Modern Slavery statement?', 'yesno', 'no', false, null, null, false);

-- ---------------------------------------------------------------------
-- Campaigns, recipients, concerns, country ratings
-- ---------------------------------------------------------------------
create table public.ms_campaigns (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  name               text not null check (char_length(btrim(name)) >= 3),
  survey_year        integer not null check (survey_year between 2000 and 2100),
  statement_id       uuid references public.ms_statements (id) on delete set null,
  deadline           date not null,
  chaser1_on         date,
  chaser2_on         date,
  sender_email       text,
  -- Filled into the emails: the policies sent with the questionnaire, and who suppliers ask for help
  relevant_policies  text,
  query_name         text,
  query_title        text,
  query_email        text,
  cover_subject      text not null,
  cover_body         text not null,
  chaser1_subject    text not null,
  chaser1_body       text not null,
  chaser2_subject    text not null,
  chaser2_body       text not null,
  -- Annual spend at or above these amounts rates medium and high
  spend_medium_from  numeric(14,2) not null default 100000 check (spend_medium_from >= 0),
  spend_high_from    numeric(14,2) not null default 1000000,
  audits_conducted   integer check (audits_conducted is null or audits_conducted >= 0),
  status             text not null default 'open' check (status in ('open', 'closed')),
  closed_at          timestamptz,
  closed_by          uuid references auth.users (id) on delete set null,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (spend_high_from >= spend_medium_from),
  unique (organisation_id, survey_year, name)
);
create index ms_campaigns_org_idx on public.ms_campaigns (organisation_id, survey_year);

create table public.ms_recipients (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  campaign_id         uuid not null references public.ms_campaigns (id) on delete cascade,
  counterparty_id     uuid not null references public.counterparties (id) on delete restrict,
  contact_name        text not null check (char_length(btrim(contact_name)) >= 2),
  contact_email       text not null check (contact_email like '%_@_%._%'),
  annual_spend        numeric(14,2) check (annual_spend is null or annual_spend >= 0),
  -- The code in this supplier's link
  token               text not null unique,
  cover_sent_at       timestamptz,
  chaser1_sent_at     timestamptz,
  chaser2_sent_at     timestamptz,
  opened_at           timestamptz,
  submitted_at        timestamptz,
  respondent_name     text,
  respondent_email    text,
  respondent_company  text,
  answers             jsonb,
  countries           text[],
  revenue_rating      public.risk_level,
  country_rating      public.risk_level,
  risk_score          integer,
  risk_level          public.risk_level,
  concerns_count      integer not null default 0,
  gaps_count          integer not null default 0,
  created_at          timestamptz not null default now(),
  unique (campaign_id, counterparty_id)
);
create index ms_recipients_campaign_idx on public.ms_recipients (campaign_id);

create table public.ms_concerns (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  campaign_id      uuid not null references public.ms_campaigns (id) on delete cascade,
  recipient_id     uuid not null references public.ms_recipients (id) on delete cascade,
  question_code    text not null references public.ms_questions (code),
  answer           text not null,
  detail           text,
  status           text not null default 'open' check (status in ('open', 'resolved')),
  decision         text,
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index ms_concerns_campaign_idx on public.ms_concerns (campaign_id, status);

-- Each organisation loads its own country ratings and records where they came from
create table public.ms_country_ratings (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  country          text not null check (char_length(btrim(country)) >= 2),
  rating           public.risk_level not null,
  score            numeric,
  source           text,
  updated_at       timestamptz not null default now()
);
create unique index ms_country_ratings_name_idx on public.ms_country_ratings (organisation_id, lower(btrim(country)));

-- ---------------------------------------------------------------------
-- Rating
--   revenue rating: from annual spend against the campaign's two thresholds
--   country rating: the highest rating among the countries named; unknown if any is not in the table
--   score = revenue (1-3) x country (1-3): 1-2 low, 3-4 medium, 6-9 high
--   If either part is unknown the overall rating is left empty. Unknown is never shown as low.
-- ---------------------------------------------------------------------
create or replace function app.ms_rate_recipient(p_recipient uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.ms_recipients%rowtype;
  v_c public.ms_campaigns%rowtype;
  v_rev integer;
  v_cty integer;
  v_unmatched integer;
  v_score integer;
  v_levels public.risk_level[] := array['low', 'medium', 'high']::public.risk_level[];
begin
  select * into v_r from public.ms_recipients r where r.id = p_recipient;
  select * into v_c from public.ms_campaigns c where c.id = v_r.campaign_id;
  v_rev := case when v_r.annual_spend is null then null
                when v_r.annual_spend >= v_c.spend_high_from then 3
                when v_r.annual_spend >= v_c.spend_medium_from then 2 else 1 end;

  if v_r.countries is not null and cardinality(v_r.countries) > 0 then
    select max(case cr.rating when 'high' then 3 when 'medium' then 2 else 1 end), count(*) filter (where cr.id is null)
      into v_cty, v_unmatched
    from unnest(v_r.countries) n
    left join public.ms_country_ratings cr on cr.organisation_id = v_r.organisation_id and lower(btrim(cr.country)) = lower(btrim(n));
    if v_unmatched > 0 then v_cty := null; end if;
  end if;

  v_score := v_rev * v_cty;
  perform set_config('app.ms_system', 'on', true);
  update public.ms_recipients
     set revenue_rating = case when v_rev is null then null else v_levels[v_rev] end,
         country_rating = case when v_cty is null then null else v_levels[v_cty] end,
         risk_score = v_score,
         risk_level = case when v_score is null then null when v_score >= 6 then 'high' when v_score >= 3 then 'medium' else 'low' end::public.risk_level
   where id = p_recipient;
  perform set_config('app.ms_system', 'off', true);
end;
$$;

-- Re-rates everything in a campaign, after spend bands or country ratings change
create or replace function public.rate_ms_campaign(p_campaign uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_id uuid;
  v_n integer := 0;
begin
  select c.organisation_id into v_org from public.ms_campaigns c where c.id = p_campaign;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'You do not have permission to rate this survey';
  end if;
  for v_id in select r.id from public.ms_recipients r where r.campaign_id = p_campaign loop
    perform app.ms_rate_recipient(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------
create or replace function app.guard_ms_campaign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'open'; new.closed_at := null; new.closed_by := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif coalesce(current_setting('app.ms_system', true), 'off') <> 'on' then
    if old.status = 'closed' then
      raise exception 'This survey is closed';
    end if;
    if new.status <> old.status or new.organisation_id <> old.organisation_id then
      raise exception 'A survey is closed with the close button';
    end if;
  end if;
  if new.statement_id is not null and not exists
     (select 1 from public.ms_statements s where s.id = new.statement_id and s.organisation_id = new.organisation_id) then
    raise exception 'The statement must belong to this organisation';
  end if;
  return new;
end;
$$;
create trigger ms_campaigns_guard before insert or update on public.ms_campaigns
  for each row execute function app.guard_ms_campaign();

create or replace function app.guard_ms_recipient()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_c public.ms_campaigns%rowtype;
  v_system boolean := coalesce(current_setting('app.ms_system', true), 'off') = 'on';
begin
  select * into v_c from public.ms_campaigns c where c.id = coalesce(new.campaign_id, old.campaign_id);
  if v_system or v_c.id is null then
    return coalesce(new, old);
  end if;
  if v_c.status = 'closed' then
    raise exception 'This survey is closed';
  end if;
  if tg_op = 'DELETE' then
    if old.submitted_at is not null then
      raise exception 'A supplier who has answered cannot be removed';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.counterparties p where p.id = new.counterparty_id and p.organisation_id = v_c.organisation_id) then
      raise exception 'The third party must belong to this organisation';
    end if;
    new.organisation_id := v_c.organisation_id;
    new.token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    new.opened_at := null; new.submitted_at := null; new.answers := null; new.countries := null;
    new.respondent_name := null; new.respondent_email := null; new.respondent_company := null;
    new.revenue_rating := null; new.country_rating := null; new.risk_score := null; new.risk_level := null;
    new.concerns_count := 0; new.gaps_count := 0;
    return new;
  end if;
  -- People may correct the contact, the spend and the sent dates. Answers and ratings come only from the supplier and the rating rule.
  if new.token <> old.token or new.campaign_id <> old.campaign_id or new.counterparty_id <> old.counterparty_id
     or new.answers is distinct from old.answers or new.countries is distinct from old.countries
     or new.submitted_at is distinct from old.submitted_at or new.opened_at is distinct from old.opened_at
     or new.respondent_name is distinct from old.respondent_name or new.respondent_email is distinct from old.respondent_email
     or new.respondent_company is distinct from old.respondent_company
     or new.revenue_rating is distinct from old.revenue_rating or new.country_rating is distinct from old.country_rating
     or new.risk_score is distinct from old.risk_score or new.risk_level is distinct from old.risk_level
     or new.concerns_count <> old.concerns_count or new.gaps_count <> old.gaps_count then
    raise exception 'A supplier''s answers and ratings cannot be edited';
  end if;
  return new;
end;
$$;
create trigger ms_recipients_guard before insert or update or delete on public.ms_recipients
  for each row execute function app.guard_ms_recipient();

create or replace function app.ms_recipient_rerate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.annual_spend is distinct from old.annual_spend then
    perform app.ms_rate_recipient(new.id);
  end if;
  return null;
end;
$$;
create trigger ms_recipients_rerate after insert or update on public.ms_recipients
  for each row when (pg_trigger_depth() = 0) execute function app.ms_recipient_rerate();

-- ---------------------------------------------------------------------
-- The supplier's side: open to anyone holding the code in their link
-- ---------------------------------------------------------------------
create or replace function public.ms_questionnaire(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_r public.ms_recipients%rowtype;
  v_c public.ms_campaigns%rowtype;
  v_org text;
begin
  select * into v_r from public.ms_recipients r where r.token = p_token and char_length(coalesce(p_token, '')) = 64;
  if v_r.id is null then
    raise exception 'This link is not valid';
  end if;
  select * into v_c from public.ms_campaigns c where c.id = v_r.campaign_id;
  select o.name into v_org from public.organisations o where o.id = v_r.organisation_id;
  if v_r.opened_at is null and v_c.status = 'open' then
    perform set_config('app.ms_system', 'on', true);
    update public.ms_recipients set opened_at = now() where id = v_r.id;
    perform set_config('app.ms_system', 'off', true);
  end if;
  return jsonb_build_object(
    'organisation', v_org,
    'supplier', (select p.name from public.counterparties p where p.id = v_r.counterparty_id),
    'contact_name', v_r.contact_name, 'contact_email', v_r.contact_email,
    'deadline', v_c.deadline, 'closed', v_c.status = 'closed', 'submitted_at', v_r.submitted_at,
    'questions', (select jsonb_agg(jsonb_build_object(
                    'code', q.code, 'section', q.section, 'prompt', replace(q.prompt, '{organisation}', v_org), 'kind', q.kind,
                    'detail_prompt', q.detail_prompt, 'detail_on', q.detail_on) order by q.position)
                  from public.ms_questions q));
end;
$$;

-- p_answers: { "<code>": { "a": "yes" | "no", "d": "details" } }
create or replace function public.ms_submit_questionnaire(
  p_token text, p_name text, p_email text, p_company text, p_answers jsonb, p_countries text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.ms_recipients%rowtype;
  v_c public.ms_campaigns%rowtype;
  v_q public.ms_questions%rowtype;
  v_a text;
  v_d text;
  v_concerns integer := 0;
  v_gaps integer := 0;
  v_supplier text;
  v_countries text[];
begin
  select * into v_r from public.ms_recipients r where r.token = p_token and char_length(coalesce(p_token, '')) = 64 for update;
  if v_r.id is null then
    raise exception 'This link is not valid';
  end if;
  select * into v_c from public.ms_campaigns c where c.id = v_r.campaign_id;
  if v_c.status = 'closed' then
    raise exception 'This questionnaire has closed. Please contact the person who sent it to you.';
  end if;
  if v_r.submitted_at is not null then
    raise exception 'This questionnaire has already been submitted';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or coalesce(p_email, '') not like '%_@_%._%' or char_length(btrim(coalesce(p_company, ''))) < 2 then
    raise exception 'Please provide your full name, email and company name';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or char_length(p_answers::text) > 60000
     or char_length(p_name) > 200 or char_length(p_email) > 200 or char_length(p_company) > 200 then
    raise exception 'The answers could not be read';
  end if;
  select array_agg(distinct btrim(n)) into v_countries from unnest(coalesce(p_countries, '{}')) n where btrim(n) <> '';
  if v_countries is null or cardinality(v_countries) > 60 then
    raise exception 'Please tell us the country or countries where your manufacturing facilities are located';
  end if;
  select p.name into v_supplier from public.counterparties p where p.id = v_r.counterparty_id;

  perform set_config('app.ms_system', 'on', true);
  for v_q in select * from public.ms_questions q where q.kind = 'yesno' order by q.position loop
    v_a := p_answers -> v_q.code ->> 'a';
    v_d := nullif(btrim(coalesce(p_answers -> v_q.code ->> 'd', '')), '');
    if v_a is null or v_a not in ('yes', 'no') then
      raise exception 'Please answer every question (question % is not answered)', v_q.position;
    end if;
    if v_q.detail_on = v_a and v_d is null then
      raise exception 'Please provide the details asked for at question %', v_q.position;
    end if;
    if v_q.adverse = v_a then
      if v_q.serious then
        v_concerns := v_concerns + 1;
        insert into public.ms_concerns (organisation_id, campaign_id, recipient_id, question_code, answer, detail)
        values (v_r.organisation_id, v_c.id, v_r.id, v_q.code, v_a, v_d);
      else
        v_gaps := v_gaps + 1;
      end if;
    end if;
  end loop;

  update public.ms_recipients
     set submitted_at = now(), respondent_name = btrim(p_name), respondent_email = btrim(p_email), respondent_company = btrim(p_company),
         answers = p_answers, countries = v_countries, concerns_count = v_concerns, gaps_count = v_gaps
   where id = v_r.id;
  perform app.ms_rate_recipient(v_r.id);

  if v_concerns > 0 then
    insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin)
    values (v_r.organisation_id, format('Modern slavery survey: %s raised %s concern(s) for Legal to review', v_supplier, v_concerns),
            'ms_recipients', v_r.id, now() + interval '7 days', 'system');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Legal's decision on a concern, and closing the survey
-- ---------------------------------------------------------------------
create or replace function public.decide_ms_concern(p_concern uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_k public.ms_concerns%rowtype;
begin
  select * into v_k from public.ms_concerns k where k.id = p_concern for update;
  if v_k.id is null or not app.has_role(v_k.organisation_id, array['owner', 'admin', 'legal', 'compliance']::public.member_role[]) then
    raise exception 'Only legal or compliance can decide a concern';
  end if;
  if v_k.status <> 'open' then
    raise exception 'This concern has already been decided';
  end if;
  if char_length(btrim(coalesce(p_decision, ''))) < 5 then
    raise exception 'Record what was decided and why';
  end if;
  update public.ms_concerns set status = 'resolved', decision = btrim(p_decision), decided_by = auth.uid(), decided_at = now() where id = p_concern;
  if not exists (select 1 from public.ms_concerns k where k.recipient_id = v_k.recipient_id and k.status = 'open') then
    update public.tasks set status = 'done', completed_at = now()
     where subject_table = 'ms_recipients' and subject_id = v_k.recipient_id and status in ('open', 'in_progress');
  end if;
end;
$$;

create or replace function public.close_ms_campaign(p_campaign uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.ms_campaigns%rowtype;
begin
  select * into v_c from public.ms_campaigns c where c.id = p_campaign for update;
  if v_c.id is null or not app.has_role(v_c.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to close this survey';
  end if;
  if v_c.status <> 'open' then
    raise exception 'This survey is already closed';
  end if;
  perform set_config('app.ms_system', 'on', true);
  update public.ms_campaigns set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_campaign;
  perform set_config('app.ms_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Statement: joint reporting, approval route, CEO signature, publication
-- ---------------------------------------------------------------------
alter table public.ms_statements
  add column is_joint               boolean not null default false,
  add column covered_entity_ids     uuid[] not null default '{}',
  add column product_info_checked   boolean not null default false,
  add column approval_method        text check (approval_method in ('meeting', 'circular')),
  add column ceo_signed_by          text,
  add column website_published_on   date,
  add column website_url            text,
  add column revenue_band           text,
  add column register_account_holder text;

create or replace function public.set_ms_statement_scope(p_statement uuid, p_joint boolean, p_covered uuid[], p_product_checked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.ms_statements%rowtype;
  v_covered uuid[] := coalesce(p_covered, '{}');
begin
  select * into v_s from public.ms_statements s where s.id = p_statement for update;
  if v_s.id is null or not app.has_role(v_s.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to change this statement';
  end if;
  if v_s.status <> 'draft' then
    raise exception 'The statement has been approved and can no longer be changed';
  end if;
  if exists (select 1 from unnest(v_covered) e
             where not exists (select 1 from public.entities x where x.id = e and x.organisation_id = v_s.organisation_id)) then
    raise exception 'Every entity covered must belong to this organisation';
  end if;
  if coalesce(p_joint, false) and cardinality(v_covered) = 0 then
    raise exception 'A joint statement covers at least one other entity';
  end if;
  perform set_config('app.ms_system', 'on', true);
  update public.ms_statements
     set is_joint = coalesce(p_joint, false),
         covered_entity_ids = case when coalesce(p_joint, false) then array_remove(v_covered, v_s.reporting_entity_id) else '{}' end,
         product_info_checked = coalesce(p_product_checked, false)
   where id = p_statement;
  perform set_config('app.ms_system', 'off', true);
end;
$$;

drop function if exists public.approve_ms_statement(uuid, text, date, text, text);
create or replace function public.approve_ms_statement(
  p_statement uuid, p_body text, p_approved_on date, p_method text, p_ceo text, p_signed_by text default null, p_signed_role text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.ms_statements%rowtype;
  v_missing integer;
begin
  select * into v_s from public.ms_statements s where s.id = p_statement for update;
  if v_s.id is null or not app.has_role(v_s.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to record approval of this statement';
  end if;
  if v_s.status <> 'draft' then
    raise exception 'This statement has already been approved';
  end if;
  select 7 - count(*) into v_missing from public.ms_sections x
   where x.statement_id = p_statement and char_length(btrim(x.content)) >= 20;
  if v_missing > 0 then
    raise exception '% of the seven mandatory criteria are not yet addressed', v_missing;
  end if;
  if not v_s.product_info_checked then
    raise exception 'Confirm that product information and imagery in the report are up to date';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) < 3 or p_approved_on is null or coalesce(p_method, '') not in ('meeting', 'circular') then
    raise exception 'Record which body approved it, when, and whether by meeting or circular resolution';
  end if;
  if char_length(btrim(coalesce(p_ceo, ''))) < 2 then
    raise exception 'The statement needs the signature of the CEO or Managing Director';
  end if;
  if p_approved_on > current_date then
    raise exception 'The approval date cannot be in the future';
  end if;
  perform set_config('app.ms_system', 'on', true);
  update public.ms_statements
     set status = 'approved', approved_body = btrim(p_body), approved_on = p_approved_on, approval_method = p_method,
         ceo_signed_by = btrim(p_ceo),
         signed_by = coalesce(nullif(btrim(coalesce(p_signed_by, '')), ''), btrim(p_ceo)),
         signed_role = coalesce(nullif(btrim(coalesce(p_signed_role, '')), ''), 'Chief Executive Officer or Managing Director')
   where id = p_statement;
  perform set_config('app.ms_system', 'off', true);
end;
$$;

drop function if exists public.lodge_ms_statement(uuid, date);
-- Publication has two parts: the entity's website and the government register. Both are needed to finish.
create or replace function public.publish_ms_statement(
  p_statement uuid, p_website_on date, p_website_url text, p_register_on date, p_revenue_band text, p_account_holder text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.ms_statements%rowtype;
begin
  select * into v_s from public.ms_statements s where s.id = p_statement for update;
  if v_s.id is null or not app.has_role(v_s.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to record publication';
  end if;
  if v_s.status <> 'approved' then
    raise exception 'Only an approved statement can be published';
  end if;
  if p_website_on is null or p_register_on is null then
    raise exception 'Record both the date it went on the website and the date it was lodged on the register';
  end if;
  if p_website_on > current_date or p_register_on > current_date or p_website_on < v_s.approved_on or p_register_on < v_s.approved_on then
    raise exception 'Publication dates must be on or after approval and not in the future';
  end if;
  if char_length(btrim(coalesce(p_revenue_band, ''))) < 2 then
    raise exception 'Record the band of annual consolidated revenue selected on the register';
  end if;
  perform set_config('app.ms_system', 'on', true);
  update public.ms_statements
     set status = 'lodged', lodged_on = p_register_on, website_published_on = p_website_on,
         website_url = nullif(btrim(coalesce(p_website_url, '')), ''), revenue_band = btrim(p_revenue_band),
         register_account_holder = nullif(btrim(coalesce(p_account_holder, '')), '')
   where id = p_statement;
  perform set_config('app.ms_system', 'off', true);
  update public.tasks set status = 'done', completed_at = now()
   where subject_table = 'ms_statements' and subject_id = p_statement and status in ('open', 'in_progress');
end;
$$;

-- Pack shots and product information attach to the statement
alter table public.document_links drop constraint document_links_subject_table_check;
alter table public.document_links add constraint document_links_subject_table_check check (subject_table in
  ('expense_claims', 'contracts', 'policies', 'workflow_run_steps', 'register_entries', 'dd_cases', 'ms_statements'));

create or replace function app.attach_target(p_table text, p_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_ok boolean := false;
begin
  if p_table = 'expense_claims' then
    select c.organisation_id, (c.claimant_user_id = auth.uid() and c.status in ('draft', 'rejected')) into v_org, v_ok
    from public.expense_claims c where c.id = p_id;
  elsif p_table = 'contracts' then
    select c.organisation_id, (app.has_role(c.organisation_id, app.records_roles()) or c.created_by = auth.uid()) into v_org, v_ok
    from public.contracts c where c.id = p_id;
  elsif p_table = 'policies' then
    select p.organisation_id, app.can_write_policy(p.id) into v_org, v_ok from public.policies p where p.id = p_id;
  elsif p_table = 'workflow_run_steps' then
    select s.organisation_id,
           (app.has_role(s.organisation_id, app.records_roles())
            or (s.assignee_role is not null and app.has_role(s.organisation_id, array[s.assignee_role]))) into v_org, v_ok
    from public.workflow_run_steps s where s.id = p_id;
  elsif p_table = 'register_entries' then
    select e.organisation_id, app.has_role(e.organisation_id, app.records_roles()) into v_org, v_ok
    from public.register_entries e where e.id = p_id;
  elsif p_table = 'dd_cases' then
    select d.organisation_id, app.has_role(d.organisation_id, app.records_roles()) into v_org, v_ok
    from public.dd_cases d where d.id = p_id;
  elsif p_table = 'ms_statements' then
    select m.organisation_id, (app.has_role(m.organisation_id, app.records_roles()) and m.status = 'draft') into v_org, v_ok
    from public.ms_statements m where m.id = p_id;
  else
    raise exception 'Files cannot be attached to that kind of record';
  end if;
  if v_org is null or not coalesce(v_ok, false) or not app.is_member(v_org) then
    raise exception 'You do not have permission to attach a file here';
  end if;
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers, privileges and row-level security
-- ---------------------------------------------------------------------
create trigger ms_campaigns_touch before update on public.ms_campaigns for each row execute function app.touch_updated_at();
create trigger ms_country_ratings_touch before update on public.ms_country_ratings for each row execute function app.touch_updated_at();
do $$
declare
  t text;
begin
  foreach t in array array['ms_campaigns', 'ms_recipients', 'ms_concerns', 'ms_country_ratings'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.ms_rate_recipient(uuid), app.attach_target(text, uuid) from authenticated;

revoke execute on function public.rate_ms_campaign(uuid) from public, anon;
revoke execute on function public.decide_ms_concern(uuid, text) from public, anon;
revoke execute on function public.close_ms_campaign(uuid) from public, anon;
revoke execute on function public.set_ms_statement_scope(uuid, boolean, uuid[], boolean) from public, anon;
revoke execute on function public.approve_ms_statement(uuid, text, date, text, text, text, text) from public, anon;
revoke execute on function public.publish_ms_statement(uuid, date, text, date, text, text) from public, anon;
grant execute on function public.rate_ms_campaign(uuid) to authenticated;
grant execute on function public.decide_ms_concern(uuid, text) to authenticated;
grant execute on function public.close_ms_campaign(uuid) to authenticated;
grant execute on function public.set_ms_statement_scope(uuid, boolean, uuid[], boolean) to authenticated;
grant execute on function public.approve_ms_statement(uuid, text, date, text, text, text, text) to authenticated;
grant execute on function public.publish_ms_statement(uuid, date, text, date, text, text) to authenticated;

-- The two public functions: usable without signing in, but only with the code from a supplier's link
revoke execute on function public.ms_questionnaire(text) from public;
revoke execute on function public.ms_submit_questionnaire(text, text, text, text, jsonb, text[]) from public;
grant execute on function public.ms_questionnaire(text) to anon, authenticated;
grant execute on function public.ms_submit_questionnaire(text, text, text, text, jsonb, text[]) to anon, authenticated;

revoke all on public.ms_questions, public.ms_campaigns, public.ms_recipients, public.ms_concerns, public.ms_country_ratings from anon, authenticated;
grant select on public.ms_questions to authenticated;
grant select, insert, update on public.ms_campaigns to authenticated;
grant select, insert, delete on public.ms_recipients to authenticated;
grant update (contact_name, contact_email, annual_spend, cover_sent_at, chaser1_sent_at, chaser2_sent_at) on public.ms_recipients to authenticated;
grant select on public.ms_concerns to authenticated;
grant select, insert, update, delete on public.ms_country_ratings to authenticated;
grant all on public.ms_questions, public.ms_campaigns, public.ms_recipients, public.ms_concerns, public.ms_country_ratings to service_role;

alter table public.ms_questions       enable row level security;
alter table public.ms_campaigns       enable row level security;
alter table public.ms_recipients      enable row level security;
alter table public.ms_concerns        enable row level security;
alter table public.ms_country_ratings enable row level security;

create policy ms_questions_select on public.ms_questions for select to authenticated using (true);

-- Supplier answers are for the board and the compliance roles, not every member
create policy ms_campaigns_select on public.ms_campaigns for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]));
create policy ms_campaigns_insert on public.ms_campaigns for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_campaigns_update on public.ms_campaigns for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));

-- The link code lets someone answer for a supplier, so only the people running the survey can read recipients
create policy ms_recipients_select on public.ms_recipients for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()));
create policy ms_recipients_insert on public.ms_recipients for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_recipients_update on public.ms_recipients for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_recipients_delete on public.ms_recipients for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles()));

create policy ms_concerns_select on public.ms_concerns for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()));

create policy ms_country_ratings_select on public.ms_country_ratings for select to authenticated
  using (app.is_member(organisation_id));
create policy ms_country_ratings_insert on public.ms_country_ratings for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_country_ratings_update on public.ms_country_ratings for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_country_ratings_delete on public.ms_country_ratings for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles()));

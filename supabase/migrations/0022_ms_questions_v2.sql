-- =====================================================================
-- Common Seal - 0022: modern slavery questionnaire, second edition
--
-- Follows a review against the Commonwealth guidance for reporting
-- entities. Removes questions that are not modern slavery indicators,
-- adds the indicators that were missing (labour hire and recruiters,
-- debts, freedom of movement, deceptive recruiting, right to work,
-- hazardous work by young workers, what is supplied and from where,
-- visibility of the supply chain, a response process), and adds an
-- optional sector pack, starting with pharmaceuticals and consumer
-- health. Removed questions are switched off, not deleted, so answers
-- already given keep their wording.
-- =====================================================================

alter table public.ms_questions
  add column is_active boolean not null default true,
  add column sector text;
alter table public.ms_questions drop constraint ms_questions_kind_check;
alter table public.ms_questions add constraint ms_questions_kind_check check (kind in ('yesno', 'countries', 'text', 'number'));
alter table public.ms_campaigns add column sector_pack text;

update public.ms_questions set is_active = false
 where code in ('community', 'local_support', 'parental_leave', 'transactions', 'overtime_12', 'discipline');

-- Employing someone under 18 is not in itself a concern; hazardous work by them is (new question below)
update public.ms_questions set serious = false where code = 'under_18';

-- Make room, then put every question in its new place
update public.ms_questions set position = position + 1000;

insert into public.ms_questions (code, position, section, prompt, kind, adverse, serious, detail_prompt, detail_on, sector) values
('supplies',          1101, 'Your business', 'What goods or services do you supply to {organisation}?', 'text', null, false, null, null, null),
('workforce_size',    1102, 'Your business', 'About how many workers do you have, including temporary and agency workers?', 'number', null, false, null, null, null),
('temporary_share',   1103, 'Your business', 'Are more than a quarter of your workers temporary, seasonal or agency workers?', 'yesno', null, false, null, null, null),
('raw_materials',     1104, 'Your business', 'Which countries do your main raw materials or components come from?', 'text', null, false, null, null, null),
('labour_hire',       1105, 'Recruitment and freedom of movement', 'Do you use labour hire companies, recruitment agents or other intermediaries to find or supply workers?', 'yesno', null, false, 'Please tell us which, and for what roles', 'yes', null),
('recruitment_costs', 1106, 'Recruitment and freedom of movement', 'Do you, and not the worker, pay all recruitment costs, including agent fees and travel?', 'yesno', 'no', false, null, null, null),
('worker_debts',      1107, 'Recruitment and freedom of movement', 'Do any workers owe money to you, a recruiter or another third party in connection with their job, or are any wages held back or kept on their behalf?', 'yesno', 'yes', true, 'Please provide details', 'yes', null),
('accommodation',     1108, 'Recruitment and freedom of movement', 'Do any workers live in accommodation that you or a recruiter own or control?', 'yesno', null, false, 'Please describe the accommodation and who lives there', 'yes', null),
('free_movement',     1109, 'Recruitment and freedom of movement', 'Are all workers free to leave the workplace and their accommodation outside working hours, and to keep their own phones and belongings?', 'yesno', 'no', true, null, null, null),
('contract_language', 1110, 'Recruitment and freedom of movement', 'Do workers receive the terms of their employment in a language they understand before they start, and do those terms match what they were told when recruited?', 'yesno', 'no', false, null, null, null),
('right_to_work',     1111, 'Recruitment and freedom of movement', 'Do you check that every worker has the legal right to work?', 'yesno', 'no', false, null, null, null),
('young_hazardous',   1112, 'Children and young workers', 'Do any workers under 18 do hazardous work, night work or long hours?', 'yesno', 'yes', true, 'Please provide details', 'yes', null),
('age_checks',        1113, 'Children and young workers', 'Do you verify the age of workers before they start?', 'yesno', 'no', false, null, null, null),
('response_process',  1114, 'Modern slavery', 'Do you have a process for responding if modern slavery is suspected in your business or supply chain?', 'yesno', 'no', false, null, null, null),
('beyond_tier_one',   1115, 'Your supply chain', 'For your main inputs, do you know who your own suppliers'' suppliers are?', 'yesno', 'no', false, null, null, null),
-- Sector pack: asked only when the survey selects it
('ph_ingredients',    1201, 'Pharmaceuticals and consumer health', 'Which countries do your active ingredients and excipients come from?', 'text', null, false, null, null, 'Pharmaceuticals and consumer health'),
('ph_palm',           1202, 'Pharmaceuticals and consumer health', 'Do your products or ingredients include palm oil or palm-derived ingredients, such as glycerin or fatty acids?', 'yesno', null, false, 'Is the source certified or traceable? Please describe', 'yes', 'Pharmaceuticals and consumer health'),
('ph_minerals',       1203, 'Pharmaceuticals and consumer health', 'Do your products include mica or other mined minerals, for example in cosmetics or sunscreens?', 'yesno', null, false, 'Where are they sourced from, and how do you check conditions at the source?', 'yes', 'Pharmaceuticals and consumer health'),
('ph_rubber',         1204, 'Pharmaceuticals and consumer health', 'Do you buy natural rubber products or disposable gloves in volume?', 'yesno', null, false, 'Where are they made?', 'yes', 'Pharmaceuticals and consumer health'),
('ph_cotton',         1205, 'Pharmaceuticals and consumer health', 'Do your products or packaging include cotton?', 'yesno', null, false, 'Where is it sourced from?', 'yes', 'Pharmaceuticals and consumer health'),
('ph_subcontract',    1206, 'Pharmaceuticals and consumer health', 'Do you subcontract any manufacturing or packaging of products supplied to {organisation}?', 'yesno', null, false, 'To whom, and in which countries?', 'yes', 'Pharmaceuticals and consumer health');

update public.ms_questions q set section = 'Children and young workers' where q.code = 'under_18';
update public.ms_questions q set section = 'Recruitment and freedom of movement' where q.code in ('migrant_workers', 'retain_documents', 'recruitment_fees');

-- The order suppliers see. Anything not listed (the switched-off questions) goes to the end.
with ordered (code, n) as (
  select o.code, o.n from unnest(array[
    'supplies', 'workforce_size', 'temporary_share', 'countries', 'raw_materials',
    'voluntary', 'labour_hire', 'recruitment_fees', 'recruitment_costs', 'worker_debts', 'retain_documents', 'migrant_workers',
    'accommodation', 'free_movement', 'contract_language', 'right_to_work',
    'under_18', 'young_hazardous', 'age_checks',
    'minimum_wage', 'written_terms', 'paid_on_time', 'deductions',
    'hours_over_60', 'overtime_rate', 'day_off', 'breaks', 'hours_monitored', 'payroll_records',
    'association', 'humane_treatment', 'discrimination',
    'policy', 'training', 'grievance',
    'aware_of_issues', 'convicted', 'response_process',
    'code_records',
    'audits_suppliers', 'supplier_terms', 'beyond_tier_one', 'own_statement',
    'ph_ingredients', 'ph_palm', 'ph_minerals', 'ph_rubber', 'ph_cotton', 'ph_subcontract'
  ]) with ordinality as o (code, n)
)
update public.ms_questions q
   set position = coalesce((select o.n from ordered o where o.code = q.code), 500 + q.position - 1000);

update public.ms_questions set section = 'Your business' where code = 'countries';

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
                  from public.ms_questions q
                  where q.is_active and (q.sector is null or q.sector = v_c.sector_pack)));
end;
$$;

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
  for v_q in select * from public.ms_questions q
             where q.is_active and q.kind <> 'countries' and (q.sector is null or q.sector = v_c.sector_pack)
             order by q.position loop
    v_a := btrim(coalesce(p_answers -> v_q.code ->> 'a', ''));
    if v_q.kind = 'text' then
      if char_length(v_a) < 2 or char_length(v_a) > 2000 then
        raise exception 'Please answer every question (question % needs a written answer)', v_q.position;
      end if;
      continue;
    elsif v_q.kind = 'number' then
      if v_a !~ '^[0-9]{1,9}$' then
        raise exception 'Please answer every question (question % needs a number)', v_q.position;
      end if;
      continue;
    end if;
    v_d := nullif(btrim(coalesce(p_answers -> v_q.code ->> 'd', '')), '');
    if v_a not in ('yes', 'no') then
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

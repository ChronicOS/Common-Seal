-- 0043: More in the third-party questionnaire, and uploads.
--
-- Everyone is asked:
--   * links to our people: is any director, shareholder or employee related to,
--     or in business with, anyone at our organisation;
--   * government links: is any director, shareholder or owner a government
--     official or politically exposed person (or close to one), or is the
--     company state-owned or controlled;
--   * who ultimately owns or controls 25% or more, looking through companies
--     (or a statement that no one does);
--   * sanctions: is the company or any owner on a sanctions list, or does it do
--     business in or with sanctioned countries;
--   * where we would pay it: the bank's country and whether the account is in
--     the company's own name (never the account number);
--   * trading names and former names in the last five years;
--   * sub-contractors for our work (who and what);
--   * whether it will handle our personal information or have access to our
--     systems, and if so whether it has privacy and security policies and will
--     tell us promptly of a breach.
-- Agents and introducers are also asked how they are paid (commission, success
-- fee, fixed fee) and whether they have an anti-bribery policy.
-- The third party can upload a company extract, licences and an insurance
-- certificate. Files go to the due diligence case, restricted to legal and
-- compliance, through upload slots tied to the personal link.
--
-- Rating: links to our people, government links, a sanctions connection, or
-- payment to an account not in the company's own name make it high; no
-- anti-bribery policy (agents), sub-contracting, or handling our data without
-- policies make it at least medium.

create table public.dd_questionnaire_files (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  questionnaire_id  uuid not null references public.dd_questionnaires (id) on delete cascade,
  document_id       uuid not null references public.documents (id) on delete cascade,
  storage_path      text not null unique,
  kind              text not null check (kind in ('company_extract', 'licence', 'insurance', 'other')),
  file_name         text not null,
  created_at        timestamptz not null default now()
);
create index dd_questionnaire_files_q_idx on public.dd_questionnaire_files (questionnaire_id);

-- An upload slot: the document record is made first, then the browser stores the file at its path
create or replace function public.register_dd_upload(p_token text, p_kind text, p_file_name text, p_mime text, p_size bigint, p_sha256 text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  q public.dd_questionnaires%rowtype;
  v_doc uuid;
  v_name text := regexp_replace(btrim(coalesce(p_file_name, '')), '[^A-Za-z0-9._ -]', '_', 'g');
  v_path text;
begin
  select * into q from public.dd_questionnaires where token = p_token and char_length(coalesce(p_token, '')) = 64;
  if q.id is null or q.status <> 'sent' then
    raise exception 'This link is not valid, or the questionnaire has already been submitted';
  end if;
  if (select count(*) from public.dd_questionnaire_files f where f.questionnaire_id = q.id) >= 12 then
    raise exception 'Up to 12 files can be uploaded';
  end if;
  if p_kind not in ('company_extract', 'licence', 'insurance', 'other') then
    raise exception 'Choose what the file is';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 150 then
    raise exception 'The file needs a name of up to 150 characters';
  end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then
    raise exception 'Files can be up to 10 MB';
  end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The file fingerprint is missing';
  end if;
  insert into public.documents (organisation_id, title, kind, is_restricted)
  values (q.organisation_id, v_name, 'evidence', true)
  returning id into v_doc;
  v_path := q.organisation_id::text || '/' || v_doc::text || '/1/' || v_name;
  insert into public.document_versions (organisation_id, document_id, version_no, storage_path, file_name, mime_type, size_bytes, sha256)
  values (q.organisation_id, v_doc, 1, v_path, v_name, nullif(p_mime, ''), p_size, p_sha256);
  insert into public.document_links (organisation_id, document_id, subject_table, subject_id)
  values (q.organisation_id, v_doc, 'dd_cases', q.case_id);
  insert into public.dd_questionnaire_files (organisation_id, questionnaire_id, document_id, storage_path, kind, file_name)
  values (q.organisation_id, q.id, v_doc, v_path, p_kind, v_name);
  return v_path;
end;
$$;

create or replace function public.remove_dd_upload(p_token text, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.dd_questionnaires%rowtype;
  v_doc uuid;
begin
  select * into q from public.dd_questionnaires where token = p_token and char_length(coalesce(p_token, '')) = 64;
  if q.id is null or q.status <> 'sent' then
    raise exception 'This link is not valid, or the questionnaire has already been submitted';
  end if;
  select document_id into v_doc from public.dd_questionnaire_files where questionnaire_id = q.id and storage_path = p_path;
  if v_doc is not null then
    delete from public.document_links where document_id = v_doc;
    delete from public.document_versions where document_id = v_doc;
    delete from public.dd_questionnaire_files where document_id = v_doc;
    delete from public.documents where id = v_doc;
  end if;
end;
$$;

-- The storage rule for those slots: only an open questionnaire's own path, within a day of registering it
create or replace function app.can_store_dd_upload(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dd_questionnaire_files f join public.dd_questionnaires q on q.id = f.questionnaire_id
                 where f.storage_path = p_name and q.status = 'sent' and f.created_at > now() - interval '1 day');
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Supabase Storage is not set up on this database; upload rule skipped';
    return;
  end if;
  execute 'drop policy if exists documents_bucket_ddq_upload on storage.objects';
  execute $p$create policy documents_bucket_ddq_upload on storage.objects for insert to anon
           with check (bucket_id = 'documents' and app.can_store_dd_upload(name))$p$;
end;
$$;

-- The link page now also says what kind of party it is (for the questions that depend on it) and lists uploads
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
    'organisation', v_org, 'party_name', p.name, 'party_type', p.party_type, 'country', p.country, 'countries', to_jsonb(p.countries),
    'registration_number', p.registration_number, 'website', p.website, 'description', p.description,
    'contact_name', q.contact_name, 'submitted_at', q.submitted_at,
    'uploads', coalesce((select jsonb_agg(jsonb_build_object('path', f.storage_path, 'kind', f.kind, 'file_name', f.file_name) order by f.created_at)
                         from public.dd_questionnaire_files f where f.questionnaire_id = q.id), '[]'::jsonb),
    'answers', case when q.status = 'submitted' then q.answers else null end);
end;
$$;

-- Rating: the new answers
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.dd_assess(jsonb)'::regprocedure);
  if v_def not like '%q_connections%' then
    v_def := replace(v_def, $x$      if p_answers ->> 'q_litigation' = 'yes' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Active or threatened litigation disclosed'); end if;$x$,
      $x$      if p_answers ->> 'q_litigation' = 'yes' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Active or threatened litigation disclosed'); end if;
      if p_answers ->> 'q_connections' = 'yes' then v_rank := 3; v_reasons := array_append(v_reasons, 'Linked to someone in our organisation'); end if;
      if p_answers ->> 'q_government' = 'yes' then v_rank := 3; v_reasons := array_append(v_reasons, 'Government official, politically exposed person or state ownership'); end if;
      if p_answers ->> 'q_sanctions' = 'yes' then v_rank := 3; v_reasons := array_append(v_reasons, 'Sanctions connection disclosed'); end if;
      if p_answers ->> 'q_bank_own' = 'no' then v_rank := 3; v_reasons := array_append(v_reasons, 'Payment to an account not in the company''s own name'); end if;
      if p_answers ->> 'q_abc_policy' = 'no' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Agent without an anti-bribery policy'); end if;
      if p_answers ->> 'q_sub' = 'yes' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Uses sub-contractors for our work (they need due diligence too)'); end if;
      if p_answers ->> 'q_data_security' = 'no' then v_rank := greatest(v_rank, 2); v_reasons := array_append(v_reasons, 'Handles our data or systems without privacy and security policies'); end if;$x$);
    if v_def not like '%q_connections%' then
      raise exception 'Could not extend app.dd_assess (run 0042 first)';
    end if;
    execute v_def;
  end if;
end;
$$;

create or replace function public.submit_dd_questionnaire(p_token text, p_answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.dd_questionnaires%rowtype;
  c public.dd_cases%rowtype;
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  v_type text;
  v_agent boolean;
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
  select * into c from public.dd_cases where id = q.case_id for update;
  select party_type into v_type from public.counterparties where id = c.counterparty_id;
  v_agent := v_type in ('sales_agent', 'process_agent');

  -- What must be there
  if char_length(btrim(coalesce(a #>> '{company,legal_name}', ''))) < 2 then raise exception 'Give the legal name'; end if;
  if coalesce(jsonb_array_length(a -> 'officers'), 0) = 0 then raise exception 'List at least one current office holder'; end if;
  if a #>> '{company,is_corporation}' = 'yes' then
    if coalesce(jsonb_array_length(a -> 'shareholders'), 0) = 0 then raise exception 'List the shareholders'; end if;
    if coalesce(jsonb_array_length(a -> 'ubos'), 0) = 0 and coalesce(a ->> 'ubo_none', '') <> 'true' then
      raise exception 'List who ultimately owns or controls 25%% or more, or confirm no one does';
    end if;
  end if;
  foreach v_t in array array['litigation', 'insolvency', 'press', 'connections', 'government', 'sanctions', 'sub_contractors', 'data'] loop
    if coalesce(a #>> array[v_t, 'answer'], '') not in ('yes', 'no') then raise exception 'Answer every question'; end if;
    if a #>> array[v_t, 'answer'] = 'yes' and v_t <> 'data' and char_length(btrim(coalesce(a #>> array[v_t, 'details'], ''))) < 5 then
      raise exception 'Give details for each "yes" answer';
    end if;
    if a #>> array[v_t, 'answer'] = 'yes' and v_t in ('litigation', 'insolvency', 'press', 'connections', 'government', 'sanctions') then v_adverse := array_append(v_adverse, v_t); end if;
  end loop;
  if a #>> '{data,answer}' = 'yes' and coalesce(a #>> '{data,security}', '') not in ('yes', 'no') then
    raise exception 'Say whether you have privacy and security policies';
  end if;
  if a #>> '{data,security}' = 'no' and a #>> '{data,answer}' = 'yes' then v_adverse := array_append(v_adverse, 'no privacy or security policies'); end if;
  if a #>> '{sub_contractors,answer}' = 'yes' then v_adverse := array_append(v_adverse, 'sub-contractors'); end if;
  if coalesce(a #>> '{licences,confirmed}', '') not in ('yes', 'no') then raise exception 'Confirm whether you hold the licences and permits needed'; end if;
  if a #>> '{licences,confirmed}' = 'no' then v_adverse := array_append(v_adverse, 'licences'); end if;
  if char_length(btrim(coalesce(a #>> '{bank,country}', ''))) < 2 then raise exception 'Give the country of the bank account we would pay'; end if;
  if coalesce(a #>> '{bank,own_name}', '') not in ('yes', 'no') then raise exception 'Say whether the account is in the company''s own name'; end if;
  if a #>> '{bank,own_name}' = 'no' then
    if char_length(btrim(coalesce(a #>> '{bank,details}', ''))) < 5 then raise exception 'Say whose name the account is in, and why'; end if;
    v_adverse := array_append(v_adverse, 'account not in own name');
  end if;
  if v_agent then
    if coalesce(a #>> '{compensation,basis}', '') = '' then raise exception 'Say how you would be paid'; end if;
    if coalesce(a #>> '{abc_policy,answer}', '') not in ('yes', 'no') then raise exception 'Say whether you have an anti-bribery policy'; end if;
    if a #>> '{abc_policy,answer}' = 'no' then v_adverse := array_append(v_adverse, 'no anti-bribery policy'); end if;
  end if;
  if coalesce(a #>> '{declaration,agreed}', '') <> 'true' or char_length(btrim(coalesce(a #>> '{declaration,signed_name}', ''))) < 3
     or char_length(btrim(coalesce(a #>> '{declaration,position}', ''))) < 2 then
    raise exception 'Complete the declaration: tick it, and give your name and position';
  end if;
  -- Never keep an account number, even if one was typed in
  a := jsonb_set(a, '{bank}', (a -> 'bank') - 'account_number' - 'bsb' - 'iban');

  update public.dd_questionnaires set status = 'submitted', submitted_at = now(), answers = a where id = q.id;

  if c.status = 'open' then
    perform set_config('app.dd_system', 'on', true);
    v_answers := c.answers || jsonb_build_object('questionnaire', 'returned',
      'q_litigation', a #>> '{litigation,answer}', 'q_insolvency', a #>> '{insolvency,answer}', 'q_press', a #>> '{press,answer}',
      'q_licences', a #>> '{licences,confirmed}', 'q_connections', a #>> '{connections,answer}', 'q_government', a #>> '{government,answer}',
      'q_sanctions', a #>> '{sanctions,answer}', 'q_bank_own', a #>> '{bank,own_name}', 'q_sub', a #>> '{sub_contractors,answer}',
      'q_data_security', case when a #>> '{data,answer}' = 'yes' then a #>> '{data,security}' else null end,
      'q_abc_policy', case when v_agent then a #>> '{abc_policy,answer}' else null end);
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
    if v_agent then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'abc') on conflict do nothing;
    end if;
    perform set_config('app.dd_system', 'off', true);
    update public.dd_checks set result = case when cardinality(v_adverse) > 0 then 'concern' else 'clear' end::public.dd_result,
      notes = 'Questionnaire returned ' || to_char(now() at time zone 'Australia/Sydney', 'FMDD Mon YYYY') || ' by ' || btrim(a #>> '{declaration,signed_name}')
              || case when cardinality(v_adverse) > 0 then '. Disclosed: ' || array_to_string(v_adverse, ', ') else '. Nothing adverse disclosed.' end
              || case when (select count(*) from public.dd_questionnaire_files f where f.questionnaire_id = q.id) > 0
                      then ' · ' || (select count(*) from public.dd_questionnaire_files f where f.questionnaire_id = q.id) || ' file(s) uploaded' else '' end
    where case_id = c.id and topic = 'questionnaire' and result = 'pending';
  end if;
end;
$$;

revoke all on public.dd_questionnaire_files from anon, authenticated;
grant select on public.dd_questionnaire_files to authenticated;
grant all on public.dd_questionnaire_files to service_role;
alter table public.dd_questionnaire_files enable row level security;
create policy dd_questionnaire_files_select on public.dd_questionnaire_files for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()));

revoke execute on all functions in schema app from public, anon;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
grant execute on function app.can_store_dd_upload(text) to anon, authenticated, service_role;
revoke execute on function public.register_dd_upload(text, text, text, text, bigint, text), public.remove_dd_upload(text, text) from public;
grant execute on function public.register_dd_upload(text, text, text, text, bigint, text), public.remove_dd_upload(text, text) to anon, authenticated;
grant execute on function public.dd_questionnaire(text), public.submit_dd_questionnaire(text, jsonb) to anon, authenticated;

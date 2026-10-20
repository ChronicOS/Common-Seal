-- 0067: Reading contracts with AI (Claude through Amazon Bedrock, processed in Australia).
--
-- In Contract Management, choose the entity, tick whether it is fully signed, and drop in contracts
-- (PDF, Word or text) or paste links to online terms. The server (edge function read-contract) sends
-- each document to Claude in Australia, which reads:
--   counterparty · title · description · purpose · start date · end date
--   termination for convenience (whether, who, notice, from when) · auto-renewal · last date for notice
-- each with the words it relied on. Links to online terms: description and purpose only, with the
-- link and the date it was added.
-- A person checks every answer before anything is saved (field by field: confirmed or corrected), so
-- nothing AI-read reaches the register unseen. The model and prompt version are recorded against
-- every reading, in the AI systems register.

-- The AI system, in the register
insert into public.ai_systems (id, name, provider, model_id, processing_region, purpose, risk_level, human_oversight, trains_on_customer_data, approved_at)
values ('6f1c2a10-0067-4c0e-9a11-c0a7ac7e0001', 'Contract reader', 'Anthropic Claude through Amazon Bedrock',
        'au.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Australia (Sydney and Melbourne)',
        'Reads the key details of contracts and online terms for the contract register', 'limited',
        'Every field is shown with the words it came from and must be confirmed or corrected by a person before the contract is saved',
        false, now())
on conflict (id) do nothing;

alter table public.contracts
  add column if not exists description text check (description is null or char_length(description) <= 2000),
  add column if not exists purpose text check (purpose is null or char_length(purpose) <= 2000),
  add column if not exists terms_url text check (terms_url is null or terms_url ~* '^https?://'),
  add column if not exists terms_added_on date,
  add column if not exists tfc_available text check (tfc_available is null or tfc_available in ('yes', 'no', 'unclear')),
  add column if not exists tfc_by text check (tfc_by is null or tfc_by in ('either', 'us', 'them', 'unclear')),
  add column if not exists tfc_notice text check (tfc_notice is null or char_length(tfc_notice) <= 300),
  add column if not exists tfc_from text check (tfc_from is null or char_length(tfc_from) <= 300),
  add column if not exists renewal_terms text check (renewal_terms is null or char_length(renewal_terms) <= 500),
  add column if not exists source text not null default 'typed' check (source in ('typed', 'document', 'online_terms')),
  add column if not exists ai_extraction_id uuid references public.extractions (id) on delete set null;

-- A dropped file is stored before the contract exists: kept private to the person who dropped it
-- until the contract is saved. Duplicates of a contract already on file are reported.
create or replace function public.stage_contract_file(p_org uuid, p_entity uuid, p_file_name text, p_mime text, p_size bigint, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_doc uuid;
  v_version uuid;
  v_name text := regexp_replace(btrim(coalesce(p_file_name, '')), '[^A-Za-z0-9._ -]', '_', 'g');
  v_path text;
  v_dup text;
begin
  if not app.has_role(p_org, app.contributor_roles()) then
    raise exception 'You do not have permission to add contracts';
  end if;
  if not exists (select 1 from public.entities e where e.id = p_entity and e.organisation_id = p_org) then
    raise exception 'Choose one of your entities';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 150 then
    raise exception 'The file needs a name of up to 150 characters';
  end if;
  if lower(v_name) !~ '\.(pdf|docx|txt)$' then
    raise exception 'Use a PDF, Word (.docx) or text file. For an older .doc file, save it as PDF or .docx first.';
  end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then
    raise exception 'Files can be up to 10 MB';
  end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The file fingerprint is missing';
  end if;
  select c.title into v_dup
  from public.document_versions v join public.document_links l on l.document_id = v.document_id and l.subject_table = 'contracts'
  join public.contracts c on c.id = l.subject_id
  where v.organisation_id = p_org and v.sha256 = p_sha256 limit 1;

  insert into public.documents (organisation_id, title, kind, is_restricted, created_by)
  values (p_org, v_name, 'contract', true, auth.uid()) returning id into v_doc;
  v_path := p_org::text || '/' || v_doc::text || '/1/' || v_name;
  insert into public.document_versions (organisation_id, document_id, version_no, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
  values (p_org, v_doc, 1, v_path, v_name, nullif(p_mime, ''), p_size, p_sha256, auth.uid()) returning id into v_version;
  insert into public.document_grants (organisation_id, document_id, user_id, granted_by) values (p_org, v_doc, auth.uid(), auth.uid());
  return jsonb_build_object('document_id', v_doc, 'version_id', v_version, 'path', v_path, 'duplicate_of', v_dup);
end;
$$;

-- Throwing away a dropped file that was not saved as a contract
create or replace function public.discard_contract_file(p_document uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.document_links l where l.document_id = p_document) then
    raise exception 'That file is already filed against a record';
  end if;
  delete from public.documents d where d.id = p_document and d.created_by = auth.uid();
end;
$$;

-- What the reader needs for one file (called by the edge function with the person's own token)
create or replace function public.contract_read_target(p_version uuid, p_entity uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  select jsonb_build_object('organisation_id', v.organisation_id, 'storage_path', v.storage_path, 'mime_type', v.mime_type, 'file_name', v.file_name,
                            'entity_name', (select e.name from public.entities e where e.id = p_entity and e.organisation_id = v.organisation_id),
                            'organisation_name', (select o.name from public.organisations o where o.id = v.organisation_id))
    into v
  from public.document_versions v
  where v.id = p_version and app.has_role(v.organisation_id, app.contributor_roles()) and app.can_read_document(v.document_id);
  if v is null then
    raise exception 'Not allowed';
  end if;
  return v;
end;
$$;

create or replace function public.contract_url_target(p_org uuid, p_entity uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, app.contributor_roles()) then
    raise exception 'Not allowed';
  end if;
  return jsonb_build_object('entity_name', (select e.name from public.entities e where e.id = p_entity and e.organisation_id = p_org),
                            'organisation_name', (select o.name from public.organisations o where o.id = p_org));
end;
$$;

-- Records what the AI read, field by field (server only), for the person to confirm
create or replace function public.record_contract_reading(p_version uuid, p_model text, p_fields jsonb, p_error text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_id uuid;
  f record;
begin
  select organisation_id into v_org from public.document_versions where id = p_version;
  if v_org is null then
    raise exception 'Unknown file';
  end if;
  insert into public.extractions (organisation_id, document_version_id, ai_system_id, prompt_version, status, error, started_at, completed_at)
  values (v_org, p_version, '6f1c2a10-0067-4c0e-9a11-c0a7ac7e0001', 'contracts-v1 ' || coalesce(p_model, ''),
          case when p_error is null then 'needs_review' else 'failed' end::public.extraction_status, p_error, now(), now())
  returning id into v_id;
  if p_error is null then
    for f in select key, value from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
      insert into public.extraction_fields (organisation_id, extraction_id, field_key, proposed_value, source_text, confidence)
      values (v_org, v_id, f.key, to_jsonb(f.value ->> 'value'), left(f.value ->> 'quote', 1000),
              case when (f.value ->> 'confidence') ~ '^(0(\.\d+)?|1(\.0+)?)$' then (f.value ->> 'confidence')::numeric end);
    end loop;
  end if;
  return v_id;
end;
$$;

-- Saving after the person has checked the answers
create or replace function public.save_read_contract(p_org uuid, p_entity uuid, p_signed boolean, p_values jsonb, p_version uuid, p_extraction uuid, p_terms_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v text;
  v_party uuid;
  v_new_party boolean := false;
  v_contract uuid;
  v_doc uuid;
  v_name text := btrim(coalesce(p_values ->> 'counterparty', ''));
  f record;
begin
  if not app.has_role(p_org, app.contributor_roles()) then
    raise exception 'You do not have permission to add contracts';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Give the other party''s name';
  end if;
  if char_length(btrim(coalesce(p_values ->> 'title', ''))) < 2 then
    raise exception 'Give the contract a short title';
  end if;
  if p_terms_url is not null and p_terms_url !~* '^https?://' then
    raise exception 'The link must start with http:// or https://';
  end if;
  select id into v_party from public.counterparties where organisation_id = p_org and lower(name) = lower(v_name);
  if v_party is null then
    insert into public.counterparties (organisation_id, name, kind) values (p_org, v_name, 'third_party') returning id into v_party;
    v_new_party := true;
  end if;

  insert into public.contracts (organisation_id, entity_id, counterparty_id, title, transaction_type, starts_on, ends_on, notice_by, auto_renews,
                                summary, description, purpose, terms_url, terms_added_on, tfc_available, tfc_by, tfc_notice, tfc_from, renewal_terms,
                                source, ai_extraction_id)
  values (p_org, p_entity, v_party, btrim(p_values ->> 'title'), coalesce(nullif(btrim(p_values ->> 'transaction_type'), ''), 'Any'),
          nullif(p_values ->> 'start_date', '')::date, nullif(p_values ->> 'end_date', '')::date, nullif(p_values ->> 'notice_by', '')::date,
          coalesce(p_values ->> 'auto_renews', '') = 'yes',
          nullif(btrim(p_values ->> 'description'), ''), nullif(btrim(p_values ->> 'description'), ''), nullif(btrim(p_values ->> 'purpose'), ''),
          p_terms_url, case when p_terms_url is not null then current_date end,
          nullif(p_values ->> 'tfc_available', ''), nullif(p_values ->> 'tfc_by', ''), nullif(btrim(p_values ->> 'tfc_notice'), ''), nullif(btrim(p_values ->> 'tfc_from'), ''),
          nullif(btrim(p_values ->> 'renewal_terms'), ''),
          case when p_terms_url is not null then 'online_terms' when p_version is not null then 'document' else 'typed' end, p_extraction)
  returning id into v_contract;

  -- Already signed: recorded as signed (it is a record of an agreement already made, not a request to approve one)
  if p_signed then
    perform set_config('app.contract_system', 'on', true);
    update public.contracts set status = 'signed' where id = v_contract;
    perform set_config('app.contract_system', 'off', true);
    -- The same reminders as signing in VeraPhius: the last day for notice (renew or not), and the end
    if nullif(p_values ->> 'notice_by', '')::date >= current_date then
      insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
      values (p_org, format('%s: decide whether to renew or give notice', btrim(p_values ->> 'title')), 'contracts', v_contract,
              ((p_values ->> 'notice_by')::date::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
    end if;
    if nullif(p_values ->> 'end_date', '')::date >= current_date then
      insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
      values (p_org, format('%s: contract ends', btrim(p_values ->> 'title')), 'contracts', v_contract,
              ((p_values ->> 'end_date')::date::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
    end if;
  end if;

  if p_version is not null then
    select document_id into v_doc from public.document_versions where id = p_version and organisation_id = p_org;
    if v_doc is not null then
      insert into public.document_links (organisation_id, document_id, subject_table, subject_id, created_by)
      values (p_org, v_doc, 'contracts', v_contract, auth.uid());
      update public.documents set is_restricted = false, title = btrim(p_values ->> 'title') where id = v_doc;
    end if;
  end if;

  -- The person's checks: each AI answer confirmed as read, or corrected
  if p_extraction is not null then
    if not exists (select 1 from public.extractions x where x.id = p_extraction and x.organisation_id = p_org and x.document_version_id is not distinct from coalesce(p_version, x.document_version_id)) then
      raise exception 'That reading belongs to another file';
    end if;
    for f in select x.field_key, x.proposed_value #>> '{}' as proposed from public.extraction_fields x where x.extraction_id = p_extraction and x.status = 'proposed' loop
      v := nullif(btrim(coalesce(p_values ->> f.field_key, '')), '');
      if coalesce(v, '') = coalesce(btrim(f.proposed), '') then
        update public.extraction_fields set status = 'confirmed' where extraction_id = p_extraction and field_key = f.field_key;
      else
        update public.extraction_fields set status = 'corrected', final_value = coalesce(to_jsonb(v), 'null'::jsonb)
         where extraction_id = p_extraction and field_key = f.field_key;
      end if;
    end loop;
    update public.extractions set status = 'confirmed' where id = p_extraction;
  end if;

  return jsonb_build_object('contract_id', v_contract, 'counterparty_id', v_party, 'new_counterparty', v_new_party,
                            'needs_due_diligence', not exists (select 1 from public.dd_cases d where d.counterparty_id = v_party)
                                                   and not exists (select 1 from public.dd_exemptions x where x.counterparty_id = v_party));
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
revoke execute on function public.record_contract_reading(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_contract_reading(uuid, text, jsonb, text) to service_role;
revoke execute on function public.stage_contract_file(uuid, uuid, text, text, bigint, text), public.discard_contract_file(uuid), public.contract_read_target(uuid, uuid),
                           public.contract_url_target(uuid, uuid), public.save_read_contract(uuid, uuid, boolean, jsonb, uuid, uuid, text) from public, anon;
grant execute on function public.stage_contract_file(uuid, uuid, text, text, bigint, text), public.discard_contract_file(uuid), public.contract_read_target(uuid, uuid),
                          public.contract_url_target(uuid, uuid), public.save_read_contract(uuid, uuid, boolean, jsonb, uuid, uuid, text) to authenticated;

-- =====================================================================
-- Common Seal - 0016: evidence attachments
--
-- Files attach to a record (a claim, a contract, a policy, a workflow
-- step, a register entry, a due diligence case). Each file is a row in
-- documents with a version carrying its SHA-256, so the evidence can be
-- shown to be unchanged. Files cannot be replaced or deleted through
-- the app; removing an attachment removes the link, not the file.
--
-- Until now the bucket had no user policies. This migration adds two:
-- read a file if you may read its document, and upload a file only to
-- the exact path the database issued for a document you just created.
-- =====================================================================

create table public.document_links (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  document_id      uuid not null references public.documents (id) on delete cascade,
  subject_table    text not null check (subject_table in
                     ('expense_claims', 'contracts', 'policies', 'workflow_run_steps', 'register_entries', 'dd_cases')),
  subject_id       uuid not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (document_id, subject_table, subject_id)
);
create index document_links_subject_idx on public.document_links (subject_table, subject_id);

-- Who may attach a file to a record. Returns the record's organisation, or raises.
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
  else
    raise exception 'Files cannot be attached to that kind of record';
  end if;
  if v_org is null or not coalesce(v_ok, false) or not app.is_member(v_org) then
    raise exception 'You do not have permission to attach a file here';
  end if;
  return v_org;
end;
$$;

-- Registers a file and returns where to upload it. The upload itself goes straight to storage.
create or replace function public.attach_document(
  p_table text, p_id uuid, p_file_name text, p_mime text, p_size bigint, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.attach_target(p_table, p_id);
  v_doc uuid;
  v_link uuid;
  v_name text := regexp_replace(btrim(coalesce(p_file_name, '')), '[^A-Za-z0-9._ -]', '_', 'g');
  v_path text;
  -- Receipts and due diligence files are for the uploader and the records roles only
  v_restricted boolean := p_table in ('expense_claims', 'dd_cases');
begin
  if char_length(v_name) < 1 or char_length(v_name) > 150 then
    raise exception 'The file needs a name of up to 150 characters';
  end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then
    raise exception 'Files can be up to 10 MB';
  end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The file fingerprint is missing';
  end if;

  insert into public.documents (organisation_id, title, kind, is_restricted, created_by)
  values (v_org, v_name, 'evidence', v_restricted, auth.uid())
  returning id into v_doc;
  v_path := v_org::text || '/' || v_doc::text || '/1/' || v_name;
  insert into public.document_versions (organisation_id, document_id, version_no, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
  values (v_org, v_doc, 1, v_path, v_name, nullif(p_mime, ''), p_size, p_sha256, auth.uid());
  if v_restricted then
    insert into public.document_grants (organisation_id, document_id, user_id, granted_by)
    values (v_org, v_doc, auth.uid(), auth.uid());
  end if;
  insert into public.document_links (organisation_id, document_id, subject_table, subject_id, created_by)
  values (v_org, v_doc, p_table, p_id, auth.uid())
  returning id into v_link;
  return jsonb_build_object('link_id', v_link, 'document_id', v_doc, 'path', v_path);
end;
$$;

-- Removes the link. The file and its record stay, so nothing that was evidence disappears.
create or replace function public.remove_attachment(p_link uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_l public.document_links%rowtype;
begin
  select * into v_l from public.document_links l where l.id = p_link;
  if v_l.id is null or not (v_l.created_by = auth.uid() and app.is_member(v_l.organisation_id)
                            or app.has_role(v_l.organisation_id, app.records_roles())) then
    raise exception 'You do not have permission to remove this attachment';
  end if;
  delete from public.document_links where id = p_link;
end;
$$;

-- May this person upload to this exact storage path? Only the uploader, only the path that was issued.
create or replace function app.can_store_object(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_versions v
    where v.storage_path = p_name and v.uploaded_by = auth.uid() and app.is_member(v.organisation_id));
$$;

create or replace function app.can_read_object(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_versions v
    where v.storage_path = p_name and app.can_read_document(v.document_id));
$$;

create trigger document_links_audit after insert or update or delete on public.document_links
  for each row execute function app.audit_row();

revoke execute on function app.attach_target(text, uuid) from public, anon, authenticated;
revoke execute on function app.can_store_object(text), app.can_read_object(text) from public, anon;
grant execute on function app.can_store_object(text), app.can_read_object(text) to authenticated, service_role;
revoke execute on function public.attach_document(text, uuid, text, text, bigint, text) from public, anon;
revoke execute on function public.remove_attachment(uuid) from public, anon;
grant execute on function public.attach_document(text, uuid, text, text, bigint, text) to authenticated;
grant execute on function public.remove_attachment(uuid) to authenticated;

revoke all on public.document_links from anon, authenticated;
grant select on public.document_links to authenticated;
grant all on public.document_links to service_role;
alter table public.document_links enable row level security;
create policy document_links_select on public.document_links for select to authenticated
  using (app.is_member(organisation_id) and app.can_read_document(document_id));

-- Storage: no update and no delete policy, so a stored file cannot be changed or removed by a user.
create policy documents_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and app.can_read_object(name));
create policy documents_bucket_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and app.can_store_object(name));

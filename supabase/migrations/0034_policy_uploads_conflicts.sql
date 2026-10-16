-- 0034: uploaded policy documents, and the conflict of interest register.
--
-- Part 1. A policy that already exists as a document (Word or PDF) can be
-- uploaded. The file is stored with the policy (document_links) and recorded
-- as the version in force from the date given, with its text kept so it can be
-- read and searched in Common Seal.
--
-- Part 2. Conflict declarations gain the register details: the type of
-- conflict (personal or financial), its risk level (actual, potential or
-- perceived), the person's position, the company concerned and a review date.
-- Directors can now read the register as well as the records roles.

-- ---- Part 1 ----
alter table public.policy_versions add column if not exists source text not null default 'written' check (source in ('written', 'uploaded'));
alter table public.policy_versions add column if not exists document_id uuid references public.documents (id) on delete set null;

create or replace function public.record_uploaded_policy(p_policy uuid, p_document uuid, p_content text, p_effective_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_p public.policies%rowtype;
  v_version uuid;
  v_only_draft uuid;
  v_effective date := coalesce(p_effective_on, current_date);
  v_review date;
begin
  select * into v_p from public.policies p where p.id = p_policy for update;
  if v_p.id is null or not app.has_role(v_p.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to approve policies';
  end if;
  if v_p.is_retired then
    raise exception 'This policy is retired';
  end if;
  if not exists (select 1 from public.document_links l where l.document_id = p_document and l.subject_table = 'policies' and l.subject_id = p_policy) then
    raise exception 'The document must be attached to this policy first';
  end if;
  if v_effective > current_date + 366 then
    raise exception 'The date it is current from looks wrong';
  end if;

  -- A policy just created for the upload has one empty-handed draft: use it rather than leave it behind
  select v.id into v_only_draft from public.policy_versions v
   where v.policy_id = p_policy and v.status = 'draft'
     and not exists (select 1 from public.policy_versions x where x.policy_id = p_policy and x.id <> v.id);

  update public.policy_versions set status = 'superseded' where policy_id = p_policy and status = 'approved';
  if v_only_draft is not null then
    update public.policy_versions
       set status = 'approved', source = 'uploaded', document_id = p_document, content = coalesce(p_content, ''),
           approved_by = auth.uid(), approved_at = now(), effective_on = v_effective, change_note = 'Uploaded existing policy document'
     where id = v_only_draft
    returning id into v_version;
  else
    insert into public.policy_versions (organisation_id, policy_id, version_no, content, change_note, status, source, document_id,
                                        written_by, approved_by, approved_at, effective_on)
    values (v_p.organisation_id, p_policy, (select max(version_no) + 1 from public.policy_versions where policy_id = p_policy),
            coalesce(p_content, ''), 'Uploaded policy document', 'approved', 'uploaded', p_document,
            auth.uid(), auth.uid(), now(), v_effective)
    returning id into v_version;
  end if;

  v_review := (v_effective + make_interval(months => v_p.review_every_months))::date;
  update public.policies set last_reviewed_on = v_effective, next_review_on = v_review where id = p_policy;
  update public.tasks set status = 'cancelled'
   where subject_table = 'policies' and subject_id = p_policy and origin = 'system' and status in ('open', 'in_progress');
  insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
  values (v_p.organisation_id, format('%s: policy review due', v_p.title), 'policies', p_policy,
          (v_review::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
  return v_version;
end;
$$;

revoke execute on function public.record_uploaded_policy(uuid, uuid, text, date) from public, anon;
grant execute on function public.record_uploaded_policy(uuid, uuid, text, date) to authenticated;

-- ---- Part 2 ----
alter table public.conflict_declarations add column if not exists conflict_type text check (conflict_type in ('personal', 'financial'));
alter table public.conflict_declarations add column if not exists risk_level text check (risk_level in ('actual', 'potential', 'perceived'));
alter table public.conflict_declarations add column if not exists person_user_id uuid references auth.users (id) on delete set null;
alter table public.conflict_declarations add column if not exists person_position text;
alter table public.conflict_declarations add column if not exists entity_id uuid references public.entities (id) on delete set null;
alter table public.conflict_declarations add column if not exists review_on date;

-- The type is part of the declaration; the risk level is the reviewer's assessment and can change
create or replace function app.guard_conflict_register()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.conflict_type is null or new.risk_level is null then
      raise exception 'Say whether the conflict is personal or financial, and whether it is actual, potential or perceived';
    end if;
  else
    if old.conflict_type is not null and new.conflict_type is distinct from old.conflict_type then
      raise exception 'The type of conflict cannot be changed once declared. Record a new declaration if it was wrong.';
    end if;
    if new.person_user_id is distinct from old.person_user_id or new.entity_id is distinct from old.entity_id then
      raise exception 'A declaration cannot be edited once made. Record a new one if it was wrong.';
    end if;
  end if;
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if new.person_user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.person_user_id) then
    raise exception 'That person is not a member of this organisation';
  end if;
  return new;
end;
$$;
create trigger conflict_declarations_register before insert or update on public.conflict_declarations
  for each row execute function app.guard_conflict_register();

-- The register is open to the board as well; people still see their own declarations
drop policy if exists conflict_declarations_select on public.conflict_declarations;
create policy conflict_declarations_select on public.conflict_declarations for select to authenticated
  using (declared_by = auth.uid() or person_user_id = auth.uid() or app.has_role(organisation_id, app.board_read_roles()));

revoke execute on all functions in schema app from public, anon;

-- ---- Part 3: gifts and hospitality ----
-- A responsible person, and types of gift and hospitality each with a
-- notifiable limit. A declaration above the limit for its type (or involving
-- a public official) needs a decision. Defaults: gifts from AUD 25,
-- hospitality from AUD 100. The responsible person, or a records role, can
-- change the limits and add types.

create table public.gift_settings (
  organisation_id      uuid primary key references public.organisations (id) on delete cascade,
  responsible_user_id  uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now()
);

create table public.gift_types (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  kind             text not null check (kind in ('gift', 'hospitality')),
  notifiable_from  numeric(12, 2) not null check (notifiable_from >= 0),
  position         integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, name)
);

alter table public.gift_entries add column if not exists type_id uuid references public.gift_types (id) on delete set null;

create or replace function app.is_gift_officer(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_member(p_org) and exists (select 1 from public.gift_settings s where s.organisation_id = p_org and s.responsible_user_id = auth.uid());
$$;

create or replace function public.ensure_gift_types(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_member(p_org) then
    raise exception 'Not a member of this organisation';
  end if;
  insert into public.gift_settings (organisation_id) values (p_org) on conflict do nothing;
  if not exists (select 1 from public.gift_types t where t.organisation_id = p_org) then
    insert into public.gift_types (organisation_id, name, kind, notifiable_from, position) values
      (p_org, 'Gifts', 'gift', 25, 1),
      (p_org, 'Hospitality (meals, entertainment and events)', 'hospitality', 100, 2);
  end if;
end;
$$;

create or replace function app.guard_gift_type()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type_id is not null and not exists (select 1 from public.gift_types t where t.id = new.type_id and t.organisation_id = new.organisation_id) then
    raise exception 'That type is not set up for this organisation';
  end if;
  if tg_op = 'UPDATE' and new.type_id is distinct from old.type_id then
    raise exception 'A declaration cannot be edited once made. Record a new one if it was wrong.';
  end if;
  return new;
end;
$$;
create trigger gift_entries_type_guard before insert or update on public.gift_entries
  for each row execute function app.guard_gift_type();

-- The notifiable limit comes from the type; without a type, the strictest active limit applies
create or replace function app.guard_gift()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_threshold numeric;
begin
  if tg_op = 'INSERT' then
    if new.type_id is not null then
      select t.notifiable_from into v_threshold from public.gift_types t where t.id = new.type_id;
    end if;
    if v_threshold is null then
      select min(t.notifiable_from) into v_threshold from public.gift_types t where t.organisation_id = new.organisation_id and t.is_active;
    end if;
    if v_threshold is null then
      select o.gift_approval_threshold into v_threshold from public.organisations o where o.id = new.organisation_id;
    end if;
    new.declared_by := coalesce(auth.uid(), new.declared_by);
    new.status := case when new.public_official or new.value_amount > v_threshold then 'pending' else 'recorded' end;
    new.decided_by := null;
    new.decided_at := null;
    return new;
  end if;
  if new.staff_name <> old.staff_name or new.direction <> old.direction or new.other_party <> old.other_party
     or new.description <> old.description or new.value_amount <> old.value_amount
     or new.occurred_on <> old.occurred_on or new.public_official <> old.public_official then
    raise exception 'A declaration cannot be edited once made. Record a new one if it was wrong.';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status not in ('approved', 'declined') then
      raise exception 'Only a pending declaration can be approved or declined';
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end;
$$;

-- Gift and hospitality lines from expense claims take the matching type
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.submit_expense_claim(uuid)'::regprocedure);
  if v_def not like '%type_id%' then
    v_def := replace(v_def,
      'insert into public.gift_entries (organisation_id, staff_name, direction, other_party, description, value_amount, occurred_on, public_official)',
      'insert into public.gift_entries (organisation_id, staff_name, direction, other_party, description, value_amount, occurred_on, public_official, type_id)');
    v_def := replace(v_def,
      'format(''%s (expense claim)'', v_line.description), v_line.amount, least(v_line.incurred_on, current_date), v_line.public_official)',
      'format(''%s (expense claim)'', v_line.description), v_line.amount, least(v_line.incurred_on, current_date), v_line.public_official,
            (select t.id from public.gift_types t where t.organisation_id = v_c.organisation_id and t.is_active
               and t.kind = case when v_line.category = ''Gifts'' then ''gift'' else ''hospitality'' end order by t.position limit 1))');
    if v_def not like '%type_id%' or v_def not like '%t.kind = case%' then
      raise exception 'Could not update submit_expense_claim';
    end if;
    execute v_def;
  end if;
end;
$$;

-- The responsible person sees and decides every declaration, alongside the records roles
drop policy if exists gift_entries_select on public.gift_entries;
create policy gift_entries_select on public.gift_entries for select to authenticated
  using (declared_by = auth.uid() or app.has_role(organisation_id, app.records_roles()) or app.is_gift_officer(organisation_id));
drop policy if exists gift_entries_update on public.gift_entries;
create policy gift_entries_update on public.gift_entries for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.is_gift_officer(organisation_id))
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_gift_officer(organisation_id));

revoke all on public.gift_settings, public.gift_types from anon, authenticated;
grant select on public.gift_settings to authenticated;
grant update (responsible_user_id) on public.gift_settings to authenticated;
grant select, insert, update on public.gift_types to authenticated;
grant all on public.gift_settings, public.gift_types to service_role;
alter table public.gift_settings enable row level security;
alter table public.gift_types enable row level security;
create policy gift_settings_select on public.gift_settings for select to authenticated using (app.is_member(organisation_id));
create policy gift_settings_update on public.gift_settings for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy gift_types_select on public.gift_types for select to authenticated using (app.is_member(organisation_id));
create policy gift_types_insert on public.gift_types for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_gift_officer(organisation_id));
create policy gift_types_update on public.gift_types for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.is_gift_officer(organisation_id))
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_gift_officer(organisation_id));

create or replace function app.guard_gift_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.responsible_user_id is not null and not exists (
       select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.responsible_user_id and m.is_active) then
    raise exception 'The responsible person must be an active member of this organisation';
  end if;
  return new;
end;
$$;
create trigger gift_settings_guard before insert or update on public.gift_settings for each row execute function app.guard_gift_settings();
create trigger gift_types_touch before update on public.gift_types for each row execute function app.touch_updated_at();
create trigger gift_settings_audit after insert or update or delete on public.gift_settings for each row execute function app.audit_row();
create trigger gift_types_audit after insert or update or delete on public.gift_types for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
grant execute on function app.is_gift_officer(uuid) to authenticated, service_role;
revoke execute on function public.ensure_gift_types(uuid) from public, anon;
grant execute on function public.ensure_gift_types(uuid) to authenticated;

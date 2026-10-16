-- 0041: IP Register.
--
-- Trade marks, patents, designs, copyright works, domain names, social media
-- accounts, business names and other IP, each with its owner (company),
-- jurisdiction, application and registration numbers, classes (for trade marks
-- and designs), goods and services, status, filing, registration or creation
-- date, expiry or renewal date, agent or registrar, web address and handle, the
-- sign-in name, how two-factor authentication is held, and who is responsible.
-- Certificates and other documents attach as files.
--
-- Passwords: never stored in readable form. The app encrypts them in the
-- browser (AES-GCM, key derived from the organisation's vault passphrase with
-- PBKDF2), so the database holds only ciphertext and never sees the passphrase.
-- A password can only be fetched through a function that records who fetched
-- it and when. The passphrase is shared outside Common Seal with the people
-- who need it; if it is lost, the stored passwords cannot be recovered.
--
-- Ladder up: anything expiring within 90 days (or expired) that is still live
-- feeds the Risk Register under Legal and Compliance.

create table public.ip_assets (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  kind                 text not null check (kind in ('trade_mark', 'patent', 'design', 'copyright', 'domain', 'social_media', 'business_name', 'other')),
  name                 text not null check (char_length(btrim(name)) between 1 and 300),
  owner_entity_id      uuid references public.entities (id) on delete set null,
  jurisdiction         text,
  application_number   text,
  registration_number  text,
  classes              integer[] not null default '{}' check (1 <= all (classes) and 45 >= all (classes)),
  goods_services       text,
  status               text not null default 'registered' check (status in ('pending', 'registered', 'active', 'opposed', 'lapsed', 'abandoned', 'expired', 'transferred')),
  filed_on             date,
  registered_on        date,          -- registration, grant or creation date
  expires_on           date,          -- expiry or next renewal
  agent                text,          -- attorney, registrar or platform
  url                  text,
  handle               text,
  login_identifier     text,          -- sign-in name or email for an account
  two_factor           text,          -- how two-factor authentication is held, and by whom
  responsible_user_id  uuid references auth.users (id) on delete set null,
  notes                text,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (expires_on is null or registered_on is null or expires_on >= registered_on)
);
create index ip_assets_org_idx on public.ip_assets (organisation_id, kind);

create or replace function app.guard_ip_asset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_entity_id is not null and not exists (select 1 from public.entities e where e.id = new.owner_entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if new.responsible_user_id is not null and not exists (
       select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.responsible_user_id and m.is_active) then
    raise exception 'The responsible person must be an active member of this organisation';
  end if;
  if tg_op = 'UPDATE' then
    if new.organisation_id <> old.organisation_id then
      raise exception 'A record cannot move to another organisation';
    end if;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.classes := array(select distinct x from unnest(new.classes) x order by x);
  return new;
end;
$$;
create trigger ip_assets_guard before insert or update on public.ip_assets for each row execute function app.guard_ip_asset();

-- Who may handle an asset's password: owner, administrator, legal, compliance, secretary, or the person responsible
create or replace function app.can_handle_ip_secret(p_asset uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ip_assets a where a.id = p_asset
                 and (app.has_role(a.organisation_id, app.records_roles()) or (a.responsible_user_id = auth.uid() and app.is_member(a.organisation_id))));
$$;

-- The vault: a salt and an encrypted check value, so the app can tell a wrong passphrase
create table public.ip_vaults (
  organisation_id  uuid primary key references public.organisations (id) on delete cascade,
  salt             text not null,
  check_iv         text not null,
  check_ciphertext text not null,
  iterations       integer not null default 600000,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table public.ip_secrets (
  asset_id         uuid primary key references public.ip_assets (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  iv               text not null,
  ciphertext       text not null,
  updated_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now()
);

create table public.ip_secret_views (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  asset_id         uuid not null references public.ip_assets (id) on delete cascade,
  action           text not null check (action in ('viewed', 'changed', 'removed')),
  user_id          uuid references auth.users (id) on delete set null,
  at               timestamptz not null default now()
);
create index ip_secret_views_asset_idx on public.ip_secret_views (asset_id, at desc);

create or replace function public.setup_ip_vault(p_org uuid, p_salt text, p_iv text, p_ciphertext text, p_iterations integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can set up the vault';
  end if;
  if exists (select 1 from public.ip_vaults where organisation_id = p_org) then
    raise exception 'The vault is already set up';
  end if;
  if coalesce(p_iterations, 0) < 100000 then
    raise exception 'The key derivation is too weak';
  end if;
  insert into public.ip_vaults (organisation_id, salt, check_iv, check_ciphertext, iterations, created_by)
  values (p_org, p_salt, p_iv, p_ciphertext, p_iterations, auth.uid());
end;
$$;

create or replace function public.get_ip_secret(p_asset uuid)
returns table (iv text, ciphertext text) language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if not app.can_handle_ip_secret(p_asset) then
    raise exception 'You do not have permission to see this password';
  end if;
  select a.organisation_id into v_org from public.ip_assets a where a.id = p_asset;
  insert into public.ip_secret_views (organisation_id, asset_id, action, user_id) values (v_org, p_asset, 'viewed', auth.uid());
  return query select s.iv, s.ciphertext from public.ip_secrets s where s.asset_id = p_asset;
end;
$$;

create or replace function public.set_ip_secret(p_asset uuid, p_iv text, p_ciphertext text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if not app.can_handle_ip_secret(p_asset) then
    raise exception 'You do not have permission to change this password';
  end if;
  select a.organisation_id into v_org from public.ip_assets a where a.id = p_asset;
  if p_ciphertext is null or p_iv is null then
    delete from public.ip_secrets where asset_id = p_asset;
    insert into public.ip_secret_views (organisation_id, asset_id, action, user_id) values (v_org, p_asset, 'removed', auth.uid());
    return;
  end if;
  insert into public.ip_secrets (asset_id, organisation_id, iv, ciphertext, updated_by)
  values (p_asset, v_org, p_iv, p_ciphertext, auth.uid())
  on conflict (asset_id) do update set iv = excluded.iv, ciphertext = excluded.ciphertext, updated_by = excluded.updated_by, updated_at = now();
  insert into public.ip_secret_views (organisation_id, asset_id, action, user_id) values (v_org, p_asset, 'changed', auth.uid());
end;
$$;

-- Which assets have a stored password (without the password)
create or replace function public.ip_secret_index(p_org uuid)
returns table (asset_id uuid, updated_at timestamptz) language sql stable security definer set search_path = '' as $$
  select s.asset_id, s.updated_at from public.ip_secrets s
  where s.organisation_id = p_org and app.is_member(p_org) and app.can_handle_ip_secret(s.asset_id);
$$;

-- ---------------------------------------------------------------------
-- Files: certificates and other documents
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%ip_assets%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''insurance_policies''', '''insurance_policies'', ''ip_assets''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%ip_assets%' then
    v_def := replace(v_def, $x$  else
    raise exception 'Files cannot be attached to that kind of record';$x$, $x$  elsif p_table = 'ip_assets' then
    select a.organisation_id, (app.has_role(a.organisation_id, app.records_roles()) or a.responsible_user_id = auth.uid()) into v_org, v_ok
    from public.ip_assets a where a.id = p_id;
  else
    raise exception 'Files cannot be attached to that kind of record';$x$);
    if v_def not like '%ip_assets%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%ip_assets%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Ladder up: renewals due within 90 days
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets'));

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%ip_assets%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- IP: still live and expiring within 90 days, or already past its date
    select 'ip_assets', i.id, 'IP Register', v_legal,
           (case when i.expires_on < current_date then 'IP renewal overdue: ' else 'IP renewal due: ' end)
           || initcap(replace(i.kind, '_', ' ')) || ' ' || i.name || coalesce(' (' || i.jurisdiction || ')', '')
           || ', ' || to_char(i.expires_on, 'FMDD Mon YYYY')
           || coalesce(E'\n' || 'Registration ' || i.registration_number, ''),
           'Renew, or decide to let it lapse',
           (select coalesce(nullif(btrim(p.full_name), ''), u.email)::text from auth.users u left join public.people p on p.user_id = u.id and p.organisation_id = v_org where u.id = i.responsible_user_id limit 1),
           i.expires_on
    from public.ip_assets i
    where i.organisation_id = v_org and i.expires_on is not null and i.expires_on <= current_date + 90
      and i.status in ('pending', 'registered', 'active', 'opposed')
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%ip_assets%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.ip_assets, public.ip_vaults, public.ip_secrets, public.ip_secret_views from anon, authenticated;
grant select on public.ip_assets, public.ip_vaults, public.ip_secret_views to authenticated;
grant insert (organisation_id, kind, name, owner_entity_id, jurisdiction, application_number, registration_number, classes, goods_services, status,
              filed_on, registered_on, expires_on, agent, url, handle, login_identifier, two_factor, responsible_user_id, notes),
      update (kind, name, owner_entity_id, jurisdiction, application_number, registration_number, classes, goods_services, status,
              filed_on, registered_on, expires_on, agent, url, handle, login_identifier, two_factor, responsible_user_id, notes)
  on public.ip_assets to authenticated;
-- ip_secrets: no direct access at all; only through get_ip_secret and set_ip_secret
grant all on public.ip_assets, public.ip_vaults, public.ip_secrets, public.ip_secret_views to service_role;

alter table public.ip_assets enable row level security;
alter table public.ip_vaults enable row level security;
alter table public.ip_secrets enable row level security;
alter table public.ip_secret_views enable row level security;

create policy ip_assets_select on public.ip_assets for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or responsible_user_id = auth.uid());
create policy ip_assets_insert on public.ip_assets for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy ip_assets_update on public.ip_assets for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or responsible_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.records_roles()) or responsible_user_id = auth.uid());
create policy ip_vaults_select on public.ip_vaults for select to authenticated
  using (app.has_role(organisation_id, app.records_roles())
         or exists (select 1 from public.ip_assets a where a.organisation_id = ip_vaults.organisation_id and a.responsible_user_id = auth.uid()));
-- Nobody reads passwords directly, not even the records roles: only through get_ip_secret, which logs it
create policy ip_secrets_none on public.ip_secrets for select to authenticated using (false);
create policy ip_secret_views_select on public.ip_secret_views for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()));

create trigger ip_assets_touch before update on public.ip_assets for each row execute function app.touch_updated_at();
create trigger ip_assets_audit after insert or update or delete on public.ip_assets for each row execute function app.audit_row();
create trigger ip_vaults_audit after insert or update or delete on public.ip_vaults for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
revoke execute on function public.setup_ip_vault(uuid, text, text, text, integer), public.get_ip_secret(uuid), public.set_ip_secret(uuid, text, text),
  public.ip_secret_index(uuid) from public, anon;
grant execute on function public.setup_ip_vault(uuid, text, text, text, integer), public.get_ip_secret(uuid), public.set_ip_secret(uuid, text, text),
  public.ip_secret_index(uuid) to authenticated;

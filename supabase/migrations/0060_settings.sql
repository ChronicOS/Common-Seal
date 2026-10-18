-- 0060: Settings.
--
-- Settings now has sub-tabs: My profile, Account, People and access,
-- Security, Defaults and set-up, Email and notifications, Integrations, and
-- Data and privacy. This migration adds what they need:
--
--   Account: company details for printed documents (legal name, ABN,
--     address, logo), billing contact, acceptance of the terms of use and the
--     data processing agreement, plan usage, and a request to close the
--     organisation (actioned by VeraPhius support, never instantly).
--   People and access: an end date on anyone's access (for example an
--     auditor's), enforced everywhere access is checked.
--   Security: two-step sign-in (MFA) required for chosen roles, enforced by
--     the database as well as the app; sign-out when idle; sign-in history;
--     which email domains can be invited; how long personal links last.
--   Defaults: policy review cycle, default confidentiality period (used when
--     a closed confidential project has no end date), the default reminder
--     email setting for new people.
--   Email: the sending address and footer for emails.
--   My profile: which areas a person does not want reminder emails about.

alter table public.organisations
  add column if not exists legal_name text,
  add column if not exists abn text check (abn is null or abn ~ '^[0-9]{11}$'),
  add column if not exists address text,
  add column if not exists logo_data_url text check (logo_data_url is null or (logo_data_url ~ '^data:image/(png|jpeg|svg\+xml|webp);base64,' and octet_length(logo_data_url) <= 300000)),
  add column if not exists billing_contact_name text,
  add column if not exists billing_contact_email text check (billing_contact_email is null or billing_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_accepted_by uuid references auth.users (id) on delete set null,
  add column if not exists dpa_version text,
  add column if not exists dpa_accepted_at timestamptz,
  add column if not exists dpa_accepted_by uuid references auth.users (id) on delete set null,
  add column if not exists close_requested_at timestamptz,
  add column if not exists close_requested_by uuid references auth.users (id) on delete set null,
  add column if not exists close_reason text,
  add column if not exists mfa_required_roles public.member_role[] not null default '{}',
  add column if not exists idle_timeout_minutes integer check (idle_timeout_minutes is null or idle_timeout_minutes between 5 and 720),
  add column if not exists invite_domains text[] not null default '{}',
  add column if not exists link_days integer not null default 30 check (link_days between 7 and 90),
  add column if not exists policy_review_months integer not null default 12 check (policy_review_months between 1 and 60),
  add column if not exists default_conf_months integer check (default_conf_months is null or default_conf_months between 1 and 240),
  add column if not exists default_reminder_emails text not null default 'when_needed' check (default_reminder_emails in ('when_needed', 'weekly', 'off')),
  add column if not exists email_from_address text check (email_from_address is null or email_from_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists email_footer text check (email_footer is null or char_length(email_footer) <= 500);

alter table public.memberships
  add column if not exists access_ends_on date,
  add column if not exists reminder_muted text[] not null default '{}';

-- Owners and admins change these through the app; terms, closure and the data region only through the functions below
revoke update on public.organisations from authenticated;
grant update (name, tier, gift_approval_threshold, expense_receipt_threshold, legal_name, abn, address, logo_data_url, billing_contact_name, billing_contact_email,
              mfa_required_roles, idle_timeout_minutes, invite_domains, link_days, policy_review_months, default_conf_months, default_reminder_emails,
              email_from_address, email_footer)
  on public.organisations to authenticated;

create or replace function app.guard_organisation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(new.name)) < 2 or char_length(new.name) > 200 then
    raise exception 'The organisation name must be between 2 and 200 characters';
  end if;
  new.name := btrim(new.name);
  new.abn := nullif(regexp_replace(coalesce(new.abn, ''), '\s', '', 'g'), '');
  new.invite_domains := coalesce((select array_agg(distinct lower(btrim(d, ' @'))) from unnest(new.invite_domains) d where btrim(d, ' @') <> ''), '{}');
  -- Requiring two-step sign-in for your own role only once you have set it up yourself, so nobody locks themselves out
  if tg_op = 'UPDATE' and new.mfa_required_roles is distinct from old.mfa_required_roles and auth.uid() is not null
     and exists (select 1 from public.memberships m where m.organisation_id = new.id and m.user_id = auth.uid() and m.is_active
                 and (m.role = any (new.mfa_required_roles) or m.extra_roles && new.mfa_required_roles))
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Set up two-step sign-in for yourself (My profile) and sign in with it before requiring it for your own role';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Access: an end date, and two-step sign-in where the organisation requires it
-- ---------------------------------------------------------------------
create or replace function app.mfa_ok(p_org uuid, p_role public.member_role, p_extra public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from public.organisations o where o.id = p_org
                     and (p_role = any (o.mfa_required_roles) or coalesce(p_extra, '{}') && o.mfa_required_roles));
$$;

create or replace function app.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organisation_id = p_org and m.user_id = auth.uid() and m.is_active
      and (m.access_ends_on is null or m.access_ends_on >= current_date)
      and app.mfa_ok(p_org, m.role, m.extra_roles)
  );
$$;
create or replace function app.has_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organisation_id = p_org and m.user_id = auth.uid() and m.is_active
      and (m.access_ends_on is null or m.access_ends_on >= current_date)
      and (m.role = any (p_roles) or m.extra_roles && p_roles)
      and app.mfa_ok(p_org, m.role, m.extra_roles)
  );
$$;
create or replace function app.user_has_role(p_org uuid, p_user uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.organisation_id = p_org and m.user_id = p_user and m.is_active
                 and (m.access_ends_on is null or m.access_ends_on >= current_date)
                 and (m.role = any (p_roles) or m.extra_roles && p_roles));
$$;

create or replace function public.set_member_access_end(p_org uuid, p_user uuid, p_ends_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, app.admin_roles()) then
    raise exception 'Only an owner or admin can change access';
  end if;
  if p_user = auth.uid() and p_ends_on is not null then
    raise exception 'You cannot set an end date on your own access';
  end if;
  if p_ends_on < current_date then
    raise exception 'Choose today or a later date';
  end if;
  update public.memberships set access_ends_on = p_ends_on where organisation_id = p_org and user_id = p_user;
  if not found then
    raise exception 'That person is not a member of this organisation';
  end if;
end;
$$;

-- The organisation's own two-step and idle settings, for the app to apply at sign-in
create or replace function public.my_security(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'mfa_required', exists (select 1 from public.memberships m join public.organisations o on o.id = m.organisation_id
                            where m.organisation_id = p_org and m.user_id = auth.uid() and m.is_active
                              and (m.role = any (o.mfa_required_roles) or m.extra_roles && o.mfa_required_roles)),
    'idle_timeout_minutes', (select o.idle_timeout_minutes from public.organisations o where o.id = p_org),
    'access_ends_on', (select m.access_ends_on from public.memberships m where m.organisation_id = p_org and m.user_id = auth.uid()))
  where exists (select 1 from public.memberships m where m.organisation_id = p_org and m.user_id = auth.uid() and m.is_active);
$$;

-- Invitations only to the organisation's own email domains, when it has set any
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.invite_member(uuid, text, public.member_role[])'::regprocedure);
  if v_def not like '%invite_domains%' then
    v_def := replace(v_def, $x$  select u.id into v_user from auth.users u$x$, $x$  if exists (select 1 from public.organisations o where o.id = p_org and cardinality(o.invite_domains) > 0
                and not (split_part(v_email, '@', 2) = any (o.invite_domains))) then
    raise exception 'This organisation only invites people with an email address at: %', (select array_to_string(o.invite_domains, ', ') from public.organisations o where o.id = p_org);
  end if;

  select u.id into v_user from auth.users u$x$);
    if v_def not like '%invite_domains%' then
      raise exception 'Could not update public.invite_member';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Sign-in history
-- ---------------------------------------------------------------------
create table if not exists public.sign_in_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  at          timestamptz not null default now(),
  method      text check (method is null or method in ('password', 'link', 'session', 'mfa')),
  user_agent  text check (user_agent is null or char_length(user_agent) <= 300)
);
create index if not exists sign_in_events_user_idx on public.sign_in_events (user_id, at desc);
alter table public.sign_in_events enable row level security;
revoke all on public.sign_in_events from anon, authenticated;
grant all on public.sign_in_events to service_role;
-- No direct access: recorded and read through the functions below
drop policy if exists sign_in_events_none on public.sign_in_events;
create policy sign_in_events_none on public.sign_in_events for select to authenticated using (false);

create or replace function public.record_sign_in(p_method text, p_user_agent text)
returns void language sql security definer set search_path = '' as $$
  insert into public.sign_in_events (user_id, method, user_agent)
  select auth.uid(), case when p_method in ('password', 'link', 'session', 'mfa') then p_method end, left(p_user_agent, 300)
  where auth.uid() is not null;
$$;
-- Owners, admins and auditors see the sign-ins of their organisation's people (last 90 days)
create or replace function public.sign_in_history(p_org uuid)
returns table (full_name text, email text, at timestamptz, method text, user_agent text)
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(btrim(pe.full_name), '') from public.people pe where pe.user_id = s.user_id and pe.organisation_id = p_org limit 1), u.email)::text,
         u.email::text, s.at, s.method, s.user_agent
  from public.sign_in_events s
  join public.memberships m on m.user_id = s.user_id and m.organisation_id = p_org
  join auth.users u on u.id = s.user_id
  where app.has_role(p_org, array['owner', 'admin', 'auditor']::public.member_role[]) and s.at > now() - interval '90 days'
  order by s.at desc
  limit 500;
$$;

-- ---------------------------------------------------------------------
-- Account: terms, the data processing agreement, closure, usage
-- ---------------------------------------------------------------------
create or replace function public.accept_terms(p_org uuid, p_what text, p_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can accept on the organisation''s behalf';
  end if;
  if p_what = 'terms' then
    update public.organisations set terms_version = p_version, terms_accepted_at = now(), terms_accepted_by = auth.uid() where id = p_org;
  elsif p_what = 'dpa' then
    update public.organisations set dpa_version = p_version, dpa_accepted_at = now(), dpa_accepted_by = auth.uid() where id = p_org;
  else
    raise exception 'Unknown';
  end if;
end;
$$;

create or replace function public.request_close(p_org uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can ask to close the organisation';
  end if;
  update public.organisations set close_requested_at = case when p_reason is null then null else now() end,
         close_requested_by = case when p_reason is null then null else auth.uid() end, close_reason = nullif(btrim(p_reason), '')
  where id = p_org;
end;
$$;

create or replace function public.account_usage(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'companies', (select count(*) from public.entities e where e.organisation_id = p_org and e.status <> 'deregistered'),
    'people', (select count(*) from public.memberships m where m.organisation_id = p_org and m.is_active),
    'files', (select count(*) from public.document_versions v where v.organisation_id = p_org),
    'storage_bytes', (select coalesce(sum(v.size_bytes), 0) from public.document_versions v where v.organisation_id = p_org),
    'owners', (select coalesce(jsonb_agg(coalesce(nullif(btrim(pe.full_name), ''), u.email) order by u.email), '[]'::jsonb)
               from public.memberships m join auth.users u on u.id = m.user_id
               left join public.people pe on pe.user_id = m.user_id and pe.organisation_id = p_org
               where m.organisation_id = p_org and m.is_active and (m.role = 'owner' or 'owner' = any (m.extra_roles))),
    'legal_contact', (select coalesce(nullif(btrim(pe.full_name), ''), u.email) from auth.users u left join public.people pe on pe.user_id = u.id and pe.organisation_id = p_org
                      where u.id = app.conf_default_legal(p_org) limit 1))
  where app.is_member(p_org);
$$;

-- ---------------------------------------------------------------------
-- Defaults that take effect
-- ---------------------------------------------------------------------
-- New people get the organisation's default reminder setting
create or replace function app.membership_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select o.default_reminder_emails into new.reminder_emails from public.organisations o where o.id = new.organisation_id;
  new.reminder_emails := coalesce(new.reminder_emails, 'when_needed');
  return new;
end;
$$;
drop trigger if exists memberships_defaults on public.memberships;
create trigger memberships_defaults before insert on public.memberships for each row execute function app.membership_defaults();

-- Personal links last as long as the organisation chooses (30 days unless changed)
create or replace function app.renew_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.link_expires_at := now() + make_interval(days => coalesce((select o.link_days from public.organisations o where o.id = new.organisation_id), 30));
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['ms_recipients', 'risk_requests', 'risk_items', 'training_assignments', 'dd_questionnaires', 'conf_members'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_link_days', t);
    execute format('create trigger %I before insert on public.%I for each row execute function app.renew_link()', t || '_link_days', t);
  end loop;
end;
$$;
create or replace function app.conf_renew_links()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kickoff_issued_at is distinct from old.kickoff_issued_at or new.closure_issued_at is distinct from old.closure_issued_at
     or new.kickoff_text is distinct from old.kickoff_text then
    update public.conf_members set link_expires_at = now() + make_interval(days => coalesce((select o.link_days from public.organisations o where o.id = new.organisation_id), 30))
     where project_id = new.id and removed_at is null;
  end if;
  return null;
end;
$$;
create or replace function public.conf_renew_link(p_member uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not exists (select 1 from public.conf_members m where m.id = p_member and app.conf_can_manage(m.project_id)) then
    raise exception 'Not allowed';
  end if;
  update public.conf_members m set link_expires_at = now() + make_interval(days => coalesce((select o.link_days from public.organisations o where o.id = m.organisation_id), 30))
   where m.id = p_member returning m.token into v_token;
  return v_token;
end;
$$;

-- New policies follow the organisation's review cycle unless one is chosen
create or replace function app.policy_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.review_every_months = 12 then
    new.review_every_months := coalesce((select o.policy_review_months from public.organisations o where o.id = new.organisation_id), 12);
  end if;
  return new;
end;
$$;
drop trigger if exists policies_defaults on public.policies;
create trigger policies_defaults before insert on public.policies for each row execute function app.policy_defaults();

-- A confidential project closed without an end date gets the default confidentiality period from its close
create or replace function app.conf_default_end()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_months integer;
begin
  if new.status = 'closed' and new.conf_ends_on is null and new.nda_status <> 'not_needed' then
    select o.default_conf_months into v_months from public.organisations o where o.id = new.organisation_id;
    if v_months is not null then
      new.conf_ends_on := (coalesce(new.closed_on, current_date) + make_interval(months => v_months))::date;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists conf_projects_default_end on public.conf_projects;
create trigger conf_projects_default_end before update on public.conf_projects for each row execute function app.conf_default_end();

-- Reminder emails: leave out the areas a person has muted, and carry the organisation's footer
create or replace function public.set_reminder_muted(p_org uuid, p_areas text[])
returns void language sql security definer set search_path = '' as $$
  update public.memberships set reminder_muted = coalesce(p_areas, '{}') where organisation_id = p_org and user_id = auth.uid() and is_active;
$$;
drop function if exists public.reminder_batch();
create or replace function public.reminder_batch()
returns table (organisation_id uuid, organisation_name text, user_id uuid, email text, full_name text, items jsonb, item_keys text[], email_footer text, reply_to text)
language sql stable security definer set search_path = '' as $$
  select m.organisation_id, o.name, m.user_id, u.email,
         coalesce((select nullif(btrim(pe.full_name), '') from public.people pe where pe.user_id = m.user_id and pe.organisation_id = m.organisation_id limit 1), u.email),
         (select jsonb_agg(jsonb_build_object('area', n.area, 'what', n.what, 'due', n.due) order by n.due nulls last, n.area)
            from app.needs_attention(m.organisation_id, m.user_id) n where not (n.area = any (m.reminder_muted))),
         (select array_agg(n.key) from app.needs_attention(m.organisation_id, m.user_id) n where not (n.area = any (m.reminder_muted))),
         o.email_footer, o.email_from_address
  from public.memberships m
  join public.organisations o on o.id = m.organisation_id
  join auth.users u on u.id = m.user_id
  where m.is_active and (m.access_ends_on is null or m.access_ends_on >= current_date) and m.reminder_emails <> 'off' and u.email is not null
    and (m.reminders_last_sent_at is null or m.reminders_last_sent_at < now() - case when m.reminder_emails = 'weekly' then interval '6 days 12 hours' else interval '20 hours' end)
    and exists (select 1 from app.needs_attention(m.organisation_id, m.user_id) n
                where not (n.area = any (m.reminder_muted)) and (not (n.key = any (m.reminders_last_keys)) or n.due <= current_date + 2));
$$;

-- ---------------------------------------------------------------------
-- Your own organisations, including any you cannot open yet
-- ---------------------------------------------------------------------
-- The sign-in screen needs to know when an organisation is waiting for
-- two-step sign-in, rather than the organisation silently disappearing.
create or replace function public.my_memberships()
returns table (organisation_id uuid, name text, tier text, data_region text, role public.member_role, extra_roles public.member_role[], locked text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.tier::text, o.data_region::text, m.role, m.extra_roles,
         case when not app.mfa_ok(o.id, m.role, m.extra_roles) then 'mfa' end
  from public.memberships m
  join public.organisations o on o.id = m.organisation_id
  where m.user_id = auth.uid() and m.is_active and (m.access_ends_on is null or m.access_ends_on >= current_date);
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
revoke execute on function public.set_member_access_end(uuid, uuid, date), public.my_security(uuid), public.record_sign_in(text, text), public.sign_in_history(uuid),
                           public.accept_terms(uuid, text, text), public.request_close(uuid, text), public.account_usage(uuid), public.set_reminder_muted(uuid, text[]), public.my_memberships() from public, anon;
grant execute on function public.set_member_access_end(uuid, uuid, date), public.my_security(uuid), public.record_sign_in(text, text), public.sign_in_history(uuid),
                          public.accept_terms(uuid, text, text), public.request_close(uuid, text), public.account_usage(uuid), public.set_reminder_muted(uuid, text[]), public.my_memberships() to authenticated;

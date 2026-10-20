-- 0066: Site access log (platform operator only).
--
-- Records each visit to VeraPhius by a signed-in person: when it started, when they were last active,
-- how long they were actively using it, which organisation they had open and on what device.
-- Only the site operators listed in app.site_admins can see the log (initially eamesron@gmail.com);
-- nobody else, including organisation owners, can read it. Visits are kept for 180 days.
--
-- Time counts only while the page is open in front of the person and they have used it in the last
-- five minutes; a tab left open overnight does not count as hours on the site.

create table if not exists app.site_admins (
  email text primary key check (email = lower(btrim(email)))
);
insert into app.site_admins (email) values ('eamesron@gmail.com') on conflict do nothing;
revoke all on app.site_admins from public, anon, authenticated;

create table if not exists public.site_sessions (
  id               uuid primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  organisation_id  uuid references public.organisations (id) on delete set null,
  started_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  active_seconds   integer not null default 0 check (active_seconds >= 0),
  user_agent       text check (user_agent is null or char_length(user_agent) <= 300)
);
create index if not exists site_sessions_started_idx on public.site_sessions (started_at desc);
create index if not exists site_sessions_user_idx on public.site_sessions (user_id, started_at desc);
alter table public.site_sessions enable row level security;
revoke all on public.site_sessions from anon, authenticated;
grant all on public.site_sessions to service_role;
drop policy if exists site_sessions_none on public.site_sessions;
create policy site_sessions_none on public.site_sessions for select to authenticated using (false);

create or replace function app.is_site_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u join app.site_admins a on a.email = lower(u.email) where u.id = auth.uid());
$$;

-- The page calls this when it opens and about once a minute while the person is using it
create or replace function public.site_heartbeat(p_session uuid, p_org uuid, p_user_agent text, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := case when p_org is not null and app.is_member(p_org) then p_org end;
begin
  if auth.uid() is null or p_session is null then
    return;
  end if;
  insert into public.site_sessions (id, user_id, organisation_id, user_agent)
  values (p_session, auth.uid(), v_org, left(p_user_agent, 300))
  on conflict (id) do update set
    last_seen_at = now(),
    organisation_id = coalesce(v_org, public.site_sessions.organisation_id),
    -- at most 90 seconds per beat, and only when the person was actually using the page
    active_seconds = public.site_sessions.active_seconds
      + case when p_active then least(90, greatest(0, extract(epoch from now() - public.site_sessions.last_seen_at)::integer)) else 0 end
  where public.site_sessions.user_id = auth.uid();
  -- Housekeeping: visits older than 180 days are removed
  if random() < 0.01 then
    delete from public.site_sessions where started_at < now() - interval '180 days';
  end if;
end;
$$;

create or replace function public.am_site_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_site_admin();
$$;

-- The log, for site operators only
create or replace function public.site_access_log(p_days integer default 30)
returns table (session_id uuid, email text, full_name text, organisation text, started_at timestamptz, last_seen_at timestamptz, active_seconds integer, user_agent text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_site_admin() then
    raise exception 'Not allowed';
  end if;
  return query
  select s.id, u.email::text,
         coalesce((select nullif(btrim(pe.full_name), '') from public.people pe where pe.user_id = s.user_id order by (pe.organisation_id = s.organisation_id) desc limit 1), u.email)::text,
         o.name, s.started_at, s.last_seen_at, s.active_seconds, s.user_agent
  from public.site_sessions s
  join auth.users u on u.id = s.user_id
  left join public.organisations o on o.id = s.organisation_id
  where s.started_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 180)))
  order by s.started_at desc
  limit 2000;
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
revoke execute on function public.site_heartbeat(uuid, uuid, text, boolean), public.am_site_admin(), public.site_access_log(integer) from public, anon;
grant execute on function public.site_heartbeat(uuid, uuid, text, boolean), public.am_site_admin(), public.site_access_log(integer) to authenticated;

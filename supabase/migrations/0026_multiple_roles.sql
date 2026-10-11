-- 0026: a person can hold more than one role in an organisation.
--
-- The first role stays in memberships.role; any further roles go in extra_roles.
-- app.has_role (which every access rule uses) now looks at both, so a person
-- gets the access of every role they hold.
--
-- Invite (someone not yet a member) and Assign (change an existing member's
-- roles) are now separate: invite_member and set_member_roles.

alter table public.memberships add column if not exists extra_roles public.member_role[] not null default '{}';
alter table public.invitations add column if not exists extra_roles public.member_role[] not null default '{}';

create or replace function app.has_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organisation_id = p_org and m.user_id = auth.uid() and m.is_active
      and (m.role = any (p_roles) or m.extra_roles && p_roles)
  );
$$;

-- Tidy a list of roles: no blanks, no repeats, order kept
create or replace function app.clean_roles(p_roles public.member_role[])
returns public.member_role[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(r order by n), '{}')
  from (select r, min(n) as n from unnest(p_roles) with ordinality as t(r, n) where r is not null group by r) x;
$$;

-- Invite: adds the person now if they have an account, otherwise records an invitation.
drop function if exists public.invite_member(uuid, text, public.member_role);

create or replace function public.invite_member(p_org uuid, p_email text, p_roles public.member_role[])
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_roles public.member_role[] := app.clean_roles(p_roles);
begin
  if not app.has_role(p_org, app.admin_roles()) then
    raise exception 'Only an owner or admin can invite people';
  end if;
  if cardinality(v_roles) = 0 then
    raise exception 'Choose at least one role';
  end if;
  if 'owner' = any (v_roles) and not app.has_role(p_org, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can add another owner';
  end if;
  if v_email not like '%_@_%._%' then
    raise exception 'Enter a valid email address';
  end if;

  select u.id into v_user from auth.users u
  where lower(u.email) = v_email and u.email_confirmed_at is not null;

  if v_user is not null then
    if exists (select 1 from public.memberships m where m.organisation_id = p_org and m.user_id = v_user and m.is_active) then
      raise exception 'That person is already a member. Use Assign to change their roles.';
    end if;
    insert into public.memberships (organisation_id, user_id, role, extra_roles)
    values (p_org, v_user, v_roles[1], v_roles[2:])
    on conflict (organisation_id, user_id) do update set role = excluded.role, extra_roles = excluded.extra_roles, is_active = true;
    if not exists (select 1 from public.people p where p.organisation_id = p_org and p.user_id = v_user) then
      insert into public.people (organisation_id, user_id, full_name, email) values (p_org, v_user, v_email, v_email);
    end if;
    return 'added';
  end if;

  perform set_config('app.invitation_system', 'on', true);
  update public.invitations set role = v_roles[1], extra_roles = v_roles[2:], invited_by = auth.uid()
  where organisation_id = p_org and email = v_email and status = 'pending';
  if not found then
    insert into public.invitations (organisation_id, email, role, extra_roles, invited_by)
    values (p_org, v_email, v_roles[1], v_roles[2:], auth.uid());
  end if;
  perform set_config('app.invitation_system', 'off', true);
  return 'invited';
end;
$$;

-- Assign: set the roles of someone who is already a member, or remove their access.
create or replace function public.set_member_roles(p_org uuid, p_user uuid, p_roles public.member_role[], p_active boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_roles public.member_role[] := app.clean_roles(p_roles);
  v_now public.member_role[];
  v_was_owner boolean;
  v_will_be_owner boolean;
begin
  if not app.has_role(p_org, app.admin_roles()) then
    raise exception 'Only an owner or admin can change roles';
  end if;
  select m.role || m.extra_roles into v_now from public.memberships m
  where m.organisation_id = p_org and m.user_id = p_user for update;
  if v_now is null then
    raise exception 'That person is not a member of this organisation. Use Invite.';
  end if;
  if p_active and cardinality(v_roles) = 0 then
    raise exception 'Choose at least one role';
  end if;

  v_was_owner := 'owner' = any (v_now);
  v_will_be_owner := p_active and 'owner' = any (v_roles);
  if v_was_owner <> v_will_be_owner and not app.has_role(p_org, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can add or remove an owner';
  end if;
  if v_was_owner and not v_will_be_owner and not exists (
       select 1 from public.memberships m
       where m.organisation_id = p_org and m.user_id <> p_user and m.is_active
         and (m.role = 'owner' or 'owner' = any (m.extra_roles))) then
    raise exception 'This is the only owner. Make someone else an owner first.';
  end if;

  if p_active then
    update public.memberships set role = v_roles[1], extra_roles = v_roles[2:], is_active = true
    where organisation_id = p_org and user_id = p_user;
  else
    update public.memberships set is_active = false where organisation_id = p_org and user_id = p_user;
  end if;
end;
$$;

-- Joining from an invitation now carries every invited role
create or replace function public.accept_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv record;
  v_count integer := 0;
begin
  if v_user is null then
    return 0;
  end if;
  select lower(u.email) into v_email from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;

  perform set_config('app.invitation_system', 'on', true);
  for v_inv in
    select i.* from public.invitations i where i.email = v_email and i.status = 'pending' for update
  loop
    insert into public.memberships (organisation_id, user_id, role, extra_roles)
    values (v_inv.organisation_id, v_user, v_inv.role, v_inv.extra_roles)
    on conflict (organisation_id, user_id) do update set is_active = true;
    if not exists (select 1 from public.people p where p.organisation_id = v_inv.organisation_id and p.user_id = v_user) then
      insert into public.people (organisation_id, user_id, full_name, email)
      values (v_inv.organisation_id, v_user, v_email, v_email);
    end if;
    update public.invitations set status = 'accepted', accepted_by = v_user, accepted_at = now() where id = v_inv.id;
    v_count := v_count + 1;
  end loop;
  perform set_config('app.invitation_system', 'off', true);
  return v_count;
end;
$$;

-- Training audiences read the role directly; make them look at every role a person holds.
do $$
declare
  f record;
  v_def text;
  v_new text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosrc like '%ms.role = ''director''%'
  loop
    v_def := pg_get_functiondef(f.oid);
    v_new := replace(v_def, 'ms.role = ''director''', '''director'' = any (ms.role || ms.extra_roles)');
    v_new := replace(v_new, 'ms.role <> ''auditor''', '(ms.role || ms.extra_roles) <> array[''auditor'']::public.member_role[]');
    execute v_new;
  end loop;
end;
$$;

revoke execute on all functions in schema app from public, anon;
grant execute on function app.has_role(uuid, public.member_role[]) to authenticated, service_role;
grant execute on function app.clean_roles(public.member_role[]) to service_role;
revoke execute on function public.invite_member(uuid, text, public.member_role[]) from public, anon;
revoke execute on function public.set_member_roles(uuid, uuid, public.member_role[], boolean) from public, anon;
revoke execute on function public.accept_invitations() from public, anon;
grant execute on function public.invite_member(uuid, text, public.member_role[]) to authenticated;
grant execute on function public.set_member_roles(uuid, uuid, public.member_role[], boolean) to authenticated;
grant execute on function public.accept_invitations() to authenticated;

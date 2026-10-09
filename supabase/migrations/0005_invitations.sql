-- =====================================================================
-- Common Seal - 0005: invitations
--
-- An owner or admin can invite someone by email before that person has
-- an account. The invitation is taken up automatically the first time
-- they sign in with that (confirmed) email address.
-- =====================================================================

create type public.invitation_status as enum ('pending', 'accepted', 'revoked');

create table public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  email            text not null check (email = lower(btrim(email)) and email like '%_@_%._%'),
  role             public.member_role not null,
  status           public.invitation_status not null default 'pending',
  invited_by       uuid references auth.users (id) on delete set null,
  accepted_by      uuid references auth.users (id) on delete set null,
  accepted_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index invitations_one_pending_idx
  on public.invitations (organisation_id, email) where status = 'pending';
create index invitations_email_idx on public.invitations (email) where status = 'pending';

create trigger invitations_touch before update on public.invitations
  for each row execute function app.touch_updated_at();
create trigger invitations_audit after insert or update or delete on public.invitations
  for each row execute function app.audit_row();

-- An invitation can only be revoked from the client; everything else goes through functions.
create or replace function app.guard_invitation_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.invitation_system', true) = 'on' then
    return new;
  end if;
  if old.status <> 'pending' or new.status <> 'revoked'
     or new.email <> old.email or new.role <> old.role or new.organisation_id <> old.organisation_id then
    raise exception 'A pending invitation can only be revoked';
  end if;
  return new;
end;
$$;
create trigger invitations_guard before update on public.invitations
  for each row execute function app.guard_invitation_update();

-- Replaces add_member: adds the person now if they have an account, otherwise records an invitation.
drop function if exists public.add_member(uuid, text, public.member_role);

create or replace function public.invite_member(p_org uuid, p_email text, p_role public.member_role)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not app.has_role(p_org, app.admin_roles()) then
    raise exception 'Only an owner or admin can invite people';
  end if;
  if p_role = 'owner' and not app.has_role(p_org, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can add another owner';
  end if;
  if v_email not like '%_@_%._%' then
    raise exception 'Enter a valid email address';
  end if;

  select u.id into v_user from auth.users u
  where lower(u.email) = v_email and u.email_confirmed_at is not null;

  if v_user is not null then
    insert into public.memberships (organisation_id, user_id, role)
    values (p_org, v_user, p_role)
    on conflict (organisation_id, user_id) do update set role = excluded.role, is_active = true;
    if not exists (select 1 from public.people p where p.organisation_id = p_org and p.user_id = v_user) then
      insert into public.people (organisation_id, user_id, full_name, email) values (p_org, v_user, v_email, v_email);
    end if;
    return 'added';
  end if;

  perform set_config('app.invitation_system', 'on', true);
  update public.invitations set role = p_role, invited_by = auth.uid()
  where organisation_id = p_org and email = v_email and status = 'pending';
  if not found then
    insert into public.invitations (organisation_id, email, role, invited_by)
    values (p_org, v_email, p_role, auth.uid());
  end if;
  perform set_config('app.invitation_system', 'off', true);
  return 'invited';
end;
$$;

-- Called by the app after sign-in. Joins the caller to every organisation that invited their email.
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
    insert into public.memberships (organisation_id, user_id, role)
    values (v_inv.organisation_id, v_user, v_inv.role)
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

revoke execute on function public.invite_member(uuid, text, public.member_role) from public, anon;
revoke execute on function public.accept_invitations() from public, anon;
grant execute on function public.invite_member(uuid, text, public.member_role) to authenticated;
grant execute on function public.accept_invitations() to authenticated;
grant execute on all functions in schema app to authenticated, service_role;

revoke all on public.invitations from anon, authenticated;
grant select, update on public.invitations to authenticated;
grant all on public.invitations to service_role;

alter table public.invitations enable row level security;
create policy invitations_select on public.invitations for select to authenticated
  using (app.has_role(organisation_id, app.admin_roles()));
create policy invitations_update on public.invitations for update to authenticated
  using (app.has_role(organisation_id, app.admin_roles()))
  with check (app.has_role(organisation_id, app.admin_roles()));

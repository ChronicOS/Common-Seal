-- =====================================================================
-- Common Seal - 0002: self-serve organisation creation
--
-- Organisations have no insert policy, so they can only be created
-- through this function. It creates the organisation, makes the caller
-- its owner and records the caller as a person, in one transaction.
-- =====================================================================

create or replace function public.create_organisation(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_org  uuid;
begin
  if v_user is null then
    raise exception 'You must be signed in to create an organisation';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 200 then
    raise exception 'Organisation name must be between 2 and 200 characters';
  end if;

  insert into public.organisations (name) values (v_name) returning id into v_org;

  insert into public.memberships (organisation_id, user_id, role)
  values (v_org, v_user, 'owner');

  insert into public.people (organisation_id, user_id, full_name, email)
  select v_org, v_user, coalesce(u.email, 'Owner'), u.email
  from auth.users u where u.id = v_user;

  return v_org;
end;
$$;

revoke execute on function public.create_organisation(text) from public, anon;
grant execute on function public.create_organisation(text) to authenticated;

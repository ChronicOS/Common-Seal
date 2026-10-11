-- 0027: an administrator can change or remove anyone, including an owner.
-- Before this, only an owner could give or take away the owner role, which left
-- no way forward if the owner was unavailable and could not replace themselves.
-- The organisation must still always have at least one owner: name the new
-- owner first, then remove the old one.

do $$
declare
  f record;
  v_new text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('invite_member', 'set_member_roles')
  loop
    -- Take out the "only an owner can ..." check, leaving every other rule in place
    v_new := regexp_replace(pg_get_functiondef(f.oid),
                            '\s+if [^;]*?then\s+raise exception ''Only an owner can[^;]*;\s+end if;', '', 'g');
    if v_new like '%Only an owner can%' then
      raise exception 'Could not update %', f.proname;
    end if;
    execute v_new;
  end loop;
end;
$$;

revoke execute on function public.invite_member(uuid, text, public.member_role[]) from public, anon;
revoke execute on function public.set_member_roles(uuid, uuid, public.member_role[], boolean) from public, anon;
grant execute on function public.invite_member(uuid, text, public.member_role[]) to authenticated;
grant execute on function public.set_member_roles(uuid, uuid, public.member_role[], boolean) to authenticated;

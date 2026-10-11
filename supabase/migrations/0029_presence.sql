-- 0029: "who else is here" (presence).
-- People signed in to the same organisation can see who else is online and
-- which tab they are on. Nothing is stored: presence lives only while a
-- browser is open, on a private Supabase Realtime channel named org:<id>.
-- These rules make that channel readable and writable only by active members
-- of that organisation.

-- The organisation a channel name refers to, or null if it is not one of ours
create or replace function app.presence_org(p_topic text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_topic ~ '^org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then substr(p_topic, 5)::uuid end;
$$;
revoke execute on function app.presence_org(text) from public, anon;
grant execute on function app.presence_org(text) to authenticated, service_role;

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'Supabase Realtime is not set up on this database; presence rules skipped';
    return;
  end if;
  execute 'drop policy if exists common_seal_presence_read on realtime.messages';
  execute 'drop policy if exists common_seal_presence_write on realtime.messages';
  execute $p$
    create policy common_seal_presence_read on realtime.messages for select to authenticated
      using (extension = 'presence' and app.is_member(app.presence_org(realtime.topic())))
  $p$;
  execute $p$
    create policy common_seal_presence_write on realtime.messages for insert to authenticated
      with check (extension = 'presence' and app.is_member(app.presence_org(realtime.topic())))
  $p$;
end;
$$;

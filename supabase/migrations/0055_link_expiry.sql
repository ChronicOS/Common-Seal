-- 0055: Personal links expire after 30 days.
--
-- Every link that works without signing in (the modern slavery supplier
-- survey, risk input and action updates, training, the third-party due
-- diligence questionnaire, and confidential project acknowledgements) now
-- stops working 30 days after it was last sent. Sending it again (a reminder,
-- a chaser, issuing a notice, or "copy their link") starts a fresh 30 days, so
-- nobody has to manage expiry by hand. Links already out get 30 days from now.

do $$
declare
  t text;
begin
  foreach t in array array['ms_recipients', 'risk_requests', 'risk_items', 'training_assignments', 'dd_questionnaires', 'conf_members'] loop
    execute format('alter table public.%I add column if not exists link_expires_at timestamptz not null default (now() + interval ''30 days'')', t);
  end loop;
end;
$$;

-- Sending (or resending) a link starts a fresh 30 days
create or replace function app.renew_link()
returns trigger language plpgsql as $$
begin
  new.link_expires_at := now() + interval '30 days';
  return new;
end;
$$;
create trigger ms_recipients_renew_link before update of cover_sent_at, chaser1_sent_at, chaser2_sent_at, token on public.ms_recipients
  for each row execute function app.renew_link();
create trigger risk_requests_renew_link before update of sent_at, reminder1_sent_at, reminder2_sent_at, token on public.risk_requests
  for each row execute function app.renew_link();
create trigger risk_items_renew_link before update of prompt_week_sent_at, prompt_due_sent_at, actioner_email, token on public.risk_items
  for each row execute function app.renew_link();
create trigger training_assignments_renew_link before update of due_on, reminder_before_sent_at, reminder_due_sent_at, overdue_sent_at, token on public.training_assignments
  for each row execute function app.renew_link();
create trigger dd_questionnaires_renew_link before update of contact_name, contact_email, sent_at, status, token on public.dd_questionnaires
  for each row execute function app.renew_link();

-- Confidential projects: issuing the notice or the closure notice renews everyone's link
create or replace function app.conf_renew_links()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kickoff_issued_at is distinct from old.kickoff_issued_at or new.closure_issued_at is distinct from old.closure_issued_at
     or new.kickoff_text is distinct from old.kickoff_text then
    update public.conf_members set link_expires_at = now() + interval '30 days' where project_id = new.id and removed_at is null;
  end if;
  return null;
end;
$$;
create trigger conf_projects_renew_links after update on public.conf_projects for each row execute function app.conf_renew_links();

-- "Copy their link" on the list renews that person's link
create or replace function public.conf_renew_link(p_member uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not exists (select 1 from public.conf_members m where m.id = p_member and app.conf_can_manage(m.project_id)) then
    raise exception 'Not allowed';
  end if;
  update public.conf_members set link_expires_at = now() + interval '30 days' where id = p_member returning token into v_token;
  return v_token;
end;
$$;

-- The link pages check the expiry
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in select * from (values
      ('public.ms_questionnaire(text)', 'r.token = p_token and char_length(coalesce(p_token, '''')) = 64', 'r.token = p_token and char_length(coalesce(p_token, '''')) = 64 and r.link_expires_at > now()'),
      ('public.ms_submit_questionnaire(text, text, text, text, jsonb, text[])', 'r.token = p_token and char_length(coalesce(p_token, '''')) = 64', 'r.token = p_token and char_length(coalesce(p_token, '''')) = 64 and r.link_expires_at > now()'),
      ('public.risk_request(text)', 'q.token = p_token and char_length(coalesce(p_token, '''')) = 64', 'q.token = p_token and char_length(coalesce(p_token, '''')) = 64 and q.link_expires_at > now()'),
      ('public.risk_save_item(text, text, jsonb)', 'q.token = p_token and char_length(coalesce(p_token, '''')) = 64', 'q.token = p_token and char_length(coalesce(p_token, '''')) = 64 and q.link_expires_at > now()'),
      ('public.risk_delete_item(text, uuid)', 'q.token = p_token and char_length(coalesce(p_token, '''')) = 64', 'q.token = p_token and char_length(coalesce(p_token, '''')) = 64 and q.link_expires_at > now()'),
      ('public.risk_finish(text, text, boolean)', 'q.token = p_token and char_length(coalesce(p_token, '''')) = 64', 'q.token = p_token and char_length(coalesce(p_token, '''')) = 64 and q.link_expires_at > now()'),
      ('public.risk_action(text)', 'i.token = p_token and char_length(coalesce(p_token, '''')) = 64', 'i.token = p_token and char_length(coalesce(p_token, '''')) = 64 and i.link_expires_at > now()'),
      ('public.risk_action_update(text, text, boolean, text)', 'i.token = p_token and char_length(coalesce(p_token, '''')) = 64', 'i.token = p_token and char_length(coalesce(p_token, '''')) = 64 and i.link_expires_at > now()'),
      ('public.training_by_link(text)', 'from public.training_assignments where token = p_token', 'from public.training_assignments where token = p_token and link_expires_at > now()'),
      ('public.complete_training_by_link(text, integer[], text, boolean)', 'from public.training_assignments where token = p_token', 'from public.training_assignments where token = p_token and link_expires_at > now()'),
      ('app.can_read_training_object(text)', 'a.completed_at is null and a.token is not null', 'a.completed_at is null and a.token is not null and a.link_expires_at > now()'),
      ('public.dd_questionnaire(text)', 'where token = p_token and char_length(coalesce(p_token, '''')) = 64', 'where token = p_token and char_length(coalesce(p_token, '''')) = 64 and link_expires_at > now()'),
      ('public.submit_dd_questionnaire(text, jsonb)', 'where token = p_token and char_length(coalesce(p_token, '''')) = 64', 'where token = p_token and char_length(coalesce(p_token, '''')) = 64 and link_expires_at > now()'),
      ('public.register_dd_upload(text, text, text, text, bigint, text)', 'where token = p_token and char_length(coalesce(p_token, '''')) = 64', 'where token = p_token and char_length(coalesce(p_token, '''')) = 64 and link_expires_at > now()'),
      ('public.remove_dd_upload(text, text)', 'where token = p_token and char_length(coalesce(p_token, '''')) = 64', 'where token = p_token and char_length(coalesce(p_token, '''')) = 64 and link_expires_at > now()'),
      ('public.conf_link(text)', 'where m.token = p_token and char_length(p_token) = 64', 'where m.token = p_token and char_length(p_token) = 64 and m.link_expires_at > now()'),
      ('public.conf_link_confirm(text, text)', 'x.token = p_token and char_length(p_token) = 64', 'x.token = p_token and char_length(p_token) = 64 and x.link_expires_at > now()')
    ) as v(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if v_def like '%link_expires_at%' then
      continue;
    end if;
    v_new := replace(v_def, r.old_text, r.new_text);
    v_new := replace(v_new, '''This link is not valid'';', '''This link is not valid or has expired. Ask the person who sent it for a new one.'';');
    v_new := replace(v_new, '''This link is not valid. Ask the project lead for a new one.''', '''This link is not valid or has expired. Ask the project lead for a new one.''');
    if v_new not like '%link_expires_at%' then
      raise exception 'Could not add the expiry check to %', r.fn;
    end if;
    execute v_new;
  end loop;
end;
$$;

-- One message for a link that is wrong or has run out
do $$
declare
  r record;
  v_def text;
begin
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.prosrc like '%This link is not valid. Ask the person who sent it for a new one.%' loop
    v_def := replace(pg_get_functiondef(r.oid), 'This link is not valid. Ask the person who sent it for a new one.', 'This link is not valid or has expired. Ask the person who sent it for a new one.');
    execute v_def;
  end loop;
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
revoke execute on function public.conf_renew_link(uuid) from public, anon;
grant execute on function public.conf_renew_link(uuid) to authenticated;

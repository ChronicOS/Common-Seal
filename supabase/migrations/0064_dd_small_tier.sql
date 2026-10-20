-- 0064: Due diligence for the Small tier.
--
-- Medium and Large keep the full due diligence process. A Small organisation gets the essentials only:
-- five checks, all of which fill themselves in from the questionnaire and the one-click checks
--   sanctions lists · politically exposed persons · other watch lists · adverse media · questionnaire
-- (individuals: the same, without the questionnaire). No special interest persons, sanctions ownership,
-- state ownership, modern slavery or customer identification checks, and no red flag or enhanced due
-- diligence reports (paid specialist reports a small organisation is unlikely to commission).
-- The questionnaire check is added only when a questionnaire is actually sent, so a Small organisation
-- that does not send one is not left waiting for it. Small organisations may also decide a case they
-- asked for themselves (there is often no second person), and anyone who works on due diligence (not only
-- Legal or Compliance) can review possible matches. Everything else that keeps it honest stays:
-- no clearing while a check is not done, and a reason whenever a check raised a concern.
-- The rating, the decision and the block on contracts still apply.
-- Cases opened before a change of tier keep the checks they were opened with.

create or replace function app.dd_small(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select o.tier::text = 'small' from public.organisations o where o.id = p_org), false);
$$;

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.request_due_diligence(uuid, uuid, jsonb, text, jsonb)'::regprocedure);
  if v_def not like '%dd_small%' then
    v_def := replace(v_def, $x$  if v_rating = 'high' then v_topics := array_append(v_topics, 'enhanced'); end if;$x$, $x$  if v_rating = 'high' then v_topics := array_append(v_topics, 'enhanced'); end if;
  -- Small tier: the essentials only
  if app.dd_small(p_org) then
    v_topics := case when v_subject = 'individual' then array['sanctions', 'pep', 'official_lists', 'adverse_media']
                     else array['sanctions', 'pep', 'official_lists', 'adverse_media'] end;
  end if;$x$);
    if v_def not like '%dd_small%' then
      raise exception 'Could not update public.request_due_diligence (run 0061 first)';
    end if;
    execute v_def;
  elsif v_def like '%''adverse_media'', ''questionnaire''] end;%' then
    -- an earlier draft of this update added the questionnaire check up front
    execute replace(v_def, $x$'adverse_media', 'questionnaire'] end;$x$, $x$'adverse_media'] end;$x$);
  end if;
end;
$$;

-- When the questionnaire comes back, a Small organisation does not get red flag or enhanced report checks added
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.submit_dd_questionnaire(text, jsonb)'::regprocedure);
  if v_def not like '%dd_small%' then
    v_def := replace(v_def, $x$    if v_rating in ('medium', 'high') then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'red_flag') on conflict do nothing;$x$,
      $x$    if v_rating in ('medium', 'high') and not app.dd_small(c.organisation_id) then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'red_flag') on conflict do nothing;$x$);
    v_def := replace(v_def, $x$    if v_rating = 'high' then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'enhanced') on conflict do nothing;$x$,
      $x$    if v_rating = 'high' and not app.dd_small(c.organisation_id) then
      insert into public.dd_checks (organisation_id, case_id, topic) values (c.organisation_id, c.id, 'enhanced') on conflict do nothing;$x$);
    if v_def not like '%dd_small%' then
      raise exception 'Could not update public.submit_dd_questionnaire (run 0062 first)';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Sending a questionnaire adds its check to the case if the case does not have one
create or replace function app.dd_questionnaire_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.dd_cases c where c.id = new.case_id and c.status = 'open')
     and not exists (select 1 from public.dd_checks k where k.case_id = new.case_id and k.topic = 'questionnaire') then
    perform set_config('app.dd_system', 'on', true);
    insert into public.dd_checks (organisation_id, case_id, topic) values (new.organisation_id, new.case_id, 'questionnaire');
    perform set_config('app.dd_system', 'off', true);
  end if;
  return null;
end;
$$;
drop trigger if exists dd_questionnaires_add_check on public.dd_questionnaires;
create trigger dd_questionnaires_add_check after insert on public.dd_questionnaires for each row execute function app.dd_questionnaire_check();

-- Small organisations can decide a case the same person asked for
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.decide_dd_case(uuid, public.dd_case_status, text)'::regprocedure);
  if v_def not like '%dd_small%' then
    v_def := replace(v_def, $x$  if v_c.requested_by = auth.uid() and v_c.risk_rating <> 'low' then$x$,
                            $x$  if v_c.requested_by = auth.uid() and v_c.risk_rating <> 'low' and not app.dd_small(v_c.organisation_id) then$x$);
    if v_def not like '%dd_small%' then
      raise exception 'Could not update public.decide_dd_case';
    end if;
    execute v_def;
  end if;
end;
$$;

-- In a Small organisation anyone who works on due diligence can review possible matches (not only Legal or Compliance)
do $$
declare
  f text;
  v_def text;
begin
  foreach f in array array['public.review_dd_screening_hit(uuid, text, text, text)', 'public.review_dd_screening_rest(uuid, text)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if v_def not like '%dd_small%' then
      v_def := replace(v_def, $x$not app.has_role(s.organisation_id, array['owner', 'admin', 'legal', 'compliance']::public.member_role[])$x$,
        $x$not app.has_role(s.organisation_id, case when app.dd_small(s.organisation_id) then app.records_roles() else array['owner', 'admin', 'legal', 'compliance']::public.member_role[] end)$x$);
      if v_def not like '%dd_small%' then
        raise exception 'Could not update %', f;
      end if;
      execute v_def;
    end if;
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

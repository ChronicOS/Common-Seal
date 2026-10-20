-- 0064: Due diligence for the Small tier.
--
-- Medium and Large keep the full due diligence process. A Small organisation gets the essentials only:
-- five checks, all of which fill themselves in from the questionnaire and the one-click checks
--   sanctions lists · politically exposed persons · other watch lists · adverse media · questionnaire
-- (individuals: the same, without the questionnaire). No special interest persons, sanctions ownership,
-- state ownership, modern slavery or customer identification checks, and no red flag or enhanced due
-- diligence reports (paid specialist reports a small organisation is unlikely to commission).
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
                     else array['sanctions', 'pep', 'official_lists', 'adverse_media', 'questionnaire'] end;
  end if;$x$);
    if v_def not like '%dd_small%' then
      raise exception 'Could not update public.request_due_diligence (run 0061 first)';
    end if;
    execute v_def;
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

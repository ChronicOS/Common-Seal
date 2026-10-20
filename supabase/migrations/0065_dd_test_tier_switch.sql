-- 0065: Each due diligence case remembers which process it was opened under ("small" or "full").
--
-- Normally that follows the organisation's tier. TEST ONLY: the Due Diligence page has a switch that
-- lets a tester open a case as Small or as Medium/Large regardless of the tier, so the two can be
-- compared side by side in two browser tabs. Remove the switch before go-live (see the to-do list);
-- the per-case record of the process stays, so a later change of tier never changes a case under way.

alter table public.organisations drop column if exists dd_tier_override;

create or replace function app.dd_small(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select o.tier::text = 'small' from public.organisations o where o.id = p_org), false);
$$;

-- The process a case runs under: what it was opened with, else the organisation's tier
create or replace function app.dd_case_small(p_case uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select case c.answers ->> 'process' when 'small' then true when 'full' then false else app.dd_small(c.organisation_id) end
                   from public.dd_cases c where c.id = p_case), false);
$$;

do $$
declare
  v_def text;
begin
  -- Opening a case: the tester's choice (p_party.dd_mode) wins, else the tier; recorded on the case
  v_def := pg_get_functiondef('public.request_due_diligence(uuid, uuid, jsonb, text, jsonb)'::regprocedure);
  if v_def not like '%v_small%' then
    v_def := replace(v_def, $x$  v_countries text[];
$x$, $x$  v_countries text[];
  v_small boolean := case p_party ->> 'dd_mode' when 'small' then true when 'full' then false else app.dd_small(p_org) end;
$x$);
    v_def := replace(v_def, $x$  if app.dd_small(p_org) then$x$, $x$  if v_small then$x$);
    v_def := replace(v_def, $x$  perform set_config('app.dd_system', 'off', true);
  return v_case;$x$, $x$  update public.dd_cases set answers = answers || jsonb_build_object('process', case when v_small then 'small' else 'full' end) where id = v_case;
  perform set_config('app.dd_system', 'off', true);
  return v_case;$x$);
    if v_def not like '%v_small boolean%' or v_def not like '%if v_small then%' or v_def not like '%''process''%' then
      raise exception 'Could not update public.request_due_diligence (run 0064 first)';
    end if;
    execute v_def;
  end if;

  v_def := pg_get_functiondef('public.submit_dd_questionnaire(text, jsonb)'::regprocedure);
  if v_def like '%not app.dd_small(c.organisation_id)%' then
    execute replace(v_def, 'not app.dd_small(c.organisation_id)', 'not app.dd_case_small(c.id)');
  end if;

  v_def := pg_get_functiondef('public.decide_dd_case(uuid, public.dd_case_status, text)'::regprocedure);
  if v_def like '%not app.dd_small(v_c.organisation_id)%' then
    execute replace(v_def, 'not app.dd_small(v_c.organisation_id)', 'not app.dd_case_small(v_c.id)');
  end if;

  v_def := pg_get_functiondef('public.review_dd_screening_hit(uuid, text, text, text)'::regprocedure);
  if v_def like '%app.dd_small(s.organisation_id)%' then
    execute replace(v_def, 'app.dd_small(s.organisation_id)', 'case when s.case_id is null then app.dd_small(s.organisation_id) else app.dd_case_small(s.case_id) end');
  end if;
  v_def := pg_get_functiondef('public.review_dd_screening_rest(uuid, text)'::regprocedure);
  if v_def like '%app.dd_small(s.organisation_id)%' then
    execute replace(v_def, 'app.dd_small(s.organisation_id)', 'case when s.case_id is null then app.dd_small(s.organisation_id) else app.dd_case_small(s.case_id) end');
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

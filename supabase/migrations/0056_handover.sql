-- 0056: Hand over when someone leaves.
--
-- Before removing someone's access, an owner or administrator sees everything
-- that person is responsible for across VeraPhius, picks who takes it over,
-- and moves it in one step. Their past records (who decided, who signed,
-- who reported) never move: only current responsibilities do.
--
-- What moves to the new person:
--   policies they own, third parties they are the business owner of, disputes,
--   insurance policies, IP assets, compliance obligations, hazards, personal
--   information holdings, automated decisions, bribery risks, compliance
--   checks, standard form contracts, the gifts and conflicts responsible
--   person, risk report ownership, open tasks, positions they hold under
--   Authorities (ended today and started for the new person), risk actions
--   addressed to their email, and actions or key contracts recorded under
--   their name.
-- Confidential projects: where they are the lead, the new person becomes the
--   lead and is added to the list; where they are the legal contact, the new
--   person takes over. They are taken off every confidential list (access
--   ceased today).
-- Shown but not moved (each needs its own step): directorships and other
--   offices (record the cessation in Appointments, which flags the ASIC
--   notice), speak-up investigations (reassigned by the speak-up handlers),
--   their own open expense claims and incomplete training.

create or replace function app.can_hand_over(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, array['owner', 'admin']::public.member_role[]);
$$;

create or replace function public.handover_summary(p_org uuid, p_user uuid)
returns table (area text, moves boolean, item_count integer, items text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_person uuid[];
  v_name text;
  v_email text;
begin
  if not app.can_hand_over(p_org) then
    raise exception 'Only an owner or administrator can hand over someone''s responsibilities';
  end if;
  select array_agg(pe.id), max(nullif(btrim(pe.full_name), '')) into v_person, v_name from public.people pe where pe.organisation_id = p_org and pe.user_id = p_user;
  select u.email into v_email from auth.users u where u.id = p_user;
  v_person := coalesce(v_person, '{}');

  return query
  select x.area, x.moves, count(*)::int, (array_agg(x.label order by x.label))[1:12]
  from (
    select 'Policies' as area, true as moves, p.title as label from public.policies p where p.organisation_id = p_org and p.owner_user_id = p_user and not p.is_retired
    union all select 'Third parties (business owner)', true, c.name from public.counterparties c where c.organisation_id = p_org and c.business_owner_user_id = p_user
    union all select 'Disputes', true, d.title from public.disputes d where d.organisation_id = p_org and d.owner_user_id = p_user and d.status <> 'closed'
    union all select 'Insurance policies', true, i.policy_type || ' · ' || i.insurer from public.insurance_policies i where i.organisation_id = p_org and i.responsible_user_id = p_user and i.status = 'current'
    union all select 'IP assets', true, a.name from public.ip_assets a where a.organisation_id = p_org and a.responsible_user_id = p_user
    union all select 'Compliance calendar obligations', true, o.title from public.compliance_obligations o where o.organisation_id = p_org and o.owner_user_id = p_user and o.is_active
    union all select 'WHS hazards', true, h.title from public.whs_hazards h where h.organisation_id = p_org and h.owner_user_id = p_user and h.status = 'active'
    union all select 'Personal information holdings', true, h.name from public.personal_info_holdings h where h.organisation_id = p_org and h.owner_user_id = p_user and h.status = 'active'
    union all select 'Automated decisions', true, a.name from public.automated_decisions a where a.organisation_id = p_org and a.owner_user_id = p_user and a.status = 'active'
    union all select 'Bribery risks', true, left(r.description, 80) from public.abc_risks r where r.organisation_id = p_org and r.owner_user_id = p_user
    union all select 'Compliance checks', true, replace(c.item_key, '_', ' ') from public.compliance_checks c where c.organisation_id = p_org and c.owner_user_id = p_user
    union all select 'Standard form contracts', true, s.name from public.standard_form_contracts s where s.organisation_id = p_org and s.owner_user_id = p_user and s.status = 'current'
    union all select 'Gifts and hospitality: responsible person', true, 'Gifts register' from public.gift_settings g where g.organisation_id = p_org and g.responsible_user_id = p_user
    union all select 'Conflicts of interest: responsible person', true, 'Conflicts register' from public.conflict_settings g where g.organisation_id = p_org and g.responsible_user_id = p_user
    union all select 'Risk report owner or backup', true, case when r.is_backup then 'Backup owner' else 'Owner' end from public.risk_owners r where r.organisation_id = p_org and r.user_id = p_user
    union all select 'Open tasks', true, t.title from public.tasks t where t.organisation_id = p_org and t.assignee_person_id = any (v_person) and t.status not in ('done', 'cancelled')
    union all select 'Positions held (Authorities)', true, po.title from public.position_assignments pa join public.positions po on po.id = pa.position_id
              where pa.organisation_id = p_org and pa.person_id = any (v_person) and (pa.ends_on is null or pa.ends_on >= current_date)
    union all select 'Risk actions', true, ri.title from public.risk_items ri where ri.organisation_id = p_org and not ri.is_closed and v_email is not null and lower(ri.actioner_email) = lower(v_email)
    union all select 'Key contracts (named owner)', true, ct.title from public.contracts ct where ct.organisation_id = p_org and v_name is not null and lower(btrim(ct.key_owner)) = lower(v_name)
    union all select 'Legal audit actions', true, left(la.action, 80) from public.legal_audit_actions la where la.organisation_id = p_org and la.done_at is null and v_name is not null and lower(btrim(la.owner_name)) = lower(v_name)
    union all select 'Due diligence mitigations', true, left(m.action, 80) from public.dd_mitigations m where m.organisation_id = p_org and m.done_at is null and v_name is not null and lower(btrim(m.owner_name)) = lower(v_name)
    union all select 'Confidential projects: lead', true, 'Project ' || cp.code_name from public.conf_projects cp where cp.organisation_id = p_org and cp.lead_user_id = p_user and cp.status <> 'closed'
    union all select 'Confidential projects: legal contact', true, 'Project ' || cp.code_name from public.conf_projects cp where cp.organisation_id = p_org and cp.legal_user_id = p_user and cp.status <> 'closed'
    union all select 'Confidential lists (access will end today)', true, 'Project ' || cp.code_name from public.conf_members m join public.conf_projects cp on cp.id = m.project_id
              where m.organisation_id = p_org and m.user_id = p_user and m.removed_at is null
    -- Shown, not moved
    union all select 'Offices held: record the cessation in Appointments', false, en.name || ' · ' || oh.role::text from public.officeholdings oh join public.entities en on en.id = oh.entity_id
              where oh.organisation_id = p_org and oh.person_id = any (v_person) and oh.ceased_on is null
    union all select 'Speak-up investigations: ask a handler to reassign', false, 'Case' from public.speak_up_cases s where s.organisation_id = p_org and s.investigator_user_id = p_user and s.status <> 'closed'
    union all select 'Speak-up handler: remove them in Speak up', false, 'Handler' from public.speak_up_handlers h where h.organisation_id = p_org and h.user_id = p_user
    union all select 'Their own open expense claims', false, coalesce(e.purpose, 'Claim') from public.expense_claims e where e.organisation_id = p_org and e.claimant_user_id = p_user and e.status in ('draft', 'submitted')
  ) x
  group by x.area, x.moves
  order by x.moves desc, x.area;
end;
$$;

create or replace function public.hand_over(p_org uuid, p_from uuid, p_to uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_from_people uuid[];
  v_to_person uuid;
  v_from_name text;
  v_to_name text;
  v_from_email text;
  v_to_email text;
  v_n integer := 0;
  v_c integer;
  r record;
begin
  if not app.can_hand_over(p_org) then
    raise exception 'Only an owner or administrator can hand over someone''s responsibilities';
  end if;
  if p_from = p_to then
    raise exception 'Choose someone else to take over';
  end if;
  if not exists (select 1 from public.memberships m where m.organisation_id = p_org and m.user_id = p_to and m.is_active) then
    raise exception 'The person taking over must be an active member';
  end if;
  select array_agg(pe.id), max(nullif(btrim(pe.full_name), '')) into v_from_people, v_from_name from public.people pe where pe.organisation_id = p_org and pe.user_id = p_from;
  select pe.id, coalesce(nullif(btrim(pe.full_name), ''), u.email), u.email into v_to_person, v_to_name, v_to_email
    from auth.users u left join public.people pe on pe.user_id = u.id and pe.organisation_id = p_org where u.id = p_to order by pe.created_at limit 1;
  select u.email into v_from_email from auth.users u where u.id = p_from;
  v_from_people := coalesce(v_from_people, '{}');
  -- The member's own system switches (for example the WHS and finance guards) do not apply here: this is a straight reassignment

  update public.policies set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from and not is_retired; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.counterparties set business_owner_user_id = p_to where organisation_id = p_org and business_owner_user_id = p_from; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.disputes set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from and status <> 'closed'; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.insurance_policies set responsible_user_id = p_to where organisation_id = p_org and responsible_user_id = p_from and status = 'current'; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.ip_assets set responsible_user_id = p_to where organisation_id = p_org and responsible_user_id = p_from; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.compliance_obligations set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from and is_active; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.whs_hazards set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from and status = 'active'; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.personal_info_holdings set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from and status = 'active'; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.automated_decisions set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from and status = 'active'; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.abc_risks set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.compliance_checks set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.standard_form_contracts set owner_user_id = p_to where organisation_id = p_org and owner_user_id = p_from and status = 'current'; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.gift_settings set responsible_user_id = p_to where organisation_id = p_org and responsible_user_id = p_from; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.conflict_settings set responsible_user_id = p_to where organisation_id = p_org and responsible_user_id = p_from; get diagnostics v_c = row_count; v_n := v_n + v_c;
  -- Risk report ownership: the new person takes the same place (unless already there)
  if exists (select 1 from public.risk_owners where organisation_id = p_org and user_id = p_from) then
    if exists (select 1 from public.risk_owners where organisation_id = p_org and user_id = p_to) then
      -- Already an owner or backup: keep the stronger place
      v_c := (select count(*) from public.risk_owners x where x.organisation_id = p_org and x.user_id = p_from and not x.is_backup);
      delete from public.risk_owners where organisation_id = p_org and user_id = p_from;
      if v_c > 0 then
        update public.risk_owners set is_backup = false where organisation_id = p_org and user_id = p_to;
      end if;
    else
      update public.risk_owners set user_id = p_to where organisation_id = p_org and user_id = p_from;
    end if;
    v_n := v_n + 1;
  end if;
  if v_to_person is not null then
    update public.tasks set assignee_person_id = v_to_person where organisation_id = p_org and assignee_person_id = any (v_from_people) and status not in ('done', 'cancelled');
    get diagnostics v_c = row_count; v_n := v_n + v_c;
    -- Positions: end theirs today, start the same position for the new person
    for r in select pa.* from public.position_assignments pa where pa.organisation_id = p_org and pa.person_id = any (v_from_people) and (pa.ends_on is null or pa.ends_on >= current_date) loop
      update public.position_assignments set ends_on = greatest(r.starts_on, current_date - 1) where id = r.id;
      if not exists (select 1 from public.position_assignments x where x.position_id = r.position_id and x.person_id = v_to_person and (x.ends_on is null or x.ends_on >= current_date)) then
        insert into public.position_assignments (organisation_id, position_id, person_id, starts_on, is_acting) values (p_org, r.position_id, v_to_person, current_date, r.is_acting);
      end if;
      v_n := v_n + 1;
    end loop;
  end if;
  if v_from_email is not null then
    update public.risk_items set actioner = v_to_name, actioner_email = v_to_email where organisation_id = p_org and not is_closed and lower(actioner_email) = lower(v_from_email);
    get diagnostics v_c = row_count; v_n := v_n + v_c;
  end if;
  if v_from_name is not null then
    update public.contracts set key_owner = v_to_name where organisation_id = p_org and lower(btrim(key_owner)) = lower(v_from_name); get diagnostics v_c = row_count; v_n := v_n + v_c;
    update public.legal_audit_actions set owner_name = v_to_name where organisation_id = p_org and done_at is null and lower(btrim(owner_name)) = lower(v_from_name); get diagnostics v_c = row_count; v_n := v_n + v_c;
    update public.dd_mitigations set owner_name = v_to_name where organisation_id = p_org and done_at is null and lower(btrim(owner_name)) = lower(v_from_name); get diagnostics v_c = row_count; v_n := v_n + v_c;
  end if;
  -- Confidential projects
  for r in select cp.* from public.conf_projects cp where cp.organisation_id = p_org and cp.lead_user_id = p_from and cp.status <> 'closed' loop
    if not exists (select 1 from public.conf_members m where m.project_id = r.id and m.user_id = p_to and m.removed_at is null) then
      insert into public.conf_members (organisation_id, project_id, user_id, full_name, email, reason)
      values (p_org, r.id, p_to, coalesce(v_to_name, 'New lead'), v_to_email, 'Took over as project lead from ' || coalesce(v_from_name, v_from_email, 'the previous lead'));
    end if;
    update public.conf_projects set lead_user_id = p_to, legal_user_id = nullif(legal_user_id, p_to) where id = r.id;
    v_n := v_n + 1;
  end loop;
  update public.conf_projects set legal_user_id = p_to where organisation_id = p_org and legal_user_id = p_from and status <> 'closed' and lead_user_id <> p_to;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.conf_projects set legal_user_id = null where organisation_id = p_org and legal_user_id = p_from and status <> 'closed';
  update public.conf_members set removed_at = now() where organisation_id = p_org and user_id = p_from and removed_at is null;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  return v_n;
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
revoke execute on function public.handover_summary(uuid, uuid), public.hand_over(uuid, uuid, uuid) from public, anon;
grant execute on function public.handover_summary(uuid, uuid), public.hand_over(uuid, uuid, uuid) to authenticated;

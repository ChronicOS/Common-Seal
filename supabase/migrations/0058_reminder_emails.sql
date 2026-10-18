-- 0058: Reminder emails, only when something is needed.
--
-- Most reminders and escalations appear under For you, which only works if
-- people log in. This adds an email, sent at most once a day, and only when
-- something needs that person:
--   * something new has come up since their last email, or
--   * something is due within two days or is overdue.
-- Nothing needed means no email. Each person can choose "when needed"
-- (the default), "weekly" (at most once a week) or "off".
--
-- Emails say what needs doing and where, never the sensitive detail: a
-- confidential project appears only by its code name, a WHS incident or a
-- data breach only as "to assess", a speak-up report only as "a new report".
--
-- public.reminder_batch() works out who needs an email and what goes in it.
-- The send-reminders edge function (supabase/functions/send-reminders) calls
-- it on a schedule, sends each email, and records it with
-- public.reminder_sent(). Both are open only to the service role.

alter table public.memberships add column if not exists reminder_emails text not null default 'when_needed'
  check (reminder_emails in ('when_needed', 'weekly', 'off'));
alter table public.memberships add column if not exists reminders_last_sent_at timestamptz;
alter table public.memberships add column if not exists reminders_last_keys text[] not null default '{}';

-- Role check for a given person (has_role checks the signed-in person)
create or replace function app.user_has_role(p_org uuid, p_user uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.organisation_id = p_org and m.user_id = p_user and m.is_active
                 and (m.role = any (p_roles) or m.extra_roles && p_roles));
$$;

-- What needs this person, across VeraPhius (the server-side twin of For you, for the email)
create or replace function app.needs_attention(p_org uuid, p_user uuid)
returns table (key text, area text, what text, due date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_manage boolean := app.user_has_role(p_org, p_user, app.records_roles());
  v_director boolean := app.user_has_role(p_org, p_user, array['director']::public.member_role[]);
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = p_user;
  return query
  -- Compliance calendar: obligations they own (or with no owner, for the records roles)
  select 'ob:' || o.id || ':' || miss.d, 'Compliance calendar', o.title, miss.d
  from public.compliance_obligations o
  cross join lateral (
    select min(x) as d from app.obligation_dates(o.first_due_on, o.frequency, o.ends_on, current_date + 14) x
    where x >= current_date - 730 and not exists (select 1 from public.obligation_completions c where c.obligation_id = o.id and c.due_on = x)
  ) miss
  where o.organisation_id = p_org and o.is_active and miss.d is not null and (o.owner_user_id = p_user or (o.owner_user_id is null and v_manage))
  -- Training
  union all
  select 'tr:' || a.id, 'Training', 'Training to complete: ' || m.title, a.due_on
  from public.training_assignments a join public.training_modules m on m.id = a.module_id
  where a.organisation_id = p_org and a.user_id = p_user and a.completed_at is null and a.due_on <= current_date + 14
  -- Policies they own, due for review
  union all
  select 'po:' || p.id, 'Policies', 'Policy review due: ' || p.title, p.next_review_on
  from public.policies p where p.organisation_id = p_org and p.owner_user_id = p_user and not p.is_retired and p.next_review_on <= current_date + 30
  -- Confidential projects (code names only)
  union all
  select 'ca:' || cm.id, 'Confidential projects', 'Acknowledge the confidentiality notice for Project ' || cp.code_name, null::date
  from public.conf_members cm join public.conf_projects cp on cp.id = cm.project_id
  where cm.organisation_id = p_org and cm.user_id = p_user and cm.removed_at is null and cp.kickoff_issued_at is not null and cm.acknowledged_at is null and cp.status <> 'closed'
  union all
  select 'cc:' || cm.id, 'Confidential projects', 'Confirm you have deleted the material for Project ' || cp.code_name, null::date
  from public.conf_members cm join public.conf_projects cp on cp.id = cm.project_id
  where cm.organisation_id = p_org and cm.user_id = p_user and cp.closure_issued_at is not null and cp.closure_needs_deletion and cm.acknowledged_at is not null and cm.closure_confirmed_at is null
  union all
  select 'cl:' || cp.id, 'Confidential projects',
         case when cp.lead_user_id = p_user then '' else 'Escalated: ' end || 'Project ' || cp.code_name || ': the protocol needs attention',
         cp.expected_close_on
  from public.conf_projects cp
  where cp.organisation_id = p_org and cp.status <> 'paused'
    and (cp.lead_user_id = p_user or (cp.legal_user_id = p_user) or (cp.legal_user_id is null and v_director))
    and ((cp.status = 'open' and cp.expected_close_on < current_date + case when cp.lead_user_id = p_user then 7 else 0 end)
         or (cp.status <> 'closed' and cp.kickoff_issued_at is not null and exists (select 1 from public.conf_members m where m.project_id = cp.id and m.removed_at is null and m.acknowledged_at is null
              and (cp.lead_user_id = p_user or m.added_at < now() - interval '5 days')))
         or (cp.closure_issued_at is not null and cp.closure_needs_deletion and (cp.lead_user_id = p_user or cp.closure_issued_at < now() - interval '14 days')
             and exists (select 1 from public.conf_members m where m.project_id = cp.id and m.acknowledged_at is not null and m.closure_confirmed_at is null))
         or (cp.status = 'closed' and cp.lead_user_id = p_user and cp.conf_ends_on <= current_date and cp.ended_notice_at is null))
  -- WHS
  union all
  select 'wi:' || wi.id, 'Work health and safety',
         case when wi.notifiable then 'Notifiable incident: tell the regulator now' else 'WHS incident to assess' end, wi.occurred_at::date
  from public.whs_incidents wi
  where wi.organisation_id = p_org and v_manage and wi.status = 'open' and (wi.notifiable is null or (wi.notifiable and wi.regulator_notified_at is null))
  union all
  select 'wh:' || h.id, 'Work health and safety', 'Hazard review due: ' || h.title, h.review_on
  from public.whs_hazards h where h.organisation_id = p_org and h.status = 'active' and h.owner_user_id = p_user and h.review_on <= current_date + 14
  -- Privacy and cyber (no detail)
  union all
  select 'pb:' || pb.id, 'Privacy and cyber',
         case when pb.ransom_paid and pb.ransom_reported_at is null then 'Ransomware payment to report within 72 hours'
              when pb.eligible and pb.oaic_notified_at is null then 'Eligible data breach to notify'
              else 'Possible data breach to assess' end,
         case when pb.eligible is null then pb.assessment_due_on else null end
  from public.privacy_breaches pb
  where pb.organisation_id = p_org and app.user_has_role(p_org, p_user, app.privacy_managers()) and pb.status = 'open'
    and ((pb.ransom_paid and pb.ransom_reported_at is null) or (pb.eligible and pb.oaic_notified_at is null) or pb.eligible is null)
  -- Company register
  union all
  select 'af:' || f.id, 'Company register', case when f.status = 'to_check' then 'Check whether ASIC needs telling: ' else 'ASIC Form ' || f.form || ' to lodge: ' end || f.title, f.due_on
  from public.asic_filings f
  where f.organisation_id = p_org and v_manage and (f.status = 'to_check' or (f.status = 'to_lodge' and f.due_on <= current_date + 14))
  -- Checklists, contracts and risks they own
  union all
  select 'ck:' || c.id, 'Compliance checks', 'Review due: ' || replace(c.item_key, '_', ' '), c.review_on
  from public.compliance_checks c where c.organisation_id = p_org and c.owner_user_id = p_user and c.review_on <= current_date + 14
  union all
  select 'sf:' || s.id, 'Consumer law', 'Standard form contract review due: ' || s.name, s.next_review_on
  from public.standard_form_contracts s where s.organisation_id = p_org and s.owner_user_id = p_user and s.status = 'current' and s.next_review_on <= current_date + 14
  union all
  select 'ab:' || r.id, 'Anti-bribery', 'Bribery risk action due', r.action_due_on
  from public.abc_risks r where r.organisation_id = p_org and r.owner_user_id = p_user and r.action_due_on <= current_date + 14
  -- Insurance renewals they look after
  union all
  select 'in:' || i.id, 'Insurance', 'Insurance renewal: ' || i.policy_type, i.period_to
  from public.insurance_policies i where i.organisation_id = p_org and i.responsible_user_id = p_user and i.status = 'current' and i.period_to <= current_date + 30
  -- Gifts and conflicts waiting for the responsible person
  union all
  select 'gf:' || g.id, 'Gifts and hospitality', 'A gift or hospitality entry is waiting for a decision', null::date
  from public.gift_entries g
  where g.organisation_id = p_org and g.status = 'pending' and exists (select 1 from public.gift_settings s where s.organisation_id = p_org and s.responsible_user_id = p_user)
  union all
  select 'cf:' || d.id, 'Conflicts of interest', 'A conflict of interest is waiting for a decision', null::date
  from public.conflict_declarations d
  where d.organisation_id = p_org and d.status = 'open' and d.outcome is null and exists (select 1 from public.conflict_settings s where s.organisation_id = p_org and s.responsible_user_id = p_user)
  -- Speak up: handlers hear of a new report, and nothing more
  union all
  select 'su:' || sc.id, 'Speak up', 'A new speak-up report has been received', null::date
  from public.speak_up_cases sc
  where sc.organisation_id = p_org and sc.status = 'new' and exists (select 1 from public.speak_up_handlers h where h.organisation_id = p_org and h.user_id = p_user)
  -- Risk report owners: a review waiting to be finalised
  union all
  select 'rr:' || rv.id, 'Risk Register', 'Risk report to review and finalise: ' || rv.name, rv.forum_on
  from public.risk_reviews rv
  where rv.organisation_id = p_org and rv.status = 'collecting' and rv.escalate_on <= current_date
    and exists (select 1 from public.risk_owners ro where ro.organisation_id = p_org and ro.user_id = p_user)
  -- Risk actions addressed to them
  union all
  select 'ri:' || ri.id, 'Risk Register', 'Risk action due: ' || left(ri.title, 80), ri.due_on
  from public.risk_items ri
  where ri.organisation_id = p_org and not ri.is_closed and v_email is not null and lower(ri.actioner_email) = lower(v_email) and ri.due_on <= current_date + 7;
end;
$$;

-- Who needs an email now, and what goes in it
create or replace function public.reminder_batch()
returns table (organisation_id uuid, organisation_name text, user_id uuid, email text, full_name text, items jsonb, item_keys text[])
language sql stable security definer set search_path = '' as $$
  select m.organisation_id, o.name, m.user_id, u.email,
         coalesce((select nullif(btrim(pe.full_name), '') from public.people pe where pe.user_id = m.user_id and pe.organisation_id = m.organisation_id limit 1), u.email),
         (select jsonb_agg(jsonb_build_object('area', n.area, 'what', n.what, 'due', n.due) order by n.due nulls last, n.area)
            from app.needs_attention(m.organisation_id, m.user_id) n),
         (select array_agg(n.key) from app.needs_attention(m.organisation_id, m.user_id) n)
  from public.memberships m
  join public.organisations o on o.id = m.organisation_id
  join auth.users u on u.id = m.user_id
  where m.is_active and m.reminder_emails <> 'off' and u.email is not null
    -- At most one a day (one a week for "weekly")
    and (m.reminders_last_sent_at is null or m.reminders_last_sent_at < now() - case when m.reminder_emails = 'weekly' then interval '6 days 12 hours' else interval '20 hours' end)
    -- Only when something is needed: something new since the last email, or due within two days or overdue
    and exists (select 1 from app.needs_attention(m.organisation_id, m.user_id) n
                where not (n.key = any (m.reminders_last_keys)) or n.due <= current_date + 2);
$$;

create or replace function public.reminder_sent(p_org uuid, p_user uuid, p_keys text[])
returns void language sql security definer set search_path = '' as $$
  update public.memberships set reminders_last_sent_at = now(), reminders_last_keys = coalesce(p_keys, '{}')
  where organisation_id = p_org and user_id = p_user;
$$;

-- Each person chooses for themselves
create or replace function public.set_reminder_emails(p_org uuid, p_choice text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_choice not in ('when_needed', 'weekly', 'off') then
    raise exception 'Choose when needed, weekly or off';
  end if;
  update public.memberships set reminder_emails = p_choice where organisation_id = p_org and user_id = auth.uid() and is_active;
  if not found then
    raise exception 'Not allowed';
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
revoke execute on function public.reminder_batch(), public.reminder_sent(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.reminder_batch(), public.reminder_sent(uuid, uuid, text[]) to service_role;
revoke execute on function public.set_reminder_emails(uuid, text) from public, anon;
grant execute on function public.set_reminder_emails(uuid, text) to authenticated;

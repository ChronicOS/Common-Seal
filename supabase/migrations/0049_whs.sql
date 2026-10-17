-- 0049: Work health and safety.
--
-- Incidents: anyone in the organisation can report one. Each is assessed for
-- whether it is notifiable to the WHS regulator (a death, a serious injury or
-- illness, or a dangerous incident), which must be notified immediately. An
-- incident cannot be closed until it has been assessed, the regulator has been
-- notified if it was notifiable, and the investigation is complete. Records
-- of notifiable incidents must be kept for at least five years.
--
-- Injury details are health information. Full incident records are visible
-- only to owners, administrators, the secretary, legal and compliance, and to
-- the person who reported them. Directors see a summary without names (for
-- their due diligence as officers) through whs_summary().
--
-- Hazards: a hazard register, including psychosocial hazards (job demands,
-- bullying, harassment, violence, poor support and others), each scored for
-- likelihood and consequence, with controls by the hierarchy of control, an
-- owner and a review date.
--
-- Officer due diligence: a periodic review against the six elements of
-- section 27(5) of the WHS Act, with evidence for each, signed off and
-- linkable to a board resolution.
--
-- Ladder up: notifiable incidents not yet notified, incidents not assessed
-- within 2 days, high hazards (score 15 or more) and overdue corrective
-- actions feed the Risk Register.

create or replace function app.whs_managers()
returns public.member_role[] language sql immutable as $$ select array['owner','admin','secretary','legal','compliance']::public.member_role[] $$;

create table public.whs_incidents (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete cascade,
  entity_id              uuid references public.entities (id) on delete set null,
  occurred_at            timestamptz not null,
  location               text,
  state                  text check (state is null or state in ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT', 'Commonwealth', 'Overseas')),
  kind                   text not null check (kind in ('injury', 'illness', 'near_miss', 'dangerous_incident', 'psychosocial', 'property', 'other')),
  description            text not null check (char_length(btrim(description)) >= 10),
  persons_involved       text,          -- names and roles; health information, restricted
  severity               text check (severity is null or severity in ('none', 'first_aid', 'medical_treatment', 'lost_time', 'serious', 'fatality')),
  immediate_action       text,
  -- Notifiable to the regulator?
  notifiable             boolean,       -- null: not yet assessed
  notifiable_reason      text check (notifiable_reason is null or notifiable_reason in ('death', 'serious_injury_illness', 'dangerous_incident')),
  notifiable_basis       text,          -- what made it notifiable or not
  assessed_by            uuid references auth.users (id) on delete set null,
  assessed_at            timestamptz,
  regulator              text,
  regulator_notified_at  timestamptz,
  regulator_reference    text,
  written_notice_at      timestamptz,   -- if the regulator asked for written notice (within 48 hours)
  site_preserved         boolean,
  -- Investigation
  investigation_status   text not null default 'not_started' check (investigation_status in ('not_started', 'in_progress', 'complete')),
  root_cause             text,
  corrective_actions     text,
  actions_due_on         date,
  actions_done_on        date,
  status                 text not null default 'open' check (status in ('open', 'closed')),
  closed_at              timestamptz,
  reported_by            uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (notifiable is not true or notifiable_reason is not null)
);
create index whs_incidents_org_idx on public.whs_incidents (organisation_id, status);

create table public.whs_hazards (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_id        uuid references public.entities (id) on delete set null,
  title            text not null check (char_length(btrim(title)) between 3 and 200),
  kind             text not null default 'physical' check (kind in ('physical', 'psychosocial', 'chemical', 'plant', 'ergonomic', 'biological', 'other')),
  psychosocial_type text check (psychosocial_type is null or psychosocial_type in ('job_demands', 'low_control', 'poor_support', 'role_clarity', 'change_management',
                                                     'recognition', 'justice', 'environment', 'remote_isolated', 'conflict', 'bullying', 'harassment',
                                                     'sexual_harassment', 'violence_aggression', 'traumatic_events', 'other')),
  where_who        text,          -- where it arises and who is exposed
  likelihood       integer not null check (likelihood between 1 and 5),
  consequence      integer not null check (consequence between 1 and 5),
  controls         text,
  control_level    text check (control_level is null or control_level in ('eliminate', 'substitute', 'isolate', 'engineering', 'administrative', 'ppe')),
  residual_likelihood integer check (residual_likelihood is null or residual_likelihood between 1 and 5),
  residual_consequence integer check (residual_consequence is null or residual_consequence between 1 and 5),
  owner_user_id    uuid references auth.users (id) on delete set null,
  review_on        date,
  status           text not null default 'active' check (status in ('active', 'closed')),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (kind <> 'psychosocial' or psychosocial_type is not null)
);

create table public.whs_due_diligence (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  period_end       date not null,
  answers          jsonb not null default '{}'::jsonb,     -- {element: {status: 'met'|'partly'|'not_met', evidence: text}}
  summary          jsonb,          -- the incident and hazard summary at sign-off
  signed_off_by    uuid references auth.users (id) on delete set null,
  signed_off_at    timestamptz,
  resolution_id    uuid references public.resolutions (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, period_end)
);

create or replace function app.guard_whs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if tg_table_name = 'whs_incidents' then
    if new.occurred_at > now() + interval '1 hour' then
      raise exception 'An incident cannot be in the future';
    end if;
    if tg_op = 'INSERT' then
      new.reported_by := coalesce(auth.uid(), new.reported_by);
    end if;
    -- The reporter can describe; only the managers assess, notify, investigate and close
    if tg_op = 'UPDATE' and not app.has_role(new.organisation_id, app.whs_managers())
       and (new.notifiable, new.notifiable_reason, new.regulator_notified_at, new.investigation_status, new.status)
           is distinct from (old.notifiable, old.notifiable_reason, old.regulator_notified_at, old.investigation_status, old.status) then
      raise exception 'Only the people who manage WHS can assess, notify or close an incident';
    end if;
    if new.notifiable is distinct from old.notifiable and new.notifiable is not null then
      new.assessed_by := auth.uid();
      new.assessed_at := now();
    end if;
    if new.regulator_notified_at is not null and new.regulator_notified_at > now() + interval '1 hour' then
      raise exception 'The notification time cannot be in the future';
    end if;
    if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
      if new.notifiable is null then
        raise exception 'Assess whether it was notifiable before closing it';
      end if;
      if new.notifiable and new.regulator_notified_at is null then
        raise exception 'It was notifiable: record when the regulator was notified before closing it';
      end if;
      if new.investigation_status <> 'complete' then
        raise exception 'Complete the investigation before closing it';
      end if;
      if new.corrective_actions is not null and new.actions_done_on is null then
        raise exception 'Record when the corrective actions were done before closing it';
      end if;
      new.closed_at := now();
    elsif new.status = 'open' then
      new.closed_at := null;
    end if;
  elsif tg_table_name = 'whs_hazards' then
    if new.owner_user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.owner_user_id and m.is_active) then
      raise exception 'The owner must be an active member of this organisation';
    end if;
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  elsif tg_table_name = 'whs_due_diligence' then
    if new.resolution_id is not null and not exists (select 1 from public.resolutions r where r.id = new.resolution_id and r.organisation_id = new.organisation_id) then
      raise exception 'That resolution is not in this organisation';
    end if;
    if tg_op = 'UPDATE' and old.signed_off_at is not null and current_setting('app.whs_system', true) is distinct from 'on'
       and (new.answers, new.period_end) is distinct from (old.answers, old.period_end) then
      raise exception 'A signed-off review cannot be changed';
    end if;
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  end if;
  return new;
end;
$$;
-- Entity check uses new.entity_id; the due diligence table has none
create or replace function app.guard_whs_dd()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.resolution_id is not null and not exists (select 1 from public.resolutions r where r.id = new.resolution_id and r.organisation_id = new.organisation_id) then
    raise exception 'That resolution is not in this organisation';
  end if;
  if tg_op = 'UPDATE' and old.signed_off_at is not null and current_setting('app.whs_system', true) is distinct from 'on'
     and (new.answers, new.period_end, new.signed_off_at) is distinct from (old.answers, old.period_end, old.signed_off_at) then
    raise exception 'A signed-off review cannot be changed';
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  if new.signed_off_at is not null and (tg_op = 'INSERT' or old.signed_off_at is null) and current_setting('app.whs_system', true) is distinct from 'on' then
    raise exception 'Sign off through Sign off, which records the summary at that date';
  end if;
  return new;
end;
$$;
create trigger whs_incidents_guard before insert or update on public.whs_incidents for each row execute function app.guard_whs();
create trigger whs_hazards_guard before insert or update on public.whs_hazards for each row execute function app.guard_whs();
create trigger whs_due_diligence_guard before insert or update on public.whs_due_diligence for each row execute function app.guard_whs_dd();

-- A summary without names: what officers need to see
create or replace function public.whs_summary(p_org uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not (app.has_role(p_org, app.board_read_roles()) or app.has_role(p_org, array['auditor']::public.member_role[])) then
    raise exception 'You do not have permission to see this';
  end if;
  select jsonb_build_object(
    'incidents', (select count(*) from public.whs_incidents i where i.organisation_id = p_org and i.occurred_at::date between p_from and p_to),
    'by_kind', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select i.kind k, count(*) n from public.whs_incidents i where i.organisation_id = p_org and i.occurred_at::date between p_from and p_to group by i.kind) x),
    'by_severity', (select coalesce(jsonb_object_agg(coalesce(s, 'not_assessed'), n), '{}'::jsonb) from (select i.severity s, count(*) n from public.whs_incidents i where i.organisation_id = p_org and i.occurred_at::date between p_from and p_to group by i.severity) x),
    'lost_time', (select count(*) from public.whs_incidents i where i.organisation_id = p_org and i.occurred_at::date between p_from and p_to and i.severity in ('lost_time', 'serious', 'fatality')),
    'notifiable', (select coalesce(jsonb_agg(jsonb_build_object('occurred_on', i.occurred_at::date, 'kind', i.kind, 'reason', i.notifiable_reason, 'notified_at', i.regulator_notified_at, 'regulator', i.regulator, 'status', i.status, 'investigation', i.investigation_status) order by i.occurred_at), '[]'::jsonb)
                   from public.whs_incidents i where i.organisation_id = p_org and i.notifiable and i.occurred_at::date between p_from and p_to),
    'not_assessed', (select count(*) from public.whs_incidents i where i.organisation_id = p_org and i.notifiable is null and i.status = 'open'),
    'open_incidents', (select count(*) from public.whs_incidents i where i.organisation_id = p_org and i.status = 'open'),
    'actions_overdue', (select count(*) from public.whs_incidents i where i.organisation_id = p_org and i.actions_due_on < current_date and i.actions_done_on is null),
    'hazards', (select count(*) from public.whs_hazards h where h.organisation_id = p_org and h.status = 'active'),
    'hazards_high', (select count(*) from public.whs_hazards h where h.organisation_id = p_org and h.status = 'active' and coalesce(h.residual_likelihood, h.likelihood) * coalesce(h.residual_consequence, h.consequence) >= 15),
    'psychosocial', (select count(*) from public.whs_hazards h where h.organisation_id = p_org and h.status = 'active' and h.kind = 'psychosocial'),
    'hazards_review_overdue', (select count(*) from public.whs_hazards h where h.organisation_id = p_org and h.status = 'active' and h.review_on < current_date)
  ) into v;
  return v;
end;
$$;

create or replace function public.sign_off_whs_review(p_review uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.whs_due_diligence%rowtype;
  k text;
begin
  select * into r from public.whs_due_diligence x where x.id = p_review for update;
  if r.id is null or not app.has_role(r.organisation_id, app.board_write_roles() || array['director']::public.member_role[]) then
    raise exception 'Only a director, owner, administrator or the secretary can sign off';
  end if;
  if r.signed_off_at is not null then
    raise exception 'Already signed off';
  end if;
  foreach k in array array['knowledge', 'operations', 'resources', 'information', 'compliance', 'verification'] loop
    if coalesce(r.answers -> k ->> 'status', '') = '' then
      raise exception 'Answer every element before signing off';
    end if;
  end loop;
  perform set_config('app.whs_system', 'on', true);
  update public.whs_due_diligence set signed_off_by = auth.uid(), signed_off_at = now(),
         summary = public.whs_summary(r.organisation_id, (r.period_end - interval '3 months')::date + 1, r.period_end)
   where id = p_review;
  perform set_config('app.whs_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Ladder up
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements',
                          'credit_facilities', 'asic_filings', 'entities', 'compliance_obligations', 'whs_incidents', 'whs_hazards'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%whs_incidents%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- WHS: no names, only what the register needs
    select 'whs_incidents', wi.id, 'Work health and safety', app.risk_feed_category(p_review, array['work health and safety', 'health and safety', 'whs', 'safety', 'people']),
           case when wi.notifiable and wi.regulator_notified_at is null then 'Notifiable WHS incident not yet notified to the regulator'
                when wi.notifiable is null then 'WHS incident not assessed for notification'
                else 'WHS corrective actions overdue' end
           || ' (' || replace(wi.kind, '_', ' ') || ', ' || to_char(wi.occurred_at, 'FMDD Mon YYYY') || ')',
           case when wi.notifiable and wi.regulator_notified_at is null then 'Notify the regulator now and record it'
                when wi.notifiable is null then 'Decide whether it is notifiable'
                else 'Complete the corrective actions' end,
           null::text,
           coalesce(case when wi.notifiable is null then (wi.created_at + interval '2 days')::date end, wi.actions_due_on, wi.occurred_at::date)
    from public.whs_incidents wi
    where wi.organisation_id = v_org and wi.status = 'open'
      and ((wi.notifiable and wi.regulator_notified_at is null)
           or (wi.notifiable is null and wi.created_at < now() - interval '2 days')
           or (wi.actions_due_on < current_date and wi.actions_done_on is null))
    union all
    select 'whs_hazards', wh.id, 'Work health and safety', app.risk_feed_category(p_review, array['work health and safety', 'health and safety', 'whs', 'safety', 'people']),
           'High WHS hazard: ' || wh.title || case when wh.kind = 'psychosocial' then ' (psychosocial)' else '' end
           || E'\n' || 'Score ' || (coalesce(wh.residual_likelihood, wh.likelihood) * coalesce(wh.residual_consequence, wh.consequence)) || ' of 25'
           || coalesce(' · controls: ' || left(wh.controls, 200), ' · no controls recorded'),
           'Strengthen the controls (eliminate or isolate where possible)',
           (select coalesce(nullif(btrim(p.full_name), ''), u.email)::text from auth.users u left join public.people p on p.user_id = u.id and p.organisation_id = v_org where u.id = wh.owner_user_id limit 1),
           wh.review_on
    from public.whs_hazards wh
    where wh.organisation_id = v_org and wh.status = 'active'
      and coalesce(wh.residual_likelihood, wh.likelihood) * coalesce(wh.residual_consequence, wh.consequence) >= 15
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%whs_incidents%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: photos, statements, investigation reports, regulator correspondence
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%whs_incidents%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''whs_incidents'', ''whs_hazards'', ''whs_due_diligence''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%whs_incidents%' then
    v_def := replace(v_def, $x$  elsif p_table = 'obligation_completions' then$x$, $x$  elsif p_table = 'whs_incidents' then
    select i.organisation_id, (app.has_role(i.organisation_id, app.whs_managers()) or i.reported_by = auth.uid()) into v_org, v_ok
    from public.whs_incidents i where i.id = p_id;
  elsif p_table in ('whs_hazards', 'whs_due_diligence') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    v_ok := v_org is not null and app.has_role(v_org, app.records_roles());
  elsif p_table = 'obligation_completions' then$x$);
    if v_def not like '%whs_incidents%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%whs_incidents%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files on sensitive records follow the record's own visibility.
--
-- Fix: files attached to ownership, finance, company register, compliance
-- calendar and WHS records were stored unrestricted, so any member could list
-- and open them even though they cannot see the record. From now on they are
-- restricted, and a restricted file can be read by the records roles, the
-- uploader, or anyone who can see a record it is attached to. Files already
-- attached are re-marked as restricted below.
-- ---------------------------------------------------------------------
create or replace function app.sensitive_subject(p_table text)
returns boolean language sql immutable as $$
  select p_table in ('expense_claims', 'dd_cases', 'share_movements', 'share_classes', 'esop_plans', 'esop_grants', 'convertibles', 'investor_consents',
                     'bank_accounts', 'credit_facilities', 'corporate_documents', 'asic_filings', 'annual_reviews', 'obligation_completions',
                     'whs_incidents', 'whs_hazards', 'whs_due_diligence');
$$;

-- Can the signed-in person see the record a file is attached to?
create or replace function app.can_read_subject(p_table text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if p_table in ('share_movements', 'share_classes', 'esop_plans', 'esop_grants', 'convertibles', 'investor_consents') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    return v_org is not null and app.can_read_ownership(v_org);
  elsif p_table in ('bank_accounts', 'credit_facilities') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    return v_org is not null and app.can_read_finance(v_org);
  elsif p_table in ('corporate_documents', 'asic_filings', 'annual_reviews') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    return v_org is not null and app.can_read_register(v_org);
  elsif p_table = 'obligation_completions' then
    return exists (select 1 from public.obligation_completions c where c.id = p_id
                   and (app.has_role(c.organisation_id, app.board_read_roles()) or app.has_role(c.organisation_id, array['auditor']::public.member_role[]) or app.is_obligation_owner(c.obligation_id)));
  elsif p_table = 'whs_incidents' then
    return exists (select 1 from public.whs_incidents i where i.id = p_id
                   and (app.has_role(i.organisation_id, app.whs_managers()) or (i.reported_by = auth.uid() and app.is_member(i.organisation_id))));
  elsif p_table in ('whs_hazards') then
    return exists (select 1 from public.whs_hazards h where h.id = p_id and app.is_member(h.organisation_id));
  elsif p_table = 'whs_due_diligence' then
    return exists (select 1 from public.whs_due_diligence w where w.id = p_id
                   and (app.has_role(w.organisation_id, app.board_read_roles()) or app.has_role(w.organisation_id, array['auditor']::public.member_role[])));
  end if;
  return false;
end;
$$;

create or replace function app.can_read_document(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document
      and app.is_member(d.organisation_id)
      and (
        not d.is_restricted
        or app.has_role(d.organisation_id, app.records_roles())
        or exists (select 1 from public.document_grants g where g.document_id = d.id and g.user_id = auth.uid())
        or exists (select 1 from public.document_links l where l.document_id = d.id and app.sensitive_subject(l.subject_table) and app.can_read_subject(l.subject_table, l.subject_id))
      )
  );
$$;

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.attach_document(text, uuid, text, text, bigint, text)'::regprocedure);
  if v_def not like '%app.sensitive_subject%' then
    v_def := replace(v_def, $x$v_restricted boolean := p_table in ('expense_claims', 'dd_cases');$x$, $x$v_restricted boolean := app.sensitive_subject(p_table);$x$);
    if v_def not like '%app.sensitive_subject%' then
      raise exception 'Could not update public.attach_document';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Files already attached to sensitive records
update public.documents d set is_restricted = true
 where not d.is_restricted
   and exists (select 1 from public.document_links l where l.document_id = d.id and app.sensitive_subject(l.subject_table));


-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.whs_incidents, public.whs_hazards, public.whs_due_diligence from anon, authenticated;
grant select on public.whs_incidents, public.whs_hazards, public.whs_due_diligence to authenticated;
grant insert (organisation_id, entity_id, occurred_at, location, state, kind, description, persons_involved, severity, immediate_action),
      update (entity_id, occurred_at, location, state, kind, description, persons_involved, severity, immediate_action, notifiable, notifiable_reason,
              notifiable_basis, regulator, regulator_notified_at, regulator_reference, written_notice_at, site_preserved, investigation_status, root_cause,
              corrective_actions, actions_due_on, actions_done_on, status)
  on public.whs_incidents to authenticated;
grant insert (organisation_id, entity_id, title, kind, psychosocial_type, where_who, likelihood, consequence, controls, control_level, residual_likelihood,
              residual_consequence, owner_user_id, review_on, status),
      update (entity_id, title, kind, psychosocial_type, where_who, likelihood, consequence, controls, control_level, residual_likelihood,
              residual_consequence, owner_user_id, review_on, status)
  on public.whs_hazards to authenticated;
grant insert (organisation_id, period_end, answers, resolution_id), update (period_end, answers, resolution_id) on public.whs_due_diligence to authenticated;
grant all on public.whs_incidents, public.whs_hazards, public.whs_due_diligence to service_role;

alter table public.whs_incidents enable row level security;
alter table public.whs_hazards enable row level security;
alter table public.whs_due_diligence enable row level security;
create policy whs_incidents_select on public.whs_incidents for select to authenticated
  using (app.has_role(organisation_id, app.whs_managers()) or (reported_by = auth.uid() and app.is_member(organisation_id)));
create policy whs_incidents_insert on public.whs_incidents for insert to authenticated with check (app.is_member(organisation_id));
create policy whs_incidents_update on public.whs_incidents for update to authenticated
  using (app.has_role(organisation_id, app.whs_managers()) or (reported_by = auth.uid() and status = 'open' and app.is_member(organisation_id)))
  with check (app.has_role(organisation_id, app.whs_managers()) or (reported_by = auth.uid() and app.is_member(organisation_id)));
-- Hazards are not personal: everyone in the organisation can see them, so they know the risks
create policy whs_hazards_select on public.whs_hazards for select to authenticated using (app.is_member(organisation_id));
create policy whs_hazards_insert on public.whs_hazards for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy whs_hazards_update on public.whs_hazards for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid());
create policy whs_due_diligence_select on public.whs_due_diligence for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]));
create policy whs_due_diligence_insert on public.whs_due_diligence for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()) or app.has_role(organisation_id, array['director']::public.member_role[]));
create policy whs_due_diligence_update on public.whs_due_diligence for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.has_role(organisation_id, array['director']::public.member_role[]))
  with check (app.has_role(organisation_id, app.records_roles()) or app.has_role(organisation_id, array['director']::public.member_role[]));

do $$
declare
  t text;
begin
  foreach t in array array['whs_incidents', 'whs_hazards', 'whs_due_diligence'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
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
grant execute on function app.can_read_document(uuid) to authenticated;
revoke execute on function public.whs_summary(uuid, date, date), public.sign_off_whs_review(uuid) from public, anon;
grant execute on function public.whs_summary(uuid, date, date), public.sign_off_whs_review(uuid) to authenticated;

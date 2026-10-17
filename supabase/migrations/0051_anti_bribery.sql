-- 0051: Anti-bribery programme.
--
-- Since 8 September 2024 a company commits an offence if an associate bribes
-- a foreign public official for its benefit, unless it had adequate
-- procedures to prevent it (Criminal Code s 70.5A). The Attorney-General's
-- guidance sets out six principles: a proportionate control environment,
-- responsibilities of top-level management, risk assessment, communication
-- and training, reporting, and monitoring and review.
--
-- Bribery risk assessment: risks by area (third parties, government
-- dealings, gifts and hospitality, donations, high-risk countries and so on)
-- with likelihood, impact, controls and owners, approved by the board.
--
-- Adequate procedures map: each element of the six principles, with its
-- status, notes and evidence. Evidence the platform already holds is
-- gathered automatically (the anti-bribery policy, training completion,
-- gifts and hospitality, conflicts, due diligence on third parties,
-- sanctions re-screens, speak-up reports) by public.abc_evidence, which
-- returns counts only.
--
-- Ladder up: high residual risks, gaps in the map, and a risk assessment
-- overdue for review feed the Risk Register.

create table public.abc_assessments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 3 and 200),
  assessed_on      date not null default current_date,
  scope            text,
  next_review_on   date,
  status           text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by      uuid references auth.users (id) on delete set null,
  approved_at      timestamptz,
  approval_note    text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.abc_risks (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  assessment_id      uuid not null references public.abc_assessments (id) on delete cascade,
  area               text not null check (area in ('third_parties', 'government', 'gifts_hospitality', 'donations_sponsorships', 'facilitation',
                                                   'countries', 'sector', 'transactions', 'joint_ventures', 'acquisitions', 'hiring', 'procurement', 'other')),
  description        text not null check (char_length(btrim(description)) >= 5),
  countries          text,
  likelihood         integer not null check (likelihood between 1 and 5),
  impact             integer not null check (impact between 1 and 5),
  controls           text,
  residual_likelihood integer check (residual_likelihood is null or residual_likelihood between 1 and 5),
  residual_impact    integer check (residual_impact is null or residual_impact between 1 and 5),
  actions            text,
  action_due_on      date,
  owner_user_id      uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index abc_risks_assessment_idx on public.abc_risks (assessment_id);

create table public.abc_programme (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  element_key      text not null check (element_key ~ '^[a-z_]{3,40}$'),
  status           text check (status is null or status in ('in_place', 'partly', 'gap', 'not_applicable')),
  notes            text,
  evidence         text,
  owner_user_id    uuid references auth.users (id) on delete set null,
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, element_key),
  check (status is distinct from 'not_applicable' or char_length(btrim(coalesce(notes, ''))) >= 5)
);

create or replace function app.guard_abc()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if tg_table_name = 'abc_assessments' then
    -- Approval only through public.approve_abc_assessment; an approved assessment is a record
    if current_setting('app.abc_system', true) is distinct from 'on' then
      if tg_op = 'INSERT' and (new.status <> 'draft' or new.approved_at is not null) then
        raise exception 'An assessment is approved with the approve button';
      end if;
      if tg_op = 'UPDATE' and (old.status = 'approved' or new.status is distinct from old.status or new.approved_at is distinct from old.approved_at) then
        raise exception 'An approved assessment cannot be changed; start a new one';
      end if;
    end if;
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  elsif tg_table_name = 'abc_risks' then
    select a.status into v_status from public.abc_assessments a where a.id = new.assessment_id and a.organisation_id = new.organisation_id;
    if v_status is null then
      raise exception 'That assessment is not in this organisation';
    end if;
    if v_status = 'approved' then
      -- Once approved, only the agreed actions can be updated (owner, actions and due date)
      if tg_op = 'INSERT' or (new.area, new.description, new.countries, new.likelihood, new.impact, new.controls, new.residual_likelihood, new.residual_impact)
                             is distinct from (old.area, old.description, old.countries, old.likelihood, old.impact, old.controls, old.residual_likelihood, old.residual_impact) then
        raise exception 'The assessment has been approved: start a new one to change its risks';
      end if;
    end if;
    if new.owner_user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.owner_user_id and m.is_active) then
      raise exception 'The owner must be an active member of this organisation';
    end if;
  else
    if new.owner_user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.owner_user_id and m.is_active) then
      raise exception 'The owner must be an active member of this organisation';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
create trigger abc_assessments_guard before insert or update on public.abc_assessments for each row execute function app.guard_abc();
create trigger abc_risks_guard before insert or update on public.abc_risks for each row execute function app.guard_abc();
create trigger abc_programme_guard before insert or update on public.abc_programme for each row execute function app.guard_abc();

create or replace function app.can_read_abc(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, app.board_read_roles()) or app.has_role(p_org, array['auditor']::public.member_role[]);
$$;

-- The board approves the risk assessment
create or replace function public.approve_abc_assessment(p_assessment uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.abc_assessments%rowtype;
begin
  select * into a from public.abc_assessments x where x.id = p_assessment for update;
  if a.id is null or not app.has_role(a.organisation_id, app.board_write_roles() || array['director']::public.member_role[]) then
    raise exception 'Only a director, owner, administrator or the secretary can approve it';
  end if;
  if a.status = 'approved' then
    raise exception 'Already approved';
  end if;
  if not exists (select 1 from public.abc_risks r where r.assessment_id = a.id) then
    raise exception 'Add the risks before approving it';
  end if;
  if exists (select 1 from public.abc_risks r where r.assessment_id = a.id and (r.controls is null or btrim(r.controls) = '')) then
    raise exception 'Record the controls for every risk before approving it';
  end if;
  perform set_config('app.abc_system', 'on', true);
  update public.abc_assessments set status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_note = nullif(btrim(p_note), ''),
         next_review_on = coalesce(next_review_on, (current_date + interval '12 months')::date)
   where id = a.id;
  perform set_config('app.abc_system', 'off', true);
end;
$$;

-- Evidence the platform already holds, as counts only
create or replace function public.abc_evidence(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_year date := current_date - 365;
  v jsonb;
begin
  if not app.can_read_abc(p_org) then
    raise exception 'Not allowed';
  end if;
  with abc_policy as (
    select p.id, p.next_review_on,
           exists (select 1 from public.policy_versions v where v.policy_id = p.id and v.status = 'approved') as approved
    from public.policies p
    where p.organisation_id = p_org and not p.is_retired and (p.category = 'Anti-bribery and corruption' or p.title ilike '%brib%' or p.title ilike '%corrupt%')
  ), abc_modules as (
    select m.id from public.training_modules m
    where m.organisation_id = p_org and m.status = 'published'
      and (m.policy_id in (select id from abc_policy) or m.title ilike '%brib%' or m.title ilike '%corrupt%')
  )
  select jsonb_build_object(
    'policy', jsonb_build_object(
      'abc', (select count(*) from abc_policy where approved),
      'abc_overdue', (select count(*) from abc_policy where approved and next_review_on < current_date),
      'gifts', (select count(*) from public.policies p where p.organisation_id = p_org and not p.is_retired and (p.title ilike '%gift%' or p.title ilike '%hospitality%')),
      'speak_up', (select count(*) from public.policies p where p.organisation_id = p_org and not p.is_retired and (p.title ilike '%whistle%' or p.title ilike '%speak%')),
      'conflicts', (select count(*) from public.policies p where p.organisation_id = p_org and not p.is_retired and p.title ilike '%conflict%')),
    'training', jsonb_build_object(
      'modules', (select count(*) from abc_modules),
      'assigned', (select count(*) from public.training_assignments t where t.module_id in (select id from abc_modules)),
      'current', (select count(*) from public.training_assignments t where t.module_id in (select id from abc_modules) and t.completed_at is not null and (t.expires_on is null or t.expires_on >= current_date)),
      'overdue', (select count(*) from public.training_assignments t where t.module_id in (select id from abc_modules) and t.completed_at is null and t.due_on < current_date)),
    'gifts', jsonb_build_object(
      'entries', (select count(*) from public.gift_entries g where g.organisation_id = p_org and g.occurred_on >= v_year),
      'public_official', (select count(*) from public.gift_entries g where g.organisation_id = p_org and g.occurred_on >= v_year and g.public_official),
      'pending', (select count(*) from public.gift_entries g where g.organisation_id = p_org and g.status = 'pending'),
      'declined', (select count(*) from public.gift_entries g where g.organisation_id = p_org and g.occurred_on >= v_year and g.status = 'declined')),
    'conflicts', jsonb_build_object(
      'declared', (select count(*) from public.conflict_declarations c where c.organisation_id = p_org and c.declared_on >= v_year),
      'open', (select count(*) from public.conflict_declarations c where c.organisation_id = p_org and c.status = 'open')),
    'due_diligence', jsonb_build_object(
      'third_parties', (select count(*) from public.counterparties c where c.organisation_id = p_org and c.party_type in ('sales_agent', 'process_agent', 'distributor', 'joint_venture', 'sub_contractor', 'service_provider')),
      'agents', (select count(*) from public.counterparties c where c.organisation_id = p_org and c.party_type in ('sales_agent', 'process_agent')),
      'agents_cleared', (select count(*) from public.counterparties c where c.organisation_id = p_org and c.party_type in ('sales_agent', 'process_agent') and c.dd_status in ('cleared', 'cleared_with_conditions')),
      'review_overdue', (select count(*) from public.counterparties c where c.organisation_id = p_org and c.next_review_on < current_date),
      'open_cases', (select count(*) from public.dd_cases d where d.organisation_id = p_org and d.status = 'open'),
      'high_risk', (select count(*) from public.counterparties c where c.organisation_id = p_org and c.risk_rating = 'high')),
    'sanctions', jsonb_build_object(
      'rescreen_overdue', (select count(*) from public.sanctions_assessments s where s.organisation_id = p_org and s.next_screen_on < current_date
                            and not exists (select 1 from public.sanctions_assessments n where n.previous_id = s.id))),
    'speak_up', jsonb_build_object(
      'handlers', (select count(*) from public.speak_up_handlers h where h.organisation_id = p_org),
      'reports', (select count(*) from public.speak_up_cases s where s.organisation_id = p_org and s.received_at >= v_year),
      'bribery', (select count(*) from public.speak_up_cases s where s.organisation_id = p_org and s.received_at >= v_year and s.category = 'Bribery or corruption'),
      'bribery_open', (select count(*) from public.speak_up_cases s where s.organisation_id = p_org and s.category = 'Bribery or corruption' and s.status <> 'closed')),
    'assessment', (select jsonb_build_object('approved_at', a.approved_at, 'next_review_on', a.next_review_on,
                          'risks', (select count(*) from public.abc_risks r where r.assessment_id = a.id),
                          'high', (select count(*) from public.abc_risks r where r.assessment_id = a.id and coalesce(r.residual_likelihood, r.likelihood) * coalesce(r.residual_impact, r.impact) >= 15),
                          'no_owner', (select count(*) from public.abc_risks r where r.assessment_id = a.id and r.owner_user_id is null))
                   from public.abc_assessments a where a.organisation_id = p_org and a.status = 'approved' order by a.approved_at desc limit 1)
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Ladder up
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements',
                          'credit_facilities', 'asic_filings', 'entities', 'compliance_obligations', 'whs_incidents', 'whs_hazards', 'privacy_breaches',
                          'abc_risks', 'abc_programme', 'abc_assessments'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%abc_risks%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- Anti-bribery: high residual risks in the latest approved assessment
    select 'abc_risks', ar.id, 'Anti-bribery', app.risk_feed_category(p_review, array['bribery and corruption', 'anti-bribery', 'legal and compliance', 'legal', 'compliance']),
           'High bribery risk: ' || left(ar.description, 160) || coalesce(' (' || ar.countries || ')', '')
           || E'\n' || 'Score ' || (coalesce(ar.residual_likelihood, ar.likelihood) * coalesce(ar.residual_impact, ar.impact)) || ' of 25 after controls',
           coalesce(nullif(btrim(ar.actions), ''), 'Strengthen the controls'),
           (select coalesce(nullif(btrim(p.full_name), ''), u.email)::text from auth.users u left join public.people p on p.user_id = u.id and p.organisation_id = v_org where u.id = ar.owner_user_id limit 1),
           ar.action_due_on
    from public.abc_risks ar
    where ar.organisation_id = v_org
      and ar.assessment_id = (select a.id from public.abc_assessments a where a.organisation_id = v_org and a.status = 'approved' order by a.approved_at desc limit 1)
      and coalesce(ar.residual_likelihood, ar.likelihood) * coalesce(ar.residual_impact, ar.impact) >= 15
    union all
    -- Gaps in the adequate procedures map
    select 'abc_programme', ap.id, 'Anti-bribery', app.risk_feed_category(p_review, array['bribery and corruption', 'anti-bribery', 'legal and compliance', 'legal', 'compliance']),
           'Gap in anti-bribery procedures: ' || replace(ap.element_key, '_', ' ') || coalesce(E'\n' || left(ap.notes, 200), ''),
           'Close the gap: adequate procedures are the only defence to failing to prevent foreign bribery',
           (select coalesce(nullif(btrim(p.full_name), ''), u.email)::text from auth.users u left join public.people p on p.user_id = u.id and p.organisation_id = v_org where u.id = ap.owner_user_id limit 1),
           null::date
    from public.abc_programme ap
    where ap.organisation_id = v_org and ap.status = 'gap'
    union all
    -- The latest approved risk assessment is overdue for review
    select 'abc_assessments', aa.id, 'Anti-bribery', app.risk_feed_category(p_review, array['bribery and corruption', 'anti-bribery', 'legal and compliance', 'legal', 'compliance']),
           'Bribery risk assessment overdue for review (approved ' || to_char(aa.approved_at, 'FMDD Mon YYYY') || ')',
           'Review the bribery risks and have the board approve the assessment',
           null::text,
           aa.next_review_on
    from public.abc_assessments aa
    where aa.organisation_id = v_org and aa.status = 'approved' and aa.next_review_on < current_date
      and aa.id = (select a.id from public.abc_assessments a where a.organisation_id = v_org and a.status = 'approved' order by a.approved_at desc limit 1)
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%abc_risks%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: evidence for each element, and the approved assessment
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%abc_programme%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''abc_assessments'', ''abc_programme''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%abc_programme%' then
    v_def := replace(v_def, $x$  elsif p_table = 'privacy_breaches' then$x$, $x$  elsif p_table in ('abc_assessments', 'abc_programme') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    v_ok := v_org is not null and app.has_role(v_org, app.records_roles());
  elsif p_table = 'privacy_breaches' then$x$);
    if v_def not like '%abc_programme%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%abc_programme%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

create or replace function app.sensitive_subject(p_table text)
returns boolean language sql immutable as $$
  select p_table in ('expense_claims', 'dd_cases', 'share_movements', 'share_classes', 'esop_plans', 'esop_grants', 'convertibles', 'investor_consents',
                     'bank_accounts', 'credit_facilities', 'corporate_documents', 'asic_filings', 'annual_reviews', 'obligation_completions',
                     'whs_incidents', 'whs_hazards', 'whs_due_diligence', 'privacy_breaches', 'personal_info_holdings', 'automated_decisions',
                     'abc_assessments', 'abc_programme');
$$;
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.can_read_subject(text, uuid)'::regprocedure);
  if v_def not like '%abc_programme%' then
    v_def := replace(v_def, $x$  elsif p_table = 'privacy_breaches' then$x$, $x$  elsif p_table in ('abc_assessments', 'abc_programme') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    return v_org is not null and app.can_read_abc(v_org);
  elsif p_table = 'privacy_breaches' then$x$);
    if v_def not like '%abc_programme%' then
      raise exception 'Could not extend app.can_read_subject';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.abc_assessments, public.abc_risks, public.abc_programme from anon, authenticated;
grant select on public.abc_assessments, public.abc_risks, public.abc_programme to authenticated;
grant insert (organisation_id, title, assessed_on, scope, next_review_on), update (title, assessed_on, scope, next_review_on) on public.abc_assessments to authenticated;
grant insert (organisation_id, assessment_id, area, description, countries, likelihood, impact, controls, residual_likelihood, residual_impact, actions, action_due_on, owner_user_id),
      update (area, description, countries, likelihood, impact, controls, residual_likelihood, residual_impact, actions, action_due_on, owner_user_id)
  on public.abc_risks to authenticated;
grant delete on public.abc_risks to authenticated;
grant insert (organisation_id, element_key, status, notes, evidence, owner_user_id), update (status, notes, evidence, owner_user_id) on public.abc_programme to authenticated;
grant all on public.abc_assessments, public.abc_risks, public.abc_programme to service_role;

alter table public.abc_assessments enable row level security;
alter table public.abc_risks enable row level security;
alter table public.abc_programme enable row level security;
create policy abc_assessments_select on public.abc_assessments for select to authenticated using (app.can_read_abc(organisation_id));
create policy abc_assessments_insert on public.abc_assessments for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy abc_assessments_update on public.abc_assessments for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy abc_risks_select on public.abc_risks for select to authenticated using (app.can_read_abc(organisation_id) or owner_user_id = auth.uid());
create policy abc_risks_insert on public.abc_risks for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy abc_risks_update on public.abc_risks for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid());
create policy abc_risks_delete on public.abc_risks for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles())
         and exists (select 1 from public.abc_assessments a where a.id = assessment_id and a.status = 'draft'));
create policy abc_programme_select on public.abc_programme for select to authenticated using (app.can_read_abc(organisation_id) or owner_user_id = auth.uid());
create policy abc_programme_insert on public.abc_programme for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy abc_programme_update on public.abc_programme for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array['abc_assessments', 'abc_risks', 'abc_programme'] loop
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
grant execute on function app.privacy_managers() to authenticated;
grant execute on function app.valid_info_kinds(text[]) to authenticated;
grant execute on function app.can_read_document(uuid) to authenticated;
grant execute on function app.can_read_abc(uuid) to authenticated;
revoke execute on function public.approve_abc_assessment(uuid, text), public.abc_evidence(uuid) from public, anon;
grant execute on function public.approve_abc_assessment(uuid, text), public.abc_evidence(uuid) to authenticated;

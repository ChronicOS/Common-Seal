-- 0052: Regulatory checks (Tier 2 of the compliance sweep).
--
-- One pattern for three programmes:
--   employment   Fair Work and related obligations, driven by a workforce profile
--                (headcount, awards, casuals, fixed-term, labour hire, agreements)
--   consumer     Australian Consumer Law: guarantees, warranties, pricing, claims,
--                product safety reporting, and unfair contract terms
--   climate      Mandatory climate reporting (Corporations Act Ch 2M, AASB S2):
--                which group a company falls in, its first reporting year, and readiness
--
-- programme_profiles holds the answers that decide which items apply (per company,
-- or for the whole group). compliance_checks holds each item's status, notes,
-- evidence, owner and review date. The item library itself lives in the app, so
-- it can be updated as the law changes without a migration.
--
-- standard_form_contracts is a register of the organisation's standard terms
-- (customer T&Cs, supplier terms, licences) with an unfair contract terms review
-- of each: since 9 November 2023 an unfair term in a standard form consumer or
-- small business contract can attract a penalty, not just be void.
--
-- Ladder up: gaps, and standard form contracts with unresolved risky terms or an
-- overdue review, feed the Risk Register.

create table public.programme_profiles (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_id        uuid references public.entities (id) on delete cascade,      -- null: the whole group
  programme        text not null check (programme in ('employment', 'consumer', 'climate')),
  answers          jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index programme_profiles_one on public.programme_profiles (organisation_id, programme, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.compliance_checks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_id        uuid references public.entities (id) on delete cascade,
  programme        text not null check (programme in ('employment', 'consumer', 'climate')),
  item_key         text not null check (item_key ~ '^[a-z0-9_]{3,40}$'),
  status           text check (status is null or status in ('in_place', 'partly', 'gap', 'not_applicable')),
  notes            text,
  evidence         text,
  owner_user_id    uuid references auth.users (id) on delete set null,
  review_on        date,
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status is distinct from 'not_applicable' or char_length(btrim(coalesce(notes, ''))) >= 5)
);
create unique index compliance_checks_one on public.compliance_checks (organisation_id, programme, item_key, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.standard_form_contracts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  entity_id         uuid references public.entities (id) on delete set null,
  name              text not null check (char_length(btrim(name)) between 2 and 200),
  kind              text not null default 'customer' check (kind in ('customer', 'supplier', 'distributor', 'licence', 'subscription', 'website', 'other')),
  used_with         text not null default 'both' check (used_with in ('consumers', 'small_business', 'both', 'neither')),
  version           text,
  findings          jsonb not null default '{}'::jsonb check (jsonb_typeof(findings) = 'object'),   -- {term_key: 'ok' | 'risk' | 'fixed' | 'na'}
  notes             text,
  owner_user_id     uuid references auth.users (id) on delete set null,
  last_reviewed_on  date,
  next_review_on    date,
  status            text not null default 'current' check (status in ('current', 'retired')),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create or replace function app.guard_regulatory()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_val text;
begin
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if tg_table_name = 'programme_profiles' then
    new.updated_by := auth.uid();
    return new;
  end if;
  if new.owner_user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.owner_user_id and m.is_active) then
    raise exception 'The owner must be an active member of this organisation';
  end if;
  if tg_table_name = 'compliance_checks' then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    for v_val in select value from jsonb_each_text(new.findings) loop
      if v_val not in ('ok', 'risk', 'fixed', 'na') then
        raise exception 'Each term is ok, a risk, fixed, or not applicable';
      end if;
    end loop;
    if new.last_reviewed_on > current_date then
      raise exception 'The review date cannot be in the future';
    end if;
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  end if;
  return new;
end;
$$;
create trigger programme_profiles_guard before insert or update on public.programme_profiles for each row execute function app.guard_regulatory();
create trigger compliance_checks_guard before insert or update on public.compliance_checks for each row execute function app.guard_regulatory();
create trigger standard_form_contracts_guard before insert or update on public.standard_form_contracts for each row execute function app.guard_regulatory();

create or replace function app.can_read_regulatory(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, app.board_read_roles()) or app.has_role(p_org, array['auditor']::public.member_role[]);
$$;

-- ---------------------------------------------------------------------
-- Ladder up
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements',
                          'credit_facilities', 'asic_filings', 'entities', 'compliance_obligations', 'whs_incidents', 'whs_hazards', 'privacy_breaches',
                          'abc_risks', 'abc_programme', 'abc_assessments', 'compliance_checks', 'standard_form_contracts'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%compliance_checks%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- Regulatory checks: items recorded as a gap
    select 'compliance_checks', cc.id,
           case cc.programme when 'employment' then 'Employment law' when 'consumer' then 'Consumer law' else 'Climate reporting' end,
           app.risk_feed_category(p_review, case cc.programme when 'employment' then array['people', 'employment', 'legal and compliance', 'legal', 'compliance']
                                                              when 'consumer' then array['customers', 'consumer', 'legal and compliance', 'legal', 'compliance']
                                                              else array['climate', 'environment', 'sustainability', 'legal and compliance', 'legal', 'compliance'] end),
           'Gap: ' || replace(cc.item_key, '_', ' ') || coalesce(' (' || en.name || ')', '') || coalesce(E'\n' || left(cc.notes, 200), ''),
           'Close the gap',
           (select coalesce(nullif(btrim(p.full_name), ''), u.email)::text from auth.users u left join public.people p on p.user_id = u.id and p.organisation_id = v_org where u.id = cc.owner_user_id limit 1),
           cc.review_on
    from public.compliance_checks cc
    left join public.entities en on en.id = cc.entity_id
    where cc.organisation_id = v_org and cc.status = 'gap'
    union all
    -- Standard form contracts used with consumers or small businesses: risky terms, or no review
    select 'standard_form_contracts', sf.id, 'Consumer law',
           app.risk_feed_category(p_review, array['customers', 'consumer', 'contracts', 'legal and compliance', 'legal', 'compliance']),
           case when exists (select 1 from jsonb_each_text(sf.findings) f where f.value = 'risk')
                then 'Possible unfair terms in ' || sf.name || ': ' || (select count(*) from jsonb_each_text(sf.findings) f where f.value = 'risk') || ' term(s) to fix'
                when sf.last_reviewed_on is null then sf.name || ' has not been reviewed for unfair contract terms'
                else sf.name || ' is overdue for its unfair contract terms review' end,
           'Fix or remove the terms: unfair terms in standard form consumer and small business contracts can attract penalties',
           (select coalesce(nullif(btrim(p.full_name), ''), u.email)::text from auth.users u left join public.people p on p.user_id = u.id and p.organisation_id = v_org where u.id = sf.owner_user_id limit 1),
           sf.next_review_on
    from public.standard_form_contracts sf
    where sf.organisation_id = v_org and sf.status = 'current' and sf.used_with <> 'neither'
      and (exists (select 1 from jsonb_each_text(sf.findings) f where f.value = 'risk')
           or sf.last_reviewed_on is null
           or sf.next_review_on < current_date)
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%compliance_checks%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: evidence for a check, and each contract's marked-up review
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%compliance_checks%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''compliance_checks'', ''standard_form_contracts''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%compliance_checks%' then
    v_def := replace(v_def, $x$  elsif p_table in ('abc_assessments', 'abc_programme') then$x$, $x$  elsif p_table in ('compliance_checks', 'standard_form_contracts') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    v_ok := v_org is not null and app.has_role(v_org, app.records_roles());
  elsif p_table in ('abc_assessments', 'abc_programme') then$x$);
    if v_def not like '%compliance_checks%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%compliance_checks%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

create or replace function app.sensitive_subject(p_table text)
returns boolean language sql immutable as $$
  select p_table in ('expense_claims', 'dd_cases', 'share_movements', 'share_classes', 'esop_plans', 'esop_grants', 'convertibles', 'investor_consents',
                     'bank_accounts', 'credit_facilities', 'corporate_documents', 'asic_filings', 'annual_reviews', 'obligation_completions',
                     'whs_incidents', 'whs_hazards', 'whs_due_diligence', 'privacy_breaches', 'personal_info_holdings', 'automated_decisions',
                     'abc_assessments', 'abc_programme', 'compliance_checks', 'standard_form_contracts', 'acquisitions');
$$;
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.can_read_subject(text, uuid)'::regprocedure);
  if v_def not like '%compliance_checks%' then
    v_def := replace(v_def, $x$  elsif p_table in ('abc_assessments', 'abc_programme') then$x$, $x$  elsif p_table in ('compliance_checks', 'standard_form_contracts') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    return v_org is not null and app.can_read_regulatory(v_org);
  elsif p_table in ('abc_assessments', 'abc_programme') then$x$);
    if v_def not like '%compliance_checks%' then
      raise exception 'Could not extend app.can_read_subject';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.programme_profiles, public.compliance_checks, public.standard_form_contracts from anon, authenticated;
grant select on public.programme_profiles, public.compliance_checks, public.standard_form_contracts to authenticated;
grant insert (organisation_id, entity_id, programme, answers), update (answers) on public.programme_profiles to authenticated;
grant insert (organisation_id, entity_id, programme, item_key, status, notes, evidence, owner_user_id, review_on),
      update (status, notes, evidence, owner_user_id, review_on)
  on public.compliance_checks to authenticated;
grant insert (organisation_id, entity_id, name, kind, used_with, version, findings, notes, owner_user_id, last_reviewed_on, next_review_on, status),
      update (entity_id, name, kind, used_with, version, findings, notes, owner_user_id, last_reviewed_on, next_review_on, status)
  on public.standard_form_contracts to authenticated;
grant all on public.programme_profiles, public.compliance_checks, public.standard_form_contracts to service_role;

alter table public.programme_profiles enable row level security;
alter table public.compliance_checks enable row level security;
alter table public.standard_form_contracts enable row level security;
create policy programme_profiles_select on public.programme_profiles for select to authenticated using (app.can_read_regulatory(organisation_id));
create policy programme_profiles_insert on public.programme_profiles for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy programme_profiles_update on public.programme_profiles for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy compliance_checks_select on public.compliance_checks for select to authenticated using (app.can_read_regulatory(organisation_id) or owner_user_id = auth.uid());
create policy compliance_checks_insert on public.compliance_checks for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy compliance_checks_update on public.compliance_checks for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid());
create policy standard_form_contracts_select on public.standard_form_contracts for select to authenticated using (app.can_read_regulatory(organisation_id) or owner_user_id = auth.uid());
create policy standard_form_contracts_insert on public.standard_form_contracts for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy standard_form_contracts_update on public.standard_form_contracts for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.records_roles()) or owner_user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array['programme_profiles', 'compliance_checks', 'standard_form_contracts'] loop
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
grant execute on function app.can_read_regulatory(uuid) to authenticated;
